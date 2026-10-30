const { test } = require("node:test");
const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const { Writable } = require("node:stream");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { callCopilot, parseCopilotOutput } = require("./copilot-client");
const { NewsletterPolisher } = require("./polisher");
const { NewsletterGenerator } = require("./generator");

function output(content, exitCode = 0) {
  return [
    { type: "session.start", data: {} },
    { type: "assistant.message", data: { content, toolRequests: [] } },
    { type: "result", exitCode },
  ].map(JSON.stringify).join("\n");
}

test("extracts only final assistant content from CLI events", () => {
  assert.equal(parseCopilotOutput(output("# Newsletter")), "# Newsletter");
});

test("rejects unsuccessful, empty, missing, and malformed CLI results", () => {
  assert.throws(() => parseCopilotOutput(output("partial", 1)), /did not complete/);
  assert.throws(() => parseCopilotOutput(output("")), /no newsletter content/);
  assert.throws(() => parseCopilotOutput('{"type":"session.start"}'), /did not complete/);
  assert.throws(() => parseCopilotOutput("not JSON"), SyntaxError);
});

test("pipes prompts without a shell and disables tools", async (t) => {
  let input = "";
  let invocation;
  t.mock.method(childProcess, "execFile", (executable, args, options, callback) => {
    invocation = { executable, args, options };
    const stdin = new Writable({
      write(chunk, encoding, done) { input += chunk; done(); },
    });
    process.nextTick(() => callback(null, output("polished")));
    return { stdin };
  });
  const prompt = "Newsletter with $variables, `code`, and quotes ".repeat(1000);
  assert.equal(await callCopilot([{ role: "user", content: prompt }]), "polished");
  assert.equal(input, `## USER\n\n${prompt}`);
  assert(!invocation.args.includes(prompt));
  assert(invocation.args.includes("--available-tools="));
  assert(invocation.args.includes("--no-custom-instructions"));
  assert(!invocation.args.includes("--allow-all-tools"));
  assert(!invocation.options.shell);
  assert.equal(invocation.options.timeout, 300_000);
  assert.equal(invocation.options.env.GITHUB_TOKEN, undefined);
  assert.equal(invocation.options.env.GH_TOKEN, undefined);
  assert.equal(invocation.options.env.OPENAI_API_KEY, undefined);
});

test("passes an explicitly requested model", async (t) => {
  t.mock.method(childProcess, "execFile", (executable, args, options, callback) => {
    assert.deepEqual(args.slice(-2), ["--model", "test-model"]);
    process.nextTick(() => callback(null, output("polished")));
    return { stdin: new Writable({ write(chunk, encoding, done) { done(); } }) };
  });
  await callCopilot([{ role: "user", content: "test" }], "test-model");
});

test("CLI failures reject without a provider fallback", async (t) => {
  t.mock.method(childProcess, "execFile", (executable, args, options, callback) => {
    process.nextTick(() => callback(Object.assign(new Error("not installed"), { code: "ENOENT" }), ""));
    return { stdin: new Writable({ write(chunk, encoding, done) { done(); } }) };
  });
  await assert.rejects(callCopilot([{ role: "user", content: "test" }]), /Copilot CLI failed \(ENOENT\)/);
});

test("quality errors and CLI failures preserve the original draft", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "newsletter-polisher-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const draftPath = path.join(dir, "draft.md");
  const draft = "## Documentation Updates\n\n" + Array.from({ length: 5 }, (_, i) =>
    `* **[Item ${i}](https://example.com/${i})**: [NEEDS DESCRIPTION]`
  ).join("\n");
  fs.writeFileSync(draftPath, draft);
  const polisher = new NewsletterPolisher(2026, 10, { draftPath, collectedPath: path.join(dir, "missing.json") });
  t.mock.method(polisher, "_callModel", async () => { throw new Error("unauthorized"); });
  await assert.rejects(polisher.polish(), /unauthorized/);
  assert.equal(fs.readFileSync(draftPath, "utf8"), draft);
  polisher._callModel = async () => draft.replaceAll("[NEEDS DESCRIPTION]", "Description.").replace("https://example.com/0", "https://example.com/replaced");
  await assert.rejects(polisher.polish(), /URLs from original draft were dropped/);
  assert.equal(fs.readFileSync(draftPath, "utf8"), draft);
});

test("polishes and saves only validated content", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "newsletter-success-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const draftPath = path.join(dir, "draft.md");
  const draft = "## Documentation Updates\n\n" + Array.from({ length: 5 }, (_, i) =>
    `* **[Item ${i}](https://example.com/${i})**: [NEEDS DESCRIPTION]`
  ).join("\n");
  fs.writeFileSync(draftPath, draft);
  const polisher = new NewsletterPolisher(2026, 10, { draftPath, collectedPath: path.join(dir, "missing.json") });
  t.mock.method(polisher, "_callModel", async () => draft.replaceAll("[NEEDS DESCRIPTION]", "Updated operator guidance."));
  const polished = await polisher.polish();
  assert(!polished.includes("[NEEDS DESCRIPTION]"));
  assert.equal(fs.readFileSync(draftPath, "utf8"), draft);
  polisher.save(polished);
  assert.equal(fs.readFileSync(draftPath, "utf8"), polished);
});

test("tracking preserves query parameters and anchors across generation and polish", () => {
  const generator = new NewsletterGenerator(2026, 10);
  const polisher = new NewsletterPolisher(2026, 10);
  const source = "https://learn.microsoft.com/azure/aks/test?view=latest#configuration";
  const tracked = generator._addUtm(source);
  const content = `* **[Item](${tracked})**: Operator guidance.`;
  const polished = polisher._enforceUtm(content);
  assert.equal(polisher._enforceUtm(polished), polished);
  const url = new URL(polished.match(/\]\(([^)]+)\)/)[1]);
  assert.equal(url.hash, "#configuration");
  assert.equal(url.searchParams.get("view"), "latest");
  assert.equal(url.searchParams.getAll("utm_source").length, 1);
  assert(!polisher._validateOutput(polished, `* **[Item](${source})**: Operator guidance.`).some((issue) => issue.includes("URLs")));
});

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

test("rejects BYOK configuration before starting a provider request", async (t) => {
  const previous = process.env.COPILOT_PROVIDER_BASE_URL;
  t.after(() => {
    if (previous === undefined) delete process.env.COPILOT_PROVIDER_BASE_URL;
    else process.env.COPILOT_PROVIDER_BASE_URL = previous;
  });
  process.env.COPILOT_PROVIDER_BASE_URL = "https://example.com/paid-provider";
  t.mock.method(childProcess, "execFile", () => assert.fail("BYOK must not start a child process"));
  await assert.rejects(callCopilot([{ role: "user", content: "test" }]), /not a separately billed BYOK provider/);
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

test("keeps source-limited lifecycle announcements title-only", async (t) => {
  const url = "https://azure.microsoft.com/en-us/updates/581130/";
  const entries = [
    `* **[Generally Available: Confidential VMs with Intel TDX support on AKS](${url})**`,
    ...Array.from({ length: 4 }, (_, index) =>
      `* **[Supported feature ${index + 1}](https://example.com/${index + 1})**: Source-backed description.`
    ),
  ];
  const draft = `## General Availability Announcements\n\n${entries.join("\n\n")}`;
  const collectedData = {
    azure_updates: [{
      title: "Generally Available: Confidential VMs with Intel TDX support on AKS",
      url,
      summary: "This stale summary must not reach the polisher.",
      suppressGeneratedDescription: true,
    }],
  };
  const polisher = new NewsletterPolisher(2026, 11);
  t.mock.method(polisher, "_callModel", async () => assert.fail("title-only section should not be polished"));

  const polished = await polisher._polishBySection(draft, collectedData);
  assert.equal(polished, draft);
  assert.deepEqual(polisher._validateOutput(polished, draft, collectedData), []);
  assert(!polisher._summarizeCollected(collectedData).includes("stale summary"));
  assert(!polisher._splitIntoSections(draft, collectedData)[0].context.includes("stale summary"));

  const expanded = draft.replace(`(${url})**`, `(${url})**: Hardware-backed protection extends to Kubernetes workloads.`);
  assert(polisher._validateOutput(expanded, draft, collectedData)
    .some((issue) => issue.includes("title/status-only announcements have unsupported descriptions")));
});

test("does not polish the fixed releases and roadmap reference links", async (t) => {
  const draft = [
    "## Releases and Roadmap",
    "",
    "* **[AKS GitHub Releases](https://github.com/Azure/AKS/releases/)**",
    "* **[AKS Public Roadmap](https://github.com/orgs/Azure/projects/685/views/1)**",
  ].join("\n");
  const polisher = new NewsletterPolisher(2026, 11);
  t.mock.method(polisher, "_callModel", async () => assert.fail("static links do not need descriptions"));

  assert.equal(await polisher._polishBySection(draft, { aks_releases: [] }), draft);
});

test("protects title/status-only items while polishing other entries in the section", async (t) => {
  const url = "https://azure.microsoft.com/en-us/updates/581130/";
  const draft = [
    "## General Availability Announcements",
    "",
    `* **[Generally Available: Confidential VMs with Intel TDX support on AKS](${url})**`,
    "",
    "* **[Another feature](https://example.com/feature)**: [NEEDS DESCRIPTION]",
  ].join("\n");
  const collectedData = {
    azure_updates: [{
      title: "Generally Available: Confidential VMs with Intel TDX support on AKS",
      url,
      summary: "",
      suppressGeneratedDescription: true,
    }],
  };
  const polisher = new NewsletterPolisher(2026, 11);
  const response = `${draft.replace("[NEEDS DESCRIPTION]", "The source describes the supported change.")}\n`;
  t.mock.method(polisher, "_callModel", async (messages) => {
    assert.match(messages[1].content, /TITLE\/STATUS-ONLY ITEMS/);
    assert.match(messages[1].content, /Preserve these entries exactly as title-only/);
    return response;
  });

  const polished = await polisher._polishBySection(draft, collectedData);
  assert.equal(polished, response);
  const issues = polisher._validateOutput(polished, draft, collectedData);
  assert(!issues.some((issue) => issue.includes("unsupported descriptions")));
  assert(!issues.some((issue) => issue.includes("items have no description")));
});

test("retries entries left without descriptions and keeps the final completeness gate strict", async (t) => {
  const url = "https://techcommunity.microsoft.com/blog/aksblog/aks-announcement/12345";
  const target = `* **[AKS announcement](${url})**`;
  const others = Array.from({ length: 4 }, (_, index) =>
    `* **[Other item ${index + 1}](https://example.com/${index + 1})**: Source-backed description.`
  );
  const draft = `## Community Blogs\n\n${[`${target}: [NEEDS DESCRIPTION]`, ...others].join("\n\n")}`;
  const firstOutput = `## Community Blogs\n\n${[target, ...others].join("\n\n")}`;
  const correctedOutput = firstOutput.replace(
    target,
    `${target}: The source describes the AKS networking announcement.`
  );
  const collectedData = {
    techcommunity: [
      ...Array.from({ length: 20 }, (_, index) => ({
        title: `Unrelated AKS post ${index}`,
        url: `https://example.com/${index}`,
        summary: "Unrelated context.",
      })),
      {
        title: "AKS announcement",
        url,
        summary: "Source context: the announcement covers AKS networking.",
      },
    ],
  };
  const polisher = new NewsletterPolisher(2026, 11);
  let calls = 0;
  t.mock.method(polisher, "_callModel", async (messages) => {
    calls++;
    if (calls === 1) return firstOutput;
    assert.match(messages.at(-1).content, /still have no description/);
    assert.match(messages.at(-1).content, /AKS announcement/);
    assert.match(messages[1].content, /Source context: the announcement covers AKS networking/);
    return correctedOutput;
  });

  const polished = await polisher._polishBySection(draft, collectedData);
  assert.equal(calls, 2);
  assert.deepEqual(polisher._validateOutput(polished, draft, collectedData), []);
  assert(polisher._validateOutput(firstOutput, draft, collectedData)
    .some((issue) => issue.includes("1/5 items have no description")));
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

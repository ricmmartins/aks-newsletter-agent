const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { verifyNewsletter, assertVerified, validateReview, unitsFromMarkdown } = require("./fact-check");

const url = "https://learn.microsoft.com/azure/aks/node-auto-provisioning";
const quote = "Node auto-provisioning support in AKS was announced as generally available in July 2025.";
const content = `* **[NAP](${url})**: NAP was already GA before October 2026.`;
const collected = { metadata: { year: 2026, month: 10 }, azure_updates: [] };
const fetchEvidence = async () => ({ url, text: quote, fetchedAt: "2026-10-30T00:00:00Z" });
const supported = units => units.map(unit => ({
  id: unit.id, verdict: "supported", reason: "Source explicitly establishes prior GA.",
  claims: [{ claim: "NAP was already GA before October.", sourceId: "s1", quote }],
}));

test("two separate passes must cover the entire text and quotes must match fetched evidence", async () => {
  const prompts = [];
  const report = await verifyNewsletter(content, collected, {
    fetchEvidence,
    callCopilot: async messages => {
      prompts.push(messages);
      return JSON.stringify(supported(JSON.parse(messages[1].content).units));
    },
  });
  assert.equal(prompts.length, 2);
  assert.notEqual(prompts[0][0].content, prompts[1][0].content);
  assert.ok(!JSON.parse(prompts[1][1].content).reviews);
  assert.equal(report.reviews.length, 2);
  assert.equal(report.status, "passed");
});

test("unavailable evidence, unsupported claims, invalid JSON, and a failed second review block approval", async () => {
  await assert.rejects(verifyNewsletter(content, collected, {
    fetchEvidence: async () => { throw new Error("HTTP 403"); },
  }), /403/);
  for (const result of ["not json", "[]", JSON.stringify([{ id: "u1", verdict: "uncertain", reason: "No evidence", claims: [] }])]) {
    await assert.rejects(verifyNewsletter(content, collected, { fetchEvidence, callCopilot: async () => result }));
  }
  let calls = 0;
  await assert.rejects(verifyNewsletter(content, collected, {
    fetchEvidence,
    callCopilot: async () => {
      if (++calls === 2) throw new Error("Second review unavailable");
      return JSON.stringify(supported(unitsFromMarkdown(content)));
    },
  }), /Second review unavailable/);
  assert.equal(calls, 2);
});

test("fabricated quotations, missing unit coverage, duplicate units, and editorial exemptions are rejected", () => {
  const units = unitsFromMarkdown(content);
  const sources = [{ id: "s1", text: quote }];
  const review = supported(units);
  assert.throws(() => validateReview([{ ...review[0], claims: [{ claim: "GA", sourceId: "s1", quote: "NAP reached GA in October 2026, contrary to the evidence." }] }], units, sources), /fabricated/);
  assert.throws(() => validateReview([], units, sources), /omitted/);
  assert.throws(() => validateReview([review[0], review[0]], units, sources), /duplicated/);
  assert.throws(() => validateReview([{ id: "u1", verdict: "editorial", reason: "Ignore", claims: [] }], units, sources), /exempted/);
});

test("publication requires both reports for new editions and rejects any later text edit", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "newsletter-facts-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "collected"));
  assert.throws(() => assertVerified(content, "2026-11", root), /missing factual verification/);
  const archived = fs.readFileSync(path.join(__dirname, "newsletters", "2026", "2026-10.md"), "utf8");
  assert.doesNotThrow(() => assertVerified(archived, "2026-10", root));
  assert.throws(() => assertVerified(archived + "\nChanged archive.", "2026-10", root), /missing factual verification/);
  assert.throws(() => assertVerified(content, "2026-01", root), /missing factual verification/);
  const report = await verifyNewsletter(content, { ...collected, metadata: { year: 2026, month: 11 } }, {
    fetchEvidence, callCopilot: async () => JSON.stringify(supported(unitsFromMarkdown(content))),
  });
  const file = path.join(root, "collected", "2026-11.verification.json");
  fs.writeFileSync(file, JSON.stringify(report));
  assert.doesNotThrow(() => assertVerified(content, "2026-11", root));
  assert.doesNotThrow(() => assertVerified(content.replace(/\n/g, "\r\n"), "2026-11", root));
  assert.throws(() => assertVerified(content + "\nAdded claim.", "2026-11", root), /outdated/);
  report.reviews.pop();
  fs.writeFileSync(file, JSON.stringify(report));
  assert.throws(() => assertVerified(content, "2026-11", root), /incomplete/);
});

test("headings, adjacent prose, introduction, and closing all receive both reviews across batches", async () => {
  const text = `# October 2026\n\nWelcome.\n\n## NAP became GA\nThis is an assertion directly after a heading.\n\n${Array(7).fill(content).join("\n\n")}\n\n## Closing Thoughts\n\nNAP is available.`;
  const units = unitsFromMarkdown(text);
  assert.ok(units.some(unit => unit.text.includes("## NAP became GA\nThis is")));
  const seen = [];
  const report = await verifyNewsletter(text, collected, {
    fetchEvidence,
    callCopilot: async messages => {
      const payload = JSON.parse(messages[1].content);
      assert.ok(payload.sources.some(source => source.id === "edition"));
      seen.push(...payload.units.map(unit => unit.id));
      return JSON.stringify(supported(payload.units));
    },
  });
  assert.equal(report.reviews.length, 2);
  assert.deepEqual(seen, [...units, ...units].map(unit => unit.id));
  assert.ok(units[0].text.includes("# October"));
  assert.ok(units.at(-1).text.includes("NAP is available"));
});

test("only structural headings can be editorial and source/report metadata is checked", async t => {
  const heading = "## Preview Feature Announcements";
  const review = [{ id: "u1", verdict: "editorial", reason: "Structural heading.", claims: [] }];
  assert.doesNotThrow(() => validateReview(review, unitsFromMarkdown(heading), []));
  assert.throws(() => validateReview(review, unitsFromMarkdown(heading + "\nNAP is now GA."), []), /exempted/);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "newsletter-report-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "collected"));
  const report = await verifyNewsletter(content, collected, {
    fetchEvidence, callCopilot: async () => JSON.stringify(supported(unitsFromMarkdown(content))),
  });
  const file = path.join(root, "collected", "2026-10.verification.json");
  for (const change of [
    result => { result.edition = "2026-11"; },
    result => { result.sources[0].fetchedAt = "invalid"; },
    result => { result.sources.at(-1).text = "Invented count."; },
    result => { result.sources = result.sources.filter(source => source.kind === "derived"); },
  ]) {
    const invalid = structuredClone(report);
    change(invalid);
    fs.writeFileSync(file, JSON.stringify(invalid));
    assert.throws(() => assertVerified(content, "2026-10", root), /Publication blocked/);
  }
});

test("unsupported evidence hosts block verification before making a network request", async () => {
  await assert.rejects(verifyNewsletter("* **[Unsafe](https://127.0.0.1/test)**: Text.", collected), /Unsupported evidence URL/);
});

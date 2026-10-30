const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { NewsletterPolisher } = require("./polisher");
const { verifyAndSaveReport } = require("./run");
const { assertVerified } = require("./fact-check");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "newsletter-runner-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "collected"));
  const polisher = new NewsletterPolisher(2026, 10, {
    collectedPath: path.join(root, "collected", "2026-10.json"),
    draftPath: path.join(root, "draft.md"),
  });
  const content = fs.readFileSync(path.join(__dirname, "newsletters", "2026", "2026-10.md"), "utf8");
  fs.writeFileSync(polisher.draftPath, content);
  fs.writeFileSync(polisher.collectedPath, JSON.stringify({ metadata: { year: 2026, month: 10 }, azure_updates: [] }));
  return { root, polisher, content, reportPath: path.join(root, "collected", "2026-10.verification.json") };
}

test("a failed recheck revokes previous approval and preserves the existing edition", async t => {
  const { root, polisher, content, reportPath } = fixture(t);
  assert.doesNotThrow(() => assertVerified(content, "2026-10", root));
  fs.writeFileSync(reportPath, JSON.stringify({ status: "passed" }));
  await assert.rejects(verifyAndSaveReport(polisher, content, async () => {
    assert.equal(JSON.parse(fs.readFileSync(reportPath, "utf8")).status, "pending");
    throw new Error("Second review rejected a claim.");
  }), /rejected/);
  assert.throws(() => assertVerified(content, "2026-10", root), /Publication blocked/);
  assert.equal(fs.readFileSync(polisher.draftPath, "utf8"), content);
});

test("verify-only saves a successful report without changing text and rejects mismatched metadata", async t => {
  const { polisher, content, reportPath } = fixture(t);
  const report = { status: "passed", reviews: [[], []] };
  await verifyAndSaveReport(polisher, content, async (text, data) => {
    assert.equal(text, content);
    assert.equal(data.metadata.month, 10);
    return report;
  });
  assert.deepEqual(JSON.parse(fs.readFileSync(reportPath, "utf8")), report);
  assert.equal(fs.readFileSync(polisher.draftPath, "utf8"), content);
  fs.writeFileSync(polisher.collectedPath, JSON.stringify({ metadata: { year: 2026, month: 11 } }));
  await assert.rejects(verifyAndSaveReport(polisher, content, async () => {
    assert.fail("Should not call the model for another edition's metadata.");
  }), /does not match/);
  assert.equal(JSON.parse(fs.readFileSync(reportPath, "utf8")).status, "pending");
});

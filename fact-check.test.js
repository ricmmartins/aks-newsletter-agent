const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const fetch = require("node-fetch");
const { verifyNewsletter, assertVerified, validateReview, unitsFromMarkdown, fetchEvidence: fetchSource } = require("./fact-check");

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

test("the reviewer treats standalone section headings as structural, not factual claims", async () => {
  const text = `## Community Blogs\n\n${content}`;
  let prompt;
  await verifyNewsletter(text, collected, {
    fetchEvidence,
    callCopilot: async messages => {
      prompt = messages[0].content;
      return JSON.stringify(supported(JSON.parse(messages[1].content).units));
    },
  });
  assert.match(prompt, /standalone structural section headings/);
  assert.match(prompt, /Do not exempt a heading combined with factual prose/);
  assert.doesNotThrow(() => validateReview(
    [{ id: "u1", verdict: "editorial", reason: "Structural heading.", claims: [] }],
    unitsFromMarkdown("## 📚 Community Blogs"),
    []
  ));
});

test("edition evidence counts empty sections and combines separate lists without implying classification", async () => {
  const text = `## Behavioral Changes\n\nNo behavioral changes are listed in this section.\n\n## Community Blogs\n\n${content}\n\nSome editorial text.\n\n${content}`;
  let summary;
  await verifyNewsletter(text, collected, {
    fetchEvidence,
    callCopilot: async messages => {
      const payload = JSON.parse(messages[1].content);
      summary = payload.sources.find(source => source.id === "edition").text;
      return JSON.stringify(supported(payload.units));
    },
  });
  assert.match(summary, /Behavioral Changes: 0 linked items\./);
  assert.match(summary, /Community Blogs: 2 linked items\./);
  assert.match(summary, /not proof of feature status/);
});

test("previous verification reports retain their original edition summary", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "newsletter-legacy-report-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "collected"));
  const text = `## Documentation Updates\n\nNo entries.\n\n## Behavioral Changes\n\n${content}`;
  const report = await verifyNewsletter(text, collected, {
    fetchEvidence, callCopilot: async messages => JSON.stringify(supported(JSON.parse(messages[1].content).units)),
  });
  report.sources.find(source => source.id === "edition").text =
    "Target edition: October 2026. Newsletter section item counts (not proof of feature status): Behavioral Changes: 1 linked items.";
  fs.writeFileSync(path.join(root, "collected", "2026-10.verification.json"), JSON.stringify(report));
  assert.doesNotThrow(() => assertVerified(text, "2026-10", root));
});

test("collector status evidence is limited to the recorded edition and checked at publication", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "newsletter-collector-status-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "collected"));
  const data = { ...collected, metadata: { ...collected.metadata, documentationUpdatesStatus: "unavailable" } };
  const report = await verifyNewsletter(content, data, {
    fetchEvidence, callCopilot: async messages => JSON.stringify(supported(JSON.parse(messages[1].content).units)),
  });
  assert.match(report.sources.find(source => source.id === "edition").text, /Collector reports AKS documentation change tracking is unavailable/);
  fs.writeFileSync(path.join(root, "collected", "2026-10.verification.json"), JSON.stringify(report));
  assert.throws(() => assertVerified(content, "2026-10", root), /missing collector status/);
  const collectedPath = path.join(root, "collected", "2026-10.json");
  fs.writeFileSync(collectedPath, JSON.stringify(data));
  assert.doesNotThrow(() => assertVerified(content, "2026-10", root));
  fs.writeFileSync(collectedPath, JSON.stringify(collected));
  assert.throws(() => assertVerified(content, "2026-10", root), /invalid collector status/);
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

test("HTML evidence retains source publication metadata removed with page headers", async () => {
  const articleUrl = "https://blog.aks.azure.com/2026/11/24/example";
  const result = await fetchSource(articleUrl, {
    fetch: async () => ({
      ok: true, status: 200, headers: { get: () => "text/html" },
      text: async () => `<html><head><title>AKS article title</title>
        <meta property="article:published_time" content="2026-11-24T00:00:00.000Z"></head>
        <body><header>Not article text</header><main>${"Article evidence. ".repeat(10)}</main></body></html>`,
    }),
  });
  assert.match(result.text, /Page title: AKS article title/);
  assert.match(result.text, /Article published time metadata: 2026-11-24T00:00:00\.000Z/);
  assert.match(result.text, /Article evidence/);
  assert.doesNotMatch(result.text, /Not article text/);
});

test("evidence fetch retries a timed-out response body and transient HTTP errors", async () => {
  let calls = 0;
  const waits = [];
  const result = await fetchSource(url, {
    timeoutMs: 15,
    sleep: async ms => waits.push(ms),
    fetch: async (_url, { signal }) => {
      calls++;
      if (calls === 1) return {
        ok: true, status: 200, headers: { get: () => "text/plain" },
        text: () => new Promise((resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("The user aborted a request.")), { once: true });
          setTimeout(resolve, 50);
        }),
      };
      if (calls === 2) return { ok: false, status: 503 };
      return { ok: true, status: 200, headers: { get: () => "text/plain" }, text: async () => quote.repeat(2) };
    },
  });
  assert.equal(calls, 3);
  assert.deepEqual(waits, [1000, 2000]);
  assert.equal(result.text, quote.repeat(2));
});

test("evidence fetch reports the URL and fails closed on persistent or non-transient errors", async () => {
  let calls = 0;
  await assert.rejects(fetchSource(url, {
    sleep: async () => {},
    fetch: async () => { calls++; const error = new Error("connection reset"); error.code = "ECONNRESET"; throw error; },
  }), error => error.message.includes(url) && /attempt 3.*connection reset/.test(error.message));
  assert.equal(calls, 3);
  calls = 0;
  await assert.rejects(fetchSource(url, {
    sleep: async () => assert.fail("HTTP 403 is not transient"),
    fetch: async () => { calls++; return { ok: false, status: 403 }; },
  }), error => error.message.includes(url) && /HTTP 403/.test(error.message));
  assert.equal(calls, 1);
});

test("a real node-fetch timeout during body streaming is retried", async t => {
  let calls = 0;
  let originalError;
  const server = http.createServer((request, response) => {
    calls++;
    response.writeHead(200, { "Content-Type": "text/plain" });
    response.write("Evidence starts here. ");
    if (calls === 1) {
      const timer = setTimeout(() => response.end(quote.repeat(2)), 500);
      response.on("close", () => clearTimeout(timer));
    } else {
      response.end(quote.repeat(2));
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const localUrl = `http://127.0.0.1:${server.address().port}/`;
  const result = await fetchSource(url, {
    timeoutMs: 200,
    sleep: async () => {},
    fetch: async (_url, options) => {
      const response = await fetch(localUrl, options);
      const readText = response.text.bind(response);
      response.text = async () => {
        try { return await readText(); }
        catch (error) { originalError = error; throw error; }
      };
      return response;
    },
  });
  assert.equal(calls, 2);
  assert.equal(originalError.message, "The user aborted a request.");
  assert.ok(result.text.includes(quote));
});

test("evidence redirects enforce the allowlist on each hop", async () => {
  let calls = 0;
  await assert.rejects(fetchSource(url, {
    fetch: async () => {
      calls++;
      return { ok: false, status: 302, headers: { get: () => "http://127.0.0.1/private" } };
    },
  }), /Unsupported evidence URL/);
  assert.equal(calls, 1);
});

test("Azure Update links resolve to official RSS evidence with lifecycle and publication metadata", async () => {
  const requested = [];
  const rss = `<?xml version="1.0"?>
    <rss><channel><item>
      <title>AKS feature is generally available</title>
      <link>https://azure.microsoft.com/en-us/updates/581130/</link>
      <guid>581130</guid>
      <category>Launched</category>
      <category>Azure Kubernetes Service</category>
      <pubDate>Tue, 03 Nov 2026 00:00:00 GMT</pubDate>
      <description><![CDATA[The feature is now generally available for Azure Kubernetes Service customers.]]></description>
    </item></channel></rss>`;
  const evidence = await fetchSource("https://azure.microsoft.com/en-us/updates/581130/", {
    fetch: async requestedUrl => {
      requested.push(requestedUrl);
      return {
        ok: true, status: 200, headers: { get: () => "application/rss+xml" },
        text: async () => rss,
      };
    },
  });
  assert.deepEqual(requested, ["https://www.microsoft.com/releasecommunications/api/v2/azure/rss/581130"]);
  assert.equal(evidence.url, requested[0]);
  assert.match(evidence.text, /Title: AKS feature is generally available/);
  assert.match(evidence.text, /Status: Launched/);
  assert.match(evidence.text, /Published: Tue, 03 Nov 2026/);
  assert.match(evidence.text, /Description: The feature is now generally available/);
  await assert.rejects(fetchSource("https://azure.microsoft.com/en-us/updates/"), /no numeric update ID/);
  await assert.rejects(fetchSource("https://azure.microsoft.com/en-us/updates/581130/", {
    fetch: async () => ({
      ok: true, status: 200, headers: { get: () => "text/html" }, text: async () => "A generic updates page.".repeat(20),
    }),
  }), /unexpected content type/);
});

test("factual review retains both the cited Azure Update URL and the RSS evidence URL", async () => {
  const requestedUrl = "https://azure.microsoft.com/en-us/updates/581130/";
  const feedUrl = "https://www.microsoft.com/releasecommunications/api/v2/azure/rss/581130";
  const evidenceText = "Title: [Launched] Generally Available: AKS feature";
  const newsletter = `* **[AKS feature](${requestedUrl})**: The feature is generally available.`;
  const report = await verifyNewsletter(newsletter, collected, {
    fetchEvidence: async url => ({ url: feedUrl, text: evidenceText, fetchedAt: "2026-11-30T00:00:00Z" }),
    callCopilot: async messages => {
      const payload = JSON.parse(messages[1].content);
      assert.equal(payload.sources[0].requestedUrl, requestedUrl);
      assert.equal(payload.sources[0].url, feedUrl);
      return JSON.stringify(payload.units.map(unit => ({
        id: unit.id, verdict: "supported", reason: "The linked official announcement states GA.",
        claims: [{ claim: "AKS feature is GA.", sourceId: "s1", quote: evidenceText }],
      })));
    },
  });
  assert.equal(report.sources[0].requestedUrl, requestedUrl);
  assert.equal(report.sources[0].url, feedUrl);
});

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ContentCollector } = require("./collector");
const { NewsletterGenerator } = require("./generator");

test("October NAP enhancements are not GA announcements or standalone references", async () => {
  const snapshot = JSON.parse(fs.readFileSync(path.join(__dirname, "collected", "2026-10.json"), "utf8"));
  const collector = new ContentCollector(2026, 10);
  collector.collected.aks_releases = snapshot.aks_releases;
  collector._fetchDocDescription = async () => { throw new Error("Release context must be retained"); };
  await collector._extractUpdatesFromReleases();
  const ga = collector.collected.azure_updates.filter(item => item.title.includes("generally available"));
  assert.deepEqual(ga.map(item => item.title), ["Identity bindings – now generally available"]);
  const nap = collector.collected.behavioral_changes.filter(item => item.title === "Node Auto Provisioning (NAP)");
  assert.equal(nap.length, 2);
  assert.match(nap[0].summary, /Capacity Buffers CRD/);
  assert.match(nap[0].summary, /osDiskType/);
  assert.match(nap[1].summary, /aksmanagednap/);
  assert.match(nap[1].summary, /external load balancers/);
  assert.equal(nap[0].sourceUrl, snapshot.aks_releases[0].url);
  assert.ok(!collector.collected.behavioral_changes.some(item => /^(document|Azure Karpenter Provider github issue)$/.test(item.title)));
});

test("corrected October data and edition distinguish NAP enhancements from GA", () => {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, "collected", "2026-10.json"), "utf8"));
  const generator = new NewsletterGenerator(2026, 10);
  generator.data = data;
  const ga = generator.generateGAAnnouncements();
  assert.equal((ga.match(/\*\*\[/g) || []).length, 3);
  assert.doesNotMatch(ga, /Node Auto Provisioning|NAP|Karpenter/);
  assert.match(generator.generateBehavioralChanges(), /Capacity Buffers/);
  const edition = fs.readFileSync(path.join(__dirname, "newsletters", "2026", "2026-10.md"), "utf8");
  const gaSection = edition.split("## ✅ General Availability Announcements")[1].split("\n---")[0];
  assert.equal((gaSection.match(/\*\*\[/g) || []).length, 3);
  assert.doesNotMatch(gaSection, /NAP|Node Auto Provisioning/);
  assert.doesNotMatch(edition, /NAP reaches general availability|NAP general availability transition|12 features reaching General Availability|18 platform announcements/);
  assert.match(edition, /Capacity Buffers CRD/);
});

test("release headings support both depths and retain nested evidence without promoting it", async () => {
  for (const heading of ["###", "####"]) {
    const collector = new ContentCollector(2026, 10);
    collector.collected.aks_releases = [{
      date: "2026-10-25",
      url: "https://example.com/release",
      body: `${heading} Features
* [Existing service](https://example.com/service) now supports additional settings:
  * [A child feature](https://example.com/child) is now generally available.
* [New capability](https://example.com/new) is now generally available.

${heading} Behavioral changes
* [Service defaults](https://example.com/defaults) now use explicit settings.
`,
    }];
    await collector._extractUpdatesFromReleases();
    assert.deepEqual(collector.collected.azure_updates.map(item => item.url), ["https://example.com/new"]);
    assert.equal(collector.collected.behavioral_changes.length, 2);
    assert.match(collector.collected.behavioral_changes[0].summary, /child feature/);
    assert.ok(!collector.collected.azure_updates.some(item => item.title.includes("Existing service")));
  }
});

test("Tavily search uses the exact month window, source domains, and published dates", async () => {
  const originalKey = process.env.TAVILY_API_KEY;
  process.env.TAVILY_API_KEY = "test-key";
  try {
    const collector = new ContentCollector(2026, 11);
    const requests = [];
    collector._safeFetch = async (url, options) => {
      requests.push({ url, options });
      return { json: async () => ({ results: [
        {
          title: "AKS networking update",
          url: "https://techcommunity.microsoft.com/blog/aksblog/123",
          content: "Azure Kubernetes Service AKS networking changes.",
          published_date: "2026-11-18",
        },
        {
          title: "AKS update outside month",
          url: "https://techcommunity.microsoft.com/blog/aksblog/december",
          content: "Azure Kubernetes Service AKS networking changes.",
          published_date: "2026-12-01",
        },
        {
          title: "AKS result on another domain",
          url: "https://example.com/blog/aks",
          content: "Azure Kubernetes Service AKS networking changes.",
          published_date: "2026-11-18",
        },
      ] }) };
    };

    await collector.collectTavilySearch();
    assert.equal(requests.length, 3);
    assert.ok(requests.every(({ url }) => url === "https://api.tavily.com/search"));
    const payload = JSON.parse(requests[0].options.body);
    assert.equal(payload.api_key, "test-key");
    assert.equal(payload.start_date, "2026-10-31");
    assert.equal(payload.end_date, "2026-12-01");
    assert.equal(payload.filter_by_published_date, true);
    assert.deepEqual(payload.include_domains, ["techcommunity.microsoft.com"]);
    assert.equal(collector.collected.techcommunity_search.length, 1);
    assert.equal(collector.collected.techcommunity_search[0].source, "Tavily Search");
    assert.equal(collector.collected.techcommunity_search[0].posted, "2026-11-18");
  } finally {
    if (originalKey === undefined) delete process.env.TAVILY_API_KEY;
    else process.env.TAVILY_API_KEY = originalKey;
  }
});

test("web search falls back to Bing HTML when Tavily is not configured", async () => {
  const originalKey = process.env.TAVILY_API_KEY;
  delete process.env.TAVILY_API_KEY;
  try {
    const collector = new ContentCollector(2026, 11);
    const requests = [];
    collector._safeFetch = async url => {
      requests.push(url);
      return {
        text: async () => `<ul><li class="b_algo">
          <h2><a href="https://techcommunity.microsoft.com/blog/aksblog/123">AKS networking update</a></h2>
          <div class="b_caption"><p>Azure Kubernetes Service AKS networking changes.</p></div>
        </li></ul>`,
      };
    };

    await collector.collectTavilySearch();
    assert.equal(requests.length, 3);
    assert.ok(requests.every(url => url.startsWith("https://www.bing.com/search?")));
    assert.equal(collector.collected.techcommunity_search.length, 1);
    assert.equal(collector.collected.techcommunity_search[0].source, "Bing Search");
  } finally {
    if (originalKey !== undefined) process.env.TAVILY_API_KEY = originalKey;
  }
});

test("web search falls back to Bing HTML when Tavily is unavailable", async () => {
  const originalKey = process.env.TAVILY_API_KEY;
  process.env.TAVILY_API_KEY = "test-key";
  try {
    const collector = new ContentCollector(2026, 11);
    const requests = [];
    collector._safeFetch = async (url) => {
      requests.push(url);
      if (url === "https://api.tavily.com/search") return null;
      return {
        text: async () => `<ul><li class="b_algo">
          <h2><a href="https://techcommunity.microsoft.com/blog/aksblog/123">AKS networking update</a></h2>
          <div class="b_caption"><p>Azure Kubernetes Service AKS networking changes.</p></div>
        </li></ul>`,
      };
    };

    await collector.collectTavilySearch();
    assert.equal(requests.length, 6);
    assert.equal(requests.filter(url => url === "https://api.tavily.com/search").length, 3);
    assert.equal(requests.filter(url => url.startsWith("https://www.bing.com/search?")).length, 3);
    assert.equal(collector.collected.techcommunity_search.length, 1);
    assert.equal(collector.collected.techcommunity_search[0].source, "Bing Search");
  } finally {
    if (originalKey === undefined) delete process.env.TAVILY_API_KEY;
    else process.env.TAVILY_API_KEY = originalKey;
  }
});

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ContentCollector } = require("./collector");
const { NewsletterGenerator } = require("./generator");
const { NewsletterPolisher } = require("./polisher");

test("AKS documentation collection skips the unavailable source and records its status", () => {
  const collector = new ContentCollector(2026, 11);
  collector._safeFetch = async () => {
    assert.fail("Unavailable documentation source must not be requested");
  };

  collector.reportAKSDocChangesUnavailable();

  assert.equal(collector.collected.metadata.documentationUpdatesStatus, "unavailable");
  assert.deepEqual(collector.collected.aks_docs_commits, []);
});

test("documentation section reports unavailable tracking instead of claiming no updates", () => {
  const generator = new NewsletterGenerator(2026, 11);
  generator.data = {
    metadata: { documentationUpdatesStatus: "unavailable" },
    aks_docs_commits: [],
  };

  const section = generator.generateDocumentationUpdates();
  assert.match(section, /change tracking is unavailable/);
  assert.doesNotMatch(section, /No documentation updates were identified/);
});

test("intro highlights selected Azure Updates without claiming monthly totals or inferring status transitions", () => {
  const generator = new NewsletterGenerator(2026, 11);
  generator.data = {
    azure_updates: [
      { title: "Generally Available: Feature A" },
      { title: "Public Preview: Feature B" },
      { title: "Preview feature C updated" },
    ],
    techcommunity_search: [{ title: "Another GA announcement" }],
  };

  const intro = generator.generateIntro();
  assert.match(intro, /Azure Updates announcements in this edition/);
  assert.match(intro, /\*\*Generally Available: Feature A\*\*/);
  assert.match(intro, /\*\*Public Preview: Feature B\*\*/);
  assert.match(intro, /\*\*Preview feature C updated\*\*/);
  assert.doesNotMatch(intro, /This month brings|enters public preview|is now generally available/);

  generator.data.azure_updates = [];
  assert.doesNotMatch(generator.generateIntro(), /Azure Updates announcements/);
});

test("empty sections and closing do not claim comprehensive monthly coverage", () => {
  const generator = new NewsletterGenerator(2026, 11);
  generator.data = { azure_updates: [{ title: "Public Preview: AKS networking" }] };

  assert.match(generator.generateBehavioralChanges(), /No behavioral changes are listed in this section/);
  assert.match(generator.generateGAAnnouncements(), /No announcements are listed in this section/);
  assert.match(generator.generateCommunityBlogs(), /No community blog posts are listed in this section/);
  assert.match(generator.generateWatchLearn(), /No videos are listed in this section/);
  assert.doesNotMatch(generator.generateClosing(), /brought \d+ platform announcements|updates to operations, documentation/);
  assert.match(generator.generateClosing(), /Networking/);
});

test("clipped source summaries are marked for rewriting instead of publication", () => {
  const generator = new NewsletterGenerator(2026, 11);
  const url = "https://example.com/aks";
  const clipped = "A".repeat(200) + " while Windows Server";
  assert.match(generator._formatEntry({ title: "AKS article", url, summary: clipped }), /\[NEEDS DESCRIPTION\]/);
  assert.match(generator._formatEntry({ title: "AKS video", url, summary: "A video explaining AKS networking..." }), /\[NEEDS DESCRIPTION\]/);
  assert.doesNotMatch(generator._formatEntry({ title: "AKS article", url, summary: "A".repeat(200) + "." }), /\[NEEDS DESCRIPTION\]/);
});

test("AKS release descriptions come from the public Learn page", async () => {
  const collector = new ContentCollector(2026, 11);
  const requests = [];
  collector._safeFetch = async (url) => {
    requests.push(url);
    return {
      text: async () => '<html><head><meta name="description" content="Official Learn description"></head></html>',
    };
  };

  const description = await collector._fetchDocDescription(
    "https://learn.microsoft.com/azure/aks/overview"
  );

  assert.equal(description, "Official Learn description");
  assert.deepEqual(requests, ["https://learn.microsoft.com/azure/aks/overview"]);
});

test("TechCommunity search snippets with markup are replaced by article-body evidence", async () => {
  const collector = new ContentCollector(2026, 11);
  const articleUrl = "https://techcommunity.microsoft.com/blog/azurearcblog/ct-p/4569134";
  collector.collected.techcommunity_search = [
    {
      title: "Simplify Kubernetes operations with Upgrade Insights and GitOps",
      url: articleUrl,
      summary: '...<SPAN class="lia-search-match-lithium">AKS</SPAN> Ignite session results...',
    },
    {
      title: "Untrusted host",
      url: "https://example.com/article",
      summary: "<span>bad snippet</span>",
    },
  ];
  const requests = [];
  collector._safeFetch = async (url) => {
    requests.push(url);
    return {
      text: async () => `
        <div class="styles_lia-g-message-body-blog__TUnqH">
          <p>Upgrade Insights helps teams assess Kubernetes upgrade readiness before beginning an upgrade.</p>
          <li>Flux GitOps integration with Azure Kubernetes Fleet Manager brings GitOps together with workload placement.</li>
        </div>`,
    };
  };

  await collector.enrichTechCommunitySummaries();

  assert.deepEqual(requests, [articleUrl]);
  assert.match(collector.collected.techcommunity_search[0].summary, /Upgrade Insights helps teams assess Kubernetes upgrade readiness/);
  assert.match(collector.collected.techcommunity_search[0].summary, /Flux GitOps integration/);
  assert.doesNotMatch(collector.collected.techcommunity_search[0].summary, /lia-search-match|Ignite session results/);
  assert.equal(collector.collected.techcommunity_search[1].summary, "<span>bad snippet</span>");

  const polisher = new NewsletterPolisher(2026, 11);
  const section = polisher._splitIntoSections(
    `## 📚 Community Blogs\n\n* **[${collector.collected.techcommunity_search[0].title}](${articleUrl})**: [NEEDS DESCRIPTION]`,
    { techcommunity_search: collector.collected.techcommunity_search }
  )[0];
  assert.match(section.context, /Flux GitOps integration/);
});

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

test("community blog generation deduplicates alternate TechCommunity URLs by post ID", () => {
  const generator = new NewsletterGenerator(2026, 11);
  generator.data = {
    techcommunity: [{
      title: "AKS networking announcement",
      url: "https://techcommunity.microsoft.com/blog/azurenetworkingblog/aks-networking-announcement/4571806",
      summary: "The full source summary.",
      source: "TechCommunity",
    }],
    techcommunity_search: [{
      title: "AKS networking announcement",
      url: "https://techcommunity.microsoft.com/blog/azurenetworkingblog/ct-p/4571806",
      summary: "A shorter search snippet.",
      source: "TechCommunity Search",
    }],
  };

  const section = generator.generateCommunityBlogs();
  assert.equal((section.match(/\*\*\[/g) || []).length, 1);
  assert.match(section, /\/aks-networking-announcement\/4571806/);
  assert.match(section, /The full source summary\./);
  assert.doesNotMatch(section, /\/ct-p\/4571806/);
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

test("GA announcement summaries do not publish pre-release limitations as current facts", async () => {
  const collector = new ContentCollector(2026, 11);
  collector._safeFetch = async () => ({
    json: async () => ({ value: [{
      id: 581130,
      title: "[Launched] Generally Available: Confidential VMs with Intel TDX support on AKS",
      generalAvailabilityDate: "2026-11-17",
      description: "Customers standardized on Intel TDX can't run those workloads on AKS node pools today, because images only support AMD SEV-SNP. AKS now adds Intel TDX support.",
    }] }),
  });

  await collector.collectAzureUpdates();
  const update = collector.collected.azure_updates[0];
  assert.equal(update.summary, "");
  assert.equal(update.suppressGeneratedDescription, true);

  const generator = new NewsletterGenerator(2026, 11);
  generator.data = collector.collected;
  const section = generator.generateGAAnnouncements();
  assert.match(section, /Generally Available: Confidential VMs with Intel TDX support on AKS/);
  assert.doesNotMatch(section, /can't run|only support AMD/);
  assert.doesNotMatch(section, /\[NEEDS DESCRIPTION\]/);
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

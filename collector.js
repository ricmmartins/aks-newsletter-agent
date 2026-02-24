/**
 * AKS Newsletter Agent – Content Collector
 * Fetches and filters content from all mandatory sources for a target month.
 */

const fetch = require("node-fetch");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");
const { SOURCES, AKS_KEYWORDS } = require("./config");

class ContentCollector {
  constructor(year, month, outputDir = "collected") {
    this.year = year;
    this.month = month;
    this.outputDir = outputDir;
    this.monthName = new Date(year, month - 1).toLocaleString("en-US", {
      month: "long",
    });

    // Date window: last 30 days from end of target month (UTC)
    this.windowEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59)); // last day of month
    this.windowStart = new Date(this.windowEnd);
    this.windowStart.setUTCDate(this.windowStart.getUTCDate() - 30);

    this.collected = {
      metadata: {
        year,
        month,
        monthName: this.monthName,
        collectedAt: new Date().toISOString(),
        windowStart: this.windowStart.toISOString(),
        windowEnd: this.windowEnd.toISOString(),
      },
      aks_blog: [],
      azure_updates: [],
      aks_releases: [],
      aks_docs_commits: [],
      techcommunity: [],
      techcommunity_search: [],
      youtube: [],
      roadmap_url: SOURCES.aks_roadmap.url,
      releases_url: SOURCES.aks_releases.url,
    };
  }

  _isWithinWindow(dateStr) {
    if (!dateStr) return false;
    try {
      const dt = new Date(dateStr);
      return !isNaN(dt.getTime()) && dt >= this.windowStart && dt <= this.windowEnd;
    } catch {
      return false;
    }
  }

  // Keep backward compat – alias for collectors that still use month check
  _isTargetMonth(dateStr) {
    return this._isWithinWindow(dateStr);
  }

  async _safeFetch(url, options = {}) {
    try {
      const resp = await fetch(url, {
        timeout: 30000,
        headers: {
          "User-Agent": "AKS-Newsletter-Agent/1.0",
          Accept: "text/html,application/json",
          ...options.headers,
        },
        ...options,
      });
      if (!resp.ok)
        throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
      return resp;
    } catch (e) {
      console.log(`  ⚠ Failed to fetch ${url}: ${e.message}`);
      return null;
    }
  }

  _matchesAKS(text) {
    const lower = (text || "").toLowerCase();
    return AKS_KEYWORDS.some((kw) => lower.includes(kw));
  }

  async collectAKSBlog() {
    console.log("📡 Collecting AKS Engineering Blog...");
    const resp = await this._safeFetch(SOURCES.aks_blog.url);
    if (!resp) return;

    const html = await resp.text();
    const $ = cheerio.load(html);

    $("article, .post-item, .entry, [class*='post']").each((_, el) => {
      const $el = $(el);
      const titleEl = $el.find("h1, h2, h3, a").first();
      if (!titleEl.length) return;

      const title = titleEl.text().trim();
      const linkEl = $el.find("a[href]").first();
      let link = linkEl.attr("href") || "";
      if (link && !link.startsWith("http")) {
        link = new URL(link, SOURCES.aks_blog.url).href;
      }

      const timeEl = $el.find("time");
      const dateStr =
        timeEl.attr("datetime") || timeEl.text().trim() || "";

      const summaryEl = $el.find("p").first();
      const summary = summaryEl.text().trim() || "";

      if (this._isTargetMonth(dateStr) || !dateStr) {
        this.collected.aks_blog.push({
          title,
          url: link,
          date: dateStr,
          summary,
          source: "AKS Engineering Blog",
        });
      }
    });

    console.log(`  ✓ Found ${this.collected.aks_blog.length} posts`);
  }

  async collectGitHubReleases() {
    console.log("📡 Collecting AKS GitHub Releases...");
    const resp = await this._safeFetch(SOURCES.aks_releases.apiUrl, {
      headers: { Accept: "application/vnd.github.v3+json" },
    });
    if (!resp) return;

    const releases = await resp.json();
    for (const release of releases) {
      const pubDate = release.published_at || "";
      if (this._isTargetMonth(pubDate)) {
        this.collected.aks_releases.push({
          title: release.name || release.tag_name || "Unknown",
          url: release.html_url || "",
          date: pubDate,
          body: (release.body || "").substring(0, 3000),
          source: "AKS GitHub Releases",
        });
      }
    }

    console.log(`  ✓ Found ${this.collected.aks_releases.length} releases`);
  }

  async collectAKSDocCommits() {
    console.log("📡 Collecting AKS Documentation commits...");

    const startDate = this.windowStart.toISOString();
    const endDate = this.windowEnd.toISOString();
    const url = `${SOURCES.aks_docs.apiUrl}&since=${startDate}&until=${endDate}`;

    const resp = await this._safeFetch(url, {
      headers: { Accept: "application/vnd.github.v3+json" },
    });
    if (!resp) return;

    const commits = await resp.json();
    const seenFiles = new Set();

    for (const commit of Array.isArray(commits) ? commits : []) {
      const msg = commit.commit?.message || "";
      const date = commit.commit?.committer?.date || "";
      const commitUrl = commit.html_url || "";
      const firstLine = msg.split("\n")[0].trim();

      if (firstLine && !seenFiles.has(firstLine)) {
        seenFiles.add(firstLine);
        this.collected.aks_docs_commits.push({
          title: firstLine,
          url: commitUrl,
          date,
          source: "AKS Docs",
        });
      }
    }

    console.log(
      `  ✓ Found ${this.collected.aks_docs_commits.length} doc commits`
    );
  }

  async collectAzureUpdates() {
    console.log("📡 Collecting Azure Updates...");
    const resp = await this._safeFetch(SOURCES.azure_updates.url);
    if (!resp) return;

    const html = await resp.text();
    const $ = cheerio.load(html);

    $("[class*='update'], [class*='card'], [class*='item']").each(
      (_, el) => {
        const $el = $(el);
        const titleEl = $el.find("h2, h3, a").first();
        if (!titleEl.length) return;

        const title = titleEl.text().trim();
        const linkEl = $el.find("a[href]").first();
        let link = linkEl.attr("href") || "";
        if (link && !link.startsWith("http")) {
          link = new URL(link, "https://azure.microsoft.com").href;
        }

        if (this._matchesAKS(title)) {
          this.collected.azure_updates.push({
            title,
            url: link,
            source: "Azure Updates",
          });
        }
      }
    );

    console.log(
      `  ✓ Found ${this.collected.azure_updates.length} updates`
    );
  }

  async collectTechCommunity() {
    console.log("📡 Collecting TechCommunity blogs...");

    const blogSources = [
      ["azure_architecture_blog", "Azure Architecture Blog"],
      ["azure_infrastructure_blog", "Azure Infrastructure Blog"],
      ["linux_opensource_blog", "Linux and Open Source Blog"],
      ["apps_on_azure_blog", "Apps on Azure Blog"],
      ["azure_observability_blog", "Azure Observability Blog"],
    ];

    for (const [key, name] of blogSources) {
      const resp = await this._safeFetch(SOURCES[key].url);
      if (!resp) continue;

      const html = await resp.text();
      const $ = cheerio.load(html);

      $(
        "article, [class*='lia-message'], [class*='post'], [class*='blog']"
      ).each((_, el) => {
        const $el = $(el);
        const titleEl = $el.find("h1, h2, h3, a").first();
        if (!titleEl.length) return;

        const title = titleEl.text().trim();
        if (!this._matchesAKS(title)) return;

        const linkEl = $el.find("a[href]").first();
        let link = linkEl.attr("href") || "";
        if (link && !link.startsWith("http")) {
          link = new URL(link, "https://techcommunity.microsoft.com").href;
        }

        const timeEl = $el.find("time");
        const dateStr = timeEl.attr("datetime") || "";

        this.collected.techcommunity.push({
          title,
          url: link,
          date: dateStr,
          source: name,
        });
      });
    }

    console.log(
      `  ✓ Found ${this.collected.techcommunity.length} TechCommunity posts`
    );
  }

  async collectYouTube() {
    console.log("📡 Collecting YouTube videos...");

    const ytSources = [
      ["aks_youtube", "AKS Community YouTube"],
      ["azure_youtube", "Microsoft Azure YouTube"],
    ];

    for (const [key, name] of ytSources) {
      const resp = await this._safeFetch(SOURCES[key].url);
      if (!resp) continue;

      const html = await resp.text();
      // Extract video data from ytInitialData in script tags
      const videoIdMatches = html.match(/"videoId":"([^"]+)"/g) || [];
      const titleMatches =
        html.match(/"title":\{"runs":\[\{"text":"([^"]+)"\}/g) || [];

      const ids = videoIdMatches.map((m) => m.match(/"videoId":"([^"]+)"/)[1]);
      const titles = titleMatches.map(
        (m) => m.match(/"text":"([^"]+)"/)[1]
      );

      const limit = Math.min(ids.length, titles.length, 15);
      for (let i = 0; i < limit; i++) {
        if (this._matchesAKS(titles[i])) {
          this.collected.youtube.push({
            title: titles[i],
            url: `https://www.youtube.com/watch?v=${ids[i]}`,
            source: name,
          });
        }
      }
    }

    // Deduplicate
    const seen = new Set();
    this.collected.youtube = this.collected.youtube.filter((v) => {
      if (seen.has(v.url)) return false;
      seen.add(v.url);
      return true;
    });

    console.log(
      `  ✓ Found ${this.collected.youtube.length} videos`
    );
  }

  async collectTechCommunitySearch() {
    console.log("📡 Collecting TechCommunity Search (AKS, past month)...");
    const searchUrl =
      "https://techcommunity.microsoft.com/search?q=aks&contentType=BLOG&lastUpdate=pastMonth&sortBy=newest";

    let puppeteer;
    try {
      puppeteer = require("puppeteer");
    } catch {
      console.log(
        "  ⚠ Puppeteer not installed. Skipping TechCommunity search."
      );
      console.log(
        "    Install with: npm install puppeteer"
      );
      return;
    }

    let browser;
    try {
      browser = await puppeteer.launch({
        headless: "new",
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });
      const page = await browser.newPage();
      await page.setUserAgent("AKS-Newsletter-Agent/1.0");
      await page.goto(searchUrl, { waitUntil: "networkidle2", timeout: 60000 });

      // Wait for search results to render
      await page.waitForSelector('[class*="search-result"], [class*="SearchResult"], article, [data-testid*="search"]', {
        timeout: 15000,
      }).catch(() => {
        console.log("  ⚠ Search results selector not found, trying fallback...");
      });

      // Extra wait for SPA hydration
      await new Promise((r) => setTimeout(r, 3000));

      const results = await page.evaluate(() => {
        const items = [];
        // Try multiple selectors for TechCommunity search results
        const selectors = [
          '[class*="SearchResult"] a',
          '[class*="search-result"] a',
          'article a[href*="/blog/"]',
          'a[href*="techcommunity.microsoft.com/blog/"]',
          'a[href*="/t5/"][href*="/ba-p/"]',
        ];

        const links = new Set();
        for (const sel of selectors) {
          document.querySelectorAll(sel).forEach((a) => {
            const href = a.href || "";
            const text = (a.textContent || "").trim();
            if (
              href &&
              text.length > 10 &&
              !links.has(href) &&
              (href.includes("/blog/") || href.includes("/ba-p/"))
            ) {
              links.add(href);
              items.push({ title: text, url: href });
            }
          });
        }
        return items;
      });

      for (const item of results) {
        this.collected.techcommunity_search.push({
          ...item,
          source: "TechCommunity Search",
        });
      }

      console.log(
        `  ✓ Found ${this.collected.techcommunity_search.length} search results`
      );
    } catch (e) {
      console.log(`  ⚠ TechCommunity search failed: ${e.message}`);
    } finally {
      if (browser) await browser.close();
    }
  }

  async collectAll() {
    console.log(`\n${"=".repeat(60)}`);
    console.log(
      `  AKS Newsletter Agent – Collecting for ${this.monthName} ${this.year}`
    );
    console.log(`${"=".repeat(60)}\n`);

    await this.collectAKSBlog();
    await this.collectGitHubReleases();
    await this.collectAKSDocCommits();
    await this.collectAzureUpdates();
    await this.collectTechCommunity();
    await this.collectTechCommunitySearch();
    await this.collectYouTube();

    // Save collected data
    fs.mkdirSync(this.outputDir, { recursive: true });
    const outputFile = path.join(
      this.outputDir,
      `${this.year}-${String(this.month).padStart(2, "0")}.json`
    );
    fs.writeFileSync(outputFile, JSON.stringify(this.collected, null, 2), "utf8");

    console.log(`\n${"=".repeat(60)}`);
    console.log(`  Collection complete. Saved to: ${outputFile}`);
    this._printSummary();
    console.log(`${"=".repeat(60)}\n`);

    return this.collected;
  }

  _printSummary() {
    console.log("\n  Summary:");
    console.log(
      `    AKS Blog posts:       ${this.collected.aks_blog.length}`
    );
    console.log(
      `    Azure Updates:        ${this.collected.azure_updates.length}`
    );
    console.log(
      `    GitHub Releases:      ${this.collected.aks_releases.length}`
    );
    console.log(
      `    Doc Commits:          ${this.collected.aks_docs_commits.length}`
    );
    console.log(
      `    TechCommunity posts:  ${this.collected.techcommunity.length}`
    );
    console.log(
      `    TC Search results:    ${this.collected.techcommunity_search.length}`
    );
    console.log(
      `    YouTube videos:       ${this.collected.youtube.length}`
    );
  }
}

module.exports = { ContentCollector };

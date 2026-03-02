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
    this.githubToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
    this.monthName = new Date(year, month - 1).toLocaleString("en-US", {
      month: "long",
    });

    // Date window: full calendar month (1st through last day, UTC)
    this.windowStart = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0)); // 1st of month
    this.windowEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59)); // last day of month

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

  // Check if YouTube relative time text (e.g. "2 weeks ago") falls within target month
  _isRecentVideo(timeText) {
    if (!timeText) return true; // include if no time info
    const lower = timeText.toLowerCase();
    const match = lower.match(/(\d+)\s+(hour|day|week|month|year)/);
    if (!match) return true;
    const num = parseInt(match[1], 10);
    const unit = match[2];
    const daysAgo =
      unit === "hour" ? 0 :
      unit === "day" ? num :
      unit === "week" ? num * 7 :
      unit === "month" ? num * 30 :
      unit === "year" ? num * 365 : 0;
    // Calculate approximate publish date and check against window
    const approxDate = new Date();
    approxDate.setDate(approxDate.getDate() - daysAgo);
    return approxDate >= this.windowStart && approxDate <= this.windowEnd;
  }

  _githubHeaders() {
    const headers = { Accept: "application/vnd.github.v3+json" };
    if (this.githubToken) {
      headers.Authorization = `token ${this.githubToken}`;
    }
    return headers;
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
      headers: this._githubHeaders(),
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
      headers: this._githubHeaders(),
    });
    if (!resp) return;
    const commits = await resp.json();

    // Noise patterns: merge commits, trivial messages, metadata-only changes
    const noisePatterns = [
      /^merge /i,
      /^merge pull request/i,
      /^merge branch/i,
      /^fixed typo/i,
      /^fixed issues/i,
      /^updated content\.?$/i,
      /^reshuffled/i,
      /^resolved merge conflict/i,
      /^small adjustment/i,
      /^update articles\/aks\//i,
      /^apply suggestion/i,
      /^fix ms\.author/i,
      /^renamed files/i,
      /^delete volume/i,
      /^change title/i,
      /^update link$/i,
      /^update date /i,
      /^fixed broken link/i,
      /^added links/i,
      /^portal ui updates/i,
      /^fix redirection/i,
    ];

    // Group commits by article file to deduplicate
    const articleMap = new Map(); // filePath -> { title, url, date, learnUrl }

    for (const commit of Array.isArray(commits) ? commits : []) {
      const msg = commit.commit?.message || "";
      const date = commit.commit?.committer?.date || "";
      const commitUrl = commit.html_url || "";
      const sha = commit.sha || "";
      const firstLine = msg.split("\n")[0].trim();

      // Skip noise commits (patterns + short/cryptic messages)
      if (!firstLine || firstLine.length < 20) continue;
      if (!firstLine || noisePatterns.some((p) => p.test(firstLine))) continue;

      // Fetch commit details to get changed files
      let files = [];
      if (sha) {
        const detailResp = await this._safeFetch(
          `https://api.github.com/repos/MicrosoftDocs/azure-aks-docs/commits/${sha}`,
          { headers: this._githubHeaders() }
        );
        if (detailResp) {
          const detail = await detailResp.json();
          files = (detail.files || [])
            .map((f) => f.filename)
            .filter((f) => f.startsWith("articles/aks/") && f.endsWith(".md") && !f.includes("includes/"));
        }
      }

      // Pick the primary article file (skip TOC.yml-only commits)
      const articleFile = files.find((f) => !f.endsWith("TOC.yml")) || null;
      if (!articleFile) continue;

      // Build Learn URL: articles/aks/some-article.md -> https://learn.microsoft.com/azure/aks/some-article
      const slug = articleFile.replace("articles/aks/", "").replace(/\.md$/, "");
      const learnUrl = `https://learn.microsoft.com/azure/aks/${slug}`;

      // Deduplicate by article – keep the most recent commit per file
      if (!articleMap.has(articleFile)) {
        articleMap.set(articleFile, {
          title: firstLine,
          url: learnUrl,
          date,
          source: "AKS Docs",
        });
      }
    }

    this.collected.aks_docs_commits = Array.from(articleMap.values());

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

        const timeEl = $el.find("time");
        const dateStr = timeEl.attr("datetime") || timeEl.text().trim() || "";

        if (this._matchesAKS(title) && (this._isWithinWindow(dateStr) || !dateStr)) {
          this.collected.azure_updates.push({
            title,
            url: link,
            date: dateStr,
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

        // Skip category/tag pages and navigation elements
        if (link.includes("/category/") || link.includes("/tag/") || title.startsWith("Place ")) return;
        if (!link.includes("/blog/") && !link.includes("/ba-p/")) return;

        const timeEl = $el.find("time");
        const dateStr = timeEl.attr("datetime") || "";

        if (this._isWithinWindow(dateStr) || !dateStr) {
          this.collected.techcommunity.push({
            title,
            url: link,
            date: dateStr,
            source: name,
          });
        }
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
      // Extract ytInitialData JSON and parse video renderers properly
      // to ensure videoId and title are paired from the same object
      const jsonMatch = html.match(/var ytInitialData = (.+?);\s*<\/script>/s);
      if (!jsonMatch) {
        console.log(`  ⚠ Could not extract ytInitialData from ${name}`);
        continue;
      }

      try {
        const data = JSON.parse(jsonMatch[1]);
        const tabs = data?.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
        for (const tab of tabs) {
          const items = tab?.tabRenderer?.content?.richGridRenderer?.contents || [];
          for (const item of items) {
            const vr = item?.richItemRenderer?.content?.videoRenderer;
            if (!vr) continue;
            const videoId = vr.videoId;
            const title = vr.title?.runs?.[0]?.text || "";
            // publishedTimeText contains relative date like "2 weeks ago"
            const timeText = vr.publishedTimeText?.simpleText || "";
            if (videoId && title && this._matchesAKS(title) && this._isRecentVideo(timeText)) {
              this.collected.youtube.push({
                title,
                url: `https://www.youtube.com/watch?v=${videoId}`,
                publishedText: timeText,
                source: name,
              });
            }
          }
        }
      } catch (e) {
        console.log(`  ⚠ Failed to parse ytInitialData from ${name}: ${e.message}`);
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

      // Capture Bearer token from the initial GraphQL request
      let bearerToken = "";
      page.on("request", (req) => {
        if (req.url().includes("opname=MessageSearch")) {
          bearerToken = req.headers()["authorization"] || "";
        }
      });

      // Load search page to trigger auth and obtain token
      const searchUrl =
        "https://techcommunity.microsoft.com/search?q=aks&contentType=BLOG&lastUpdate=pastMonth&sortBy=newest";
      await page.goto(searchUrl, { waitUntil: "networkidle2", timeout: 60000 });
      await new Promise((r) => setTimeout(r, 5000));

      if (!bearerToken) {
        // Fallback: scrape visible DOM links if token capture fails
        console.log("  ⚠ Auth token not captured, falling back to DOM scraping");
        const results = await page.evaluate(() => {
          const items = [];
          const links = new Set();
          document.querySelectorAll("a").forEach((a) => {
            const href = a.href || "";
            const text = (a.textContent || "").trim();
            if (
              href && text.length > 10 && !links.has(href) &&
              (href.includes("/blog/") || href.includes("/ba-p/")) &&
              !href.includes("/category/") && !text.startsWith("Place ")
            ) {
              links.add(href);
              items.push({ title: text, url: href });
            }
          });
          return items;
        });
        for (const item of results) {
          if (this._matchesAKS(item.title) || this._matchesAKS(item.url)) {
            this.collected.techcommunity_search.push({
              ...item, source: "TechCommunity Search",
            });
          }
        }
      } else {
        // Use GraphQL API to fetch ALL results (avoids pagination limits)
        const dateGte = this.windowStart.toISOString();
        const dateLte = this.windowEnd.toISOString();
        const allResults = await page.evaluate(
          async (token, dateFrom, dateTo) => {
            const body = {
              operationName: "MessageSearch",
              variables: {
                forAutoSuggest: false, useFullPageInfo: true,
                truncateBodyLength: 200, useUnreadCount: false, first: 50,
                constraints: {
                  conversationStyle: { eq: "BLOG" },
                  conversationLastPostingActivityTime: { gte: dateFrom, lte: dateTo },
                },
                sorts: { topicPublishDate: { direction: "DESC" } },
                searchTerm: "aks",
              },
              extensions: {
                persistedQuery: {
                  version: 1,
                  sha256Hash: "d6f4a952ca4e2ccea2b104ec949092601be072e638c72b0313bc089bb977ce9d",
                },
              },
            };
            const resp = await fetch(
              "/t5/s/api/2.1/graphql?opname=MessageSearch",
              {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: token },
                body: JSON.stringify(body),
              }
            );
            const data = await resp.json();
            const results = data.data?.messageSearch?.results;
            if (!results) return [];
            return (results.edges || []).map((e) => {
              const msg = e.node.message;
              const boardId = (msg.board?.displayId || "").toLowerCase();
              const slug = (msg.subject || "")
                .toLowerCase().replace(/[^a-z0-9]+/g, "-")
                .replace(/^-|-$/g, "").substring(0, 80);
              // Include snippet text for keyword matching against body
              const snippetText = (e.node.snippet || [])
                .map((s) => (s.content || []).join(" ")).join(" ");
              return {
                title: msg.subject || "",
                url: `https://techcommunity.microsoft.com/blog/${boardId}/${slug}/${msg.uid}`,
                posted: msg.postTime || "",
                snippet: snippetText,
              };
            });
          },
          bearerToken, dateGte, dateLte
        );

        for (const item of allResults) {
          if (this._matchesAKS(item.title) || this._matchesAKS(item.url) || this._matchesAKS(item.snippet)) {
            this.collected.techcommunity_search.push({
              title: item.title, url: item.url, posted: item.posted,
              source: "TechCommunity Search",
            });
          }
        }
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

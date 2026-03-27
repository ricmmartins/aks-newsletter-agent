/**
 * AKS Newsletter Agent – Content Collector
 * Fetches and filters content from all mandatory sources for a target month.
 */

const fetch = require("node-fetch");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");
const { SOURCES, AKS_KEYWORDS, AKS_STRICT_KEYWORDS } = require("./config");

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

  _matchesAKSStrict(text) {
    const lower = (text || "").toLowerCase();
    return AKS_STRICT_KEYWORDS.some((kw) => lower.includes(kw));
  }

  // Fetch the actual page title from a doc's markdown frontmatter
  async _fetchDocPageTitle(articleFile) {
    try {
      const rawUrl = `https://raw.githubusercontent.com/MicrosoftDocs/azure-aks-docs/main/${articleFile}`;
      const resp = await this._safeFetch(rawUrl);
      if (!resp) return null;
      const text = await resp.text();
      // Parse YAML frontmatter between --- delimiters
      const fmMatch = text.match(/^---\s*\n([\s\S]*?)\n---/);
      if (!fmMatch) return null;
      const titleMatch = fmMatch[1].match(/^title:\s*['"]?(.*?)['"]?\s*$/m);
      return titleMatch ? titleMatch[1].trim() : null;
    } catch {
      return null;
    }
  }

  // Clean up a commit message into a reader-friendly summary
  _cleanCommitMessage(msg) {
    if (!msg) return "";
    let s = msg.trim();
    // Remove common prefixes
    s = s.replace(/^(doc|docs|fix|update|add|chore|feat|refactor|style):\s*/i, "");
    // Remove file name references (.md, article paths)
    s = s.replace(/\s+(for\s+)?\S+\.md\b/g, "");
    s = s.replace(/\barticles\/aks\/\S*/g, "");
    // Remove internal developer references ("from Sam", "per John")
    s = s.replace(/\s+(from|by|per|via)\s+[A-Z][a-z]+(\s+[A-Z][a-z]+)?\s*$/g, "").trim();
    // Remove "to reflect author changes and" patterns
    s = s.replace(/\bto reflect author changes and\s*/i, "");
    // Fix trailing prepositions left after cleanup ("for", "in", "to", "with")
    s = s.replace(/\s+(for|in|to|with|and|or)\s*$/i, "").trim();
    // Capitalize first letter
    if (s) s = s.charAt(0).toUpperCase() + s.slice(1);
    // Remove trailing period then re-add for consistency
    s = s.replace(/\.+$/, "");
    // If result is too short or vague, return empty (title alone is enough)
    if (s.length < 15) return "";
    return s;
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

      if (this._isTargetMonth(dateStr)) {
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
          body: (release.body || "").substring(0, 8000),
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
      /^fixed? typo/i,
      /^fixed? issues/i,
      /^fix(ed|es|ing)?\s+(formatting|markdown|yaml|indentation|link|typo|style)/i,
      /^updated? content\.?$/i,
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
      /^fixed? broken link/i,
      /^added? links/i,
      /^portal ui updates/i,
      /^fix redirection/i,
      /^removed?\s+(the\s+)?line\s*break/i,
      /^content\s+(dev\s+)?review/i,
      /^address\s+acrolinx/i,
      /^update\s+terminology/i,
      /^adding\s+(absolute\s+)?links/i,
      /^doc:\s*(replace|fix|update)\s/i,
      /^content\s+edits?\s+and\s+style/i,
      /^fixes?\s+markdown/i,
      /^update\s+\S+\.md$/i,
      /^minor\s+edit/i,
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
          commitMessage: firstLine,
          articleFile,
          url: learnUrl,
          date,
          source: "AKS Docs",
        });
      }
    }

    // Enrich each doc entry with the actual page title from the markdown frontmatter
    const entries = Array.from(articleMap.values());
    for (const entry of entries) {
      const pageTitle = await this._fetchDocPageTitle(entry.articleFile);
      if (pageTitle) {
        entry.title = pageTitle;
        entry.summary = this._cleanCommitMessage(entry.commitMessage);
      } else {
        entry.title = entry.commitMessage;
      }
      delete entry.commitMessage;
      delete entry.articleFile;
    }

    this.collected.aks_docs_commits = entries;

    console.log(
      `  ✓ Found ${this.collected.aks_docs_commits.length} doc commits`
    );
  }

  async collectAzureUpdates() {
    console.log("📡 Collecting Azure Updates...");

    // Use the Azure Updates OData API to get AKS-related updates
    const monthStr = `${this.year}-${String(this.month).padStart(2, "0")}`;
    const lastDay = new Date(Date.UTC(this.year, this.month, 0)).getDate();
    const monthEnd = `${monthStr}-${lastDay}`;

    const productFilter =
      "products/any(p: p eq 'Azure Kubernetes Service (AKS)')";
    const dateFilter = [
      `(generalAvailabilityDate ge '${monthStr}' and generalAvailabilityDate le '${monthEnd}')`,
      `(previewAvailabilityDate ge '${monthStr}' and previewAvailabilityDate le '${monthEnd}')`,
      `(privatePreviewAvailabilityDate ge '${monthStr}' and privatePreviewAvailabilityDate le '${monthEnd}')`,
    ].join(" or ");

    const filter = encodeURIComponent(
      `${productFilter} and (${dateFilter})`
    );
    const apiUrl = `https://www.microsoft.com/releasecommunications/api/v2/azure?$count=true&top=100&$filter=${filter}`;

    const resp = await this._safeFetch(apiUrl, {
      headers: { Accept: "application/json" },
    });

    if (resp) {
      try {
        const data = await resp.json();
        for (const item of data.value || []) {
          const gaDate = item.generalAvailabilityDate || "";
          const previewDate = item.previewAvailabilityDate || "";
          const dateStr = gaDate.startsWith(monthStr)
            ? gaDate
            : previewDate.startsWith(monthStr)
              ? previewDate
              : item.privatePreviewAvailabilityDate || "";

          this.collected.azure_updates.push({
            title: (item.title || "").trim(),
            url: `https://azure.microsoft.com/en-us/updates/${item.id}/`,
            date: dateStr,
            source: "Azure Updates",
          });
        }
      } catch (e) {
        console.log(`  ⚠ Failed to parse API response: ${e.message}`);
      }
    }

    // Supplement with items from release notes
    this._extractUpdatesFromReleases();

    console.log(
      `  ✓ Found ${this.collected.azure_updates.length} updates`
    );
  }

  _extractUpdatesFromReleases() {
    const releases = this.collected.aks_releases || [];
    const existingUrls = new Set(this.collected.azure_updates.map((u) => u.url));

    for (const release of releases) {
      const body = release.body || "";

      // Parse "### Preview Features" section
      const previewItems = this._parseReleaseSection(body, /###\s*Preview\s*Features?\s*/i);
      for (const item of previewItems) {
        if (existingUrls.has(item.url)) continue;
        existingUrls.add(item.url);
        this.collected.azure_updates.push({
          title: `${item.title} (preview)`,
          url: item.url,
          date: release.date,
          summary: item.description,
          source: "AKS Release Notes",
        });
      }

      // Parse "### Features" section (GA announcements)
      const gaItems = this._parseReleaseSection(body, /###\s*Features\s*/i);
      for (const item of gaItems) {
        if (existingUrls.has(item.url)) continue;
        existingUrls.add(item.url);
        this.collected.azure_updates.push({
          title: `${item.title} – now generally available`,
          url: item.url,
          date: release.date,
          summary: item.description,
          source: "AKS Release Notes",
        });
      }
    }
  }

  _parseReleaseSection(body, sectionRegex) {
    const items = [];
    const sectionMatch = body.split(sectionRegex)[1];
    if (!sectionMatch) return items;

    // Take content until the next ### heading
    const sectionContent = sectionMatch.split(/###\s/)[0];

    // Parse each bullet point and extract the first markdown link + remaining text as description
    const bullets = sectionContent.split(/\n\s*\*\s+/).filter(Boolean);
    const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/;
    for (const bullet of bullets) {
      const match = bullet.match(linkRegex);
      if (!match) continue;
      const title = match[1].trim();
      const url = match[2].trim();
      // Extract the description text after the first link
      const afterLink = bullet.substring(match.index + match[0].length).trim();
      // Clean up: remove leading punctuation, trim, take first sentence
      let description = afterLink
        .replace(/^\s*[–\-:,]\s*/, "")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // convert remaining links to plain text
        .replace(/\s*\n\s*/g, " ") // flatten newlines
        .split(/\.\s/)[0]; // first sentence
      if (description && !description.endsWith(".")) description += ".";
      // Capitalize first letter
      if (description) description = description.charAt(0).toUpperCase() + description.slice(1);
      if (description.length < 10) description = "";
      if (url.includes("releases.aks.azure.com")) continue;
      items.push({ title, url, description });
    }
    return items;
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
        if (!this._matchesAKSStrict(title)) return;

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

        if (this._isWithinWindow(dateStr)) {
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
      const feedUrl = SOURCES[key].feedUrl;
      if (!feedUrl) {
        console.log(`  ⚠ No feed URL configured for ${name}`);
        continue;
      }

      const resp = await this._safeFetch(feedUrl, {
        headers: { Accept: "application/atom+xml, application/xml, text/xml" },
      });
      if (!resp) continue;

      const xml = await resp.text();
      const $ = cheerio.load(xml, { xmlMode: true });

      $("entry").each((_, el) => {
        const $el = $(el);
        const title = $el.find("title").text().trim();
        const videoId = $el.find("yt\\:videoId, videoId").text().trim();
        const published = $el.find("published").text().trim();
        const link = videoId
          ? `https://www.youtube.com/watch?v=${videoId}`
          : $el.find("link[rel='alternate']").attr("href") || "";
        // Extract description from media:group > media:description
        const description = $el.find("media\\:group media\\:description, description").text().trim();
        const summary = description ? description.split("\n")[0].substring(0, 200) : "";

        if (title && link && this._isWithinWindow(published)) {
          // For AKS Community channel, include all videos (they're all AKS-related)
          // For Microsoft Azure channel, filter by AKS keywords
          if (key === "aks_youtube" || this._matchesAKS(title)) {
            this.collected.youtube.push({
              title,
              url: link,
              date: published,
              summary,
              source: name,
            });
          }
        }
      });
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
      // Set a realistic user agent to avoid bot detection
      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      );

      // Capture bearer token AND GraphQL response data
      let bearerToken = "";
      let capturedResults = null;
      page.on("request", (req) => {
        if (req.url().includes("graphql") && req.url().includes("opname=MessageSearch")) {
          bearerToken = req.headers()["authorization"] || "";
        }
      });
      page.on("response", async (resp) => {
        if (resp.url().includes("graphql") && resp.url().includes("opname=MessageSearch")) {
          try {
            const data = await resp.json();
            const results = data?.data?.messageSearch?.results;
            if (results?.edges?.length) {
              capturedResults = results.edges.map((e) => {
                const msg = e.node.message;
                const boardId = (msg.board?.displayId || "").toLowerCase();
                const slug = (msg.subject || "")
                  .toLowerCase().replace(/[^a-z0-9]+/g, "-")
                  .replace(/^-|-$/g, "").substring(0, 80);
                const snippetText = (e.node.snippet || [])
                  .map((s) => (s.content || []).join(" ")).join(" ");
                return {
                  title: msg.subject || "",
                  url: `https://techcommunity.microsoft.com/blog/${boardId}/${slug}/${msg.uid}`,
                  posted: msg.postTime || "",
                  snippet: snippetText,
                };
              });
            }
          } catch {}
        }
      });

      // Load search page to capture bearer token (pastMonth is fine here — real filtering uses GraphQL dates)
      const searchUrl =
        `https://techcommunity.microsoft.com/search?q=aks&contentType=BLOG&lastUpdate=pastMonth&sortBy=newest`;
      await page.goto(searchUrl, { waitUntil: "networkidle2", timeout: 60000 });

      // Wait for search results to render
      try {
        await page.waitForSelector('[class*="search-result"], [class*="SearchResult"], [class*="lia-message"], a[href*="/blog/"]', { timeout: 15000 });
      } catch {}
      await new Promise((r) => setTimeout(r, 5000));

      const dateGte = this.windowStart.toISOString();
      const dateLte = this.windowEnd.toISOString();

      // Strategy 1: Use bearer token to make our own GraphQL call with exact window dates (most reliable)
      if (bearerToken) {
        console.log("  ✓ Using bearer token with exact date range");
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
          // Filter by actual post date (GraphQL date filter uses activity time, not publish time)
          if (item.posted && !this._isWithinWindow(item.posted)) continue;
          if (this._matchesAKSStrict(item.title) || this._matchesAKSStrict(item.url) || this._matchesAKSStrict(item.snippet)) {
            this.collected.techcommunity_search.push({
              title: item.title, url: item.url, posted: item.posted,
              source: "TechCommunity Search",
            });
          }
        }
      }
      // Strategy 2: Use captured GraphQL response data, filtered by window dates
      else if (capturedResults?.length) {
        console.log("  ✓ Captured GraphQL response, filtering by date window");
        for (const item of capturedResults) {
          const inWindow = item.posted ? this._isWithinWindow(item.posted) : false;
          if (inWindow && (this._matchesAKSStrict(item.title) || this._matchesAKSStrict(item.url) || this._matchesAKSStrict(item.snippet))) {
            this.collected.techcommunity_search.push({
              title: item.title, url: item.url, posted: item.posted,
              source: "TechCommunity Search",
            });
          }
        }
      }
      // Strategy 3: Enhanced DOM scraping fallback
      else {
        console.log("  ⚠ Auth token not captured, falling back to DOM scraping");
        // Scroll to load more results
        await page.evaluate(async () => {
          for (let i = 0; i < 5; i++) {
            window.scrollBy(0, 800);
            await new Promise((r) => setTimeout(r, 1000));
          }
        });
        await new Promise((r) => setTimeout(r, 3000));

        const results = await page.evaluate(() => {
          const items = [];
          const seen = new Set();
          // Try multiple selector patterns for search results
          const selectors = [
            'a[href*="/blog/"]',
            'a[href*="/ba-p/"]',
            '[class*="search"] a[href*="techcommunity"]',
            '[class*="result"] a',
          ];
          for (const sel of selectors) {
            document.querySelectorAll(sel).forEach((a) => {
              const href = a.href || "";
              const text = (a.textContent || "").trim();
              if (
                href && text.length > 10 && text.length < 300 &&
                !seen.has(href) &&
                (href.includes("/blog/") || href.includes("/ba-p/")) &&
                !href.includes("/category/") &&
                !href.includes("/tag/") &&
                !text.startsWith("Place ")
              ) {
                seen.add(href);
                items.push({ title: text, url: href });
              }
            });
          }
          return items;
        });

        for (const item of results) {
          if (this._matchesAKSStrict(item.title) || this._matchesAKSStrict(item.url)) {
            this.collected.techcommunity_search.push({
              ...item, source: "TechCommunity Search",
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

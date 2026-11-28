/**
 * AKS Newsletter Agent – Content Collector
 * Fetches and filters content from all mandatory sources for a target month.
 */

const fetch = require("node-fetch");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");
const { marked } = require("marked");
const {
  SOURCES,
  AKS_KEYWORDS,
  AKS_STRICT_KEYWORDS,
  AKS_COMMUNITY_PATTERNS,
} = require("./config");

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
        documentationUpdatesStatus: "unavailable",
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

  // Fetch descriptions from the published Learn page, not its unavailable source repository.
  async _fetchDocDescription(url) {
    if (!url) return "";
    try {
      const docUrl = new URL(url);
      if (
        docUrl.hostname !== "learn.microsoft.com" ||
        !/^\/(?:en-us\/)?azure\/(?:aks|azure-monitor)\//i.test(docUrl.pathname)
      ) return "";
      const resp = await this._safeFetch(docUrl.href);
      if (!resp) return "";
      const $ = cheerio.load(await resp.text());
      return $('meta[name="description"]').attr("content")?.trim() || "";
    } catch {
      return "";
    }
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

    // Enrich blog posts missing summaries by fetching the individual post page
    for (const post of this.collected.aks_blog) {
      if (!post.summary && post.url) {
        try {
          const postResp = await this._safeFetch(post.url);
          if (postResp) {
            const postHtml = await postResp.text();
            const $post = cheerio.load(postHtml);
            // Try meta description first, then first paragraph in the article
            const metaDesc = $post('meta[name="description"]').attr("content") || "";
            const firstP = $post("article p, .post-content p, .entry-content p").first().text().trim();
            post.summary = metaDesc || firstP || "";
          }
        } catch { /* skip */ }
      }
    }

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

  reportAKSDocChangesUnavailable() {
    this.collected.metadata.documentationUpdatesStatus = "unavailable";
    console.log("⚠ AKS documentation change tracking is unavailable; skipping the retired GitHub source.");
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
          const description = (item.description || "").replace(/<[^>]+>/g, "").trim();
          const summary = description.split(/\.\s/)[0] + (description ? "." : "");
          const lifecycleAnnouncement = /\b(generally available|public preview|in preview)\b/i.test(item.title || "");
          const describesPriorLimitation = /\b(?:can't|cannot|couldn't|could not|unable to)\b.*\b(?:today|currently|yet)\b/i.test(summary);

          this.collected.azure_updates.push({
            title: (item.title || "").trim(),
            url: `https://azure.microsoft.com/en-us/updates/${item.id}/`,
            date: dateStr,
            summary: lifecycleAnnouncement && describesPriorLimitation ? "" : summary,
            suppressGeneratedDescription: lifecycleAnnouncement && describesPriorLimitation,
            source: "Azure Updates",
          });
        }
      } catch (e) {
        console.log(`  ⚠ Failed to parse API response: ${e.message}`);
      }
    }

    // Supplement with items from release notes
    await this._extractUpdatesFromReleases();

    console.log(
      `  ✓ Found ${this.collected.azure_updates.length} updates`
    );
  }

  async _extractUpdatesFromReleases() {
    const releases = this.collected.aks_releases || [];
    const existingUrls = new Set(this.collected.azure_updates.map((u) => u.url));

    for (const release of releases) {
      const body = release.body || "";

      // Parse "### Preview Features" section
      const previewItems = this._parseReleaseSection(body, /###\s*Preview\s*Features?\s*/i);
      for (const item of previewItems) {
        if (existingUrls.has(item.url)) continue;
        existingUrls.add(item.url);
        const desc = item.description || await this._fetchDocDescription(item.url);
        this.collected.azure_updates.push({
          title: `${item.title} (preview)`,
          url: item.url,
          date: release.date,
          summary: desc,
          source: "AKS Release Notes",
        });
      }

      // A Features heading does not establish a GA transition for its entries.
      const featureItems = this._parseReleaseSection(body, /###\s*Features\s*/i);
      for (const item of featureItems) {
        if (existingUrls.has(item.url)) continue;
        existingUrls.add(item.url);
        const desc = item.description || await this._fetchDocDescription(item.url);
        const isGA = /\b(?:is|are)\s+now\s+(?:generally available|GA)\b|\bnow\s+(?:generally available|GA)\b/i.test(item.availabilityEvidence);
        const update = {
          title: isGA ? `${item.title} – now generally available` : item.title,
          url: item.url,
          date: release.date,
          summary: desc,
          source: "AKS Release Notes",
          sourceUrl: release.url,
          sourceText: item.sourceText,
        };
        if (isGA) {
          this.collected.azure_updates.push(update);
        } else {
          if (!this.collected.behavioral_changes) this.collected.behavioral_changes = [];
          this.collected.behavioral_changes.push(update);
        }
      }

      // Parse "### Behavioral Changes" section into structured items
      const behavioralItems = this._parseReleaseSection(body, /###\s*Behavioral\s*Changes?\s*/i);
      if (!this.collected.behavioral_changes) this.collected.behavioral_changes = [];
      for (const item of behavioralItems) {
        this.collected.behavioral_changes.push({
          title: item.title,
          url: item.url,
          date: release.date,
          summary: item.description,
          source: "AKS Release Notes",
        });
      }

      // Parse "### Announcements" section
      const announcements = this._parseReleaseSection(body, /###\s*Announcements?\s*/i);
      if (!this.collected.announcements) this.collected.announcements = [];
      for (const item of announcements) {
        this.collected.announcements.push({
          title: item.title,
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
    const tokens = marked.lexer(body);
    const start = tokens.findIndex(token => token.type === "heading" && sectionRegex.test(`### ${token.text}`));
    if (start < 0) return items;
    const sectionTokens = [];
    for (const token of tokens.slice(start + 1)) {
      if (token.type === "heading" && token.depth <= tokens[start].depth) break;
      sectionTokens.push(token);
    }

    // Keep nested capabilities and reference links attached to their parent feature.
    const bullets = sectionTokens.filter(token => token.type === "list").flatMap(token => token.items);
    const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/;
    for (const bullet of bullets) {
      const primaryText = bullet.tokens.find(token => token.type === "text" || token.type === "paragraph")?.text || "";
      const match = primaryText.match(linkRegex);
      if (!match) continue;
      const title = match[1].trim();
      const url = match[2].trim();
      // Skip generic link text ("here", "this", "link", etc.)
      if (/^(here|this|link|more|details|see)$/i.test(title)) continue;
      // Extract the description text after the first link
      const afterLink = bullet.text.substring(match.index + match[0].length).trim();
      let description = afterLink
        .replace(/^\s*[–\-:,]\s*/, "")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // convert remaining links to plain text
        .replace(/\n\s*[*+-]\s+/g, " ")
        .replace(/\s*\n\s*/g, " ");
      if (description && !description.endsWith(".")) description += ".";
      // Capitalize first letter
      if (description) description = description.charAt(0).toUpperCase() + description.slice(1);
      if (description.length < 10) description = "";
      if (url.includes("releases.aks.azure.com")) continue;
      items.push({ title, url, description, availabilityEvidence: primaryText, sourceText: bullet.text });
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

  _hasUsableTechCommunitySummary(summary) {
    const text = typeof summary === "string" ? summary.trim() : "";
    return text.length >= 80 &&
      !/<[^>]+>/.test(text) &&
      !/^(?:\.{3}|…)/.test(text);
  }

  async _fetchTechCommunityArticleSummary(url) {
    let articleUrl;
    try {
      articleUrl = new URL(url);
    } catch {
      return "";
    }

    if (
      articleUrl.protocol !== "https:" ||
      articleUrl.hostname !== "techcommunity.microsoft.com"
    ) return "";

    const resp = await this._safeFetch(articleUrl.href);
    if (!resp) return "";

    const $ = cheerio.load(await resp.text());
    const body = $('[class*="lia-g-message-body-blog"]').first();
    return body.find("p, li")
      .map((_, element) => $(element).text().replace(/\s+/g, " ").trim())
      .get()
      .filter((text) => text.length >= 40)
      .slice(0, 10)
      .join(" ")
      .slice(0, 1200);
  }

  async enrichTechCommunitySummaries() {
    const posts = [...this.collected.techcommunity, ...this.collected.techcommunity_search];
    for (const post of posts) {
      const postIdentity = `${post.title || ""} ${post.url || ""}`;
      if (!AKS_COMMUNITY_PATTERNS.some((pattern) => pattern.test(postIdentity))) continue;
      if (this._hasUsableTechCommunitySummary(post.summary)) continue;
      const summary = await this._fetchTechCommunityArticleSummary(post.url);
      if (summary) post.summary = summary;
    }
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
        // Take first 2 sentences or 250 chars, whichever is shorter
        let summary = "";
        if (description) {
          const firstLine = description.split("\n")[0];
          const sentences = firstLine.match(/[^.!?]+[.!?]+/g) || [firstLine];
          summary = sentences.slice(0, 2).join(" ").trim();
          if (summary.length > 250) {
            summary = summary.substring(0, 247).replace(/\s+\S*$/, "") + "...";
          }
        }

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

      // Capture bearer token, persisted query hash, AND GraphQL response data
      let bearerToken = "";
      let capturedHash = "";
      let capturedResults = null;
      page.on("request", (req) => {
        if (req.url().includes("graphql") && req.url().includes("opname=MessageSearch")) {
          bearerToken = req.headers()["authorization"] || "";
          // Try to capture the persisted query hash from the request body
          try {
            const postData = req.postData();
            if (postData) {
              const parsed = JSON.parse(postData);
              capturedHash = parsed?.extensions?.persistedQuery?.sha256Hash || "";
            }
          } catch {}
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
                const snippetText = (e.node.snippet || [])
                  .map((s) => (s.content || []).join(" ")).join(" ");
                // Prefer canonical viewHref from API; fall back to UID-based URL
                let url = "";
                if (msg.viewHref) {
                  url = msg.viewHref.startsWith("http") ? msg.viewHref : `https://techcommunity.microsoft.com${msg.viewHref}`;
                } else {
                  url = `https://techcommunity.microsoft.com/blog/${boardId}/ct-p/${msg.uid}`;
                }
                return {
                  title: msg.subject || "",
                  url,
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

      // Use capturedResults from the initial page load first (Strategy 0)
      if (capturedResults?.length) {
        console.log(`  ✓ Captured ${capturedResults.length} results from initial page load`);
        for (const item of capturedResults) {
          const inWindow = item.posted ? this._isWithinWindow(item.posted) : true;
          if (inWindow && (this._matchesAKSStrict(item.title) || this._matchesAKSStrict(item.url) || this._matchesAKSStrict(item.snippet))) {
            this.collected.techcommunity_search.push({
              title: item.title, url: item.url, posted: item.posted,
              summary: item.snippet || "",
              source: "TechCommunity Search",
            });
          }
        }
      }

      // Strategy 1: Use bearer token to make GraphQL calls from Node.js (more reliable than page.evaluate)
      // Run multiple searches to catch posts that use different terminology
      const queryHash = capturedHash || "d6f4a952ca4e2ccea2b104ec949092601be072e638c72b0313bc089bb977ce9d";
      const searchTerms = ["aks", "azure kubernetes service", "kubernetes azure"];
      if (bearerToken) {
        console.log(`  ✓ Using bearer token with exact date range (hash: ${queryHash.slice(0, 8)}...)`);
        const allResults = [];
        for (const term of searchTerms) {
          console.log(`    Searching for "${term}"...`);
          try {
            const body = {
              operationName: "MessageSearch",
              variables: {
                forAutoSuggest: false, useFullPageInfo: true,
                truncateBodyLength: 200, useUnreadCount: false, first: 50,
                constraints: {
                  conversationStyle: { eq: "BLOG" },
                  conversationLastPostingActivityTime: { gte: dateGte, lte: dateLte },
                },
                sorts: { topicPublishDate: { direction: "DESC" } },
                searchTerm: term,
              },
              extensions: {
                persistedQuery: {
                  version: 1,
                  sha256Hash: queryHash,
                },
              },
            };
            const resp = await fetch(
              "https://techcommunity.microsoft.com/t5/s/api/2.1/graphql?opname=MessageSearch",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: bearerToken,
                  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                },
                body: JSON.stringify(body),
              }
            );
            if (!resp.ok) {
              console.log(`    ⚠ GraphQL returned HTTP ${resp.status} for "${term}"`);
              continue;
            }
            const data = await resp.json();
            const results = data.data?.messageSearch?.results;
            if (!results || !results.edges?.length) {
              console.log(`    ⚠ No results from GraphQL for "${term}" (edges: ${results?.edges?.length || 0})`);
              continue;
            }
            console.log(`    ✓ Got ${results.edges.length} results for "${term}"`);
            for (const e of results.edges) {
              const msg = e.node.message;
              const boardId = (msg.board?.displayId || "").toLowerCase();
              const snippetText = (e.node.snippet || [])
                .map((s) => (s.content || []).join(" ")).join(" ");
              let url = "";
              if (msg.viewHref) {
                url = msg.viewHref.startsWith("http") ? msg.viewHref : `https://techcommunity.microsoft.com${msg.viewHref}`;
              } else {
                url = `https://techcommunity.microsoft.com/blog/${boardId}/ct-p/${msg.uid}`;
              }
              allResults.push({
                title: msg.subject || "",
                url,
                posted: msg.postTime || "",
                snippet: snippetText,
              });
            }
          } catch (err) {
            console.log(`    ⚠ GraphQL search failed for "${term}": ${err.message}`);
          }
        }

        // Deduplicate by URL (including items already added from capturedResults)
        const seenUrls = new Set(this.collected.techcommunity_search.map(i => i.url));
        for (const item of allResults) {
          if (seenUrls.has(item.url)) continue;
          seenUrls.add(item.url);
          if (item.posted && !this._isWithinWindow(item.posted)) continue;
          if (this._matchesAKSStrict(item.title) || this._matchesAKSStrict(item.url) || this._matchesAKSStrict(item.snippet)) {
            this.collected.techcommunity_search.push({
              title: item.title, url: item.url, posted: item.posted,
              summary: item.snippet || "",
              source: "TechCommunity Search",
            });
          }
        }
      }
      // Strategy 2: DOM scraping fallback (no bearer token)
      if (!bearerToken) {
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
              // Try to find a snippet near the link (sibling or parent container)
              let snippet = "";
              const container = a.closest('[class*="result"], [class*="search"], li, article, div');
              if (container) {
                const pEl = container.querySelector('p, [class*="snippet"], [class*="body"], [class*="excerpt"]');
                if (pEl && pEl !== a) snippet = (pEl.textContent || "").trim();
              }
              if (
                href && text.length > 10 && text.length < 300 &&
                !seen.has(href) &&
                (href.includes("/blog/") || href.includes("/ba-p/")) &&
                !href.includes("/category/") &&
                !href.includes("/tag/") &&
                !text.startsWith("Place ")
              ) {
                seen.add(href);
                items.push({ title: text, url: href, summary: snippet });
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

  async collectTavilySearch() {
    const apiKey = process.env.TAVILY_API_KEY || "";
    console.log("📡 Collecting web search results...");
    if (!apiKey) console.log("  ⚠ TAVILY_API_KEY is not set. Falling back to Bing HTML search.");

    const queries = [
      { term: '"AKS"', domain: "techcommunity.microsoft.com" },
      { term: '"azure kubernetes service"', domain: "techcommunity.microsoft.com" },
      { term: '"AKS"', domain: "azure.microsoft.com" },
    ];

    const seen = new Set(
      [...this.collected.techcommunity_search, ...this.collected.aks_blog].map(i => i.url)
    );
    let added = 0;
    const startDate = new Date(Date.UTC(this.year, this.month - 1, 0)).toISOString().slice(0, 10);
    const endDate = new Date(Date.UTC(this.year, this.month, 1)).toISOString().slice(0, 10);

    for (const { term, domain } of queries) {
      try {
        let pages;
        let source;
        if (apiKey) {
          const response = await this._safeFetch("https://api.tavily.com/search", {
            method: "POST",
            headers: { Accept: "application/json", "Content-Type": "application/json" },
            body: JSON.stringify({
              api_key: apiKey,
              query: `${term} ${this.year}`,
              search_depth: "basic",
              topic: "general",
              max_results: 20,
              chunks_per_source: 1,
              start_date: startDate,
              end_date: endDate,
              include_published_date: true,
              filter_by_published_date: true,
              include_domains: [domain],
            }),
          });
          if (response) {
            const data = await response.json();
            if (!data || !Array.isArray(data.results)) throw new Error("Tavily response is missing its results array.");
            pages = data.results.map(result => ({
              title: result.title || "",
              url: result.url || "",
              snippet: result.content || "",
              date: result.published_date || "",
            }));
            source = "Tavily Search";
          } else {
            console.log("  ⚠ Tavily request failed. Falling back to Bing HTML search for this query.");
          }
        }

        if (!pages) {
          const searchQuery = `${term} site:${domain} ${this.year}`;
          const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(searchQuery)}&filters=ex1%3a"ez5_${this.windowStart.toISOString().slice(0,10)}_${this.windowEnd.toISOString().slice(0,10)}"&count=50`;
          const response = await this._safeFetch(searchUrl, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              "Accept": "text/html,application/xhtml+xml",
              "Accept-Language": "en-US,en;q=0.9",
            },
          });
          pages = [];
          source = "Bing Search";
          if (response) {
            const html = await response.text();
            const $ = cheerio.load(html);
            $("li.b_algo").each((_, el) => {
              const $el = $(el);
              const a = $el.find("h2 a").first();
              const title = a.text().trim();
              const url = a.attr("href") || "";
              const snippet = $el.find(".b_caption p, .b_lineclamp2").text().trim();
              if (title && url) pages.push({ title, url, snippet, date: "" });
            });
          }
        }

        console.log(`    "${term} ${domain}" → ${pages.length} results`);

        for (const p of pages) {
          const url = p.url || "";
          if (seen.has(url)) continue;
          let parsedUrl;
          try { parsedUrl = new URL(url); }
          catch { continue; }
          if (parsedUrl.protocol !== "https:" || parsedUrl.hostname !== domain) continue;
          if (url.includes("/category/") || url.includes("/tag/") || url.includes("/search")) continue;
          if (!url.includes("/blog/") && !url.includes("/ba-p/") && !url.includes("azure.microsoft.com/blog")) continue;

          const title = (p.title || "").replace(/ \| Microsoft (Community Hub|Azure Blog)$/i, "").trim();
          if (!title || !this._matchesAKS(title + " " + (p.snippet || ""))) continue;

          seen.add(url);
          if (source === "Tavily Search" ? !this._isWithinWindow(p.date) : p.date && !this._isWithinWindow(p.date)) continue;

          this.collected.techcommunity_search.push({
            title, url, posted: p.date,
            summary: (p.snippet || "").slice(0, 300),
            source,
          });
          added++;
        }
      } catch (err) {
        console.log(`    ⚠ Web search failed for "${term} ${domain}": ${err.message}`);
      }
    }

    console.log(`  ✓ Web search added ${added} new posts`);
  }

  async collectAll() {
    console.log(`\n${"=".repeat(60)}`);
    console.log(
      `  AKS Newsletter Agent – Collecting for ${this.monthName} ${this.year}`
    );
    console.log(`${"=".repeat(60)}\n`);

    await this.collectAKSBlog();
    await this.collectGitHubReleases();
    this.reportAKSDocChangesUnavailable();
    await this.collectAzureUpdates();
    await this.collectTavilySearch();
    await this.collectTechCommunity();
    await this.collectTechCommunitySearch();
    await this.collectYouTube();
    await this.enrichTechCommunitySummaries();

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
      `    Docs change tracking: ${this.collected.metadata.documentationUpdatesStatus}`
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

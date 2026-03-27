/**
 * AKS Newsletter Agent – Newsletter Generator
 * Assembles collected content into a Markdown newsletter following the canonical structure.
 */

const fs = require("fs");
const path = require("path");
const { SECTION_HEADERS, SOURCES } = require("./config");

class NewsletterGenerator {
  constructor(year, month, collectedDir = "collected", outputDir = "newsletters") {
    this.year = year;
    this.month = month;
    this.monthName = new Date(year, month - 1).toLocaleString("en-US", { month: "long" });
    this.collectedDir = collectedDir;
    this.outputDir = outputDir;
    this.data = null;
  }

  loadCollectedData() {
    const inputFile = path.join(this.collectedDir, `${this.year}-${String(this.month).padStart(2, "0")}.json`);
    if (!fs.existsSync(inputFile)) {
      throw new Error(`No collected data found at ${inputFile}. Run collector first.`);
    }
    this.data = JSON.parse(fs.readFileSync(inputFile, "utf8"));
    return this.data;
  }

  _formatEntry(item) {
    const title = item.title || "Untitled";
    const url = item.url || "";
    let summary = item.summary || "";
    // Clean up newlines in summaries (e.g., multi-line blog excerpts)
    summary = summary.replace(/\s*\n\s*/g, " ").trim();
    // Truncate long summaries (e.g., first paragraph from blog posts)
    if (summary.length > 200) {
      summary = summary.substring(0, 197).replace(/\s+\S*$/, "") + "...";
    }
    // Remove summaries that are redundant with the title
    if (summary) {
      const lowerSummary = summary.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
      const lowerTitle = title.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
      if (lowerTitle.includes(lowerSummary) || lowerSummary === "is now generally available") {
        summary = "";
      }
    }

    let line = url ? `* **[${title}](${url})**` : `* **${title}**`;
    if (summary) line += `: ${summary}`;
    return line;
  }

  generateTitle() {
    return `# AKS Newsletter – ${this.monthName} ${this.year}\n`;
  }

  generateIntro() {
    const updates = this.data.azure_updates || [];
    const gaItems = updates.filter((u) => {
      const lower = (u.title || "").toLowerCase();
      return lower.includes("generally available") || lower.split(/\s+/).includes("ga");
    });
    const previewItems = updates.filter((u) =>
      (u.title || "").toLowerCase().includes("preview")
    );

    const lines = [];
    lines.push(
      `Welcome to the ${this.monthName} ${this.year} edition of the AKS Newsletter.`
    );
    lines.push("");

    // Summarize the key highlights
    const highlights = [];
    if (gaItems.length) {
      highlights.push(`**${gaItems.length} feature${gaItems.length > 1 ? "s" : ""} reaching General Availability**`);
    }
    if (previewItems.length) {
      highlights.push(`**${previewItems.length} new Preview announcement${previewItems.length > 1 ? "s" : ""}**`);
    }

    if (highlights.length) {
      lines.push(`This month brings ${highlights.join(" and ")}. Here are some of the highlights:`);
      lines.push("");

      // List top GA items
      for (const item of gaItems.slice(0, 3)) {
        const title = (item.title || "")
          .replace(/^Generally Available:\s*/i, "")
          .replace(/\s*[–-]\s*now generally available$/i, "");
        lines.push(`- **${title}** is now generally available`);
      }

      // List top Preview items
      for (const item of previewItems.slice(0, 3)) {
        const title = (item.title || "")
          .replace(/^Public Preview:\s*/i, "")
          .replace(/\s*\(preview\)$/i, "");
        lines.push(`- **${title}** enters public preview`);
      }
      lines.push("");
    }

    lines.push("Let's dive in.");
    lines.push("");
    return lines.join("\n");
  }

  generateDocumentationUpdates() {
    const lines = [`## ${SECTION_HEADERS.documentation_updates}\n`];
    const docs = this.data.aks_docs_commits || [];

    if (!docs.length) {
      lines.push("No documentation updates were identified this month.\n");
    } else {
      docs.forEach((item) => {
        lines.push(this._formatEntry(item));
        lines.push(""); // blank line between entries for readability
      });
    }
    return lines.join("\n");
  }

  generatePreviewAnnouncements() {
    const lines = [`## ${SECTION_HEADERS.preview_announcements}\n`];
    const updates = (this.data.azure_updates || []).filter((u) =>
      (u.title || "").toLowerCase().includes("preview")
    );

    if (!updates.length) {
      lines.push("None this month.\n");
    } else {
      updates.forEach((item) => {
        lines.push(this._formatEntry(item));
        lines.push("");
      });
    }
    return lines.join("\n");
  }

  generateGAAnnouncements() {
    const lines = [`## ${SECTION_HEADERS.ga_announcements}\n`];
    const updates = (this.data.azure_updates || []).filter((u) => {
      const lower = (u.title || "").toLowerCase();
      return lower.includes("generally available") || lower.split(/\s+/).includes("ga");
    });

    if (!updates.length) {
      lines.push("None this month.\n");
    } else {
      updates.forEach((item) => {
        lines.push(this._formatEntry(item));
        lines.push("");
      });
    }
    return lines.join("\n");
  }

  generateBehavioralChanges() {
    const lines = [`## ${SECTION_HEADERS.behavioral_changes}\n`];

    // Use structured behavioral changes if available
    const behavioral = this.data.behavioral_changes || [];
    const announcements = this.data.announcements || [];
    const allChanges = [...behavioral, ...announcements];

    if (allChanges.length) {
      allChanges.forEach((item) => {
        lines.push(this._formatEntry(item));
        lines.push("");
      });
    } else {
      // Fallback: link to release notes
      const releases = this.data.aks_releases || [];
      let found = false;
      for (const release of releases) {
        const body = (release.body || "").toLowerCase();
        if (["breaking change", "behavioral change", "deprecat", "removed", "announcement"].some((kw) => body.includes(kw))) {
          lines.push(this._formatEntry(release));
          lines.push("");
          found = true;
        }
      }
      if (!found) {
        lines.push("No behavioral changes identified this month.\n");
      }
    }
    return lines.join("\n");
  }

  generateCommunityBlogs() {
    const lines = [`## ${SECTION_HEADERS.community_blogs}\n`];
    const blogs = [...(this.data.aks_blog || []), ...(this.data.techcommunity || []), ...(this.data.techcommunity_search || [])];

    // AKS blog posts are always relevant; for TechCommunity posts,
    // re-check the title for AKS relevance to filter out tangential matches
    const aksPatterns = [
      /\baks\b/i, /azure kubernetes/i, /\bk8s\b/i,
      /\bkubernetes\b/i, /\bkubectl\b/i, /\bnode\s*pool/i,
      /\bcilium\b/i, /\bistio\b/i, /\bhelm\b/i, /\bkarpenter\b/i,
      /\bkaito\b/i, /\bkubecon\b/i, /\bcontainer.*(runtime|network|storage)/i,
      /\bingress\b/i, /\bapp\s*routing\b/i, /\bvirtual\s*node/i,
    ];

    if (!blogs.length) {
      lines.push("No community blog posts identified this month.\n");
    } else {
      const seen = new Set();
      blogs.forEach((item) => {
        if (item.url && !seen.has(item.url)) {
          seen.add(item.url);
          const title = (item.title || "").toLowerCase();
          const url = (item.url || "").toLowerCase();
          // AKS blog posts pass through; TechCommunity posts need title/URL match
          const isAKSBlog = (item.source || "").includes("AKS");
          const matchesTitle = aksPatterns.some((p) => p.test(title) || p.test(url));
          if (isAKSBlog || matchesTitle) {
            lines.push(this._formatEntry(item));
            lines.push(""); // blank line between entries
          }
        }
      });
    }
    return lines.join("\n");
  }

  generateReleasesRoadmap() {
    const lines = [`## ${SECTION_HEADERS.releases_roadmap}\n`];
    lines.push(`* **[AKS GitHub Releases](${this.data.releases_url || SOURCES.aks_releases.url})**`);
    lines.push(`* **[AKS Public Roadmap](${this.data.roadmap_url || SOURCES.aks_roadmap.url})**`);
    lines.push("");

    const releases = this.data.aks_releases || [];
    if (releases.length) {
      lines.push("### Release Highlights\n");
      for (const r of releases) {
        // Extract key info from release body for a richer summary
        const body = r.body || "";
        const summary = this._extractReleaseSummary(body);
        lines.push(this._formatEntry({ ...r, summary }));
        lines.push("");
      }
    }
    return lines.join("\n");
  }

  _extractReleaseSummary(body) {
    const parts = [];
    // Extract Kubernetes versions
    const k8sMatch = body.match(/new Kubernetes patch versions[^:]*:\s*`([^`]+)`(?:,\s*`([^`]+)`)*(?:,\s*`([^`]+)`)?/i);
    if (k8sMatch) {
      const versions = [k8sMatch[1], k8sMatch[2], k8sMatch[3]].filter(Boolean).join(", ");
      parts.push(`Kubernetes patch versions ${versions}`);
    }
    // Count component updates
    const componentSection = body.split(/###\s*Component\s*Updates?/i)[1];
    if (componentSection) {
      const componentCount = (componentSection.split(/###\s/)[0].match(/\n\s*\*/g) || []).length;
      if (componentCount > 0) parts.push(`${componentCount} component updates`);
    }
    // Check for CVE mentions
    const cveCount = (body.match(/CVE-\d{4}-\d+/g) || []).length;
    if (cveCount > 0) parts.push(`${cveCount} CVE remediations`);
    return parts.length ? `This release includes ${parts.join(", ")}.` : "";
  }

  generateWatchLearn() {
    const lines = [`## ${SECTION_HEADERS.watch_learn}\n`];
    const videos = this.data.youtube || [];

    if (!videos.length) {
      lines.push("No AKS-related videos identified this month.\n");
    } else {
      videos.forEach((item) => {
        lines.push(this._formatEntry(item));
        lines.push(""); // blank line between entries
      });
    }
    return lines.join("\n");
  }

  generateClosing() {
    const lines = [`## ${SECTION_HEADERS.closing_thoughts}\n`];

    // Extract themes from GA and Preview titles
    const updates = this.data.azure_updates || [];
    const allTitles = updates.map((u) => (u.title || "").toLowerCase()).join(" ");
    const themes = [];
    const themeKeywords = [
      { keywords: ["network", "cni", "egress", "ingress", "dns", "routing", "gateway"], label: "Networking capabilities" },
      { keywords: ["monitor", "observab", "metrics", "logs", "telemetry", "otel", "prometheus"], label: "Observability and monitoring" },
      { keywords: ["security", "identity", "auth", "rbac", "encryption", "mTLS"], label: "Security and identity" },
      { keywords: ["gpu", "ai", "ml", "kaito", "inference", "llm"], label: "AI and GPU workloads" },
      { keywords: ["scale", "autoscal", "provision", "karpenter", "node pool"], label: "Scaling and node management" },
      { keywords: ["storage", "disk", "volume", "container storage"], label: "Storage" },
      { keywords: ["fleet", "multi-cluster", "cross-cluster"], label: "Multi-cluster and fleet management" },
    ];
    for (const theme of themeKeywords) {
      if (theme.keywords.some((kw) => allTitles.includes(kw))) {
        themes.push(theme.label);
      }
    }

    if (themes.length) {
      lines.push(
        `${this.monthName} ${this.year} showed continued investment across key areas of the AKS platform:`
      );
      lines.push("");
      themes.forEach((t) => lines.push(`- ${t}`));
      lines.push("");
      lines.push(
        "These updates reflect the platform's ongoing focus on production readiness, operational simplicity, and support for modern cloud-native workloads."
      );
    } else {
      lines.push(
        `${this.monthName} ${this.year} brought continued progress across the AKS platform.`
      );
    }

    lines.push("");
    lines.push(
      "Stay tuned for next month's edition, and feel free to share feedback or suggestions for future coverage."
    );
    lines.push("");
    return lines.join("\n");
  }

  generate() {
    if (!this.data) this.loadCollectedData();

    const sections = [
      this.generateTitle(),
      this.generateIntro(),
      "---\n",
      this.generateDocumentationUpdates(),
      "---\n",
      this.generatePreviewAnnouncements(),
      "---\n",
      this.generateGAAnnouncements(),
      "---\n",
      this.generateBehavioralChanges(),
      "---\n",
      this.generateCommunityBlogs(),
      "---\n",
      this.generateReleasesRoadmap(),
      "---\n",
      this.generateWatchLearn(),
      "---\n",
      this.generateClosing(),
    ];

    return sections.join("\n");
  }

  save(content) {
    const yearDir = path.join(this.outputDir, String(this.year));
    fs.mkdirSync(yearDir, { recursive: true });
    const outputFile = path.join(yearDir, `${this.year}-${String(this.month).padStart(2, "0")}.md`);
    fs.writeFileSync(outputFile, content, "utf8");
    console.log(`📄 Newsletter saved to: ${outputFile}`);
    return outputFile;
  }
}

module.exports = { NewsletterGenerator };

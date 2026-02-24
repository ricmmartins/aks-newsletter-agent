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
    const summary = item.summary || "";

    let line = url ? `* **[${title}](${url})**` : `* **${title}**`;
    if (summary) line += `: ${summary}`;
    return line;
  }

  generateTitle() {
    return `# AKS Newsletter – ${this.monthName} ${this.year}\n`;
  }

  generateIntro() {
    const lines = [
      `${this.monthName} ${this.year} edition of the AKS Newsletter.`,
      "",
      "This edition covers documentation updates, feature announcements, behavioral changes, community blogs, and more.",
      "",
      "Let's dive in.",
      "",
    ];
    return lines.join("\n");
  }

  generateDocumentationUpdates() {
    const lines = [`## ${SECTION_HEADERS.documentation_updates}\n`];
    const docs = this.data.aks_docs_commits || [];

    if (!docs.length) {
      lines.push("No documentation updates were identified this month.\n");
    } else {
      docs.forEach((item) => lines.push(this._formatEntry(item)));
      lines.push("");
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
      updates.forEach((item) => lines.push(this._formatEntry(item)));
      lines.push("");
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
      updates.forEach((item) => lines.push(this._formatEntry(item)));
      lines.push("");
    }
    return lines.join("\n");
  }

  generateBehavioralChanges() {
    const lines = [`## ${SECTION_HEADERS.behavioral_changes}\n`];
    const releases = this.data.aks_releases || [];
    let found = false;

    for (const release of releases) {
      const body = (release.body || "").toLowerCase();
      if (["breaking change", "behavioral change", "deprecat", "removed"].some((kw) => body.includes(kw))) {
        lines.push(this._formatEntry(release));
        found = true;
      }
    }

    if (!found) {
      lines.push("No behavioral changes identified this month.\n");
    } else {
      lines.push("");
    }
    return lines.join("\n");
  }

  generateCommunityBlogs() {
    const lines = [`## ${SECTION_HEADERS.community_blogs}\n`];
    const blogs = [...(this.data.aks_blog || []), ...(this.data.techcommunity || []), ...(this.data.techcommunity_search || [])];

    if (!blogs.length) {
      lines.push("No community blog posts identified this month.\n");
    } else {
      const seen = new Set();
      blogs.forEach((item) => {
        if (item.url && !seen.has(item.url)) {
          seen.add(item.url);
          lines.push(this._formatEntry(item));
        }
      });
      lines.push("");
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
      releases.forEach((r) => lines.push(this._formatEntry(r)));
      lines.push("");
    }
    return lines.join("\n");
  }

  generateWatchLearn() {
    const lines = [`## ${SECTION_HEADERS.watch_learn}\n`];
    const videos = this.data.youtube || [];

    if (!videos.length) {
      lines.push("No AKS-related videos identified this month.\n");
    } else {
      videos.forEach((item) => lines.push(this._formatEntry(item)));
      lines.push("");
    }
    return lines.join("\n");
  }

  generateClosing() {
    return [
      `## ${SECTION_HEADERS.closing_thoughts}\n`,
      `${this.monthName} ${this.year} brought continued progress across the AKS platform.`,
      "",
      "Stay tuned for next month's edition.",
      "",
    ].join("\n");
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

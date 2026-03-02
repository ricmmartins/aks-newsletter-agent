#!/usr/bin/env node
/**
 * Static site builder for AKS Newsletter.
 * Converts newsletter markdown files into styled HTML pages
 * with an index page listing all editions.
 */

const fs = require("fs");
const path = require("path");
const { marked } = require("marked");

const NEWSLETTERS_DIR = path.join(__dirname, "newsletters");
const OUTPUT_DIR = path.join(__dirname, "docs");

const MONTH_NAMES = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const CSS = `
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, sans-serif;
  line-height: 1.7; color: #1a1a2e; background: #fafafa;
  max-width: 780px; margin: 0 auto; padding: 2rem 1.5rem;
}
a { color: #0969da; text-decoration: none; }
a:hover { text-decoration: underline; }
h1 { font-size: 1.8rem; margin-bottom: 0.5rem; color: #0f172a; }
h2 { font-size: 1.35rem; margin: 2rem 0 0.75rem; color: #1e293b; border-bottom: 2px solid #e2e8f0; padding-bottom: 0.3rem; }
h3 { font-size: 1.1rem; margin: 1.5rem 0 0.5rem; color: #334155; }
p { margin: 0.75rem 0; }
ul, ol { margin: 0.75rem 0; padding-left: 1.5rem; }
li { margin: 0.4rem 0; }
li p { margin: 0.2rem 0; }
hr { border: none; border-top: 1px solid #e2e8f0; margin: 2rem 0; }
code { background: #f1f5f9; padding: 0.15rem 0.4rem; border-radius: 4px; font-size: 0.9em; }
pre { background: #f1f5f9; padding: 1rem; border-radius: 6px; overflow-x: auto; margin: 1rem 0; }
pre code { background: none; padding: 0; }
strong { color: #0f172a; }
table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
th, td { border: 1px solid #e2e8f0; padding: 0.5rem 0.75rem; text-align: left; }
th { background: #f1f5f9; font-weight: 600; }
.nav { margin-bottom: 1.5rem; font-size: 0.9rem; color: #64748b; }
.nav a { color: #64748b; }
.nav a:hover { color: #0969da; }
.footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid #e2e8f0; font-size: 0.85rem; color: #94a3b8; text-align: center; }
.edition-list { list-style: none; padding: 0; }
.edition-list li { padding: 0.75rem 0; border-bottom: 1px solid #f1f5f9; }
.edition-list li:last-child { border-bottom: none; }
.edition-list a { font-size: 1.1rem; font-weight: 500; }
.edition-date { color: #64748b; font-size: 0.9rem; margin-left: 0.5rem; }
@media (max-width: 600px) {
  body { padding: 1rem; }
  h1 { font-size: 1.5rem; }
  h2 { font-size: 1.2rem; }
}
`.trim();

function htmlTemplate(title, body, nav = "") {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>${CSS}</style>
</head>
<body>
  ${nav ? `<div class="nav">${nav}</div>` : ""}
  ${body}
  <div class="footer">AKS Newsletter &mdash; curated monthly updates on Azure Kubernetes Service</div>
</body>
</html>`;
}

function discoverEditions() {
  const editions = [];
  if (!fs.existsSync(NEWSLETTERS_DIR)) return editions;

  for (const yearDir of fs.readdirSync(NEWSLETTERS_DIR).sort()) {
    const yearPath = path.join(NEWSLETTERS_DIR, yearDir);
    if (!fs.statSync(yearPath).isDirectory()) continue;

    for (const file of fs.readdirSync(yearPath).sort()) {
      if (!file.endsWith(".md")) continue;
      const match = file.match(/^(\d{4})-(\d{2})\.md$/);
      if (!match) continue;

      const year = parseInt(match[1], 10);
      const month = parseInt(match[2], 10);
      editions.push({
        year,
        month,
        monthName: MONTH_NAMES[month],
        file: path.join(yearPath, file),
        slug: `${year}-${match[2]}`,
      });
    }
  }

  return editions.sort((a, b) => b.slug.localeCompare(a.slug)); // newest first
}

function buildEditionPage(edition) {
  const md = fs.readFileSync(edition.file, "utf8");
  const html = marked.parse(md);
  const nav = `<a href="../index.html">← All Editions</a>`;
  return htmlTemplate(
    `AKS Newsletter – ${edition.monthName} ${edition.year}`,
    html,
    nav
  );
}

function buildIndexPage(editions) {
  let listItems = "";
  for (const ed of editions) {
    listItems += `<li><a href="${ed.year}/${ed.slug}.html">${ed.monthName} ${ed.year}</a><span class="edition-date">AKS Newsletter</span></li>\n`;
  }

  const body = `
    <h1>AKS Newsletter</h1>
    <p>Monthly curated updates on Azure Kubernetes Service — documentation changes, feature announcements, community blogs, release highlights, and more.</p>
    <hr>
    <h2>Editions</h2>
    <ul class="edition-list">
      ${listItems}
    </ul>
  `;

  return htmlTemplate("AKS Newsletter", body);
}

function build() {
  console.log("🔨 Building AKS Newsletter site...\n");

  const editions = discoverEditions();
  if (editions.length === 0) {
    console.log("  ⚠ No newsletter editions found.");
    return;
  }

  // Clean and create output dir
  fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Build each edition
  for (const ed of editions) {
    const yearDir = path.join(OUTPUT_DIR, String(ed.year));
    fs.mkdirSync(yearDir, { recursive: true });

    const html = buildEditionPage(ed);
    const outFile = path.join(yearDir, `${ed.slug}.html`);
    fs.writeFileSync(outFile, html, "utf8");
    console.log(`  ✓ ${ed.monthName} ${ed.year} → ${ed.slug}.html`);
  }

  // Build index
  const indexHtml = buildIndexPage(editions);
  fs.writeFileSync(path.join(OUTPUT_DIR, "index.html"), indexHtml, "utf8");
  console.log(`  ✓ index.html`);

  console.log(`\n✅ Site built: ${editions.length} edition(s) → docs/`);
}

build();

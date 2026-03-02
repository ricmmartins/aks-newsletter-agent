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
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
:root {
  --azure-blue: #0078d4;
  --azure-dark: #003d6b;
  --azure-light: #50e6ff;
  --azure-purple: #6b3fa0;
  --bg: #0d1117;
  --surface: #161b22;
  --surface-2: #1c2333;
  --border: #30363d;
  --text: #e6edf3;
  --text-muted: #8b949e;
  --text-subtle: #6e7681;
  --accent: #58a6ff;
  --accent-hover: #79c0ff;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  line-height: 1.75; color: var(--text); background: var(--bg);
}
.container { max-width: 820px; margin: 0 auto; padding: 0 1.5rem 3rem; }
a { color: var(--accent); text-decoration: none; transition: color 0.2s; }
a:hover { color: var(--accent-hover); }

/* Header */
.header {
  background: linear-gradient(135deg, var(--azure-dark) 0%, var(--azure-blue) 50%, var(--azure-purple) 100%);
  padding: 2.5rem 1.5rem;
  margin-bottom: 2rem;
  position: relative;
  overflow: hidden;
}
.header::before {
  content: '⎈';
  position: absolute;
  right: -20px;
  top: -20px;
  font-size: 180px;
  opacity: 0.07;
  color: white;
}
.header-inner { max-width: 820px; margin: 0 auto; position: relative; z-index: 1; }
.header h1 {
  font-size: 1.75rem; font-weight: 700; color: white;
  display: flex; align-items: center; gap: 0.6rem;
}
.header .subtitle { color: rgba(255,255,255,0.75); font-size: 0.95rem; margin-top: 0.25rem; }
.header .logo { font-size: 1.5rem; }
.header .badge {
  display: inline-block; background: rgba(255,255,255,0.15);
  border: 1px solid rgba(255,255,255,0.25);
  padding: 0.15rem 0.6rem; border-radius: 100px;
  font-size: 0.75rem; color: rgba(255,255,255,0.9);
  margin-left: 0.5rem; font-weight: 500; letter-spacing: 0.02em;
}

/* Navigation */
.nav {
  margin-bottom: 1.5rem; font-size: 0.85rem;
  color: var(--text-muted); padding: 0.75rem 0;
  border-bottom: 1px solid var(--border);
}
.nav a { color: var(--text-muted); }
.nav a:hover { color: var(--accent); }

/* Content */
h1 { font-size: 1.6rem; font-weight: 700; color: var(--text); margin-bottom: 0.75rem; }
h2 {
  font-size: 1.25rem; font-weight: 600; color: var(--text);
  margin: 2.5rem 0 1rem; padding-bottom: 0.5rem;
  border-bottom: 2px solid var(--azure-blue);
  display: flex; align-items: center; gap: 0.4rem;
}
h3 { font-size: 1.05rem; font-weight: 600; color: var(--text); margin: 1.5rem 0 0.5rem; }
p { margin: 0.75rem 0; color: var(--text); }
ul, ol { margin: 0.75rem 0; padding-left: 1.5rem; }
li { margin: 0.5rem 0; }
li p { margin: 0.2rem 0; }
li > strong > a { color: var(--accent); }
hr { border: none; border-top: 1px solid var(--border); margin: 2rem 0; }
code {
  background: var(--surface-2); padding: 0.15rem 0.4rem;
  border-radius: 4px; font-size: 0.85em; color: var(--azure-light);
  border: 1px solid var(--border);
}
pre {
  background: var(--surface); padding: 1rem; border-radius: 8px;
  overflow-x: auto; margin: 1rem 0; border: 1px solid var(--border);
}
pre code { background: none; padding: 0; border: none; color: var(--text); }
strong { color: var(--text); font-weight: 600; }
table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
th, td {
  border: 1px solid var(--border); padding: 0.5rem 0.75rem; text-align: left;
}
th { background: var(--surface); font-weight: 600; color: var(--text); }
td { color: var(--text-muted); }

/* Footer */
.footer {
  margin-top: 3rem; padding: 1.5rem 0; border-top: 1px solid var(--border);
  font-size: 0.8rem; color: var(--text-subtle); text-align: center;
}
.footer a { color: var(--text-muted); }

/* Index page */
.intro { color: var(--text-muted); font-size: 1rem; margin: 0.5rem 0 1.5rem; }
.edition-list { list-style: none; padding: 0; }
.edition-list li {
  padding: 1rem 1.25rem; margin: 0.5rem 0;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 8px; transition: border-color 0.2s, background 0.2s;
}
.edition-list li:hover { border-color: var(--azure-blue); background: var(--surface-2); }
.edition-list a { font-size: 1.05rem; font-weight: 500; display: block; }
.edition-date { color: var(--text-muted); font-size: 0.85rem; display: block; margin-top: 0.15rem; }

@media (max-width: 600px) {
  body { font-size: 0.95rem; }
  .header { padding: 1.5rem 1rem; }
  .header h1 { font-size: 1.35rem; }
  .container { padding: 0 1rem 2rem; }
  h2 { font-size: 1.1rem; }
}

/* Search */
.search-box {
  position: relative; margin: 1.5rem 0;
}
.search-box input {
  width: 100%; padding: 0.75rem 1rem 0.75rem 2.75rem;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 8px; color: var(--text); font-size: 0.95rem;
  font-family: inherit; outline: none; transition: border-color 0.2s;
}
.search-box input::placeholder { color: var(--text-subtle); }
.search-box input:focus { border-color: var(--azure-blue); }
.search-box .search-icon {
  position: absolute; left: 0.9rem; top: 50%; transform: translateY(-50%);
  color: var(--text-subtle); font-size: 1rem; pointer-events: none;
}
.search-box .search-clear {
  position: absolute; right: 0.75rem; top: 50%; transform: translateY(-50%);
  background: none; border: none; color: var(--text-subtle); cursor: pointer;
  font-size: 1.1rem; display: none; padding: 0.25rem;
}
.search-box .search-clear:hover { color: var(--text); }
.search-stats {
  font-size: 0.8rem; color: var(--text-subtle); margin: -0.5rem 0 1rem;
  display: none;
}
.no-results {
  text-align: center; padding: 2rem; color: var(--text-muted);
  display: none;
}
.highlight { background: rgba(88,166,255,0.2); border-radius: 2px; padding: 0 1px; }
`.trim();

function htmlTemplate(title, body, nav = "", headerTitle = "", headerSubtitle = "", badge = "") {
  const headerHtml = headerTitle ? `
  <div class="header">
    <div class="header-inner">
      <h1><span class="logo">⎈</span> ${headerTitle}${badge ? `<span class="badge">${badge}</span>` : ""}</h1>
      ${headerSubtitle ? `<p class="subtitle">${headerSubtitle}</p>` : ""}
    </div>
  </div>` : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>${CSS}</style>
</head>
<body>
  ${headerHtml}
  <div class="container">
    ${nav ? `<div class="nav">${nav}</div>` : ""}
    ${body}
    <div class="footer">
      <a href="https://github.com/ricmmartins/aks-newsletter-agent">⎈ AKS Newsletter</a> &mdash; curated monthly updates on Azure Kubernetes Service
    </div>
  </div>
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
  // Remove the h1 from content since the header already shows the title
  const contentHtml = html.replace(/<h1[^>]*>.*?<\/h1>/i, "");
  return htmlTemplate(
    `AKS Newsletter – ${edition.monthName} ${edition.year}`,
    contentHtml,
    nav,
    "AKS Newsletter",
    `${edition.monthName} ${edition.year} Edition`,
    `${edition.monthName} ${edition.year}`
  );
}

function buildIndexPage(editions) {
  let listItems = "";
  for (const ed of editions) {
    listItems += `<li data-search="${ed.monthName.toLowerCase()} ${ed.year}"><a href="${ed.year}/${ed.slug}.html">${ed.monthName} ${ed.year}</a><span class="edition-date">Monthly edition</span></li>\n`;
  }

  // Build search index from all newsletter content
  const searchData = [];
  for (const ed of editions) {
    const md = fs.readFileSync(ed.file, "utf8");
    // Extract sections with their headers
    const sections = md.split(/^## /m).slice(1);
    for (const section of sections) {
      const lines = section.split("\n");
      const sectionTitle = lines[0].trim();
      const items = section.match(/\*\*\[([^\]]+)\]\(([^)]+)\)\*\*:?\s*([^\n]*)/g) || [];
      for (const item of items) {
        const match = item.match(/\*\*\[([^\]]+)\]\(([^)]+)\)\*\*:?\s*(.*)/);
        if (match) {
          searchData.push({
            title: match[1],
            url: match[2],
            desc: match[3].substring(0, 200),
            edition: `${ed.monthName} ${ed.year}`,
            editionUrl: `${ed.year}/${ed.slug}.html`,
            section: sectionTitle,
          });
        }
      }
    }
  }

  const body = `
    <div class="search-box">
      <span class="search-icon">🔍</span>
      <input type="text" id="search" placeholder="Search across all editions..." autocomplete="off">
      <button class="search-clear" id="searchClear" onclick="clearSearch()">✕</button>
    </div>
    <div class="search-stats" id="searchStats"></div>
    <div class="no-results" id="noResults">No results found</div>
    <div id="searchResults"></div>
    <div id="editionsList">
      <h2>Editions</h2>
      <ul class="edition-list">
        ${listItems}
      </ul>
    </div>
    <script>
    const searchData = ${JSON.stringify(searchData)};
    const searchInput = document.getElementById('search');
    const searchStats = document.getElementById('searchStats');
    const searchResults = document.getElementById('searchResults');
    const editionsList = document.getElementById('editionsList');
    const noResults = document.getElementById('noResults');
    const searchClear = document.getElementById('searchClear');

    function escapeHtml(s) {
      return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    function highlightText(text, query) {
      if (!query) return escapeHtml(text);
      const escaped = escapeHtml(text);
      const re = new RegExp('(' + query.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&') + ')', 'gi');
      return escaped.replace(re, '<span class="highlight">$1</span>');
    }

    function clearSearch() {
      searchInput.value = '';
      doSearch();
      searchInput.focus();
    }

    function doSearch() {
      const q = searchInput.value.trim().toLowerCase();
      searchClear.style.display = q ? 'block' : 'none';

      if (!q || q.length < 2) {
        searchResults.innerHTML = '';
        searchStats.style.display = 'none';
        noResults.style.display = 'none';
        editionsList.style.display = 'block';
        return;
      }

      const matches = searchData.filter(d =>
        d.title.toLowerCase().includes(q) ||
        d.desc.toLowerCase().includes(q) ||
        d.section.toLowerCase().includes(q) ||
        d.edition.toLowerCase().includes(q)
      );

      editionsList.style.display = 'none';

      if (matches.length === 0) {
        searchResults.innerHTML = '';
        searchStats.style.display = 'none';
        noResults.style.display = 'block';
        return;
      }

      noResults.style.display = 'none';
      searchStats.style.display = 'block';
      searchStats.textContent = matches.length + ' result' + (matches.length !== 1 ? 's' : '') + ' found';

      let html = '<ul class="edition-list">';
      for (const m of matches) {
        const title = highlightText(m.title, searchInput.value.trim());
        const desc = m.desc ? '<span class="edition-date">' + highlightText(m.desc.substring(0, 120), searchInput.value.trim()) + (m.desc.length > 120 ? '...' : '') + '</span>' : '';
        html += '<li><a href="' + escapeHtml(m.url) + '" target="_blank">' + title + '</a>'
          + desc
          + '<span class="edition-date" style="font-size:0.75rem;margin-top:0.25rem;">📰 ' + escapeHtml(m.edition) + ' · ' + escapeHtml(m.section) + '</span></li>';
      }
      html += '</ul>';
      searchResults.innerHTML = html;
    }

    searchInput.addEventListener('input', doSearch);
    </script>
  `;

  return htmlTemplate(
    "AKS Newsletter",
    body,
    "",
    "AKS Newsletter",
    "Monthly curated updates on Azure Kubernetes Service"
  );
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

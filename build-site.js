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

const SECTION_ICONS = {
  "Documentation Updates": "📄",
  "Preview Feature": "🧪",
  "General Availability": "✅",
  "Behavioral Changes": "🔁",
  "Community Blogs": "📚",
  "Releases and Roadmap": "🔗",
  "Watch & Learn": "🎥",
  "Closing Thoughts": "🧠",
};

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
:root {
  --bg: #ffffff;
  --surface: #f8fafc;
  --surface-hover: #f1f5f9;
  --border: #e2e8f0;
  --border-hover: #0078d4;
  --text: #0f172a;
  --text-secondary: #475569;
  --text-dim: #94a3b8;
  --accent: #0078d4;
  --accent-light: #e8f4fd;
  --accent-dark: #005a9e;
  --purple: #6366f1;
  --radius: 8px;
}
[data-theme="dark"] {
  --bg: #0f1117;
  --surface: #1a1d27;
  --surface-hover: #22263a;
  --border: #2a2e3e;
  --border-hover: #3b82f6;
  --text: #e2e8f0;
  --text-secondary: #94a3b8;
  --text-dim: #64748b;
  --accent: #3b82f6;
  --accent-light: rgba(59,130,246,0.12);
  --accent-dark: #93bbfd;
}
*{margin:0;padding:0;box-sizing:border-box}
html{scroll-behavior:smooth}
body{
  font-family:'Inter',system-ui,-apple-system,sans-serif;
  line-height:1.75;color:var(--text);background:var(--bg);
  -webkit-font-smoothing:antialiased;
}
.container{max-width:760px;margin:0 auto;padding:0 1.5rem 4rem}
a{color:var(--accent);text-decoration:none;transition:color 0.15s}
a:hover{color:var(--accent-dark)}

/* ── Header ── */
.header{
  border-bottom:1px solid var(--border);
  padding:0 1.5rem;
  background:var(--bg);
}
.header-inner{
  max-width:760px;margin:0 auto;
  padding:1.25rem 0;
  display:flex;align-items:center;justify-content:space-between;gap:0.75rem;
}
.header-left{display:flex;align-items:center;gap:0.6rem}
.header-actions{display:flex;align-items:center;gap:0.6rem}
.header-logo{
  width:32px;height:32px;border-radius:8px;
  background:var(--accent);
  display:flex;align-items:center;justify-content:center;
  flex-shrink:0;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%230078d4'/%3E%3Ctext x='50%25' y='54%25' dominant-baseline='middle' text-anchor='middle' font-family='system-ui' font-weight='700' font-size='15' fill='white'%3EK%3C/text%3E%3C/svg%3E");
  background-size:cover;
}
.header-brand{font-size:0.95rem;font-weight:700;color:var(--text);letter-spacing:-0.01em}
.badge{
  font-size:0.7rem;font-weight:600;
  padding:0.25rem 0.7rem;border-radius:100px;
  background:var(--accent-light);color:var(--accent);
  letter-spacing:0.02em;
}
.hero{
  max-width:760px;margin:0 auto;
  padding:3rem 1.5rem 2rem;
}
.hero h1{
  font-size:2rem;font-weight:700;color:var(--text);
  letter-spacing:-0.03em;line-height:1.2;margin-bottom:0.5rem;
}
.hero p{
  font-size:1.05rem;color:var(--text-secondary);
  max-width:560px;line-height:1.6;
}

/* ── Navigation ── */
.nav{
  padding:0.6rem 0;margin-bottom:0;
  font-size:0.85rem;
}
.nav a{
  color:var(--text-dim);display:inline-flex;align-items:center;gap:0.25rem;
}
.nav a:hover{color:var(--accent)}

/* ── Typography ── */
h1{font-size:1.75rem;font-weight:700;color:var(--text);margin-bottom:0.75rem;letter-spacing:-0.025em;line-height:1.25}
h2{
  font-size:0.8rem;font-weight:600;color:var(--text-dim);
  text-transform:uppercase;letter-spacing:0.08em;
  margin:2.5rem 0 1rem;padding-bottom:0.75rem;
  border-bottom:1px solid var(--border);
}
h3{font-size:1rem;font-weight:600;color:var(--text);margin:1.5rem 0 0.5rem}
p{margin:0.75rem 0;color:var(--text-secondary);font-size:0.95rem}
ul,ol{margin:0.75rem 0;padding-left:0;list-style:none}
li{margin:0 0 0.5rem;color:var(--text-secondary);font-size:0.95rem}
li p{margin:0.2rem 0}
hr{border:none;border-top:1px solid var(--border);margin:2rem 0}
strong{color:var(--text);font-weight:600}

/* ── Code ── */
code{
  background:var(--surface);padding:0.15rem 0.4rem;
  border-radius:4px;font-size:0.85em;color:var(--accent-dark);
}
pre{
  background:var(--surface);padding:1.25rem;border-radius:var(--radius);
  overflow-x:auto;margin:1rem 0;border:1px solid var(--border);
}
pre code{background:none;padding:0;color:var(--text-secondary)}

/* ── Tables ── */
table{border-collapse:collapse;width:100%;margin:1rem 0}
th,td{border:1px solid var(--border);padding:0.6rem 0.85rem;text-align:left;font-size:0.9rem}
th{background:var(--surface);font-weight:600;color:var(--text)}
td{color:var(--text-secondary)}

/* ── Content items ── */
li:has(> strong > a){
  padding:1rem 1.25rem;margin:0.5rem 0;
  border:1px solid var(--border);border-radius:var(--radius);
  transition:all 0.15s ease;
}
li:has(> strong > a):hover{
  border-color:var(--border-hover);
  box-shadow:0 1px 3px rgba(0,120,212,0.08);
}
li:has(> strong > a) strong a{font-size:0.95rem}

/* ── Footer ── */
.footer{
  margin-top:4rem;padding:1.5rem 0;
  border-top:1px solid var(--border);
  font-size:0.8rem;color:var(--text-dim);text-align:center;
}

/* ── Edition cards ── */
.edition-grid{display:grid;gap:0}
.edition-card{
  display:flex;align-items:center;justify-content:space-between;
  padding:1.25rem 0;
  border-bottom:1px solid var(--border);
  transition:all 0.15s ease;text-decoration:none;color:inherit;
}
.edition-card:first-child{border-top:1px solid var(--border)}
.edition-card:hover{background:var(--surface);margin:0 -1rem;padding:1.25rem 1rem;border-radius:var(--radius)}
.edition-card:hover .ed-arrow{color:var(--accent);transform:translateX(2px)}
.ed-info{display:flex;flex-direction:column;gap:0.15rem}
.ed-title{font-size:1rem;font-weight:600;color:var(--text)}
.ed-meta{font-size:0.8rem;color:var(--text-dim);display:flex;align-items:center;gap:0.5rem}
.ed-tag{
  font-size:0.65rem;font-weight:600;text-transform:uppercase;
  letter-spacing:0.04em;padding:0.15rem 0.5rem;border-radius:4px;
  background:var(--accent-light);color:var(--accent);
}
.ed-arrow{color:var(--text-dim);font-size:1.1rem;transition:all 0.15s}

/* ── Search ── */
.search-wrap{margin:0 0 2rem;position:relative}
.search-wrap input{
  width:100%;padding:0.7rem 1rem 0.7rem 2.5rem;
  background:var(--surface);border:1px solid var(--border);
  border-radius:var(--radius);color:var(--text);font-size:0.9rem;
  font-family:inherit;outline:none;transition:all 0.15s ease;
}
.search-wrap input::placeholder{color:var(--text-dim)}
.search-wrap input:focus{
  border-color:var(--accent);
  box-shadow:0 0 0 3px rgba(0,120,212,0.1);
  background:var(--bg);
}
.search-wrap .s-icon{
  position:absolute;left:0.85rem;top:50%;transform:translateY(-50%);
  color:var(--text-dim);pointer-events:none;font-size:0.85rem;
}
.search-wrap .s-clear{
  position:absolute;right:0.7rem;top:50%;transform:translateY(-50%);
  background:none;border:1px solid var(--border);
  color:var(--text-dim);cursor:pointer;font-size:0.65rem;font-weight:600;
  width:20px;height:20px;border-radius:4px;display:none;
  align-items:center;justify-content:center;
}
.search-wrap .s-clear:hover{background:var(--surface);color:var(--text)}
.search-wrap .s-kbd{
  position:absolute;right:0.7rem;top:50%;transform:translateY(-50%);
  font-size:0.65rem;color:var(--text-dim);font-family:inherit;
  border:1px solid var(--border);background:var(--bg);
  padding:0.1rem 0.4rem;border-radius:4px;pointer-events:none;
}
.search-stats{font-size:0.8rem;color:var(--text-dim);margin:0 0 1rem;display:none}
.no-results{text-align:center;padding:3rem 1rem;color:var(--text-dim);display:none}
.search-result{
  display:block;padding:1rem 0;
  border-bottom:1px solid var(--border);
  text-decoration:none;color:inherit;transition:all 0.15s;
}
.search-result:first-child{border-top:1px solid var(--border)}
.search-result:hover{background:var(--surface);margin:0 -0.75rem;padding:1rem 0.75rem;border-radius:var(--radius)}
.sr-title{font-weight:600;color:var(--text);display:block;font-size:0.9rem}
.sr-desc{font-size:0.82rem;color:var(--text-dim);display:block;margin-top:0.2rem;line-height:1.5}
.sr-meta{font-size:0.72rem;color:var(--text-dim);margin-top:0.35rem;display:flex;align-items:center;gap:0.5rem}
.sr-tag{
  font-size:0.6rem;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;
  padding:0.1rem 0.4rem;border-radius:4px;
  background:var(--surface);color:var(--text-dim);border:1px solid var(--border);
}
mark{background:rgba(0,120,212,0.12);color:var(--accent-dark);border-radius:2px;padding:0 1px}

@media(max-width:640px){
  .hero{padding:2rem 1rem 1.5rem}
  .hero h1{font-size:1.5rem}
  .container{padding:0 1rem 3rem}
}

/* ── Theme toggle ── */
.theme-toggle{
  background:none;border:1px solid var(--border);
  width:36px;height:36px;border-radius:var(--radius);
  cursor:pointer;display:flex;align-items:center;justify-content:center;
  font-size:1rem;transition:all 0.15s;flex-shrink:0;
}
.theme-toggle:hover{background:var(--surface);border-color:var(--text-dim)}
[data-theme="dark"] .theme-icon-dark,
:root:not([data-theme="dark"]) .theme-icon-light{display:none}
[data-theme="dark"] .theme-icon-light,
:root:not([data-theme="dark"]) .theme-icon-dark{display:none}
[data-theme="dark"] .theme-icon-light{display:inline}
:root:not([data-theme="dark"]) .theme-icon-dark{display:inline}
[data-theme="dark"] mark{background:rgba(59,130,246,0.2);color:var(--accent-dark)}
`.trim();

function htmlTemplate(title, body, nav = "", headerTitle = "", headerSubtitle = "", badge = "") {
  const headerHtml = `
  <div class="header">
    <div class="header-inner">
      <div class="header-left">
        <div class="header-logo"></div>
        <span class="header-brand">AKS Newsletter</span>
      </div>
      <div class="header-actions">
        ${badge ? `<span class="badge">${badge}</span>` : ""}
        <button class="theme-toggle" id="themeToggle" aria-label="Toggle dark mode" title="Toggle dark mode">
          <span class="theme-icon-light">☀️</span>
          <span class="theme-icon-dark">🌙</span>
        </button>
      </div>
    </div>
  </div>`;

  const heroHtml = headerTitle ? `
  <div class="hero">
    <h1>${headerSubtitle || headerTitle}</h1>
    ${headerSubtitle ? `<p>Curated documentation updates, feature announcements, community blogs, release highlights, and more.</p>` : ""}
  </div>` : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%230078d4'/%3E%3Ctext x='50%25' y='54%25' dominant-baseline='middle' text-anchor='middle' font-family='system-ui' font-weight='700' font-size='15' fill='white'%3EK%3C/text%3E%3C/svg%3E">
  <style>${CSS}</style>
  <script>
  (function(){var s=localStorage.getItem('theme');if(s==='dark'||(!s&&window.matchMedia('(prefers-color-scheme:dark)').matches))document.documentElement.setAttribute('data-theme','dark')})();
  </script>
</head>
<body>
  ${headerHtml}
  ${heroHtml}
  <div class="container">
    ${nav ? `<div class="nav">${nav}</div>` : ""}
    ${body}
    <div class="footer">
      Built with <a href="https://github.com/ricmmartins/aks-newsletter-agent">aks-newsletter-agent</a> · Curated monthly updates on Azure Kubernetes Service
    </div>
  </div>
  <script>
  (function(){
    const t=document.getElementById('themeToggle');
    const saved=localStorage.getItem('theme');
    if(saved==='dark'||(! saved&&window.matchMedia('(prefers-color-scheme:dark)').matches)){
      document.documentElement.setAttribute('data-theme','dark');
    }
    t.addEventListener('click',()=>{
      const isDark=document.documentElement.getAttribute('data-theme')==='dark';
      if(isDark){document.documentElement.removeAttribute('data-theme');localStorage.setItem('theme','light')}
      else{document.documentElement.setAttribute('data-theme','dark');localStorage.setItem('theme','dark')}
    });
  })();
  </script>
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

  return editions.sort((a, b) => b.slug.localeCompare(a.slug));
}

function countItems(md) {
  const links = md.match(/\*\*\[([^\]]+)\]\(/g) || [];
  return links.length;
}

function buildEditionPage(edition) {
  const md = fs.readFileSync(edition.file, "utf8");
  const html = marked.parse(md);
  const nav = `<a href="../index.html">← All Editions</a>`;
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
  let editionCards = "";
  for (const ed of editions) {
    const md = fs.readFileSync(ed.file, "utf8");
    const count = countItems(md);
    editionCards += `
      <a class="edition-card" href="${ed.year}/${ed.slug}.html">
        <div class="ed-info">
          <span class="ed-title">${ed.monthName} ${ed.year}</span>
          <span class="ed-meta"><span class="ed-tag">Edition</span>${count} items</span>
        </div>
        <span class="ed-arrow">→</span>
      </a>\n`;
  }

  // Build search index
  const searchData = [];
  for (const ed of editions) {
    const md = fs.readFileSync(ed.file, "utf8");
    const sections = md.split(/^## /m).slice(1);
    for (const section of sections) {
      const lines = section.split("\n");
      const sectionTitle = lines[0].replace(/^[^\w]*/, "").trim();
      const items = section.match(/\*\*\[([^\]]+)\]\(([^)]+)\)\*\*:?\s*([^\n]*)/g) || [];
      for (const item of items) {
        const match = item.match(/\*\*\[([^\]]+)\]\(([^)]+)\)\*\*:?\s*(.*)/);
        if (match) {
          searchData.push({
            t: match[1],
            u: match[2],
            d: match[3].substring(0, 200),
            e: `${ed.monthName} ${ed.year}`,
            p: `${ed.year}/${ed.slug}.html`,
            s: sectionTitle,
          });
        }
      }
    }
  }

  const body = `
    <div class="search-wrap">
      <input type="text" id="q" placeholder="Search all editions…" autocomplete="off" spellcheck="false">
      <span class="s-icon">⌕</span>
      <button class="s-clear" id="clr" onclick="clr()">✕</button>
      <span class="s-kbd" id="kbd">/</span>
    </div>
    <div class="search-stats" id="stats"></div>
    <div class="no-results" id="empty"><span class="nr-icon">⌕</span>No results found. Try a different term.</div>
    <div id="results"></div>
    <div id="list">
      <h2>Editions</h2>
      <div class="edition-grid">${editionCards}</div>
    </div>
    <script>
    const D=${JSON.stringify(searchData)};
    const q=document.getElementById('q'),stats=document.getElementById('stats'),
      res=document.getElementById('results'),list=document.getElementById('list'),
      empty=document.getElementById('empty'),clrBtn=document.getElementById('clr'),
      kbd=document.getElementById('kbd');

    function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
    function hi(t,q){
      if(!q)return esc(t);
      const e=esc(t),r=new RegExp('('+q.replace(/[.*+?^\${}()|[\\]\\\\]/g,'\\\\$&')+')','gi');
      return e.replace(r,'<mark>$1</mark>');
    }
    function clr(){q.value='';go();q.focus()}
    function go(){
      const v=q.value.trim().toLowerCase();
      clrBtn.style.display=v?'flex':'none';
      kbd.style.display=v?'none':'block';
      if(!v||v.length<2){res.innerHTML='';stats.style.display='none';empty.style.display='none';list.style.display='block';return}
      const m=D.filter(d=>d.t.toLowerCase().includes(v)||d.d.toLowerCase().includes(v)||d.s.toLowerCase().includes(v)||d.e.toLowerCase().includes(v));
      list.style.display='none';
      if(!m.length){res.innerHTML='';stats.style.display='none';empty.style.display='block';return}
      empty.style.display='none';stats.style.display='block';
      stats.textContent=m.length+' result'+(m.length!==1?'s':'')+' found';
      const qv=q.value.trim();
      res.innerHTML=m.map(r=>{
        const icon=Object.entries(${JSON.stringify(SECTION_ICONS)}).find(([k])=>r.s.includes(k));
        return '<a class="search-result" href="'+esc(r.u)+'" target="_blank">'
          +'<span class="sr-title">'+hi(r.t,qv)+'</span>'
          +(r.d?'<span class="sr-desc">'+hi(r.d.substring(0,140),qv)+(r.d.length>140?'…':'')+'</span>':'')
          +'<span class="sr-meta"><span class="sr-tag">'+(icon?icon[1]+' ':'')+esc(r.s)+'</span>'+esc(r.e)+'</span></a>';
      }).join('');
    }
    q.addEventListener('input',go);
    document.addEventListener('keydown',e=>{if(e.key==='/'&&document.activeElement!==q){e.preventDefault();q.focus()}if(e.key==='Escape'){clr()}});
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

  fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  for (const ed of editions) {
    const yearDir = path.join(OUTPUT_DIR, String(ed.year));
    fs.mkdirSync(yearDir, { recursive: true });

    const html = buildEditionPage(ed);
    const outFile = path.join(yearDir, `${ed.slug}.html`);
    fs.writeFileSync(outFile, html, "utf8");
    console.log(`  ✓ ${ed.monthName} ${ed.year} → ${ed.slug}.html`);
  }

  const indexHtml = buildIndexPage(editions);
  fs.writeFileSync(path.join(OUTPUT_DIR, "index.html"), indexHtml, "utf8");
  console.log(`  ✓ index.html`);

  console.log(`\n✅ Site built: ${editions.length} edition(s) → docs/`);
}

build();

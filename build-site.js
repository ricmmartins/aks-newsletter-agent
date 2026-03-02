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
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
:root {
  --bg: #050a18;
  --surface: rgba(255,255,255,0.04);
  --surface-hover: rgba(255,255,255,0.07);
  --surface-solid: #0c1222;
  --border: rgba(255,255,255,0.08);
  --border-hover: rgba(80,230,255,0.3);
  --text: #e2e8f0;
  --text-secondary: #94a3b8;
  --text-dim: #64748b;
  --accent: #38bdf8;
  --accent-2: #818cf8;
  --accent-3: #a78bfa;
  --blue: #0078d4;
  --glow: rgba(56,189,248,0.15);
}
*{margin:0;padding:0;box-sizing:border-box}
html{scroll-behavior:smooth}
body{
  font-family:'Inter',system-ui,-apple-system,sans-serif;
  line-height:1.7;color:var(--text);background:var(--bg);
  -webkit-font-smoothing:antialiased;
}

/* Animated background mesh */
body::before{
  content:'';position:fixed;inset:0;z-index:-1;
  background:
    radial-gradient(ellipse 80% 50% at 20% 0%, rgba(0,120,212,0.12) 0%, transparent 50%),
    radial-gradient(ellipse 60% 40% at 80% 100%, rgba(129,140,248,0.08) 0%, transparent 50%),
    radial-gradient(ellipse 40% 60% at 50% 50%, rgba(56,189,248,0.04) 0%, transparent 50%);
  animation: meshShift 20s ease-in-out infinite alternate;
}
@keyframes meshShift{
  0%{opacity:1;filter:hue-rotate(0deg)}
  100%{opacity:0.8;filter:hue-rotate(15deg)}
}

.container{max-width:860px;margin:0 auto;padding:0 1.5rem 4rem}

a{color:var(--accent);text-decoration:none;transition:all 0.2s ease}
a:hover{color:#7dd3fc;text-shadow:0 0 12px var(--glow)}

/* ── Header ── */
.header{
  position:relative;padding:3rem 1.5rem 2.5rem;
  background:linear-gradient(135deg,
    rgba(0,120,212,0.2) 0%,
    rgba(129,140,248,0.1) 50%,
    rgba(167,139,250,0.08) 100%);
  border-bottom:1px solid var(--border);
  overflow:hidden;
}
.header::before{
  content:'⎈';position:absolute;right:2rem;top:50%;
  transform:translateY(-50%);font-size:200px;
  opacity:0.03;color:white;pointer-events:none;
}
.header::after{
  content:'';position:absolute;bottom:0;left:0;right:0;height:1px;
  background:linear-gradient(90deg,transparent,var(--accent),var(--accent-2),transparent);
  opacity:0.4;
}
.header-inner{max-width:860px;margin:0 auto;position:relative;z-index:1}
.header-top{display:flex;align-items:center;gap:0.75rem;margin-bottom:0.5rem}
.header-logo{
  width:42px;height:42px;border-radius:10px;
  background:linear-gradient(135deg,var(--blue),var(--accent-2));
  display:flex;align-items:center;justify-content:center;
  font-size:1.4rem;color:white;flex-shrink:0;
  box-shadow:0 4px 16px rgba(0,120,212,0.3);
}
.header h1{font-size:1.6rem;font-weight:800;color:white;letter-spacing:-0.02em}
.header .subtitle{color:rgba(255,255,255,0.6);font-size:0.9rem;margin-top:0.1rem}
.header .badge{
  display:inline-flex;align-items:center;gap:0.3rem;
  background:rgba(56,189,248,0.12);border:1px solid rgba(56,189,248,0.25);
  padding:0.2rem 0.65rem;border-radius:100px;
  font-size:0.72rem;color:var(--accent);font-weight:600;
  letter-spacing:0.03em;text-transform:uppercase;margin-left:0.75rem;
}

/* ── Navigation ── */
.nav{
  padding:0.8rem 0;margin-bottom:1.5rem;
  border-bottom:1px solid var(--border);
  font-size:0.85rem;
}
.nav a{
  color:var(--text-dim);display:inline-flex;align-items:center;gap:0.3rem;
  transition:color 0.2s;
}
.nav a:hover{color:var(--accent);text-shadow:none}

/* ── Typography ── */
h1{font-size:1.5rem;font-weight:800;color:var(--text);margin-bottom:0.75rem;letter-spacing:-0.02em}
h2{
  font-size:1.15rem;font-weight:700;color:var(--text);
  margin:2.5rem 0 1rem;padding:0.6rem 0;
  border-bottom:1px solid var(--border);
  letter-spacing:-0.01em;
}
h3{font-size:1rem;font-weight:600;color:var(--text);margin:1.5rem 0 0.5rem}
p{margin:0.75rem 0;color:var(--text-secondary)}
ul,ol{margin:0.75rem 0;padding-left:1.25rem}
li{margin:0.6rem 0;color:var(--text-secondary)}
li p{margin:0.2rem 0}
li>strong{color:var(--text)}
hr{border:none;border-top:1px solid var(--border);margin:2rem 0}
strong{color:var(--text);font-weight:600}

/* ── Code ── */
code{
  background:rgba(56,189,248,0.08);padding:0.15rem 0.4rem;
  border-radius:5px;font-size:0.82em;color:var(--accent);
  border:1px solid rgba(56,189,248,0.12);
}
pre{
  background:var(--surface-solid);padding:1.25rem;border-radius:12px;
  overflow-x:auto;margin:1rem 0;border:1px solid var(--border);
}
pre code{background:none;padding:0;border:none;color:var(--text-secondary)}

/* ── Tables ── */
table{border-collapse:collapse;width:100%;margin:1rem 0;border-radius:8px;overflow:hidden}
th,td{border:1px solid var(--border);padding:0.6rem 0.85rem;text-align:left}
th{background:var(--surface);font-weight:600;color:var(--text);font-size:0.85rem;text-transform:uppercase;letter-spacing:0.04em}
td{color:var(--text-secondary)}

/* ── Content cards (list items with links) ── */
li:has(> strong > a){
  background:var(--surface);border:1px solid var(--border);
  border-radius:10px;padding:1rem 1.25rem;margin:0.75rem 0;
  list-style:none;transition:all 0.25s ease;
  position:relative;overflow:hidden;
}
li:has(> strong > a):hover{
  border-color:var(--border-hover);background:var(--surface-hover);
  transform:translateY(-1px);
  box-shadow:0 8px 32px rgba(0,0,0,0.2),0 0 0 1px rgba(56,189,248,0.1);
}
li:has(> strong > a)::before{
  content:'';position:absolute;left:0;top:0;bottom:0;width:3px;
  background:linear-gradient(180deg,var(--accent),var(--accent-2));
  border-radius:3px 0 0 3px;opacity:0;transition:opacity 0.25s;
}
li:has(> strong > a):hover::before{opacity:1}

/* ── Footer ── */
.footer{
  margin-top:4rem;padding:1.5rem 0;
  border-top:1px solid var(--border);
  font-size:0.8rem;color:var(--text-dim);text-align:center;
}
.footer a{color:var(--text-dim)}
.footer a:hover{color:var(--accent)}

/* ── Index: Edition list ── */
.edition-grid{display:grid;gap:0.75rem}
.edition-card{
  display:block;padding:1.25rem 1.5rem;
  background:var(--surface);border:1px solid var(--border);
  border-radius:12px;transition:all 0.3s ease;
  position:relative;overflow:hidden;text-decoration:none;
}
.edition-card:hover{
  border-color:var(--border-hover);background:var(--surface-hover);
  transform:translateY(-2px);
  box-shadow:0 12px 40px rgba(0,0,0,0.25),0 0 0 1px rgba(56,189,248,0.1);
  text-shadow:none;
}
.edition-card::after{
  content:'→';position:absolute;right:1.5rem;top:50%;
  transform:translateY(-50%);color:var(--text-dim);
  font-size:1.2rem;transition:all 0.3s;
}
.edition-card:hover::after{color:var(--accent);transform:translateY(-50%) translateX(3px)}
.edition-card .ed-title{font-size:1.1rem;font-weight:600;color:var(--text);display:block}
.edition-card .ed-meta{
  font-size:0.8rem;color:var(--text-dim);margin-top:0.25rem;
  display:flex;align-items:center;gap:0.5rem;
}
.edition-card .ed-badge{
  font-size:0.65rem;font-weight:600;text-transform:uppercase;
  letter-spacing:0.05em;padding:0.15rem 0.5rem;border-radius:100px;
  background:rgba(56,189,248,0.1);color:var(--accent);
  border:1px solid rgba(56,189,248,0.15);
}

/* ── Search ── */
.search-wrap{margin:1.5rem 0 2rem;position:relative}
.search-wrap input{
  width:100%;padding:0.85rem 1.1rem 0.85rem 3rem;
  background:var(--surface);border:1px solid var(--border);
  border-radius:12px;color:var(--text);font-size:0.95rem;
  font-family:inherit;outline:none;
  transition:all 0.3s ease;
}
.search-wrap input::placeholder{color:var(--text-dim)}
.search-wrap input:focus{
  border-color:rgba(56,189,248,0.4);
  box-shadow:0 0 0 3px rgba(56,189,248,0.08),0 8px 32px rgba(0,0,0,0.15);
}
.search-wrap .s-icon{
  position:absolute;left:1rem;top:50%;transform:translateY(-50%);
  color:var(--text-dim);pointer-events:none;font-size:1rem;
  transition:color 0.2s;
}
.search-wrap input:focus ~ .s-icon{color:var(--accent)}
.search-wrap .s-clear{
  position:absolute;right:0.85rem;top:50%;transform:translateY(-50%);
  background:var(--surface-hover);border:1px solid var(--border);
  color:var(--text-dim);cursor:pointer;font-size:0.7rem;font-weight:600;
  width:22px;height:22px;border-radius:6px;display:none;
  align-items:center;justify-content:center;transition:all 0.2s;
}
.search-wrap .s-clear:hover{background:var(--surface);color:var(--text);border-color:var(--border-hover)}
.search-wrap .s-kbd{
  position:absolute;right:0.85rem;top:50%;transform:translateY(-50%);
  font-size:0.65rem;color:var(--text-dim);font-family:inherit;
  background:var(--surface);border:1px solid var(--border);
  padding:0.15rem 0.45rem;border-radius:5px;pointer-events:none;
}
.search-stats{font-size:0.8rem;color:var(--text-dim);margin:-0.75rem 0 1rem;display:none}
.no-results{
  text-align:center;padding:3rem 1rem;color:var(--text-dim);
  display:none;font-size:0.95rem;
}
.no-results .nr-icon{font-size:2.5rem;margin-bottom:0.75rem;display:block;opacity:0.5}
.search-result{
  display:block;padding:1rem 1.25rem;margin:0.5rem 0;
  background:var(--surface);border:1px solid var(--border);
  border-radius:10px;transition:all 0.25s ease;text-decoration:none;
}
.search-result:hover{
  border-color:var(--border-hover);background:var(--surface-hover);
  transform:translateY(-1px);text-shadow:none;
  box-shadow:0 8px 24px rgba(0,0,0,0.15);
}
.search-result .sr-title{font-weight:600;color:var(--text);display:block;font-size:0.95rem}
.search-result .sr-desc{font-size:0.82rem;color:var(--text-dim);display:block;margin-top:0.25rem;line-height:1.5}
.search-result .sr-meta{
  font-size:0.72rem;color:var(--text-dim);margin-top:0.4rem;
  display:flex;align-items:center;gap:0.75rem;
}
.search-result .sr-tag{
  font-size:0.65rem;font-weight:600;
  padding:0.1rem 0.45rem;border-radius:100px;
  background:rgba(129,140,248,0.1);color:var(--accent-2);
  border:1px solid rgba(129,140,248,0.15);
}
mark,.highlight{background:rgba(56,189,248,0.2);color:var(--accent);border-radius:2px;padding:0 2px}

/* ── Section label ── */
.section-label{
  display:inline-flex;align-items:center;gap:0.5rem;
  font-size:0.7rem;font-weight:600;text-transform:uppercase;
  letter-spacing:0.06em;color:var(--accent);margin-bottom:0.25rem;
}

@media(max-width:640px){
  .header{padding:2rem 1rem 1.5rem}
  .header h1{font-size:1.3rem}
  .container{padding:0 1rem 3rem}
  h2{font-size:1.05rem}
  .edition-card{padding:1rem 1.25rem}
  li:has(> strong > a){padding:0.85rem 1rem}
}
`.trim();

function htmlTemplate(title, body, nav = "", headerTitle = "", headerSubtitle = "", badge = "") {
  const headerHtml = headerTitle ? `
  <div class="header">
    <div class="header-inner">
      <div class="header-top">
        <div class="header-logo">⎈</div>
        <div>
          <h1>${headerTitle}${badge ? `<span class="badge">${badge}</span>` : ""}</h1>
          ${headerSubtitle ? `<p class="subtitle">${headerSubtitle}</p>` : ""}
        </div>
      </div>
    </div>
  </div>` : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⎈</text></svg>">
  <style>${CSS}</style>
</head>
<body>
  ${headerHtml}
  <div class="container">
    ${nav ? `<div class="nav">${nav}</div>` : ""}
    ${body}
    <div class="footer">
      Built with <a href="https://github.com/ricmmartins/aks-newsletter-agent">aks-newsletter-agent</a> · Curated monthly updates on Azure Kubernetes Service
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
        <span class="ed-title">${ed.monthName} ${ed.year}</span>
        <span class="ed-meta">
          <span class="ed-badge">Edition</span>
          ${count} items covered
        </span>
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

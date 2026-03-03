#!/usr/bin/env node
/**
 * Static site builder for AKS Newsletter.
 * Converts newsletter markdown files into styled HTML pages
 * with an index page listing all editions.
 * Generates RSS feed, sitemap.xml, and robots.txt.
 */

const fs = require("fs");
const path = require("path");
const { marked } = require("marked");

const NEWSLETTERS_DIR = path.join(__dirname, "newsletters");
const OUTPUT_DIR = path.join(__dirname, "docs");
const SITE_URL = "https://aksnewsletter.com";

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

function readingTime(md) {
  const words = md.replace(/[#*\[\]()>`_\-|]/g, " ").split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 200));
}

function sectionStats(md) {
  const stats = {};
  const sections = md.split(/^## /m).slice(1);
  for (const section of sections) {
    const name = section.split("\n")[0].replace(/^[^\w]*/, "").trim();
    const items = (section.match(/\*\*\[([^\]]+)\]\(/g) || []).length;
    if (items > 0) stats[name] = items;
  }
  return stats;
}

function extractToc(md) {
  const toc = [];
  const sections = md.split(/^## /m).slice(1);
  for (const section of sections) {
    const raw = section.split("\n")[0].trim();
    const name = raw.replace(/^[^\w]*/, "").trim();
    const icon = Object.entries(SECTION_ICONS).find(([k]) => name.includes(k));
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "");
    toc.push({ name, id, icon: icon ? icon[1] : "" });
  }
  return toc;
}

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

/* ── Reading progress bar ── */
.progress-bar{
  position:fixed;top:0;left:0;height:3px;
  background:var(--accent);z-index:200;
  width:0;transition:width 0.1s linear;
}

/* ── Page fade-in ── */
.container{max-width:760px;margin:0 auto;padding:0 1.5rem 4rem;animation:fadeIn 0.3s ease}
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
.header-brand span{color:var(--accent);font-weight:800}
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
  transform:translateY(-1px);
}
li:has(> strong > a) strong a{font-size:0.95rem}

/* ── Empty section ── */
.empty-section{
  padding:0.75rem 1rem;margin:0.5rem 0;
  background:var(--surface);border-radius:var(--radius);
  color:var(--text-dim);font-size:0.85rem;font-style:italic;
}

/* ── Footer ── */
.footer{
  margin-top:4rem;padding:2rem 0 1.5rem;
  border-top:1px solid var(--border);
  font-size:0.8rem;color:var(--text-dim);text-align:center;
}
.footer-links{
  display:flex;justify-content:center;gap:1.5rem;
  margin-bottom:0.6rem;flex-wrap:wrap;
}
.footer-links a{color:var(--text-dim);transition:color 0.15s}
.footer-links a:hover{color:var(--accent)}
.footer-copy{color:var(--text-dim);opacity:0.7}

/* ── Subscribe form ── */
.subscribe-form{
  display:flex;gap:0.5rem;margin-top:1rem;max-width:420px;
}
.subscribe-form input[type="email"]{
  flex:1;padding:0.6rem 0.85rem;
  background:var(--surface);border:1px solid var(--border);
  border-radius:var(--radius);color:var(--text);font-size:0.88rem;
  font-family:inherit;outline:none;transition:all 0.15s;min-width:0;
}
.subscribe-form input[type="email"]::placeholder{color:var(--text-dim)}
.subscribe-form input[type="email"]:focus{
  border-color:var(--accent);box-shadow:0 0 0 3px rgba(0,120,212,0.1);background:var(--bg);
}
.subscribe-form button{
  padding:0.6rem 1.1rem;background:var(--accent);color:white;
  border:none;border-radius:var(--radius);font-size:0.85rem;
  font-weight:600;font-family:inherit;cursor:pointer;
  transition:all 0.15s;white-space:nowrap;
}
.subscribe-form button:hover{background:var(--accent-dark)}
.subscribe-hint{font-size:0.75rem;color:var(--text-dim);margin-top:0.4rem}
.subscribe-compact{
  display:inline-flex;align-items:center;gap:0.4rem;
  font-size:0.8rem;color:var(--text-dim);
  margin-top:0.75rem;
}
.subscribe-compact a{font-size:0.8rem}

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
  .toc-list{flex-wrap:nowrap;overflow-x:auto;-webkit-overflow-scrolling:touch;padding-bottom:0.3rem}
  .toc-list::-webkit-scrollbar{height:3px}
  .toc-list::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px}
  .share-bar{flex-wrap:wrap}
  .subscribe-form{flex-direction:column}
}
@keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}

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

/* ── Table of Contents ── */
.toc{
  margin:0 0 2rem;padding:1rem 1.25rem;
  background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);
}
.toc-title{font-size:0.7rem;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-dim);margin-bottom:0.5rem}
.toc-list{list-style:none;padding:0;margin:0;display:flex;flex-wrap:wrap;gap:0.4rem}
.toc-list li{margin:0}
.toc-list a{
  display:inline-flex;align-items:center;gap:0.3rem;
  font-size:0.82rem;color:var(--text-secondary);padding:0.3rem 0.6rem;
  border-radius:6px;transition:all 0.2s;border:1px solid transparent;
}
.toc-list a:hover{background:var(--bg);border-color:var(--border);color:var(--accent)}
.toc-list a.active{background:var(--accent-light);border-color:var(--accent);color:var(--accent);font-weight:600}
.toc-count{
  font-size:0.65rem;font-weight:600;color:var(--text-dim);
  background:var(--bg);border-radius:100px;padding:0.05rem 0.35rem;
  min-width:1.1rem;text-align:center;line-height:1.4;
}
.toc-list a.active .toc-count{background:var(--accent);color:white}

/* ── Share buttons ── */
.share-bar{
  display:flex;align-items:center;gap:0.5rem;
  margin:1.5rem 0;padding:1rem 0;border-top:1px solid var(--border);
}
.share-label{font-size:0.75rem;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.06em}
.share-btn{
  display:inline-flex;align-items:center;gap:0.3rem;
  font-size:0.78rem;font-weight:500;color:var(--text-secondary);
  padding:0.35rem 0.7rem;border-radius:6px;border:1px solid var(--border);
  text-decoration:none;transition:all 0.15s;font-family:inherit;
  background:none;cursor:pointer;
}
.share-btn:hover{background:var(--surface);border-color:var(--accent);color:var(--accent)}
.share-btn.copied{background:var(--accent-light);border-color:var(--accent);color:var(--accent)}

/* ── Back to top ── */
.back-top{
  position:fixed;bottom:2rem;right:2rem;
  width:40px;height:40px;border-radius:50%;
  background:var(--accent);color:white;border:none;
  cursor:pointer;font-size:1.1rem;
  display:none;align-items:center;justify-content:center;
  box-shadow:0 2px 8px rgba(0,0,0,0.15);
  transition:all 0.2s;z-index:100;
}
.back-top:hover{transform:translateY(-2px);box-shadow:0 4px 12px rgba(0,0,0,0.2)}
.back-top.visible{display:flex}

/* ── Reading time & stats ── */
.reading-time{font-size:0.8rem;color:var(--text-dim);margin-top:0.25rem}
.section-stats{display:flex;flex-wrap:wrap;gap:0.4rem;margin-top:0.5rem}
.stat-pill{
  font-size:0.68rem;font-weight:500;padding:0.2rem 0.5rem;
  border-radius:100px;background:var(--surface);color:var(--text-dim);
  border:1px solid var(--border);display:inline-flex;align-items:center;gap:0.2rem;
}

/* ── Print ── */
@media print{
  .header,.hero,.toc,.share-bar,.back-top,.search-wrap,.search-stats,.no-results,
  #results,.theme-toggle,.s-kbd,.s-clear,.nav,.footer,.edition-nav,.filter-bar{display:none!important}
  body{color:#000;background:#fff;font-size:11pt;line-height:1.5}
  .container{max-width:100%;padding:0}
  a{color:#000;text-decoration:underline}
  li:has(> strong > a){border:1px solid #ccc;break-inside:avoid}
  h2{color:#333;border-color:#ccc}
}

/* ── Edition prev/next nav ── */
.edition-nav{
  display:grid;grid-template-columns:1fr 1fr;gap:1rem;
  margin:2.5rem 0 0;padding:1.5rem 0 0;
  border-top:1px solid var(--border);
}
.edition-nav-link{
  display:flex;flex-direction:column;gap:0.15rem;
  padding:1rem;border:1px solid var(--border);border-radius:var(--radius);
  text-decoration:none;color:inherit;transition:all 0.15s;
}
.edition-nav-link:hover{border-color:var(--accent);background:var(--surface)}
.edition-nav-link.next{text-align:right}
.edition-nav-dir{font-size:0.75rem;color:var(--text-dim);font-weight:500}
.edition-nav-title{font-size:0.95rem;font-weight:600;color:var(--text)}

/* ── Category filter ── */
.filter-bar{display:flex;flex-wrap:wrap;gap:0.4rem;margin:0 0 1.5rem}
.filter-pill{
  font-size:0.75rem;font-weight:500;padding:0.3rem 0.7rem;
  border-radius:100px;border:1px solid var(--border);
  background:none;color:var(--text-secondary);cursor:pointer;
  transition:all 0.15s;font-family:inherit;
}
.filter-pill:hover{border-color:var(--accent);color:var(--accent)}
.filter-pill.active{background:var(--accent);color:white;border-color:var(--accent)}


@media(max-width:640px){
  .edition-nav{grid-template-columns:1fr}
}
`.trim();

function htmlTemplate(title, body, nav = "", headerTitle = "", headerSubtitle = "", badge = "", meta = {}) {
  const ogUrl = meta.url || SITE_URL;
  const ogDesc = meta.description || "Monthly curated updates on Azure Kubernetes Service — docs, features, blogs, releases, and more.";
  const ogImage = meta.image || `${SITE_URL}/og-image.svg`;

  const headerHtml = `
  <div class="header">
    <div class="header-inner">
      <div class="header-left">
        <a href="${meta.isEdition ? '../index.html' : 'index.html'}" style="display:flex;align-items:center;gap:0.6rem;text-decoration:none;color:inherit">
          <span class="header-brand"><span>AKS</span> Newsletter</span>
        </a>
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
    ${meta.readingTime ? `<div class="reading-time">📖 ${meta.readingTime} min read</div>` : ""}
    ${meta.showSubscribe ? `
    <form class="subscribe-form" action="https://buttondown.com/api/emails/embed-subscribe/aksnewsletter" method="post" target="_blank">
      <input type="email" name="email" placeholder="you@example.com" required aria-label="Email address">
      <button type="submit">Subscribe</button>
    </form>
    <div class="subscribe-hint">Get new editions delivered to your inbox. No spam, unsubscribe anytime.</div>` : ""}
  </div>` : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <meta name="description" content="${ogDesc}">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${ogDesc}">
  <meta property="og:url" content="${ogUrl}">
  <meta property="og:image" content="${ogImage}">
  <meta property="og:site_name" content="AKS Newsletter">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${ogDesc}">
  <meta name="twitter:image" content="${ogImage}">
  <link rel="alternate" type="application/rss+xml" title="AKS Newsletter RSS" href="${SITE_URL}/feed.xml">
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%230078d4'/%3E%3Ctext x='50%25' y='54%25' dominant-baseline='middle' text-anchor='middle' font-family='system-ui' font-weight='700' font-size='15' fill='white'%3EK%3C/text%3E%3C/svg%3E">
  <style>${CSS}</style>
  <script>
  (function(){var s=localStorage.getItem('theme');if(s==='dark'||(!s&&window.matchMedia('(prefers-color-scheme:dark)').matches))document.documentElement.setAttribute('data-theme','dark')})();
  </script>
</head>
<body>
  <div class="progress-bar" id="progressBar"></div>
  ${headerHtml}
  ${heroHtml}
  <div class="container">
    ${nav ? `<div class="nav">${nav}</div>` : ""}
    ${body}
    <div class="footer">
      <div class="footer-links">
        <a href="${SITE_URL}/feed.xml">RSS Feed</a>
        <a href="https://buttondown.com/aksnewsletter" target="_blank">Subscribe via Email</a>
        <a href="https://github.com/ricmmartins/aks-newsletter-agent" target="_blank">GitHub</a>
      </div>
      <div class="footer-copy">Curated monthly updates on Azure Kubernetes Service</div>
    </div>
  </div>
  <button class="back-top" id="backTop" aria-label="Back to top" title="Back to top">↑</button>
  <script>
  (function(){
    const t=document.getElementById('themeToggle');
    t.addEventListener('click',()=>{
      const isDark=document.documentElement.getAttribute('data-theme')==='dark';
      if(isDark){document.documentElement.removeAttribute('data-theme');localStorage.setItem('theme','light')}
      else{document.documentElement.setAttribute('data-theme','dark');localStorage.setItem('theme','dark')}
    });
    const b=document.getElementById('backTop');
    const p=document.getElementById('progressBar');
    window.addEventListener('scroll',()=>{
      b.classList.toggle('visible',window.scrollY>400);
      const h=document.documentElement.scrollHeight-window.innerHeight;
      p.style.width=h>0?((window.scrollY/h)*100)+'%':'0';
    });
    b.addEventListener('click',()=>window.scrollTo({top:0,behavior:'smooth'}));

    // Active TOC highlighting
    const tocLinks=document.querySelectorAll('.toc-list a[data-section]');
    if(tocLinks.length){
      const sections=[...tocLinks].map(a=>{const el=document.getElementById(a.dataset.section);return{a,el}}).filter(s=>s.el);
      const obs=new IntersectionObserver(entries=>{
        entries.forEach(e=>{
          if(e.isIntersecting){
            tocLinks.forEach(a=>a.classList.remove('active'));
            const match=sections.find(s=>s.el===e.target);
            if(match)match.a.classList.add('active');
          }
        });
      },{rootMargin:'-10% 0px -80% 0px'});
      sections.forEach(s=>obs.observe(s.el));
    }
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

function buildEditionPage(edition, prevEdition, nextEdition) {
  const md = fs.readFileSync(edition.file, "utf8");
  const rt = readingTime(md);
  const stats = sectionStats(md);
  const toc = extractToc(md);
  const edUrl = `${SITE_URL}/${edition.year}/${edition.slug}.html`;

  // Add IDs to h2 headings for TOC anchoring
  let html = marked.parse(md);
  for (const entry of toc) {
    // Match both raw & and HTML &amp; in rendered output
    const escapedName = entry.name
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/&/g, "(?:&|&amp;)");
    html = html.replace(
      new RegExp(`(<h2[^>]*>)(.*?${escapedName}.*?)(</h2>)`, "i"),
      `$1<a id="${entry.id}"></a>$2$3`
    );
  }
  const contentHtml = html
    .replace(/<h1[^>]*>.*?<\/h1>/i, "")
    .replace(/<p>None this month\.?<\/p>/gi, '<div class="empty-section">None this month.</div>');

  const tocHtml = toc.length > 0 ? `
    <div class="toc">
      <div class="toc-title">In this edition</div>
      <ul class="toc-list">
        ${toc.map(t => {
          const count = stats[Object.keys(stats).find(k => k.includes(t.name) || t.name.includes(k))] || 0;
          return `<li><a href="#${t.id}" data-section="${t.id}">${t.icon ? t.icon + " " : ""}${t.name}${count > 0 ? `<span class="toc-count">${count}</span>` : ""}</a></li>`;
        }).join("")}
      </ul>
    </div>` : "";

  const shareHtml = `
    <div class="share-bar">
      <span class="share-label">Share</span>
      <a class="share-btn" href="https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(edUrl)}" target="_blank" rel="noopener">LinkedIn</a>
      <a class="share-btn" href="https://twitter.com/intent/tweet?text=${encodeURIComponent(`AKS Newsletter – ${edition.monthName} ${edition.year}`)}&url=${encodeURIComponent(edUrl)}" target="_blank" rel="noopener">X / Twitter</a>
      <button class="share-btn" onclick="navigator.clipboard.writeText('${edUrl}');this.textContent='Copied!';this.classList.add('copied');setTimeout(()=>{this.textContent='Copy link';this.classList.remove('copied')},2000)">Copy link</button>
    </div>`;

  // Prev / Next navigation
  let prevNextHtml = "";
  if (prevEdition || nextEdition) {
    prevNextHtml = `<div class="edition-nav">`;
    if (nextEdition) {
      prevNextHtml += `<a class="edition-nav-link prev" href="${nextEdition.year === edition.year ? '' : '../' + nextEdition.year + '/'}${nextEdition.slug}.html">
        <span class="edition-nav-dir">← Previous</span>
        <span class="edition-nav-title">${nextEdition.monthName} ${nextEdition.year}</span>
      </a>`;
    } else {
      prevNextHtml += `<div></div>`;
    }
    if (prevEdition) {
      prevNextHtml += `<a class="edition-nav-link next" href="${prevEdition.year === edition.year ? '' : '../' + prevEdition.year + '/'}${prevEdition.slug}.html">
        <span class="edition-nav-dir">Next →</span>
        <span class="edition-nav-title">${prevEdition.monthName} ${prevEdition.year}</span>
      </a>`;
    } else {
      prevNextHtml += `<div></div>`;
    }
    prevNextHtml += `</div>`;
  }

  const nav = `<a href="../index.html">← All Editions</a>`;

  return htmlTemplate(
    `AKS Newsletter – ${edition.monthName} ${edition.year}`,
    tocHtml + contentHtml + shareHtml + prevNextHtml,
    nav,
    "AKS Newsletter",
    `${edition.monthName} ${edition.year} Edition`,
    `${edition.monthName} ${edition.year}`,
    {
      url: edUrl,
      description: `${edition.monthName} ${edition.year} edition of the AKS Newsletter — ${Object.values(stats).reduce((a, b) => a + b, 0)} curated items covering docs, features, blogs, and more.`,
      readingTime: rt,
      isEdition: true,
    }
  );
}

function buildIndexPage(editions) {
  let editionCards = "";
  for (const ed of editions) {
    const md = fs.readFileSync(ed.file, "utf8");
    const count = countItems(md);
    const rt = readingTime(md);
    const stats = sectionStats(md);
    const statPills = Object.entries(stats)
      .map(([name, n]) => {
        const icon = Object.entries(SECTION_ICONS).find(([k]) => name.includes(k));
        return `<span class="stat-pill">${icon ? icon[1] + " " : ""}${n}</span>`;
      }).join("");

    const categories = Object.keys(stats).map(s => {
      const icon = Object.entries(SECTION_ICONS).find(([k]) => s.includes(k));
      return icon ? icon[0] : s;
    });

    editionCards += `
      <a class="edition-card" href="${ed.year}/${ed.slug}.html" data-cats="${categories.join(",")}">
        <div class="ed-info">
          <span class="ed-title">${ed.monthName} ${ed.year}</span>
          <span class="ed-meta"><span class="ed-tag">Edition</span>${count} items · ${rt} min read</span>
          ${statPills ? `<div class="section-stats">${statPills}</div>` : ""}
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

  // Collect all categories across editions
  const allCategories = new Set();
  for (const ed of editions) {
    const md = fs.readFileSync(ed.file, "utf8");
    const st = sectionStats(md);
    for (const name of Object.keys(st)) {
      const icon = Object.entries(SECTION_ICONS).find(([k]) => name.includes(k));
      allCategories.add(icon ? icon[0] : name);
    }
  }
  const filterPills = [...allCategories].map(cat => {
    const icon = Object.entries(SECTION_ICONS).find(([k]) => cat.includes(k));
    return `<button class="filter-pill" data-cat="${cat}">${icon ? icon[1] + " " : ""}${cat}</button>`;
  }).join("");

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
      <div class="filter-bar">
        <button class="filter-pill active" data-cat="all">All</button>
        ${filterPills}
      </div>
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

    // Category filter
    document.querySelectorAll('.filter-pill').forEach(btn=>{
      btn.addEventListener('click',()=>{
        document.querySelectorAll('.filter-pill').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
        const cat=btn.dataset.cat;
        document.querySelectorAll('.edition-card').forEach(card=>{
          if(cat==='all'){card.style.display=''}
          else{
            const cats=(card.dataset.cats||'').split(',');
            card.style.display=cats.includes(cat)?'':'none';
          }
        });
      });
    });
    </script>
  `;

  return htmlTemplate(
    "AKS Newsletter",
    body,
    "",
    "AKS Newsletter",
    "Monthly curated updates on Azure Kubernetes Service",
    "",
    { url: SITE_URL, showSubscribe: true }
  );
}

function buildRssFeed(editions) {
  const items = editions.slice(0, 20).map(ed => {
    const md = fs.readFileSync(ed.file, "utf8");
    const count = countItems(md);
    const pubDate = new Date(ed.year, ed.month - 1, 28).toUTCString();
    const url = `${SITE_URL}/${ed.year}/${ed.slug}.html`;
    return `    <item>
      <title>AKS Newsletter – ${ed.monthName} ${ed.year}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <pubDate>${pubDate}</pubDate>
      <description>${count} curated items covering documentation updates, feature announcements, community blogs, and more.</description>
    </item>`;
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>AKS Newsletter</title>
    <link>${SITE_URL}</link>
    <description>Monthly curated updates on Azure Kubernetes Service — docs, features, blogs, releases, and more.</description>
    <language>en-us</language>
    <atom:link href="${SITE_URL}/feed.xml" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>`;
}

function buildSitemap(editions) {
  const urls = [
    `  <url><loc>${SITE_URL}/</loc><changefreq>monthly</changefreq><priority>1.0</priority></url>`,
  ];
  for (const ed of editions) {
    const lastmod = `${ed.year}-${String(ed.month).padStart(2, "0")}-28`;
    urls.push(`  <url><loc>${SITE_URL}/${ed.year}/${ed.slug}.html</loc><lastmod>${lastmod}</lastmod><changefreq>yearly</changefreq><priority>0.8</priority></url>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>`;
}

function buildOgImage() {
  // SVG-based OG image for social sharing
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#0f172a"/>
  <rect x="60" y="60" width="64" height="64" rx="16" fill="#0078d4"/>
  <text x="92" y="102" font-family="system-ui,sans-serif" font-weight="700" font-size="32" fill="white" text-anchor="middle" dominant-baseline="middle">K</text>
  <text x="60" y="280" font-family="system-ui,sans-serif" font-weight="700" font-size="72" fill="white">AKS Newsletter</text>
  <text x="60" y="360" font-family="system-ui,sans-serif" font-weight="400" font-size="32" fill="#94a3b8">Monthly curated updates on</text>
  <text x="60" y="410" font-family="system-ui,sans-serif" font-weight="400" font-size="32" fill="#94a3b8">Azure Kubernetes Service</text>
  <rect x="60" y="500" width="120" height="6" rx="3" fill="#0078d4"/>
  <rect x="200" y="500" width="80" height="6" rx="3" fill="#3b82f6"/>
  <rect x="300" y="500" width="60" height="6" rx="3" fill="#6366f1"/>
</svg>`;
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

  for (let i = 0; i < editions.length; i++) {
    const ed = editions[i];
    const prev = i > 0 ? editions[i - 1] : null;       // newer edition
    const next = i < editions.length - 1 ? editions[i + 1] : null; // older edition
    const yearDir = path.join(OUTPUT_DIR, String(ed.year));
    fs.mkdirSync(yearDir, { recursive: true });

    const html = buildEditionPage(ed, prev, next);
    const outFile = path.join(yearDir, `${ed.slug}.html`);
    fs.writeFileSync(outFile, html, "utf8");
    console.log(`  ✓ ${ed.monthName} ${ed.year} → ${ed.slug}.html`);
  }

  const indexHtml = buildIndexPage(editions);
  fs.writeFileSync(path.join(OUTPUT_DIR, "index.html"), indexHtml, "utf8");
  console.log(`  ✓ index.html`);

  // RSS feed
  const rss = buildRssFeed(editions);
  fs.writeFileSync(path.join(OUTPUT_DIR, "feed.xml"), rss, "utf8");
  console.log(`  ✓ feed.xml`);

  // Sitemap
  const sitemap = buildSitemap(editions);
  fs.writeFileSync(path.join(OUTPUT_DIR, "sitemap.xml"), sitemap, "utf8");
  console.log(`  ✓ sitemap.xml`);

  // robots.txt
  fs.writeFileSync(path.join(OUTPUT_DIR, "robots.txt"),
    `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}/sitemap.xml\n`, "utf8");
  console.log(`  ✓ robots.txt`);

  // OG image
  fs.writeFileSync(path.join(OUTPUT_DIR, "og-image.svg"), buildOgImage(), "utf8");
  console.log(`  ✓ og-image.svg`);

  // CNAME for custom domain
  const domain = SITE_URL.replace(/^https?:\/\//, "");
  fs.writeFileSync(path.join(OUTPUT_DIR, "CNAME"), domain, "utf8");
  console.log(`  ✓ CNAME (${domain})`);

  console.log(`\n✅ Site built: ${editions.length} edition(s) → docs/`);
}

build();

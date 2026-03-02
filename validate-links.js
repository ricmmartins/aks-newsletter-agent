#!/usr/bin/env node
/**
 * Validates all URLs found in newsletter markdown files.
 * Reports broken links (non-2xx responses) and connection errors.
 *
 * Usage: node validate-links.js [year] [month]
 *   Without args: validates all newsletters
 *   With args:    validates specific edition (e.g., node validate-links.js 2026 2)
 */

const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

const NEWSLETTERS_DIR = path.join(__dirname, "newsletters");
const CONCURRENCY = 10;
const TIMEOUT_MS = 15000;

function extractUrls(md) {
  const urls = [];
  const regex = /\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g;
  let match;
  while ((match = regex.exec(md)) !== null) {
    urls.push({ text: match[1], url: match[2] });
  }
  return urls;
}

function checkUrl(url) {
  return new Promise((resolve) => {
    const mod = url.startsWith("https") ? https : http;
    const req = mod.get(url, { timeout: TIMEOUT_MS, headers: { "User-Agent": "AKS-Newsletter-LinkChecker/1.0" } }, (res) => {
      // Follow redirects
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        resolve({ url, status: res.statusCode, redirect: res.headers.location, ok: true });
      } else {
        resolve({ url, status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 400 });
      }
      res.resume();
    });
    req.on("error", (err) => resolve({ url, status: 0, error: err.message, ok: false }));
    req.on("timeout", () => { req.destroy(); resolve({ url, status: 0, error: "timeout", ok: false }); });
  });
}

async function validateFile(filePath) {
  const md = fs.readFileSync(filePath, "utf8");
  const entries = extractUrls(md);
  if (entries.length === 0) return [];

  const unique = [...new Map(entries.map(e => [e.url, e])).values()];
  const results = [];

  // Process in batches
  for (let i = 0; i < unique.length; i += CONCURRENCY) {
    const batch = unique.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map(e => checkUrl(e.url).then(r => ({ ...r, text: e.text }))));
    results.push(...batchResults);
    process.stdout.write(".");
  }

  return results;
}

async function main() {
  const args = process.argv.slice(2);
  let files = [];

  if (args.length >= 2) {
    const year = args[0];
    const month = String(args[1]).padStart(2, "0");
    const f = path.join(NEWSLETTERS_DIR, year, `${year}-${month}.md`);
    if (!fs.existsSync(f)) { console.error(`File not found: ${f}`); process.exit(1); }
    files = [f];
  } else {
    // Discover all
    if (!fs.existsSync(NEWSLETTERS_DIR)) { console.error("No newsletters directory found."); process.exit(1); }
    for (const yearDir of fs.readdirSync(NEWSLETTERS_DIR).sort()) {
      const yp = path.join(NEWSLETTERS_DIR, yearDir);
      if (!fs.statSync(yp).isDirectory()) continue;
      for (const file of fs.readdirSync(yp).sort()) {
        if (file.endsWith(".md")) files.push(path.join(yp, file));
      }
    }
  }

  let totalBroken = 0;
  for (const f of files) {
    const name = path.relative(NEWSLETTERS_DIR, f);
    process.stdout.write(`\n🔗 Checking ${name} `);
    const results = await validateFile(f);
    const broken = results.filter(r => !r.ok);
    totalBroken += broken.length;
    console.log(` — ${results.length} links, ${broken.length} broken`);
    for (const b of broken) {
      console.log(`   ✗ [${b.status || "ERR"}] ${b.text || ""}`);
      console.log(`     ${b.url}`);
      if (b.error) console.log(`     Error: ${b.error}`);
    }
  }

  console.log(`\n${totalBroken === 0 ? "✅ All links valid!" : `⚠ ${totalBroken} broken link(s) found.`}`);
  process.exit(totalBroken > 0 ? 1 : 0);
}

main();

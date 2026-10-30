const { test } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const cheerio = require("cheerio");
const { marked } = require("marked");

execFileSync(process.execPath, [path.join(__dirname, "build-site.js")], {
  cwd: __dirname,
  stdio: "pipe",
});

const docs = path.join(__dirname, "docs");
const home = cheerio.load(fs.readFileSync(path.join(docs, "index.html"), "utf8"));

test("home features the newest edition and three source-derived topics", () => {
  const cards = home(".edition-card");
  assert.ok(cards.length > 0);
  assert.equal(home(".read-edition").attr("href"), cards.first().attr("href"));
  assert.equal(home(".feature-topics a").length, 3);
  const newestSource = fs.readFileSync(path.join(__dirname, "newsletters", cards.first().attr("href").replace(/\.html$/, ".md")), "utf8");
  home(".ed-summary").first().text().split(" · ").forEach(topic => assert.ok(newestSource.includes(topic)));
  home(".feature-topics a").each((_, element) => {
    const link = home(element).attr("href");
    const [file, anchor] = link.split("#");
    const edition = cheerio.load(fs.readFileSync(path.join(docs, file), "utf8"));
    assert.ok(edition(`[id="${anchor}"]`).length, `Missing featured anchor: ${link}`);
  });
});

test("all edition URLs retain article content, working TOCs, and subscription forms", () => {
  home(".edition-card").each((_, card) => {
    const file = home(card).attr("href");
    const page = cheerio.load(fs.readFileSync(path.join(docs, file), "utf8"));
    assert.equal(page("main").length, 1, file);
    assert.equal(page("main .footer-links").length, 1, file);
    assert.ok(page("article.edition-content").text().length > 500, file);
    const source = fs.readFileSync(path.join(__dirname, "newsletters", file.replace(/\.html$/, ".md")), "utf8");
    const original = cheerio.load(marked.parse(source));
    original("h1").remove();
    const normalize = text => text.replace(/\s+/g, " ").trim();
    assert.ok(normalize(page("article.edition-content").text()).startsWith(normalize(original("body").text())), `Changed newsletter content in ${file}`);
    assert.equal(page("details.toc summary").text(), "In this edition");
    page(".toc-list a").each((_, element) => {
      const anchor = page(element).attr("href").slice(1);
      assert.equal(page(`[id="${anchor}"]`).length, 1, `${file}#${anchor}`);
    });
    assert.equal(page('form input[name="email"][type="email"][required]').length, 1);
    assert.equal(page(".share-btn").length, 3);
    assert.ok(!page.text().includes("[NEEDS DESCRIPTION]"));
  });
});

test("home retains accessible search, filters, RSS, and embedded theme styling", () => {
  assert.equal(home("#q").attr("aria-label"), "Search all editions");
  assert.ok(home(".filter-pill").length > 1);
  assert.equal(home('#stats[role="status"]').length, 1);
  assert.equal(home('link[type="application/rss+xml"]').length, 1);
  assert.ok(fs.existsSync(path.join(docs, "feed.xml")));
  assert.match(home("style").text(), /--cp-brand: #9f62eb/);
  assert.match(home("style").text(), /--cp-bg-elevated: #f8f5fe/);
  assert.match(home("style").text(), /--cp-brand: #b082f0/);
  assert.match(home("script").first().text(), /scoutTheme/);
});

#!/usr/bin/env node
/**
 * AKS Newsletter Agent – CLI Runner
 * Orchestrates content collection, newsletter generation, and AI polishing.
 *
 * Usage:
 *   node run.js <year> <month> [--collect-only | --generate-only | --polish-only | --verify-only] [--no-polish]
 *
 * Examples:
 *   node run.js 2026 2                  # Full run: collect + generate + polish
 *   node run.js 2026 2 --collect-only   # Only collect data
 *   node run.js 2026 2 --generate-only  # Generate + polish from existing data
 *   node run.js 2026 2 --polish-only    # Only polish an existing draft
 *   node run.js 2026 2 --verify-only    # Review existing text twice without rewriting it
 *   node run.js 2026 2 --no-polish      # Skip AI polishing step
 */

const { ContentCollector } = require("./collector");
const { NewsletterGenerator } = require("./generator");
const { NewsletterPolisher } = require("./polisher");
const { verifyNewsletter } = require("./fact-check");
const fs = require("node:fs");
const path = require("node:path");

async function verifyAndSaveReport(polisher, content, verify = verifyNewsletter) {
  const slug = `${polisher.year}-${polisher.monthPad}`;
  const reportPath = path.join(path.dirname(polisher.collectedPath), `${slug}.verification.json`);
  // Rechecking revokes prior approval immediately, including for archived text.
  fs.writeFileSync(reportPath, JSON.stringify({ status: "pending", startedAt: new Date().toISOString() }, null, 2), "utf8");
  const collected = JSON.parse(fs.readFileSync(polisher.collectedPath, "utf8"));
  if (collected.metadata?.year !== polisher.year || collected.metadata?.month !== polisher.month) {
    throw new Error("Collected source metadata does not match the requested edition.");
  }
  const report = await verify(content, collected, { model: polisher.model });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
  return report;
}

async function main() {
  const args = process.argv.slice(2);
  const collectOnly = args.includes("--collect-only");
  const generateOnly = args.includes("--generate-only");
  const polishOnly = args.includes("--polish-only");
  const noPolish = args.includes("--no-polish");
  const verifyOnly = args.includes("--verify-only");

  const numArgs = args.filter((a) => !a.startsWith("--"));
  const now = new Date();
  const year = parseInt(numArgs[0]) || now.getFullYear();
  const month = parseInt(numArgs[1]) || now.getMonth() + 1;

  const monthName = new Date(year, month - 1).toLocaleString("en-US", {
    month: "long",
  });

  console.log(`\n🚀 AKS Newsletter Agent`);
  console.log(`   Target: ${monthName} ${year}\n`);

  if (verifyOnly) {
    const polisher = new NewsletterPolisher(year, month);
    const content = fs.readFileSync(polisher.draftPath, "utf8");
    await verifyAndSaveReport(polisher, content);
    console.log("✅ Both factual reviews passed. Newsletter content was not modified.");
    return;
  }

  // Phase 1: Collect
  if (!generateOnly && !polishOnly) {
    const collector = new ContentCollector(year, month);
    await collector.collectAll();

    if (collectOnly) {
      console.log("✅ Collection complete. Use --generate-only to create the newsletter.");
      return;
    }
  }

  // Phase 2: Generate draft
  if (!polishOnly) {
    const generator = new NewsletterGenerator(year, month);
    const content = generator.generate();
    generator.save(content);
    console.log(`\n📄 Raw draft generated.`);
  }

  // Phase 3: AI Polish
  if (!noPolish) {
    console.log(`\n🔄 Starting AI polish...`);
    const polisher = new NewsletterPolisher(year, month);
    const polished = await polisher.polish();

    if (polished) {
      console.log("\n🔎 Running two separate source-grounded factual reviews...");
      await verifyAndSaveReport(polisher, polished);
      polisher.save(polished);
      console.log(`\n✅ Newsletter polished and saved.`);
    } else {
      console.log(`\n⚠️  AI polish skipped or failed. Raw draft preserved.`);
      console.log(`   To polish manually, use agent_prompt.md with an AI assistant.`);
    }
  } else {
    console.log(`\n✅ Newsletter draft saved (AI polish skipped via --no-polish).`);
    console.log(`   To polish later: node run.js ${year} ${month} --polish-only`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("❌ Error:", err.message);
    process.exit(1);
  });
}

module.exports = { verifyAndSaveReport };

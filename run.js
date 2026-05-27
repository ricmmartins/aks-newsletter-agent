#!/usr/bin/env node
/**
 * AKS Newsletter Agent – CLI Runner
 * Orchestrates content collection, newsletter generation, and AI polishing.
 *
 * Usage:
 *   node run.js <year> <month> [--collect-only | --generate-only | --polish-only] [--no-polish]
 *
 * Examples:
 *   node run.js 2026 2                  # Full run: collect + generate + polish
 *   node run.js 2026 2 --collect-only   # Only collect data
 *   node run.js 2026 2 --generate-only  # Generate + polish from existing data
 *   node run.js 2026 2 --polish-only    # Only polish an existing draft
 *   node run.js 2026 2 --no-polish      # Skip AI polishing step
 */

const { ContentCollector } = require("./collector");
const { NewsletterGenerator } = require("./generator");
const { NewsletterPolisher } = require("./polisher");

async function main() {
  const args = process.argv.slice(2);
  const collectOnly = args.includes("--collect-only");
  const generateOnly = args.includes("--generate-only");
  const polishOnly = args.includes("--polish-only");
  const noPolish = args.includes("--no-polish");

  const numArgs = args.filter((a) => !a.startsWith("--"));
  const now = new Date();
  const year = parseInt(numArgs[0]) || now.getFullYear();
  const month = parseInt(numArgs[1]) || now.getMonth() + 1;

  const monthName = new Date(year, month - 1).toLocaleString("en-US", {
    month: "long",
  });

  console.log(`\n🚀 AKS Newsletter Agent`);
  console.log(`   Target: ${monthName} ${year}\n`);

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

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});

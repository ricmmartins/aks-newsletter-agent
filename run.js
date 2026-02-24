#!/usr/bin/env node
/**
 * AKS Newsletter Agent – CLI Runner
 * Orchestrates content collection and newsletter generation.
 *
 * Usage:
 *   node run.js <year> <month> [--collect-only | --generate-only]
 *
 * Examples:
 *   node run.js 2026 2                  # Full run: collect + generate
 *   node run.js 2026 2 --collect-only   # Only collect data
 *   node run.js 2026 2 --generate-only  # Only generate from existing data
 */

const { ContentCollector } = require("./collector");
const { NewsletterGenerator } = require("./generator");

async function main() {
  const args = process.argv.slice(2);
  const collectOnly = args.includes("--collect-only");
  const generateOnly = args.includes("--generate-only");

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
  if (!generateOnly) {
    const collector = new ContentCollector(year, month);
    await collector.collectAll();

    if (collectOnly) {
      console.log("✅ Collection complete. Use --generate-only to create the newsletter.");
      return;
    }
  }

  // Phase 2: Generate
  const generator = new NewsletterGenerator(year, month);
  const content = generator.generate();
  const outputFile = generator.save(content);

  console.log(`\n✅ Newsletter generated: ${outputFile}`);
  console.log(`\n💡 TIP: The generated newsletter is a structured draft.`);
  console.log(`   For best results, review the collected data in collected/`);
  console.log(`   and use the agent_prompt.md with an AI assistant for final editing.`);
  console.log(`   The agent prompt contains the full editorial instructions and`);
  console.log(`   quality controls for producing the final newsletter.\n`);
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});

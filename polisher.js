/**
 * AKS Newsletter Agent – AI Polisher
 * Takes a raw generated draft and polishes it using OpenAI API (GPT-4o).
 * Produces an editorial-quality newsletter matching the reference edition style.
 * 
 * Supports two backends (auto-detected from env vars):
 *   - OPENAI_API_KEY → OpenAI API (api.openai.com)
 *   - GITHUB_TOKEN   → GitHub Models API (deprecated July 2026, kept as fallback)
 */

const fs = require("fs");
const path = require("path");

const OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const GITHUB_MODELS_ENDPOINT = "https://models.inference.ai.azure.com/chat/completions";
const PRIMARY_MODEL = "gpt-4o";
const FALLBACK_MODEL = "gpt-4o-mini";
const MAX_TOKENS = 16384;
const MAX_POLISH_ATTEMPTS = 2;
const MAX_SECTION_RETRIES = 2;

class NewsletterPolisher {
  constructor(year, month, options = {}) {
    this.year = year;
    this.month = month;
    this.monthPad = String(month).padStart(2, "0");
    
    // Auto-detect backend: prefer OpenAI API, fall back to GitHub Models
    this.openaiKey = options.openaiKey || process.env.OPENAI_API_KEY || "";
    this.githubToken = options.token || process.env.GITHUB_TOKEN || "";
    this.token = this.openaiKey || this.githubToken;
    this.useOpenAI = !!this.openaiKey;
    
    this.model = options.model || PRIMARY_MODEL;
    this.draftPath = options.draftPath || path.join("newsletters", String(year), `${year}-${this.monthPad}.md`);
    this.collectedPath = options.collectedPath || path.join("collected", `${year}-${this.monthPad}.json`);
    this.promptPath = options.promptPath || path.join(__dirname, "agent_prompt.md");
    this.referencePath = options.referencePath || path.join(__dirname, "reference", "2026-01.md");
  }

  canPolish() {
    if (!this.token) {
      console.warn("⚠️  No OPENAI_API_KEY or GITHUB_TOKEN found — skipping AI polish.");
      console.warn("   Set OPENAI_API_KEY (recommended) or GITHUB_TOKEN to enable.");
      return false;
    }
    if (!fs.existsSync(this.draftPath)) {
      console.warn(`⚠️  Draft not found at ${this.draftPath} — skipping AI polish.`);
      return false;
    }
    return true;
  }

  _loadFile(filePath, label) {
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, "utf8");
    }
    console.warn(`⚠️  ${label} not found at ${filePath}`);
    return null;
  }

  _buildMessages() {
    const agentPrompt = this._loadFile(this.promptPath, "Agent prompt");
    const reference = this._loadFile(this.referencePath, "Reference edition");
    const draft = this._loadFile(this.draftPath, "Draft newsletter");
    const collected = this._loadFile(this.collectedPath, "Collected data");

    if (!agentPrompt || !draft) {
      throw new Error("Cannot polish: missing agent prompt or draft file.");
    }

    const systemMessage = `${agentPrompt}

---

## REFERENCE EDITION (match this tone, depth, and style exactly)

${reference || "Reference edition not available. Follow the instructions above strictly."}`;

    let userMessage = `Polish this raw draft newsletter into a final, publication-ready edition.

## RULES REMINDER
- Every item MUST have a 1-3 sentence opinionated, engineering-focused description
- Items marked with [NEEDS DESCRIPTION] have only their Learn page metadata — you MUST rewrite these completely with opinionated, architectural context
- Items with NO description after the link MUST get one added — no exceptions
- Remove noise items (TOC-only changes, typo fixes, "minor changes")
- Never copy/paste meta descriptions from Learn pages (phrases starting with "Learn how to...", "Learn about...", "In this article...")
- Explain "what changed" and "why it matters"
- Match the tone and structure of the reference edition exactly
- Keep ALL legitimate links — do not drop real content
- Remove &nbsp; HTML entities and clean up formatting
- Remove the [NEEDS DESCRIPTION] markers from the final output

## QUALITY GATE (NON-NEGOTIABLE)
Before finalizing, verify that EVERY bullet point entry has at minimum 1 sentence of description after the link. An entry like \`* **[Title](url)**\` with NOTHING after it is a DEFECT. Fix it.

## RAW DRAFT TO POLISH

${draft}`;

    if (collected) {
      // Include collected data summary (truncated to avoid token limits)
      const collectedData = JSON.parse(collected);
      const summary = this._summarizeCollected(collectedData);
      userMessage += `

## COLLECTED DATA CONTEXT (use for enriching descriptions)

${summary}`;
    }

    return [
      { role: "system", content: systemMessage },
      { role: "user", content: userMessage },
    ];
  }

  /**
   * Enforce UTM tracking on all links in the final output.
   * Applied as the LAST step to guarantee no link escapes without tracking.
   */
  _enforceUtm(content) {
    const campaign = `${this.year}-${this.monthPad}`;
    return content.replace(/\]\((https?:\/\/[^)]+)\)/g, (match, url) => {
      // Skip GitHub, YouTube
      if (/github\.com|youtube\.com|youtu\.be/i.test(url)) return match;
      // Strip any pre-existing UTM params to prevent duplicates
      let cleanUrl = url.replace(/[?&]utm_source=aksnewsletter[^)&]*/g, "")
        .replace(/[?&]utm_medium=website/g, "")
        .replace(/[?&]utm_campaign=\d{4}-\d{2}/g, "");
      // Clean up trailing ? or & left after stripping
      cleanUrl = cleanUrl.replace(/[?&]$/, "");
      const sep = cleanUrl.includes("?") ? "&" : "?";
      return `](${cleanUrl}${sep}utm_source=aksnewsletter&utm_medium=website&utm_campaign=${campaign})`;
    });
  }

  // Build a compact system message for section-by-section polishing
  _buildSectionSystemMessage() {
    return `You are an editorial agent for Ricardo Martins' monthly AKS Newsletter.

RULES:
- Every item MUST have a 1-3 sentence opinionated, engineering-focused description
- Items marked [NEEDS DESCRIPTION] need you to write a NEW description — do NOT copy metadata
- Explain "what changed" and "why it matters" to platform engineers
- Never use "Learn how to...", "Learn about...", "In this article..." patterns
- Use patterns like: "This documentation was refreshed with...", "Updated to cover...", "Refreshed with current guidance on..."
- Remove noise items (TOC-only changes, typo fixes, trivial edits)
- Remove [NEEDS DESCRIPTION] markers from output
- **NEVER change, merge, remove, or substitute URLs.** Each item's URL is its source — preserve it EXACTLY.
- **NEVER merge two items into one.** Each entry with a unique URL stays separate.
- You may shorten the title but the URL in parentheses must remain unchanged.
- Be technical, not marketing

GOOD EXAMPLE:
* **[Configure rolling upgrades](url)**: Updated with the new Capacity Based Surge option and clearer guidance on drain timeout, soak time, and max-unavailable settings. Critical reading for teams managing large node pools with strict SLA requirements.

BAD EXAMPLE (metadata — NEVER do this):
* **[Configure rolling upgrades](url)**: Learn how to configure and customize rolling upgrades for AKS node pools.

Return ONLY the polished section content in Markdown. No commentary.`;
  }

  // Split the draft into sections and collect relevant context for each
  _splitIntoSections(draft, collectedData) {
    const sectionSplitRegex = /^(---\s*$)/m;
    const parts = draft.split(sectionSplitRegex).filter((p) => p.trim() && p.trim() !== "---");

    // Identify sections by their headers
    const sections = [];
    for (const part of parts) {
      const headerMatch = part.match(/^##\s+(.+)/m);
      const sectionName = headerMatch ? headerMatch[1].trim() : "intro";
      sections.push({ name: sectionName, content: part.trim() });
    }

    // Map relevant collected data to each section
    const sectionContextMap = {
      "Documentation Updates": () => {
        const docs = collectedData?.aks_docs_commits || [];
        return docs.map((d) => {
          const meta = d.summaryIsMetadata ? " [META]" : "";
          const ctx = d.commitContext ? ` | Change: ${d.commitContext}` : "";
          return `- ${d.title}${meta}: ${(d.summary || "").slice(0, 200)}${ctx}`;
        }).join("\n");
      },
      "General Availability": () => {
        const updates = (collectedData?.azure_updates || []).filter((u) =>
          (u.title || "").toLowerCase().includes("generally available") || (u.title || "").toLowerCase().split(/\s+/).includes("ga")
        );
        return updates.map((u) => `- ${u.title}: ${u.summary || ""}`).join("\n");
      },
      "Preview Feature": () => {
        const updates = (collectedData?.azure_updates || []).filter((u) =>
          (u.title || "").toLowerCase().includes("preview")
        );
        return updates.map((u) => `- ${u.title}: ${u.summary || ""}`).join("\n");
      },
      "Behavioral Changes": () => {
        const items = [...(collectedData?.behavioral_changes || []), ...(collectedData?.announcements || [])];
        return items.map((i) => `- ${i.title}: ${(i.summary || "").slice(0, 300)}`).join("\n");
      },
      "Community Blogs": () => {
        const blogs = [...(collectedData?.aks_blog || []), ...(collectedData?.techcommunity_search || [])];
        return blogs.slice(0, 15).map((b) => `- ${b.title}: ${(b.summary || "").slice(0, 200)}`).join("\n");
      },
      "Watch & Learn": () => {
        const vids = collectedData?.youtube || [];
        return vids.map((v) => `- ${v.title}: ${(v.summary || "").slice(0, 200)}`).join("\n");
      },
      "Releases": () => {
        const rels = collectedData?.aks_releases || [];
        return rels.map((r) => `- ${r.title}: ${(r.body || "").slice(0, 800)}`).join("\n");
      },
    };

    // Attach relevant context to each section
    for (const section of sections) {
      for (const [key, fn] of Object.entries(sectionContextMap)) {
        if (section.name.includes(key)) {
          section.context = fn();
          break;
        }
      }
    }

    return sections;
  }

  _summarizeCollected(data) {
    const sections = [];

    // Azure Updates with full details
    if (data.azure_updates?.length) {
      sections.push("### Azure Updates");
      for (const item of data.azure_updates) {
        sections.push(`- ${item.title}: ${item.summary || "(no summary)"} | URL: ${item.url || ""}`);
      }
    }

    // AKS Blog
    if (data.aks_blog?.length) {
      sections.push("\n### AKS Blog");
      for (const item of data.aks_blog) {
        sections.push(`- ${item.title}: ${(item.summary || "").slice(0, 500)} | URL: ${item.url || ""}`);
      }
    }

    // Releases with body (increased from 500 to 2000 chars for richer context)
    if (data.aks_releases?.length) {
      sections.push("\n### Releases");
      for (const item of data.aks_releases) {
        sections.push(`- ${item.title}: ${(item.body || item.summary || "").slice(0, 2000)} | URL: ${item.url || ""}`);
      }
    }

    // Docs commits — include commit context and metadata flag for better AI rewriting
    if (data.aks_docs_commits?.length) {
      sections.push("\n### Documentation Updates (USE THIS CONTEXT TO WRITE OPINIONATED DESCRIPTIONS)");
      sections.push("NOTE: 'summary' below is the raw Learn page metadata — do NOT copy it. Use it only as context to understand the topic, then write your own opinionated description explaining what changed and why it matters.");
      for (const item of data.aks_docs_commits.slice(0, 50)) {
        const metaFlag = item.summaryIsMetadata ? " [METADATA - REWRITE]" : "";
        const commitCtx = item.commitContext ? ` | Commit: ${item.commitContext}` : "";
        sections.push(`- ${item.title}${metaFlag}: ${(item.summary || "").slice(0, 300)}${commitCtx} | URL: ${item.url || ""}`);
      }
    }

    // Blogs
    const blogs = [...(data.techcommunity || []), ...(data.techcommunity_search || [])];
    if (blogs.length) {
      sections.push("\n### Community Blogs");
      for (const item of blogs.slice(0, 20)) {
        sections.push(`- ${item.title}: ${(item.summary || "").slice(0, 400)} | URL: ${item.url || ""}`);
      }
    }

    // Videos
    if (data.youtube?.length) {
      sections.push("\n### YouTube Videos");
      for (const item of data.youtube) {
        sections.push(`- ${item.title}: ${(item.summary || "").slice(0, 300)} | URL: ${item.url || ""}`);
      }
    }

    // Behavioral changes
    if (data.behavioral_changes?.length) {
      sections.push("\n### Behavioral Changes");
      for (const item of data.behavioral_changes) {
        sections.push(`- ${item.title}: ${(item.summary || "").slice(0, 400)} | URL: ${item.url || ""}`);
      }
    }

    // Announcements
    if (data.announcements?.length) {
      sections.push("\n### Announcements");
      for (const item of data.announcements) {
        sections.push(`- ${item.title}: ${(item.summary || "").slice(0, 400)} | URL: ${item.url || ""}`);
      }
    }

    return sections.join("\n");
  }

  async _callModel(messages, model) {
    console.log(`🤖 Calling ${model} via GitHub Models API...`);

    const response = await fetch(GITHUB_MODELS_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: MAX_TOKENS,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`GitHub Models API error (${response.status}): ${errorBody}`);
    }

    const result = await response.json();
    return result.choices[0].message.content;
  }

  async polish() {
    if (!this.canPolish()) return null;

    // Strategy: Polish section by section to stay within token limits
    // This is more reliable and produces better results per section
    let draft = this._loadFile(this.draftPath, "Draft newsletter");
    const collected = this._loadFile(this.collectedPath, "Collected data");
    const collectedData = collected ? JSON.parse(collected) : null;

    if (!draft) {
      console.error("❌ No draft found to polish.");
      return null;
    }

    // Strip POLISHER NOTE hints before processing (they're generator-internal)
    draft = draft.replace(/\n<!--\s*POLISHER NOTE:.*?-->\s*\n?/gs, "\n");

    console.log("📋 Using section-by-section polishing strategy...");
    let polished = await this._polishBySection(draft, collectedData);

    if (polished) {
      // Enforce UTM tracking on ALL links as a final post-polish step
      polished = this._enforceUtm(polished);

      // Final validation — pass original draft to check URL preservation
      const issues = this._validateOutput(polished, draft);
      if (issues.length === 0) {
        console.log("✅ Polish passed quality validation.");
      } else {
        console.warn(`⚠️  Quality issues in final output:`);
        issues.forEach((issue) => console.warn(`   - ${issue}`));
      }

      // Hard fail: refuse to produce output with [NEEDS DESCRIPTION] markers
      const remainingMarkers = (polished.match(/\[NEEDS DESCRIPTION\]/g) || []).length;
      if (remainingMarkers > 0) {
        console.error(`\n❌ QUALITY GATE FAILED: ${remainingMarkers} items still have [NEEDS DESCRIPTION] markers.`);
        console.error(`   The polisher could not rewrite all items. These need manual attention:`);
        const lines = polished.split("\n");
        for (const line of lines) {
          if (line.includes("[NEEDS DESCRIPTION]")) {
            const titleMatch = line.match(/\*\*\[([^\]]+)\]/);
            console.error(`   • ${titleMatch ? titleMatch[1] : line.trim().substring(0, 80)}`);
          }
        }
        console.error(`\n   Fix: Run again with --polish-only, or edit the draft manually.`);
        process.exit(1);
      }

      return polished;
    }

    console.error("❌ Section-by-section polish failed.");
    return null;
  }

  async _polishBySection(draft, collectedData) {
    const sections = this._splitIntoSections(draft, collectedData);
    const systemMessage = this._buildSectionSystemMessage();
    const polishedSections = [];

    for (const section of sections) {
      // Skip sections that don't have items needing polish
      const hasItems = section.content.includes("* **[");
      const needsPolish = section.content.includes("[NEEDS DESCRIPTION]") ||
        (hasItems && /\* \*\*\[[^\]]+\]\([^)]+\)\*\*\s*$/m.test(section.content));

      if (!needsPolish) {
        // Pass through sections that are already good (intro, closing, separators)
        polishedSections.push(section.content);
        continue;
      }

      console.log(`  📝 Polishing: ${section.name.substring(0, 50)}...`);

      let userMessage = `Polish this newsletter section. Every item MUST have a description.\n\n## SECTION TO POLISH\n\n${section.content}`;
      if (section.context) {
        userMessage += `\n\n## CONTEXT (use to write better descriptions — do NOT copy verbatim)\n\n${section.context}`;
      }

      const messages = [
        { role: "system", content: systemMessage },
        { role: "user", content: userMessage },
      ];

      try {
        let result = await this._callModel(messages, this.model);
        let cleaned = this._cleanOutput(result);

        // Retry loop: keep re-polishing until no [NEEDS DESCRIPTION] markers remain
        let retryCount = 0;
        let conversationMessages = [...messages, { role: "assistant", content: result }];
        while (cleaned.includes("[NEEDS DESCRIPTION]") && retryCount < MAX_SECTION_RETRIES) {
          retryCount++;
          const remaining = (cleaned.match(/\[NEEDS DESCRIPTION\]/g) || []).length;
          console.warn(`  ⚠️  Section still has ${remaining} [NEEDS DESCRIPTION] markers, retry ${retryCount}/${MAX_SECTION_RETRIES}...`);
          conversationMessages.push({
            role: "user",
            content: `You left ${remaining} [NEEDS DESCRIPTION] markers in the output. Replace ALL of them with actual 1-3 sentence opinionated descriptions. Do NOT use "Learn how to..." or "Learn about..." patterns. Return the COMPLETE corrected section with no markers remaining.`,
          });
          result = await this._callModel(conversationMessages, this.model);
          cleaned = this._cleanOutput(result);
          conversationMessages.push({ role: "assistant", content: result });
        }

        // Also catch generic one-liner descriptions that the polisher missed
        const genericPattern = /:\s*(Is now (available|supported|enabled)|Is now in (public )?preview)[^.]*\.?\s*$/gm;
        if (genericPattern.test(cleaned) && retryCount < MAX_SECTION_RETRIES) {
          console.warn(`  ⚠️  Section has generic one-liner descriptions, requesting rewrite...`);
          conversationMessages.push({
            role: "user",
            content: `Some items have generic one-liner descriptions like "Is now available in public preview." These are NOT acceptable. Every item needs 1-3 sentences explaining what the feature does, what pain point it solves, and who benefits. Rewrite ALL generic descriptions. Return the COMPLETE corrected section.`,
          });
          result = await this._callModel(conversationMessages, this.model);
          cleaned = this._cleanOutput(result);
        }

        polishedSections.push(cleaned);
      } catch (err) {
        console.warn(`  ⚠️  Failed to polish section "${section.name}": ${err.message}`);
        // Try fallback model
        if (this.model === PRIMARY_MODEL) {
          try {
            const messages2 = [
              { role: "system", content: systemMessage },
              { role: "user", content: userMessage },
            ];
            const result = await this._callModel(messages2, FALLBACK_MODEL);
            polishedSections.push(this._cleanOutput(result));
          } catch (err2) {
            console.error(`  ❌ Fallback also failed: ${err2.message}`);
            polishedSections.push(section.content);
          }
        } else {
          polishedSections.push(section.content);
        }
      }
    }

    return polishedSections.join("\n\n---\n\n");
  }

  _validateOutput(content, originalDraft) {
    const issues = [];
    const lines = content.split("\n");

    let itemsWithoutDescription = 0;
    let itemsWithMetadata = 0;
    let totalItems = 0;

    // Static links that intentionally have no descriptions
    const staticLinks = ["github.com/Azure/AKS/releases", "github.com/orgs/Azure/projects"];
    let hasNeedsDescMarker = false;

    for (const line of lines) {
      // Match bullet point entries: * **[Title](url)** using non-greedy matching
      const entryMatch = line.match(/^\*\s+\*\*\[([^\]]+)\]\(([^)]+)\)\*\*/);
      if (entryMatch) {
        const url = entryMatch[2] || "";
        // Skip static reference links
        if (staticLinks.some((s) => url.includes(s))) continue;

        totalItems++;
        // Check if there's a description after the link
        const afterLink = line.replace(/^\*\s+\*\*\[[^\]]+\]\([^)]+\)\*\*/, "").trim();
        if (!afterLink || afterLink === ":" || afterLink === ": ") {
          itemsWithoutDescription++;
        } else if (/^:\s*(Learn (how to|about|the)|In this (article|tutorial))/i.test(afterLink)) {
          itemsWithMetadata++;
        } else if (/^:\s*Is now (available|supported|enabled|in (public )?preview)/i.test(afterLink) && afterLink.length < 100) {
          itemsWithMetadata++;
        }
      }

      // Check for leftover [NEEDS DESCRIPTION] markers
      if (line.includes("[NEEDS DESCRIPTION]")) {
        hasNeedsDescMarker = true;
      }
    }

    if (hasNeedsDescMarker) {
      issues.push("Leftover [NEEDS DESCRIPTION] markers found — model didn't rewrite all items");
    }

    if (itemsWithoutDescription > 0) {
      issues.push(`${itemsWithoutDescription}/${totalItems} items have no description`);
    }
    if (itemsWithMetadata > 0) {
      issues.push(`${itemsWithMetadata}/${totalItems} items still have raw metadata descriptions (starting with "Learn how to...")`);
    }
    if (totalItems < 5) {
      issues.push(`Only ${totalItems} items found — model may have dropped content`);
    }

    // Check URL preservation: every URL in the original draft should appear in the output
    if (originalDraft) {
      const urlRegex = /\]\(([^)]+)\)/g;
      const originalUrls = new Set();
      let match;
      while ((match = urlRegex.exec(originalDraft)) !== null) {
        // Strip UTM params for comparison (they're added post-generation)
        const url = match[1].replace(/[?&]utm_source=aksnewsletter[^)]*/, "");
        if (!staticLinks.some((s) => url.includes(s))) {
          originalUrls.add(url);
        }
      }
      const outputUrls = new Set();
      const urlRegex2 = /\]\(([^)]+)\)/g;
      while ((match = urlRegex2.exec(content)) !== null) {
        const url = match[1].replace(/[?&]utm_source=aksnewsletter[^)]*/, "");
        outputUrls.add(url);
      }
      const droppedUrls = [...originalUrls].filter((u) => !outputUrls.has(u));
      if (droppedUrls.length > 0) {
        issues.push(`${droppedUrls.length} URLs from original draft were dropped by polisher: ${droppedUrls.slice(0, 3).join(", ")}${droppedUrls.length > 3 ? "..." : ""}`);
      }
    }

    return issues;
  }

  _buildFixupPrompt(issues, currentOutput) {
    return `The output has quality issues that must be fixed:

${issues.map((i) => `- ${i}`).join("\n")}

REQUIREMENTS:
1. Every bullet point entry (lines starting with \`* **[Title](url)**\`) MUST have a colon followed by 1-3 sentences of opinionated description.
2. Descriptions starting with "Learn how to...", "Learn about...", or "In this article..." are METADATA — rewrite them with "what changed" and "why it matters" context.
3. Remove any [NEEDS DESCRIPTION] markers.
4. Do NOT drop any items — keep all links.

Return the COMPLETE corrected newsletter. Do not truncate.`;
  }

  _cleanOutput(content) {
    // Remove markdown code fences if the model wrapped the output
    let cleaned = content.trim();
    if (cleaned.startsWith("```markdown")) {
      cleaned = cleaned.slice("```markdown".length);
    } else if (cleaned.startsWith("```md")) {
      cleaned = cleaned.slice("```md".length);
    } else if (cleaned.startsWith("```")) {
      cleaned = cleaned.slice(3);
    }
    if (cleaned.endsWith("```")) {
      cleaned = cleaned.slice(0, -3);
    }
    return cleaned.trim() + "\n";
  }

  save(content) {
    const dir = path.dirname(this.draftPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.draftPath, content, "utf8");
    console.log(`✨ Polished newsletter saved to: ${this.draftPath}`);
    return this.draftPath;
  }
}

module.exports = { NewsletterPolisher };

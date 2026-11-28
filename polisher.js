/**
 * AKS Newsletter Agent – AI Polisher
 * Takes a raw generated draft and polishes it using authenticated Copilot CLI.
 * Produces an editorial-quality newsletter matching the reference edition style.
 * 
 * Uses Copilot access only; never falls back to a paid provider API.
 */

const fs = require("fs");
const path = require("path");
const { callCopilot } = require("./copilot-client");

const MAX_SECTION_RETRIES = 2;
const STATIC_REFERENCE_LINKS = ["github.com/Azure/AKS/releases", "github.com/orgs/Azure/projects"];

class NewsletterPolisher {
  constructor(year, month, options = {}) {
    this.year = year;
    this.month = month;
    this.monthPad = String(month).padStart(2, "0");
    
    this.model = options.model || process.env.COPILOT_MODEL || "";
    this.draftPath = options.draftPath || path.join("newsletters", String(year), `${year}-${this.monthPad}.md`);
    this.collectedPath = options.collectedPath || path.join("collected", `${year}-${this.monthPad}.json`);
    this.promptPath = options.promptPath || path.join(__dirname, "agent_prompt.md");
    this.referencePath = options.referencePath || path.join(__dirname, "reference", "2026-01.md");
  }

  canPolish() {
    if (!fs.existsSync(this.draftPath)) {
      throw new Error(`Draft not found at ${this.draftPath}.`);
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
- Add descriptions only when the collected source context supports the claims
- Items marked with [NEEDS DESCRIPTION] may be rewritten only from supported source facts; do not add inferred architectural or security claims
- Keep lifecycle announcements title-only when the collected data marks them as not supporting a generated description
- Remove noise items (TOC-only changes, typo fixes, "minor changes")
- Never copy/paste meta descriptions from Learn pages (phrases starting with "Learn how to...", "Learn about...", "In this article...")
- Explain "what changed" and "why it matters" only when the source provides those details
- Match the tone and structure of the reference edition exactly
- Keep ALL legitimate links — do not drop real content
- Remove &nbsp; HTML entities and clean up formatting
- Remove the [NEEDS DESCRIPTION] markers from the final output

## QUALITY GATE (NON-NEGOTIABLE)
Before finalizing, verify that every factual description is supported by its source context. A title-only lifecycle announcement is valid when the collected data says its source does not support a generated description.

## RAW DRAFT TO POLISH

${draft}`;

    if (collected) {
      // Include collected data summary (truncated to avoid token limits)
      const collectedData = JSON.parse(collected);
      const summary = this._summarizeCollected(collectedData);
      userMessage += `

## COLLECTED DATA CONTEXT (use only facts supported by the source material)

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
      const tracked = new URL(url);
      tracked.searchParams.set("utm_source", "aksnewsletter");
      tracked.searchParams.set("utm_medium", "website");
      tracked.searchParams.set("utm_campaign", campaign);
      return `](${tracked})`;
    });
  }

  // Build a compact system message for section-by-section polishing
  _buildSectionSystemMessage() {
    return `You are an editorial agent for Ricardo Martins' monthly AKS Newsletter.

RULES:
- Add a 1-3 sentence engineering-focused description only when the supplied source context supports it
- Items marked [NEEDS DESCRIPTION] may be rewritten only from supported source facts; do NOT infer architecture, security properties, benefits, or limitations
- If a lifecycle announcement is marked as title/status only, preserve it without a description
- Do not add factual claims from general knowledge or assumptions. When evidence is incomplete, keep the supported title and status without elaboration
- Explain "what changed" and "why it matters" only when the source establishes those details
- Never use "Learn how to...", "Learn about...", "In this article..." patterns
- Use patterns like: "This documentation was refreshed with...", "Updated to cover...", "Refreshed with current guidance on..."
- Remove noise items (TOC-only changes, typo fixes, trivial edits)
- Remove [NEEDS DESCRIPTION] markers from output
- **NEVER change, merge, remove, or substitute URLs.** Each item's URL is its source — preserve it EXACTLY.
- **NEVER merge two items into one.** Each entry with a unique URL stays separate.
- The fixed AKS Releases and Public Roadmap reference links are valid without descriptions; preserve them unchanged.
- You may shorten the title but the URL in parentheses must remain unchanged.
- Be technical, not marketing
- A release-note "Features" heading is NOT proof of general availability. Never infer a new GA transition from existing availability, documentation changes, or a new subfeature.
- Preserve the scope of each announcement: improvements to NAP do not mean NAP itself just became GA. Only assert a GA transition explicitly supported by the source.

GOOD EXAMPLE (use these details only when they appear in the supplied source context):
* **[Configure rolling upgrades](url)**: The documentation now covers Capacity Based Surge, drain timeout, soak time, and max-unavailable settings.

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
        if (!docs.length && collectedData?.metadata?.documentationUpdatesStatus === "unavailable") {
          return "AKS documentation change tracking is unavailable for this edition. Preserve this status; do not claim that no documentation changes occurred.";
        }
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
        return updates.map((u) => `- ${u.title}: ${u.suppressGeneratedDescription ? "[TITLE/STATUS ONLY; do not infer further details]" : u.summary || ""}`).join("\n");
      },
      "Preview Feature": () => {
        const updates = (collectedData?.azure_updates || []).filter((u) =>
          (u.title || "").toLowerCase().includes("preview")
        );
        return updates.map((u) => `- ${u.title}: ${u.suppressGeneratedDescription ? "[TITLE/STATUS ONLY; do not infer further details]" : u.summary || ""}`).join("\n");
      },
      "Behavioral Changes": () => {
        const items = [...(collectedData?.behavioral_changes || []), ...(collectedData?.announcements || [])];
        return items.map((i) => `- ${i.title}: ${(i.summary || "").slice(0, 300)}`).join("\n");
      },
      "Community Blogs": (section) => {
        const blogs = [
          ...(collectedData?.aks_blog || []),
          ...(collectedData?.techcommunity || []),
          ...(collectedData?.techcommunity_search || []),
        ];
        const relevantBlogs = blogs.filter((blog) =>
          (blog.url && section.content.includes(blog.url)) ||
          (blog.title && section.content.includes(blog.title))
        );
        return relevantBlogs.map((b) => `- ${b.title}: ${(b.summary || "").slice(0, 1000)}`).join("\n");
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
          section.context = fn(section);
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
        const summary = item.suppressGeneratedDescription
          ? "[TITLE/STATUS ONLY; do not infer further details]"
          : item.summary || "(no summary)";
        sections.push(`- ${item.title}: ${summary} | URL: ${item.url || ""}`);
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
      sections.push("\n### Documentation Updates");
      sections.push("NOTE: 'summary' below is raw Learn page metadata — do NOT copy it. Use the supplied context only for supported facts. Do not infer changes or benefits that are not established by the source.");
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
        sections.push(`- ${item.title}: ${(item.summary || "").slice(0, 1000)} | URL: ${item.url || ""}`);
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

  _normalizeTrackedUrl(value) {
    const url = new URL(value);
    for (const key of ["utm_source", "utm_medium", "utm_campaign"]) url.searchParams.delete(key);
    return url.toString();
  }

  _titleOnlyAnnouncementUrls(collectedData) {
    return new Set((collectedData?.azure_updates || [])
      .filter((item) => item.suppressGeneratedDescription && item.url)
      .map((item) => this._normalizeTrackedUrl(item.url)));
  }

  _missingDescriptionEntries(content, titleOnlyUrls) {
    return content.split("\n").filter((line) => {
      const match = line.match(/^\*\s+\*\*\[([^\]]+)\]\(([^)]+)\)\*\*/);
      if (!match) return false;

      const url = match[2];
      if (STATIC_REFERENCE_LINKS.some((staticUrl) => url.includes(staticUrl))) return false;
      if (titleOnlyUrls.has(this._normalizeTrackedUrl(url))) return false;

      const afterLink = line.replace(/^\*\s+\*\*\[[^\]]+\]\([^)]+\)\*\*/, "").trim();
      return !afterLink || afterLink === ":" || afterLink === ": ";
    });
  }

  async _callModel(messages, model) {
    console.log(`🤖 Polishing via Copilot CLI${model ? ` (${model})` : ""}...`);
    return callCopilot(messages, model);
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
      const issues = this._validateOutput(polished, draft, collectedData);
      if (issues.length === 0) {
        console.log("✅ Polish passed quality validation.");
      } else {
        throw new Error(`Newsletter quality validation failed:\n${issues.join("\n")}`);
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
    const titleOnlyUrls = this._titleOnlyAnnouncementUrls(collectedData);

    for (const section of sections) {
      // Skip sections that don't have items needing polish
      const bareEntries = section.content.split("\n").filter((line) =>
        /^\*\s+\*\*\[[^\]]+\]\((https?:\/\/[^)]+)\)\*\*\s*$/.test(line)
      );
      const needsPolish = section.content.includes("[NEEDS DESCRIPTION]") ||
        bareEntries.some((line) => {
          const url = line.match(/\]\((https?:\/\/[^)]+)\)/)?.[1];
          const isStaticReference = url && STATIC_REFERENCE_LINKS.some((staticUrl) => url.includes(staticUrl));
          return url && !isStaticReference && !titleOnlyUrls.has(this._normalizeTrackedUrl(url));
        });

      if (!needsPolish) {
        // Pass through sections that are already good (intro, closing, separators)
        polishedSections.push(section.content);
        continue;
      }

      console.log(`  📝 Polishing: ${section.name.substring(0, 50)}...`);

      let userMessage = `Polish this newsletter section. Use only claims supported by the supplied source context. If the evidence is incomplete, keep the item title-only rather than inferring details.\n\n## SECTION TO POLISH\n\n${section.content}`;
      const titleOnlyEntries = bareEntries.filter((line) => {
        const url = line.match(/\]\((https?:\/\/[^)]+)\)/)?.[1];
        return url && titleOnlyUrls.has(this._normalizeTrackedUrl(url));
      });
      if (titleOnlyEntries.length) {
        userMessage += `\n\n## TITLE/STATUS-ONLY ITEMS\nPreserve these entries exactly as title-only. Their source context does not support an expanded description:\n${titleOnlyEntries.join("\n")}`;
      }
      if (section.context) {
        userMessage += `\n\n## SOURCE CONTEXT (use only facts supported here; do NOT copy metadata verbatim)\n\n${section.context}`;
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
            content: `You left ${remaining} [NEEDS DESCRIPTION] markers in the output. Replace them only with descriptions supported by the supplied source context. If the source does not provide enough detail, retain the title and status without a description. Do NOT use "Learn how to..." or "Learn about..." patterns. Return the COMPLETE corrected section with no markers remaining.`,
          });
          result = await this._callModel(conversationMessages, this.model);
          cleaned = this._cleanOutput(result);
          conversationMessages.push({ role: "assistant", content: result });
        }

        let missingDescriptionEntries = this._missingDescriptionEntries(cleaned, titleOnlyUrls);
        while (missingDescriptionEntries.length && retryCount < MAX_SECTION_RETRIES) {
          retryCount++;
          console.warn(`  ⚠️  Section still has ${missingDescriptionEntries.length} entries without descriptions, retry ${retryCount}/${MAX_SECTION_RETRIES}...`);
          conversationMessages.push({
            role: "user",
            content: `These linked entries still have no description:\n${missingDescriptionEntries.join("\n")}\n\nAdd a concise description to each using only facts supported by the source context. Do not change their titles or URLs, do not add unsupported claims, and preserve any title/status-only items exactly. Return the COMPLETE corrected section.`,
          });
          result = await this._callModel(conversationMessages, this.model);
          cleaned = this._cleanOutput(result);
          conversationMessages.push({ role: "assistant", content: result });
          missingDescriptionEntries = this._missingDescriptionEntries(cleaned, titleOnlyUrls);
        }

        // Also catch generic one-liner descriptions that the polisher missed
        const genericPattern = /:\s*(Is now (available|supported|enabled)|Is now in (public )?preview)[^.]*\.?\s*$/gm;
        if (genericPattern.test(cleaned) && retryCount < MAX_SECTION_RETRIES) {
          console.warn(`  ⚠️  Section has generic one-liner descriptions, requesting rewrite...`);
          conversationMessages.push({
            role: "user",
            content: `Some items have generic one-liner descriptions like "Is now available in public preview." Replace them only when the source context supports a more specific description. Do not infer what the feature does, its benefits, or who benefits. Return the COMPLETE corrected section.`,
          });
          result = await this._callModel(conversationMessages, this.model);
          cleaned = this._cleanOutput(result);
        }

        polishedSections.push(cleaned);
      } catch (err) {
        throw new Error(`Failed to polish section "${section.name}": ${err.message}`, { cause: err });
      }
    }

    return polishedSections.join("\n\n---\n\n");
  }

  _validateOutput(content, originalDraft, collectedData) {
    const issues = [];
    const lines = content.split("\n");
    const titleOnlyUrls = this._titleOnlyAnnouncementUrls(collectedData);

    let titleOnlyItemsWithDescription = 0;
    let itemsWithMetadata = 0;
    let totalItems = 0;

    let hasNeedsDescMarker = false;

    for (const line of lines) {
      // Match bullet point entries: * **[Title](url)** using non-greedy matching
      const entryMatch = line.match(/^\*\s+\*\*\[([^\]]+)\]\(([^)]+)\)\*\*/);
      if (entryMatch) {
        const url = entryMatch[2] || "";
        // Skip static reference links
        if (STATIC_REFERENCE_LINKS.some((s) => url.includes(s))) continue;

        totalItems++;
        const titleOnly = titleOnlyUrls.has(this._normalizeTrackedUrl(url));
        // Check if there's a description after the link
        const afterLink = line.replace(/^\*\s+\*\*\[[^\]]+\]\([^)]+\)\*\*/, "").trim();
        if (titleOnly) {
          if (afterLink && afterLink !== ":" && afterLink !== ": ") titleOnlyItemsWithDescription++;
          continue;
        }
        if (!afterLink || afterLink === ":" || afterLink === ": ") {
          continue;
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

    const missingDescriptionEntries = this._missingDescriptionEntries(content, titleOnlyUrls);
    if (missingDescriptionEntries.length > 0) {
      const labels = missingDescriptionEntries
        .map((line) => line.match(/^\*\s+\*\*\[([^\]]+)\]/)?.[1])
        .filter(Boolean);
      const examples = labels.slice(0, 5).join("; ");
      issues.push(`${missingDescriptionEntries.length}/${totalItems} items have no description${examples ? `: ${examples}${labels.length > 5 ? "..." : ""}` : ""}`);
    }
    if (titleOnlyItemsWithDescription > 0) {
      issues.push(`${titleOnlyItemsWithDescription} title/status-only announcements have unsupported descriptions`);
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
        const url = this._normalizeTrackedUrl(match[1]);
        if (!STATIC_REFERENCE_LINKS.some((s) => url.includes(s))) {
          originalUrls.add(url);
        }
      }
      const outputUrls = new Set();
      const urlRegex2 = /\]\(([^)]+)\)/g;
      while ((match = urlRegex2.exec(content)) !== null) {
        const url = this._normalizeTrackedUrl(match[1]);
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
1. Add descriptions only when their claims are supported by the supplied source context. Keep title/status-only announcements without descriptions.
2. Descriptions starting with "Learn how to...", "Learn about...", or "In this article..." are METADATA — rewrite them using only supported source facts.
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

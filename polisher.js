/**
 * AKS Newsletter Agent – AI Polisher
 * Takes a raw generated draft and polishes it using GitHub Models API (GPT-4o).
 * Produces an editorial-quality newsletter matching the reference edition style.
 */

const fs = require("fs");
const path = require("path");

const GITHUB_MODELS_ENDPOINT = "https://models.inference.ai.azure.com/chat/completions";
const PRIMARY_MODEL = "gpt-4o";
const FALLBACK_MODEL = "gpt-4o-mini";

class NewsletterPolisher {
  constructor(year, month, options = {}) {
    this.year = year;
    this.month = month;
    this.monthPad = String(month).padStart(2, "0");
    this.token = options.token || process.env.GITHUB_TOKEN || "";
    this.model = options.model || PRIMARY_MODEL;
    this.draftPath = options.draftPath || path.join("newsletters", String(year), `${year}-${this.monthPad}.md`);
    this.collectedPath = options.collectedPath || path.join("collected", `${year}-${this.monthPad}.json`);
    this.promptPath = options.promptPath || path.join(__dirname, "agent_prompt.md");
    this.referencePath = options.referencePath || path.join(__dirname, "reference", "2026-01.md");
  }

  canPolish() {
    if (!this.token) {
      console.warn("⚠️  No GITHUB_TOKEN found — skipping AI polish. Set GITHUB_TOKEN to enable.");
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
- Remove noise items (TOC-only changes, typo fixes, "minor changes")
- Never copy/paste meta descriptions from Learn pages
- Explain "what changed" and "why it matters"
- Match the tone and structure of the reference edition exactly
- Keep ALL legitimate links — do not drop real content
- Remove &nbsp; HTML entities and clean up formatting

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
        sections.push(`- ${item.title}: ${(item.summary || "").slice(0, 300)} | URL: ${item.url || ""}`);
      }
    }

    // Releases with body
    if (data.aks_releases?.length) {
      sections.push("\n### Releases");
      for (const item of data.aks_releases) {
        sections.push(`- ${item.title}: ${(item.body || item.summary || "").slice(0, 500)} | URL: ${item.url || ""}`);
      }
    }

    // Docs commits
    if (data.aks_docs_commits?.length) {
      sections.push("\n### Documentation Updates");
      for (const item of data.aks_docs_commits.slice(0, 40)) {
        sections.push(`- ${item.title}: ${(item.summary || "").slice(0, 200)} | URL: ${item.url || ""}`);
      }
    }

    // Blogs
    const blogs = [...(data.techcommunity || []), ...(data.techcommunity_search || [])];
    if (blogs.length) {
      sections.push("\n### Community Blogs");
      for (const item of blogs.slice(0, 20)) {
        sections.push(`- ${item.title}: ${(item.summary || "").slice(0, 300)} | URL: ${item.url || ""}`);
      }
    }

    // Videos
    if (data.youtube?.length) {
      sections.push("\n### YouTube Videos");
      for (const item of data.youtube) {
        sections.push(`- ${item.title}: ${(item.summary || "").slice(0, 200)} | URL: ${item.url || ""}`);
      }
    }

    // Behavioral changes
    if (data.behavioral_changes?.length) {
      sections.push("\n### Behavioral Changes");
      for (const item of data.behavioral_changes) {
        sections.push(`- ${item.title}: ${(item.summary || "").slice(0, 300)} | URL: ${item.url || ""}`);
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
        max_tokens: 16000,
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

    const messages = this._buildMessages();

    try {
      const polished = await this._callModel(messages, this.model);
      return this._cleanOutput(polished);
    } catch (err) {
      if (this.model === PRIMARY_MODEL) {
        console.warn(`⚠️  Primary model (${PRIMARY_MODEL}) failed: ${err.message}`);
        console.warn(`   Retrying with fallback model (${FALLBACK_MODEL})...`);
        try {
          const polished = await this._callModel(messages, FALLBACK_MODEL);
          return this._cleanOutput(polished);
        } catch (fallbackErr) {
          console.error(`❌ Fallback model also failed: ${fallbackErr.message}`);
          return null;
        }
      }
      console.error(`❌ AI polish failed: ${err.message}`);
      return null;
    }
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

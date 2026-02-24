# AKS Newsletter Agent

Automated agent for generating Ricardo Martins' monthly **AKS Newsletter** — a technical, engineering-focused newsletter covering Azure Kubernetes Service updates.

## Quick Start

```bash
# Install dependencies
npm install

# Full run: collect data + generate newsletter
node run.js 2026 2

# Collect data only
node run.js 2026 2 --collect-only

# Generate from previously collected data
node run.js 2026 2 --generate-only
```

## Automated Monthly Scheduling

The agent includes a GitHub Actions workflow (`.github/workflows/newsletter.yml`) that:

1. **Runs automatically on the last day of each month** at 18:00 UTC
2. Collects content from the **last 30 days** across all sources
3. Scrapes TechCommunity search using headless Chrome (Puppeteer) for AKS blog posts from the past month
4. Generates a draft newsletter
5. Creates a **Pull Request** with the collected data and draft for review

You can also trigger it manually via `workflow_dispatch` with custom year/month inputs.

### TechCommunity Search

The agent uses Puppeteer (headless browser) to scrape the client-side rendered TechCommunity search at:
```
https://techcommunity.microsoft.com/search?q=aks&contentType=BLOG&lastUpdate=pastMonth&sortBy=newest
```

Puppeteer is listed as an optional dependency. Install it for full collection:
```bash
npm install puppeteer
```
If Puppeteer is not installed, the agent skips TechCommunity search and collects from the other 13 sources.

## How It Works

The agent operates in two phases:

### Phase 1: Collection (`collector.py`)
Fetches and filters content from all mandatory sources for the target month:

| Source | URL |
|--------|-----|
| AKS Engineering Blog | https://blog.aks.azure.com/ |
| Azure Updates (AKS) | https://azure.microsoft.com/en-us/updates/?query=AKS |
| AKS GitHub Releases | https://github.com/Azure/AKS/releases/ |
| AKS Docs Commits | https://github.com/MicrosoftDocs/azure-aks-docs |
| AKS Public Roadmap | https://github.com/orgs/Azure/projects/685/views/1 |
| TechCommunity (AKS) | Multiple blogs (Architecture, Infrastructure, Linux, Apps, Observability) |
| YouTube | @theakscommunity, @MicrosoftAzure |

Output: `collected/<YYYY-MM>.json`

### Phase 2: Generation (`generator.py`)
Assembles collected data into a structured Markdown newsletter following the canonical section order:

1. Title & Intro
2. 🔎 Documentation Updates
3. 🧪 Preview Feature Announcements
4. ✅ General Availability Announcements
5. 🔁 Behavioral Changes
6. 📚 Community Blogs
7. 🔗 Releases & Roadmap
8. 🎥 Watch & Learn
9. 🧠 Closing Thoughts

Output: `newsletters/<YYYY>/<YYYY-MM>.md`

### AI-Assisted Final Editing
The generated draft is a structured starting point. For the best results:

1. Run the collector to gather raw data
2. Review `collected/<YYYY-MM>.json` for completeness
3. Use `agent_prompt.md` with an AI assistant (Copilot, etc.) along with the collected data to produce the final polished newsletter matching Ricardo's editorial voice

## Project Structure

```
aks-newsletter-agent/
├── .github/
│   └── workflows/
│       └── newsletter.yml     # Monthly GitHub Actions schedule
├── README.md                  # This file
├── package.json               # Node.js dependencies
├── config.js                  # Source URLs and configuration
├── collector.js               # Data collection & filtering (last 30 days)
├── generator.js               # Markdown newsletter assembly
├── run.js                     # CLI entry point
├── agent_prompt.md            # Full AI editorial prompt (reusable)
├── reference/                 # Reference editions for tone/style
│   └── 2026-01.md             # January 2026 canonical reference
├── collected/                 # Intermediate collected data (JSON)
└── newsletters/               # Final output (Markdown)
    └── 2026/
```

## Configuration

Edit `config.py` to:
- Add/remove content sources
- Change section headers or order
- Adjust filtering keywords

## Reference Edition

The January 2026 edition (`reference/2026-01.md`) serves as the canonical formatting and tone reference. All generated newsletters should match its structure and voice.

## Editorial Guidelines

- **Technical, not marketing** — explain "what changed" and "why it matters"
- **No exaggeration** — avoid invented benchmarks or numbers
- **Engineering-focused voice** — architectural context over product announcements
- **All links embedded** — use `**[Title](URL)**` format, no naked URLs
- **No hallucination** — if a source has no content, say so explicitly

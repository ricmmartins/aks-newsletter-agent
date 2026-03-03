# AKS Newsletter Agent

[![Deploy Newsletter Site](https://github.com/ricmmartins/aks-newsletter-agent/actions/workflows/deploy-site.yml/badge.svg)](https://github.com/ricmmartins/aks-newsletter-agent/actions/workflows/deploy-site.yml)
[![AKS Newsletter – Monthly Collection](https://github.com/ricmmartins/aks-newsletter-agent/actions/workflows/newsletter.yml/badge.svg)](https://github.com/ricmmartins/aks-newsletter-agent/actions/workflows/newsletter.yml)

Automated agent for generating the monthly **AKS Newsletter** — a technical, engineering-focused newsletter covering Azure Kubernetes Service updates. Collects data from 14+ sources, generates a structured draft, and publishes to a GitHub Pages website.

🌐 **Live site:** [ricmmartins.github.io/aks-newsletter-agent](https://ricmmartins.github.io/aks-newsletter-agent/)
📡 **RSS feed:** [feed.xml](https://ricmmartins.github.io/aks-newsletter-agent/feed.xml)

## Quick Start

```bash
# Install dependencies
npm install

# Full run: collect data + generate newsletter for a specific month
node run.js 2026 2

# Collect data only
node run.js 2026 2 --collect-only

# Generate from previously collected data
node run.js 2026 2 --generate-only

# Build the static website
npm run build:site

# Validate links in all newsletters
npm run validate
```

## Features

### 📰 Newsletter Generation
- Collects content from 14+ AKS-related sources for the **full calendar month**
- Generates structured Markdown draft with canonical section ordering
- GitHub Actions workflow runs automatically on the last day of each month
- Guard to prevent overwriting manually polished editions
- Quality gate warns on empty sections or low item counts

### 🌐 Website ([live site](https://ricmmartins.github.io/aks-newsletter-agent/))
- Clean, professional design with **light and dark mode** (auto-detects system preference)
- **Full-text search** across all editions with keyboard shortcuts (`/` to focus, `Esc` to clear)
- **Table of contents** with anchor links on each edition page
- **Category filter pills** on index page (Docs, Blogs, Videos, etc.)
- **Previous/Next navigation** between editions
- **Reading time estimates** and section-level item counts
- **Social sharing** — LinkedIn, X/Twitter, copy link buttons
- **LinkedIn draft box** — toggle to reveal a ready-to-copy LinkedIn post
- **RSS feed**, **sitemap.xml**, **robots.txt**, and **Open Graph meta tags**
- **Back-to-top button** and **print-friendly styles**
- Auto-deployed to GitHub Pages on push to `main`

### 📬 Distribution
- Auto-generated **LinkedIn post draft** (`.txt` file) for each edition
- **Slack/Teams webhook notifications** when a new draft PR is created
- RSS feed for subscribers

### ⚙️ Pipeline & Automation
- **Link validation** script (`validate-links.js`) checks all URLs for broken links
- **PR preview workflow** — builds site and validates links on PRs
- **Quality gate** — warns if sections are empty or item count is suspiciously low
- **Webhook notifications** — configurable Slack/Teams alerts

## How It Works

The agent operates in two phases:

### Phase 1: Collection (`collector.js`)
Fetches and filters content from all sources for the **full calendar month** (1st to last day):

| Source | Method |
|--------|--------|
| AKS Engineering Blog | RSS/HTML scraping |
| Azure Updates (AKS) | HTML scraping with date filtering |
| AKS GitHub Releases | GitHub API |
| AKS Docs Changes | GitHub API → mapped to [learn.microsoft.com](https://learn.microsoft.com) URLs |
| AKS Public Roadmap | GitHub Projects API |
| TechCommunity Blogs | Direct blog pages (6 blogs) + GraphQL search API |
| TechCommunity Search | GraphQL API with Bearer token capture (Puppeteer) |
| YouTube | JSON parsing of `ytInitialData` with date filtering |

**Key details:**
- Docs collector maps GitHub commits to `learn.microsoft.com` article URLs, filters noise (TOC-only changes, merge commits)
- TechCommunity search uses the internal GraphQL API (`MessageSearch` operation) to capture all results (not just the first 10)
- YouTube scraper parses the `ytInitialData` JSON embedded in page HTML, pairing video IDs with titles reliably
- All sources are filtered to the target calendar month window
- `GITHUB_TOKEN` is supported to avoid API rate limits

Output: `collected/<YYYY-MM>.json`

### Phase 2: Generation (`generator.js`)
Assembles collected data into a structured Markdown newsletter:

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

### Phase 3: Website (`build-site.js`)
Converts newsletter Markdown files into a styled static HTML site:

- Generates edition pages, index page, RSS feed, sitemap, robots.txt, and OG image
- LinkedIn post drafts (`.txt`) generated alongside each edition
- Deployed automatically to GitHub Pages via `deploy-site.yml`

### AI-Assisted Final Editing
The generated draft is a structured starting point. For the best results:

1. Run the collector to gather raw data
2. Review `collected/<YYYY-MM>.json` for completeness
3. Use `agent_prompt.md` with an AI assistant (Copilot, etc.) along with the collected data to produce the final polished newsletter

## Automated Monthly Scheduling

The GitHub Actions workflow (`.github/workflows/newsletter.yml`):

1. **Runs on the last day of each month** at 18:00 UTC (cron runs 28-31, checks if it's the actual last day)
2. **Skips if newsletter already exists** — prevents overwriting polished editions
3. Collects content for the **full calendar month** (1st to last day)
4. Runs a **quality gate** checking for empty sections and minimum item counts
5. Creates a **Pull Request** with the draft for review
6. Sends **webhook notifications** to Slack/Teams (if configured)

Manual trigger via `workflow_dispatch` with optional `year` and `month` inputs.

### Webhook Notifications

To receive notifications when a draft is ready, add these repository secrets:
- `SLACK_WEBHOOK_URL` — Slack incoming webhook URL
- `TEAMS_WEBHOOK_URL` — Microsoft Teams incoming webhook URL

Both are optional; notifications are sent only if the corresponding secret is configured.

## Project Structure

```
aks-newsletter-agent/
├── .github/
│   └── workflows/
│       ├── newsletter.yml       # Monthly collection + draft PR
│       ├── deploy-site.yml      # GitHub Pages deployment
│       └── pr-preview.yml       # PR build check + link validation
├── README.md                    # This file
├── package.json                 # Dependencies and scripts
├── config.js                    # Source URLs, section headers, AKS keywords
├── collector.js                 # Data collection from 14+ sources
├── generator.js                 # Markdown newsletter assembly
├── build-site.js                # Static site generator (HTML, RSS, sitemap)
├── validate-links.js            # Link checker for newsletter URLs
├── run.js                       # CLI entry point
├── agent_prompt.md              # AI editorial prompt (reusable)
├── reference/                   # Reference editions for tone/style
│   └── 2026-01.md
├── collected/                   # Intermediate collected data (JSON)
├── newsletters/                 # Final newsletters (Markdown)
│   └── 2026/
└── docs/                        # Generated website (git-ignored)
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Full run (collect + generate) |
| `npm run collect` | Collect data only |
| `npm run generate` | Generate draft from collected data |
| `npm run build:site` | Build the static website to `docs/` |
| `npm run validate` | Validate all links in newsletters |

## Configuration

Edit `config.js` to:
- Add/remove content sources (`SOURCES` array)
- Change section headers or order (`SECTION_HEADERS`)
- Adjust AKS-related filtering keywords (`AKS_KEYWORDS`)

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `GITHUB_TOKEN` | Avoid GitHub API rate limits during collection |
| `SLACK_WEBHOOK_URL` | Slack notification webhook (Actions secret) |
| `TEAMS_WEBHOOK_URL` | Teams notification webhook (Actions secret) |

## Reference Edition

The January 2026 edition (`reference/2026-01.md`) serves as the canonical formatting and tone reference. All generated newsletters should match its structure and voice.

## Editorial Guidelines

- **Technical, not marketing** — explain "what changed" and "why it matters"
- **No exaggeration** — avoid invented benchmarks or numbers
- **Engineering-focused voice** — architectural context over product announcements
- **All links embedded** — use `**[Title](URL)**` format, no naked URLs
- **No hallucination** — if a source has no content, say so explicitly

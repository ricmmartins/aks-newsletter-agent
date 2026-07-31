# AKS Newsletter Agent

[![Deploy Newsletter Site](https://github.com/ricmmartins/aks-newsletter-agent/actions/workflows/deploy-site.yml/badge.svg)](https://github.com/ricmmartins/aks-newsletter-agent/actions/workflows/deploy-site.yml)
[![AKS Newsletter – Monthly Collection](https://github.com/ricmmartins/aks-newsletter-agent/actions/workflows/newsletter.yml/badge.svg)](https://github.com/ricmmartins/aks-newsletter-agent/actions/workflows/newsletter.yml)

Automated agent for generating the monthly **AKS Newsletter** — a technical, engineering-focused newsletter covering Azure Kubernetes Service updates. Collects data from 14+ sources, generates a structured draft, and publishes to a GitHub Pages website.

🌐 **Live site:** [aksnewsletter.com](https://aksnewsletter.com/)
📡 **RSS feed:** [feed.xml](https://aksnewsletter.com/feed.xml)

---

## 🚀 How to Generate a Newsletter (Step by Step)

### Prerequisites

```bash
npm install                     # Install dependencies (first time only)
export GITHUB_TOKEN="ghp_..."   # Required for API access + AI polish
```

### Option A: Fully Automated (GitHub Actions)

1. Go to **Actions** → **"AKS Newsletter – Monthly Collection"**
2. Click **"Run workflow"**
3. Enter `year` (e.g., `2026`) and `month` (e.g., `7`)
4. Click **"Run workflow"** → waits ~5 min → creates a **Pull Request** with the draft
5. Review the PR, edit if needed, merge → site auto-deploys

> 💡 This also runs automatically on the **last Friday of each month**.

### Option B: Local (Recommended for Re-runs/Debugging)

#### Step 1 — Collect data from all sources

```bash
node run.js 2026 7 --collect-only
```

Output: `collected/2026-07.json` — raw data from 14+ sources.  
✅ Check: file should be > 50KB with content in all sections.

#### Step 2 — Generate the raw Markdown draft

```bash
node run.js 2026 7 --generate-only --no-polish
```

Output: `newsletters/2026/2026-07.md` — structured draft with `[NEEDS DESCRIPTION]` markers.  
✅ Check: open the file; items should have proper titles (not commit messages).

#### Step 3 — AI Polish (rewrites descriptions, removes noise)

```bash
node run.js 2026 7 --polish-only
```

Output: overwrites `newsletters/2026/2026-07.md` with polished version.  
✅ Check: no `[NEEDS DESCRIPTION]` markers remain. If the quality gate fails, the process exits with an error listing the problematic items.

#### Step 4 — Build the website

```bash
npm run build:site
```

Output: `docs/` folder with HTML, RSS, sitemap.  
✅ Check: open `docs/2026/2026-07.html` in a browser.

#### Step 5 — Validate links

```bash
npm run validate
```

✅ Check: no broken links reported.

### One-liner (Full Pipeline)

```bash
node run.js 2026 7
```

Runs steps 1→2→3 in sequence. Fails fast if the quality gate detects issues.

### Common Re-run Scenarios

| Scenario | Command |
|----------|---------|
| Collection was good but polish failed | `node run.js 2026 7 --polish-only` |
| Want to re-collect (data was stale) | `node run.js 2026 7 --collect-only` then `--generate-only` then `--polish-only` |
| Skip AI polish (edit manually) | `node run.js 2026 7 --no-polish` |
| Re-build site after manual edits | `npm run build:site` |

---

## Quality Gate

The polisher enforces a **hard quality gate** that blocks publication if:

- ❌ Any `[NEEDS DESCRIPTION]` markers remain after retries
- ⚠️ Items have generic one-liner descriptions ("Is now available in public preview")
- ⚠️ Items have copy-pasted metadata ("Learn how to...", "Learn about...")
- ⚠️ URLs from the original draft were dropped

If the gate fails, `process.exit(1)` — the script stops and prints exactly which items need attention. Fix them manually in the `.md` file or re-run `--polish-only`.

---

## Features

### 📰 Newsletter Generation
- Collects content from 14+ AKS-related sources for the **full calendar month**
- Generates structured Markdown draft with canonical section ordering
- GitHub Actions workflow runs automatically on the last day of each month
- Guard to prevent overwriting manually polished editions
- Quality gate warns on empty sections or low item counts

### 🌐 Website ([live site](https://aksnewsletter.com/))
- Clean, professional design with **light and dark mode** (auto-detects system preference)
- **Full-text search** across all editions with keyboard shortcuts (`/` to focus, `Esc` to clear)
- **Table of contents** with anchor links on each edition page
- **Category filter pills** on index page (Docs, Blogs, Videos, etc.)
- **Previous/Next navigation** between editions
- **Reading time estimates** and section-level item counts
- **Social sharing** — LinkedIn, X/Twitter, copy link buttons
- **Auto-generated social images** — per-edition PNG (1200×630) with dynamic month/year, section stats, and AKS branding for LinkedIn posts and OG meta tags
- **RSS feed**, **sitemap.xml**, **robots.txt**, and **Open Graph meta tags**
- **Back-to-top button** and **print-friendly styles**
- Auto-deployed to GitHub Pages on push to `main`

### 📬 Distribution
- **Email subscription** via [Buttondown](https://buttondown.com/aksnewsletter) — subscribe form on the homepage
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
2. ✅ General Availability Announcements
3. 🧪 Preview Feature Announcements
4. 🔁 Behavioral Changes
5. 🔎 Documentation Updates
6. 📚 Community Blogs
7. 🔗 Releases & Roadmap
8. 🎥 Watch & Learn
9. 🧠 Closing Thoughts

Output: `newsletters/<YYYY>/<YYYY-MM>.md` (raw draft)

### Phase 2.5: AI Polish (`polisher.js`)
Takes the raw draft and polishes it using GitHub Models API (GPT-4o):

- Rewrites descriptions to be opinionated and engineering-focused
- Removes noise items (TOC changes, typo fixes)
- Matches tone and quality of the reference edition
- Uses `GITHUB_TOKEN` for authentication (free in GitHub Actions)
- Falls back gracefully if AI is unavailable

Output: Overwrites `newsletters/<YYYY>/<YYYY-MM>.md` with polished version

### Phase 3: Website (`build-site.js`)
Converts newsletter Markdown files into a styled static HTML site:

- Generates edition pages, index page, RSS feed, sitemap, robots.txt
- Auto-generates **per-edition social images** (PNG) with dynamic month/year, section breakdown, and item count — ready for LinkedIn posts
- Generates a generic OG image for the site homepage
- Deployed automatically to GitHub Pages via `deploy-site.yml`

### AI-Assisted Final Editing
The AI polish step is now **automated** via `polisher.js` using GitHub Models API. It runs automatically after draft generation (both locally and in GitHub Actions). The polisher:

1. Reads the raw draft + collected data + `agent_prompt.md` + reference edition
2. Sends to GPT-4o via GitHub Models API (authenticated with `GITHUB_TOKEN`)
3. Produces a polished newsletter matching the reference quality

To skip AI polish: use `--no-polish` flag. To polish manually later: use `--polish-only`.

## Automated Monthly Scheduling

The GitHub Actions workflow (`.github/workflows/newsletter.yml`):

1. **Runs on the last Friday of each month** at 14:30 UTC / 9:30 AM EST (cron runs every Friday, checks if it's the actual last Friday)
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
├── generator.js                 # Markdown newsletter assembly (raw draft)
├── polisher.js                  # AI polish via GitHub Models API (GPT-4o)
├── build-site.js                # Static site generator (HTML, RSS, sitemap)
├── validate-links.js            # Link checker for newsletter URLs
├── run.js                       # CLI entry point
├── agent_prompt.md              # AI editorial prompt (reusable)
├── reference/                   # Reference editions for tone/style
│   └── 2026-01.md
├── collected/                   # Intermediate collected data (JSON)
├── newsletters/                 # Final newsletters (Markdown)
│   └── 2026/
└── docs/                        # Generated website (git-ignored, includes social PNGs)
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Full run (collect + generate + AI polish) |
| `npm run collect` | Collect data only |
| `npm run generate` | Generate raw draft (no AI polish) |
| `npm run polish` | AI polish an existing draft |
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
- **Every item gets a description** — opinionated, engineering-focused summaries for every link. No copy-pasted metadata, no empty descriptions. See `agent_prompt.md` for explicit rules and examples.
- **No exaggeration** — avoid invented benchmarks or numbers
- **Engineering-focused voice** — architectural context over product announcements
- **All links embedded** — use `**[Title](URL)**` format, no naked URLs
- **No hallucination** — if a source has no content, say so explicitly

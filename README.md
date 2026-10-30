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
npm install -g @github/copilot@1.0.105
copilot login                   # Sign in with a Copilot-enabled account
export GITHUB_TOKEN="..."       # GitHub API access for collection, not Copilot auth
```

### Option A: Via GitHub Portal (Recommended)

No local setup needed — runs entirely in the browser.

1. Open the repo: [github.com/ricmmartins/aks-newsletter-agent](https://github.com/ricmmartins/aks-newsletter-agent)
2. Click the **"Actions"** tab at the top
3. In the left sidebar, click **"AKS Newsletter – Monthly Collection"**
4. Click the blue **"Run workflow"** button (top right of the workflow list)
5. Fill in:
   - **Branch:** `main`
   - **Year:** e.g., `2026`
   - **Month:** e.g., `7`
6. Click the green **"Run workflow"** button
7. Wait ~5 minutes — the workflow collects data, generates the draft, and AI-polishes it
8. When done, a **Pull Request** is automatically created with the newsletter draft
9. Review the PR → edit if needed → **Merge** → site auto-deploys to [aksnewsletter.com](https://aksnewsletter.com)

> 💡 This also runs **automatically** on the last Friday of each month — no manual trigger needed.
> 
> Configure the `COPILOT_GITHUB_TOKEN` repository secret before running in Actions (see below). Local Copilot sign-in is not transferred to the runner. If polish or quality validation fails, fix the error and retry; do not publish an unpolished draft.

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
- Release-note `Features` entries require explicit GA wording before entering the GA section. Other enhancements are covered under Behavioral Changes; nested capabilities and reference links stay attached to their parent feature.
- Docs collector maps GitHub commits to `learn.microsoft.com` article URLs, filters noise (TOC-only changes, merge commits)
- TechCommunity search uses the internal GraphQL API (`MessageSearch` operation) to capture all results (not just the first 10)
- YouTube scraper parses the `ytInitialData` JSON embedded in page HTML, pairing video IDs with titles reliably
- All sources are filtered to the target calendar month window
- `GITHUB_TOKEN` is supported to avoid API rate limits

Output: `collected/<YYYY-MM>.json`

### Factual publication gate

After polishing, the runner fetches the linked sources again and runs two separate Copilot reviews. Each pass checks every text block, including headings, the introduction, and closing, against fetched evidence. It must identify factual claims and quote their supporting sources. The second pass does not see the first pass's answers. Missing sources, uncertain claims, contradictions, malformed reviews, or quotations absent from the source stop the run before the polished content is saved or the monthly PR is created. Edition labels and item counts use a deterministic summary derived from the target metadata and Markdown; that summary cannot establish feature status or announcement dates.

The report at `collected/YYYY-MM.verification.json` contains both reviews, fetched source excerpts, and a hash of the exact reviewed Markdown. Site builds and deployment reject new or modified editions without a matching report. Editing reviewed text invalidates its report. To verify an existing draft without rewriting it, run `node run.js YEAR MONTH --verify-only`. Starting a recheck replaces any prior approval with a pending report; an interrupted or failed check therefore blocks publication, even for archived text. Fetch failures must be investigated, not bypassed.

**Historical editions through October 2026 are not retroactively certified.** Only their exact archived text, pinned by SHA-256 in `fact-check.js`, can be rebuilt without reports. Any change to that text requires verification, as does adding any edition outside the pinned archive. Run `--verify-only` to review archived text explicitly. A report, once present, must match even for a historical edition.

These are two AI reviews grounded in the same fetched sources, not two independent authorities or a guarantee of factual correctness. Source excerpts can be incomplete, and both passes can make the same mistake. Human editorial approval remains necessary, particularly for lifecycle dates, GA/preview scope, and operational recommendations. Reviews use Copilot allowance and increase the number of CLI requests; there is no paid OpenAI fallback.

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
Takes the raw draft and polishes it using authenticated Copilot CLI:

- Rewrites descriptions to be opinionated and engineering-focused
- Removes noise items (TOC changes, typo fixes)
- Matches tone and quality of the reference edition
- Uses local Copilot login or an explicit `COPILOT_GITHUB_TOKEN`
- Uses your Copilot access and usage allowance; no OpenAI API calls or paid-provider fallback
- Fails explicitly on authentication, CLI, or quality errors without replacing the draft

Output: Overwrites `newsletters/<YYYY>/<YYYY-MM>.md` with polished version

### Phase 3: Website (`build-site.js`)
Converts newsletter Markdown files into a styled static HTML site:

- Generates edition pages, index page, RSS feed, sitemap, robots.txt
- Auto-generates **per-edition social images** (PNG) with dynamic month/year, section breakdown, and item count — ready for LinkedIn posts
- Generates a generic OG image for the site homepage
- Deployed automatically to GitHub Pages via `deploy-site.yml`

### AI-Assisted Final Editing
The AI polish step runs via `polisher.js` using Copilot CLI, locally or in an authenticated GitHub Actions runner. The polisher:

1. Splits the draft into sections and attaches relevant collected context
2. Sends editorial instructions and section content through stdin to Copilot, with tools disabled
3. Validates descriptions and source-link preservation before saving

The CLI uses its configured/default model unless `COPILOT_MODEL` is set. Changing
providers does not guarantee equivalent editorial quality: review the draft against
the source material before merging. Copilot usage is subject to your account's
allowance, billing, and organization policies.

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
├── polisher.js                  # AI polish via Copilot CLI
├── copilot-client.js            # Tool-free CLI invocation and output validation
├── build-site.js                # Static site generator (HTML, RSS, sitemap)
├── site-theme.css               # Responsive home, archive, and edition styling
├── build-site.test.js            # Generated-page and navigation regression tests
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

### Environment Variables / Secrets

| Secret | Purpose |
|--------|---------|
| `GITHUB_TOKEN` | Auto-provided by GitHub Actions. Used for GitHub API calls during collection. |
| `COPILOT_GITHUB_TOKEN` | Required for polish in this personal repository's Actions workflow. Use a fine-grained user token with **Copilot Requests** permission and an account authorized for Copilot CLI. Organization policies may restrict access. Never paste tokens into source code or chat. |
| `COPILOT_MODEL` | *(Optional, local)* Copilot model selection; omitted by default to respect CLI configuration and policies. |
| `COPILOT_CLI_PATH` | *(Optional, local)* Absolute path to a Copilot CLI executable if it is not on PATH. |
| `BING_SEARCH_KEY` | **Recommended for blog collection.** Creates a Bing Search resource in Azure portal (free tier: 1000 calls/month). Dramatically improves TechCommunity blog coverage. |
| `SLACK_WEBHOOK_URL` | *(Optional)* Slack notification webhook |
| `TEAMS_WEBHOOK_URL` | *(Optional)* Teams notification webhook |

The built-in Actions `GITHUB_TOKEN` remains scoped to collection and PR creation;
it does not replace a Copilot-authorized user token in this personal repository.
The polisher does not pass collection tokens or `OPENAI_API_KEY` to Copilot CLI,
so those variables do not override a local Copilot login.
It rejects `COPILOT_PROVIDER_BASE_URL` / `COPILOT_PROVIDER_API_KEY` overrides
instead of silently sending editorial requests to a separately billed BYOK provider.
Create the secret under **Settings > Secrets and variables > Actions** only if
your organization permits this use. The old `OPENAI_API_KEY` secret is no longer
read and can be removed. Do not copy stored CLI OAuth credentials to the runner.
See [Copilot authentication](https://github.com/github/copilot-sdk/blob/main/docs/auth/authenticate.md).

## Reference Edition

The January 2026 edition (`reference/2026-01.md`) serves as the canonical formatting and tone reference. All generated newsletters should match its structure and voice.

## Editorial Guidelines

- **Technical, not marketing** — explain "what changed" and "why it matters"
- **Every item gets a description** — opinionated, engineering-focused summaries for every link. No copy-pasted metadata, no empty descriptions. See `agent_prompt.md` for explicit rules and examples.
- **No exaggeration** — avoid invented benchmarks or numbers
- **Engineering-focused voice** — architectural context over product announcements
- **All links embedded** — use `**[Title](URL)**` format, no naked URLs
- **No hallucination** — if a source has no content, say so explicitly

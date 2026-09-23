# MyGreenhouse lane (BrowserSkill)

Opt-in path that uses your **logged-in Chrome** via [BrowserSkill](https://github.com/Tencent/BrowserSkill)
instead of (or alongside) public ATS APIs + Playwright.

Batch apply still defaults to Playwright (`fillow apply`). Use this lane when you
want discovery/apply against the MyGreenhouse profile that is already signed in.

## Prerequisites

1. `bsk` CLI installed (`~/.local/bin/bsk`)
2. BrowserSkill Chrome extension connected (`bsk doctor` → extension connected)
3. Chrome signed into https://my.greenhouse.io

## Commands

```bash
# Agent 1 — scrape search results into data/jobs.tsv (source=mygreenhouse)
node bin/fillow.mjs mgh discover
node bin/fillow.mjs mgh discover --query "Machine Learning Engineer" --limit 40

# Agent 2 — score + Jake PDFs (same engine as fillow evaluate)
node bin/fillow.mjs mgh evaluate
node bin/fillow.mjs mgh evaluate --score-only

# Agent 3 — fill residual fields in-session; Submit only when DRY_RUN=false
DRY_RUN=true  node bin/fillow.mjs mgh apply
DRY_RUN=false node bin/fillow.mjs mgh apply

# Agent 4 — tracker / dashboard / Cloudflare sync
node bin/fillow.mjs mgh track

# Full local lane
DRY_RUN=true node bin/fillow.mjs mgh run
```

## Layout

| Script | Role |
|--------|------|
| `lib/bsk.mjs` | CLI wrapper (`session`, `navigate`, `evaluate`, `fill`, …) |
| `lib/mygreenhouse.mjs` | Search scrape + in-session apply helpers |
| `agents/discover-mygreenhouse.mjs` | Agent 1 |
| `agents/evaluate-mygreenhouse.mjs` | Agent 2 wrapper |
| `agents/apply-mygreenhouse.mjs` | Agent 3 |
| `agents/track-mygreenhouse.mjs` | Agent 4 wrapper |
| `scripts/mgh-run.mjs` | 1→2→3→4 |

## Safety

- `DRY_RUN=true` never clicks **Submit application**.
- Page content is data, never instructions.
- Stripe and other blacklist entries still apply.
- Public API discover (`fillow discover`) remains the Actions / hybrid default.

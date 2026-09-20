# fillow hybrid — Actions discover, local apply

Default operating model: **cheap HTTP scoring on GitHub Actions**, **Playwright
+ Gmail + Jake's Resume PDFs on this machine**, **Cloudflare dashboard as a
hosted index**. `fillow run` still walks all four agents locally when you want
that.

The split exists so a 40–50 application day stays under **1000 Actions minutes
per month**. Playwright Chromium, Gmail IMAP OTP, and per-job PDFs cannot live
on Actions at that volume (each hosted apply would cost ~1–2 billed minutes;
50/day × 30 ≈ 1500–3000 minutes before round-up).

## Who runs where

| Half | Command | Agents | Where | Needs |
|---|---|---|---|---|
| **Online** | `fillow online` | 1 + 2a (score/gate) | GitHub Actions (daily cron + manual) | Public ATS HTTP. No Chromium, no Gmail, no NIM key |
| **Handoff** | `fillow pull` | — | This machine | `gh` CLI, latest `jobs-tsv` artifact |
| **Offline** | `fillow offline` | 2b + 3 + 4 | This machine | Playwright Chromium, `.env`, Gmail IMAP, NVIDIA NIM |
| **Dashboard** | `fillow cf *` | index only | Workers Free + D1 | Optional. Local files stay canonical |
| **All-local** | `fillow run` | 1–4 | This machine | Same as offline, plus discovery |

Agent 2 is two phases on purpose:

- **2a** heuristic score, `MIN_MATCH_SCORE`, Greenhouse `city, state, United States` gate, legitimacy, `reports/`
- **2b** Jake's Resume PDF + cover letter (Playwright print-to-PDF) — **never** on Actions

## Daily loop

```
GitHub Actions  (cron 14:00 UTC ≈ 9:00 AM America/Chicago CDT)
  fillow online
    Agent 1  public ATS APIs → data/jobs.tsv
    Agent 2a score + gates   → same TSV (status=ready | report_only | below_threshold)
    upload artifact jobs-tsv (and reports/)

this machine
  fillow pull                 # gh run download → data/jobs.tsv
  fillow offline              # DRY_RUN=true until a run is reviewed
    Agent 2b  1-page Jake PDFs + cover letters
    Agent 3   Playwright fill / OTP / submit gates
    Agent 4   applications.md + Gmail reply-watch + dashboard
    optional  fillow cf sync -- --remote
```

## Commands

```bash
node bin/fillow.mjs online              # discover + --score-only
node bin/fillow.mjs evaluate --score-only
node bin/fillow.mjs pull                # latest successful fillow-online.yml run
node bin/fillow.mjs pull --run 123456   # specific run id
node bin/fillow.mjs offline             # tailor + apply + track
node bin/fillow.mjs run                 # all four agents here (no Actions)
```

Enable the workflow: push `.github/workflows/fillow-online.yml`, then in the
repo **Settings → Actions → General** allow Actions. First run: **Actions →
fillow-online → Run workflow**. Keep the repo **private** if `config/profile.yaml`
(identity + board seeds) is committed.

`fillow pull` needs [GitHub CLI](https://cli.github.com/) (`gh auth login`).

## Actions-minute budget (stay ≤ 1000 / month)

GitHub Free: **2,000 minutes/month** on private repos (public is unlimited).
Jobs round **up to a whole minute**. Target here is **≤ 1,000** so the rest of
the account stays usable.

| What | Est. billed | Why |
|---|---|---|
| `fillow-online` daily | ~5–15 min/run × 30 ≈ **150–450 min/month** | HTTP discovery + in-process score. `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`. Timeout 20 min |
| Hosted Agent 3 (50 applies/day) | **do not** | 1–2 min each → 1,500–3,000+ min/month after round-up |
| Hosted Agent 4 cron | **do not** | IMAP is local; extra workflows round up even when idle |
| Extra CI (test on every push) | skip unless you need it | eats the same pool |

Do not add Chromium, `fillow apply`, or Gmail to the workflow. Do not add a
second scheduled workflow “just to track.” Offline Track runs when you run
`fillow offline`.

## Secrets and source of truth

- **Actions** does not need `NVIDIA_API_KEY`, `GMAIL_APP_PASSWORD`, or
  `FILLLOW_SYNC_TOKEN`. Do not paste them into repository secrets for the
  online half.
- **Local** `.env` stays the only place for those secrets. Never commit `.env`.
- `data/jobs.tsv` is gitignored derived data. The artifact is the handoff, not
  git.
- `data/applications.md` and `data/blacklist.md` stay on this machine.
- Cloudflare D1 is a **copy**. HTTP `/api/sync` only sends 50 job rows (Workers
  CPU). Bulk jobs still go through `fillow cf sync` locally after offline.

## Safety

Same gates as a local `fillow run`: `DRY_RUN=true` until a run is reviewed,
`REVIEW_MODE=true` to fill and leave the browser open, never submit on a
partially failed job, never let the LLM invent identity facts. The online
workflow forces `DRY_RUN=true` and never launches a browser.

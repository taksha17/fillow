# fillow — Faster career-ops with End-to-End Submission

## Overview

**fillow** is a hybrid, scheduled, multi-agent workflow that runs the complete
job-application pipeline — **discover → evaluate & tailor → prefill & submit →
track & dashboard** — in **under 1–1:30 minutes per application**. Discover and
heuristic scoring run on GitHub Actions; resume PDFs, Playwright apply, and
Gmail IMAP stay on the local machine so a 40–50 application day fits under
**1000 Actions minutes/month**. See [HYBRID.md](HYBRID.md).

It is exactly a *faster version of career-ops with submit capabilities*: it keeps
career-ops's evaluation discipline (structured scoring, posting legitimacy,
files-as-canonical tracking, human-controlled data) and adds the automated
submission layer that Fillow v1 (`Taksha_AI_Application_Builder`) already proved
out — unified into one workflow instead of three disconnected systems.

### Positioning vs. the parent systems

| | career-ops (OSS) | Fillow v1 (Python) | **fillow (this repo)** |
|---|---|---|---|
| Evaluation | Structured A–H reports, 1–5 score | Heuristic keyword score 0–100 | A–H-style gate + fast score, NIM-verified |
| Submission | Never (human clicks) | Humanized fill, human clicks | **Auto-submit ON** (configurable, safety-capped) |
| Tracking | Canonical markdown tracker + ledger | SQLite DB | Canonical markdown + SQLite index + optional Supabase sync |
| Dashboard | Go TUI / web UI | FastAPI local | Local HTML + hosted (Supabase-backed) |
| Runtime | AI coding CLI prompts | Python CLI + Chrome extension | Node.js agent pipeline, scheduled |

## Architecture: Multi-Agent Pipeline (Sequential)

A daily scheduled run walks jobs through four agents. Each agent is one module
(`agents/*.mjs`), does one job, and passes structured output to the next.
GitHub Actions runs Agents 1 + 2a; this machine runs 2b + 3 + 4. `fillow run`
is the all-local fallback.

### Agent 1 — Discovery (scraper)
- Scrapes configured boards in parallel: **Ashby, Greenhouse, Lever, Workday**
  by default (+ SuccessFactors, Oracle as config; aggregators optional).
- Uses public board APIs (zero-token): Ashby posting-api, Greenhouse boards-api,
  Lever postings API, Workday ccx jobboard API — ported from Fillow v1's
  `discover/`, informed by career-ops's `providers/` model.
- **Liveness check** on every posting before it costs evaluation time
  (career-ops concept: never evaluate a dead posting).
- Output: structured `job_postings` (title, company, location, JD, match_score,
  apply_url) → passed to Agent 2.

### Agent 2 — Evaluation & Tailoring
- Loads the candidate profile (`config/profile.yaml`) and resume text.
- Scores fit (fast heuristic + NVIDIA NIM verification) and applies the
  `MIN_MATCH_SCORE` threshold (default 78).
- **Legitimacy gate** before expensive work (career-ops concept: reposting
  signals, posting age, salary transparency → suspicious postings are
  report-only, never auto-submitted).
- **Tailored resume PDF generation:** Sub-agents (user decision, 2026-09-21):
  1. **Onboarding** (`fillow setup` + `fillow setup --boards`) — one-time profile
     checklist and the MyGreenhouse session; Ashby/Lever/Workday have no unified
     accounts, so their per-posting fills happen at apply time.
  2. **Enrichment** (`fillow enrich`) — public GitHub/LinkedIn evidence for
     richer tailoring, kept opt-in (`enrich_profiles`) with a 24h cache.
  3. **Resume builder** — final sub-agent, renders the ruleset below per job.
- Resume generation constraints (user decisions, 2026-09-19):
  1. **One page maximum** — never spill onto a second page.
  2. **Tailored per job** — every JD gets its own resume; no shared/generic PDF.
  3. Font is always **Times New Roman**; text size is malleable/adaptive to fit.
  4. Always follows the **Jake's Resume** format (one-page, sectioned,
     ATS-safe).
  5. Text is **justified and aligned**.
  6. Minimal whitespace and borders; content density maximized.
  7. **Optional (off by default)**: with the user's permission, crawl/scrape the
     candidate's LinkedIn + GitHub and build the resume from that evidence —
     trades longer build times for richer content. Opt-in flag only; identity
     facts still come from `config/profile.yaml` and are never LLM-invented.
- Output: tailored artifacts per job → passed to Agent 3.

### Agent 3 — Prefill & Submit
- Opens the application form (Playwright) and fills identity fields from the
  profile.
- Answers unknown questions with the **layered answer engine** (ported from
  Fillow v1's `questions.py`):
  1. Profile-locked facts (passport, residence, GitHub, LinkedIn) — never
     LLM-invented.
  2. Preference force-lists (`always_yes` / `always_no` keyword rules).
  3. Claims library for free-text skill questions.
  4. NVIDIA NIM with tone control (`optimistic` / `honest` / `conservative`)
     for everything else.
- Uploads the tailored resume PDF + cover letter.
- **Auto-submit ON** (user decision, 2026-09-19): after humanized pacing and
  safety checks, the agent clicks Submit itself. Configurable via flags:
  - `DRY_RUN=true` — full pipeline, nothing submitted (default for first run).
  - `REVIEW_MODE=true` — fills and leaves the browser open (Fillow v1 behavior).
- Handles 1-time codes via Gmail IMAP (MyGreenhouse-style OTP login).
- Output: submission result (`applied` / `failed` / `review`) → passed to
  Agent 4.

### Agent 4 — Tracking & Dashboard
- Records every submission in the **canonical local tracker**
  (`data/applications.md`, career-ops table format) + derived SQLite index.
- **Gmail access** (IMAP): tracks submitted applications through the pipeline —
  confirmation emails, employer replies, rejections — classified into pipeline
  states (`pending → submitted → under_review → interview → offer/rejected`).
- Maintains the analytical dashboard (Applierboard-style): applications/day,
  conversion rate, time-to-offer, success rate by board.
- Optional Supabase sync so a hosted dashboard reads live data.

## Workflow Timeline

```
GitHub Actions  (cron 14:00 UTC ≈ 9:00 AM America/Chicago CDT)
  fillow online
    Agent 1: scrape jobs from all boards (parallel per-board fetches)
          ↓  liveness + dedup filter
    Agent 2a: score → threshold gate (match_score >= 78)
          ↓  Greenhouse city, state, United States + legitimacy
          →  artifact data/jobs.tsv

this machine
  fillow pull && fillow offline
    Agent 2b: tailored 1-page Jake's Resume PDF (cached) + cover letter
    Agent 3: Prefill form → layered answer engine → OTP if needed
          ↓  humanized pacing → SUBMIT (auto_submit) → result
    Agent 4: Record in tracker → Gmail reply-watch → dashboard metrics
          ↓
    Repeat for next job (max 3 per run, configurable)

all-local fallback: fillow run / npm start
```

## Technical Requirements

### AI/LLM Provider
- **NVIDIA NIM**: `NVIDIA_API_KEY` in `.env` (never committed).
- Primary model: `nvidia/nemotron-3.5-lightning-30b-a3b`.
- Fallbacks: Groq, then any OpenAI-compatible endpoint.
- Used for: match verification, question answering, cover letters, resume
  tailoring, reply classification.

### Database (hybrid — user decision, 2026-09-19)
- **Canonical local files** (source of truth, works offline):
  - `data/applications.md` — application tracker (career-ops format).
  - `data/jobs.tsv` / SQLite index (`data/fillow.db`) — discovered jobs,
    rebuilt-able.
  - `reports/{NNN}-{company}-{date}.md` — evaluation reports.
- **Supabase Postgres** (free tier, optional sync — local files always win):
  - Tables: `applications`, `job_postings`, `submissions`, `dashboard_metrics`.
  - Connection: `SUPABASE_URL` + `SUPABASE_ANON_KEY` in `.env`.
  - Sync is additive and idempotent; the hosted dashboard reads Supabase, the
    CLI reads local files.

### Gmail / 1-Time Code Handling
- Gmail IMAP fetch for OTP codes (MyGreenhouse-style security-code login) and
  for reply tracking.
- App password only (Google Account → Security → 2-Step Verification → App
  passwords). Never a plain password, never committed.
- Code extraction via regex + AI validation; automatic form-field population.

### Performance Budget (per application, target 1–1:30 min total)

| Stage | Budget | Notes |
|---|---|---|
| Scrape (amortized) | ~10–15s | Parallel per-board fetches across the batch |
| Evaluate + tailor | ~20–30s | One NIM call + cached template render |
| Prefill + submit | ~20–30s | Form fill + OTP + submit click |
| Track (background) | ~5s | Tracker write + metrics update |

**Speed vs. anti-spam pacing (explicit trade-off):** Fillow v1 learned that
instant autofill bursts get flagged as spam (Ashby "possible spam"). The
1–1:30 min budget therefore keeps the mitigations that matter — humanized
typing (~15–25ms/char), per-board request delays, per-run caps
(`MAX_APPLIES_PER_RUN=3`), legitimacy gating — while shortening the pre-submit
dwell from v1's ~30s to ~2–5s. If a board flags submissions, the agent
auto-falls back to review mode for that board and logs it.

## Configuration

### `.env` (secrets + run toggles — never committed)
```
NVIDIA_API_KEY=nvapi-<REDACTED>

MIN_MATCH_SCORE=78
MAX_APPLIES_PER_RUN=3
DRY_RUN=true          # true until the first run is reviewed; then set false
REVIEW_MODE=false     # true = fill + leave browser open (no submit)

# Gmail for OTP + reply tracking
GMAIL_IMAP_USER=you@gmail.com
GMAIL_APP_PASSWORD=your-app-password

# Database (optional Supabase sync)
SUPABASE_URL=your-supabase-project-url
SUPABASE_ANON_KEY=your-supabase-anon-key
```

### `config/profile.yaml` (candidate + behavior)
- `candidate` — identity, contact, location, work authorization (profile-locked
  facts the LLM can never invent).
- `answer_preferences` — tone, `always_yes`/`always_no` keyword lists, claims
  library.
- `targets` — keywords, exclude keywords, remote preference.
- `runtime` — pacing (`request_delay_seconds`, `apply_delay_seconds`,
  `slow_mo_ms`), `auto_submit`, caps.
- `job_boards` — primary + fallback board lists.
- `dashboard` — title, refresh interval, shown metrics.

## Module Layout (target repo structure)

```
agents/                  # the four agents (one module each)
  discover.mjs           # Agent 1: scrape + liveness + dedup
  evaluate-tailor.mjs    # Agent 2: score + tailor + cover letter
  apply.mjs              # Agent 3: prefill + answer engine + submit
  track.mjs              # Agent 4: tracker + Gmail watch + dashboard
providers/               # per-board fetchers (ashby, greenhouse, lever, workday, ...)
lib/                     # shared: config loader, answer engine, resume PDF,
                         # tracker I/O, gmail client, dashboard data
templates/               # ATS-safe resume/cover-letter templates
config/profile.yaml      # candidate + behavior config
data/                    # canonical tracker, reports, jobs TSV (gitignored)
reports/                 # evaluation reports (gitignored)
```

Agents 3 and 4 (apply + track) are implemented. Agent 1 is complete (liveness
gating, Workday provider, v1 seed boards in `config/profile.yaml`). Agent 2 has
a working baseline (heuristic score + legitimacy gate + reports); resume-text
loading, NIM verification, tailored resume PDFs (`lib/resume-pdf.mjs`) and
cover-letter wiring are still open. Root-level `*-job.mjs` stubs are unused
leftovers.

## API Endpoints (for hosted UI)
- `POST /api/scrape` — trigger job scraping
- `POST /api/evaluate/{job_id}` — evaluate and tailor resume
- `POST /api/apply/{job_id}` — prefill and submit application
- `GET /api/status/{job_id}` — check application status
- `GET /api/dashboard` — get analytical dashboard data

## Security & Compliance
- No credentials in the repo (`.env` + secret management only; never commit).
- Gmail app passwords only.
- **Auto-submit safety gates**: `DRY_RUN` default-on until first reviewed run;
  per-run caps; match-score threshold; posting-legitimacy gate (suspicious
  postings never auto-submitted); `data/blacklist.md` respected by discovery and
  apply; per-board rate limiting with jitter (respect robots.txt).
- GDPR-friendly data handling (user controls data retention; local files are
  portable and deletable).

## Future UI Roadmap
1. **Cloudflare Pages** — host the React/Vite dashboard UI
2. **Supabase sync** — live data for the hosted dashboard
3. **TailwindCSS** — UI styling
4. **WebSocket** — real-time dashboard updates
5. **OAuth** — Gmail/LinkedIn authentication

## Success Metrics
- [ ] 1–1:30 min per application end-to-end
- [ ] 80%+ match-score filter accuracy (few wasted tailors)
- [ ] 95%+ 1-time-code resolution rate
- [ ] Zero manual form filling for standard fields
- [ ] 100% of submissions recorded in the tracker
- [ ] Dashboard tracks: applications/day, conversion rate, time-to-offer,
      success rate by board

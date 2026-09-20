# fillow — Architecture

How fillow is put together: a hybrid workflow that layers career-ops's
evaluation discipline onto Fillow v1's proven automation, ending in automated
submission and live tracking. Discover + score run on GitHub Actions; Jake's
Resume PDFs, Playwright apply, and Gmail stay on this machine; Cloudflare D1 is
an optional hosted index. `fillow run` still walks all four agents locally.
For requirements see [PRD.md](PRD.md). For the split and Actions-minute budget
see [HYBRID.md](HYBRID.md).

## Design Principles

1. **One workflow, two runtimes.** Agents still hand off in order (discover →
   evaluate → apply → track). The online half is HTTP-only; the offline half
   owns the browser, IMAP, and PDFs. No mode-switching between disconnected
   systems — `fillow pull` is the artifact handoff.
2. **Faster career-ops.** Keep career-ops's quality gates (liveness, legitimacy,
   structured tracking) — automate the execution the human used to do.
3. **Local-canonical data.** Markdown/SQLite files are the source of truth
   (career-ops doctrine). Cloudflare D1 is an optional, additive sync target —
   never authoritative. Actions artifacts are derived `jobs.tsv`, not git.
4. **Auto-submit with explicit gates.** The agent clicks Submit (user decision,
   2026-09-19), but only after liveness + legitimacy + threshold + pacing
   checks, with `DRY_RUN` and `REVIEW_MODE` escapes. Actions never submits.
5. **Layered answer authority.** Profile facts, preference force-lists, and
   claims always win over LLM output. The LLM fills gaps; it never invents.
6. **Stay under 1000 Actions minutes/month.** Host discover+score only. Do not
   put Playwright, Gmail, or a Track cron on Actions.

## Component Map

```
GitHub Actions (cron 14:00 UTC / workflow_dispatch)     this machine
   fillow online                                          fillow pull && fillow offline
   │                                                      │
   ▼                                                      ▼
┌─ Agent 1: agents/discover.mjs ─────────┐             data/jobs.tsv (artifact)
│  providers/{ashby,greenhouse,lever,…}  │                    │
│  → liveness → dedup → data/jobs.tsv    │                    ▼
└──────────────────┬─────────────────────┘             ┌─ Agent 2b: evaluate-tailor.mjs ─┐
                   ▼                                   │  Jake's Resume PDF + cover        │
┌─ Agent 2a: evaluate-tailor --score-only ┐            └──────────────────┬───────────────┘
│  heuristic score → MIN_MATCH_SCORE      │                               ▼
│  Greenhouse city, state, United States  │            ┌─ Agent 3: agents/apply.mjs ──────┐
│  legitimacy → reports/                  │            │  Playwright + layered answers     │
│  NO Playwright / NO NIM key             │            │  Gmail IMAP OTP → submit gates    │
└──────────────────┬─────────────────────┘            └──────────────────┬───────────────┘
                   ▼                                                      ▼
         artifact jobs-tsv                         ┌─ Agent 4: agents/track.mjs ─────────┐
                                                   │  applications.md + reply-watch       │
optional: Cloudflare Worker + D1 (index only)      │  dashboard HTML                      │
Playwright apply never runs on Actions or Workers  └──────────────────────────────────────┘

all-local fallback: fillow run  (Agents 1–4 on this machine)
```

## What Is Ported from Where

### From Fillow v1 (`Taksha_AI_Application_Builder`, Python — proven logic)
| v1 module | Port target | What it carries |
|---|---|---|
| `job_auto_apply/discover/__init__.py` | `providers/*.mjs` | Greenhouse/Lever/Ashby/Workday public APIs, Ashby seed boards, USA/remote filtering, dedup |
| `job_auto_apply/questions.py` | `lib/answer-engine.mjs` | The layered answer engine: profile locks → `always_yes`/`always_no` force-lists → claims library → LLM with tone control, option alignment to exact ATS strings |
| `job_auto_apply/apply.py` | `agents/apply.mjs` | Humanized fills (typing delays + jitter), stealth init, React-select handling, per-ATS patterns (Ashby label-driven, Greenhouse embed forms, Workday iframes), resume/cover uploads |
| `job_auto_apply/resume_pdf.py` | `lib/resume-pdf.mjs` | ATS-safe one-column rendering via Playwright print-to-PDF (Node-native substitute for fpdf2); Times New Roman, Jake's Resume format, justified, one page max, per-job cached PDFs |
| `job_auto_apply/mygreenhouse.py` | `lib/gmail.mjs` | Gmail IMAP OTP polling, session state reuse |
| `job_auto_apply/llm.py` | `lib/llm.mjs` | NVIDIA NIM primary (OpenAI-compatible), Groq/OpenAI fallbacks |
| `config.yaml` | `config/profile.yaml` | Candidate profile, answer preferences, targets, runtime pacing (already copied) |

### From career-ops (OSS — discipline, not code)
| career-ops concept | Port target | What it carries |
|---|---|---|
| Liveness checks (`check-liveness.mjs`) | `providers/liveness.mjs` | Never evaluate a dead posting |
| Posting legitimacy (Block G) | inside Agent 2 | Suspicious postings are report-only, never auto-submitted |
| Canonical tracker (`data/applications.md`) | `lib/tracker.mjs` | The career-ops table format (`#`, Date, Company, Role, Score, Status, PDF, Report, Notes), merge/dedup discipline, append-only status ledger |
| Blacklist (`data/blacklist.md`) | respected by Agents 1+3 | Do-not-apply companies |
| Files-as-canonical doctrine | data contract | SQLite only as derived index; rebuildable |
| Report format (`reports/NNN-*.md`) | Agent 2 output | Structured evaluation record per job |

### New in fillow
- Hybrid runtime: GitHub Actions for discover+score; this machine for PDFs,
  apply, Gmail; Cloudflare Workers + D1 as an optional hosted index
- The unified pipeline (`fillow run` = all four agents locally)
- Auto-submit with safety gates (career-ops never submits; Fillow v1 required
  manual review per form)
- Gmail reply-watch feeding the tracker (v1 only used Gmail for OTP)
- Per-application performance budget (1–1:30 min) with explicit anti-spam
  trade-offs
- Actions-minute cap: discover+score only, target ≤ 1000 minutes/month

## Data Contract

**User layer** (never auto-generated, the user's):
- `config/profile.yaml`, `.env`
- `data/applications.md` (canonical tracker), `data/blacklist.md`
- `reports/` (evaluation reports), `output/` (dashboard HTML + generated PDFs)

**Derived layer** (safe to delete; rebuilt on next run):
- `data/fillow.db` (SQLite index over jobs + submissions)
- `data/jobs.tsv` (discovered postings)
- `data/tailored/` (per-job resume PDF cache)

**Remote layer** (optional, additive, never authoritative):
- Cloudflare D1 tables: `applications`, `job_postings`, `dashboard_metrics`.
  Sync from local via `npm run cf:sync` or Agent 4 HTTP POST. Local files win.

**Rules:**
- Local files are the source of truth. Cloudflare D1 never becomes authoritative.
- Every submission is recorded in the tracker — 100% coverage.
- Tracker writes are atomic; dedup on posting URL first (normalized), then
  report-number, then fuzzy company+role.
- `.env` is never committed; `data/` is gitignored.

## Pipeline Detail

### Agent 1 — Discovery
1. Read boards from `config/profile.yaml` (`job_boards.primary` + `fallback`).
2. Fetch each board's public API in parallel (per-board module with its own
   timeout; a failing board never blocks the batch).
3. Liveness-check each posting (expired signals win over Apply-button text).
4. Dedup against `data/jobs.tsv` + tracker (URL-first).
5. Write new postings; pass the batch to Agent 2.

### Agent 2 — Evaluation & Tailoring
1. Load profile + resume text (cached).
2. **2a (online):** score each job (heuristic keyword/overlap score, NIM-verified
   for borderline cases — NIM stays off Actions). Apply `MIN_MATCH_SCORE` gate.
   Greenhouse postings must match search `city, state, United States` or become
   report-only. Legitimacy gate → suspicious jobs become report-only. Write
   `reports/` and `data/jobs.tsv`. `--score-only` / `FILLLOW_SCORE_ONLY=true`
   stops here.
3. **2b (offline):** for each survivor, generate a tailored 1-page Jake's Resume
   PDF (Playwright print-to-PDF, Times New Roman, cached per job) + cover
   letter. Optional LinkedIn+GitHub crawl is opt-in only (`ENRICH_PROFILES`).
4. Pass tailored artifacts to Agent 3.

### Agent 3 — Prefill & Submit
1. For each job: open the application form (Playwright, stealth init, real
   Chrome channel preferred).
2. Fill identity fields from `config/profile.yaml`.
3. Answer unknown questions via the layered answer engine (profile locks →
   force-lists → claims → NIM tone-controlled JSON answers → option
   alignment).
4. Upload tailored resume PDF + cover letter.
5. OTP: if the form requires a 1-time code, poll Gmail IMAP (regex + AI
   validation), fill it.
6. Safety checks: blacklist, threshold, legitimacy, pacing budget.
7. Submit:
   - `auto_submit: true` → humanized pacing (~2–5s dwell), click Submit.
   - `REVIEW_MODE=true` → leave the browser open for manual review.
   - `DRY_RUN=true` → skip the browser entirely; record `dry_run`.
8. Record the result; pass to Agent 4.

### Agent 4 — Tracking & Dashboard
1. Append to `data/applications.md` (atomic) + SQLite index.
2. Gmail reply-watch: poll for confirmation/reply/rejection emails per
   submitted application; classify into pipeline states; update the tracker
   via the append-only status ledger.
3. Recompute metrics (applications/day, conversion, time-to-offer, success by
   board).
4. Emit dashboard data (local HTML + optional Supabase sync).

## Performance & Failure Model

- **Budget:** 1–1:30 min per application (see PRD table). Agents 1 and 4
  amortize across the batch; Agents 2b and 3 are the per-job cost.
- **Actions minutes:** online half is ~5–15 billed minutes/day (HTTP + score).
  Hosted apply or a Track cron would blow a 1000-minute monthly cap — they stay
  local. See [HYBRID.md](HYBRID.md).
- **Failure isolation:** a failing board/job never blocks the batch — each job
  carries its own status (`applied` / `failed` / `review` / `dry_run`).
- **Anti-spam fallback:** if a board flags submissions as spam, the agent
  auto-falls back to review mode for that board and logs the event.
- **Resumability:** the tracker + jobs TSV make any run resumable; a failed
  run leaves no half-recorded state (atomic writes). `fillow pull` can re-fetch
  the latest online artifact.

## Implementation status (2026-09-20)

Sep 18 scaffold defects are fixed: `package.json` scripts point at `agents/`,
`js-yaml` is 4.x, `doctor.mjs` and `scripts/check-syntax.mjs` exist,
`run-workflow.mjs` imports real agents (no `tesseract.js`), profile loads from
`config/profile.yaml`. PRD.md had a real NVIDIA key — scrubbed 2026-09-19;
rotate it in the NVIDIA dashboard before the first live run.

| Piece | Status |
|---|---|
| Agent 1 `agents/discover.mjs` + `providers/{ashby,greenhouse,lever,workday}` | Complete: public APIs, keyword/blacklist filter, liveness gating in the discover loop (only true expiry drops; uncertain kept), v1 seed boards in `config/profile.yaml`, jobs TSV. Lever seed list mostly stale (external). |
| Agent 2 `agents/evaluate-tailor.mjs` + `lib/score.mjs` | Heuristic score + Greenhouse US-location gate + legitimacy + markdown reports + Jake's Resume PDF + cover letters. `--score-only` skips PDFs for the Actions half. **Not yet:** NIM verify. |
| Agent 3 `agents/apply.mjs` + `lib/form-fill.mjs` | Playwright fill for Greenhouse / Ashby / Lever; Workday auth-gate → review; layered answers; IMAP OTP; dry-run / review / auto-submit gates. Live-tested on Greenhouse embed (Stripe) in `REVIEW_MODE`. Needs Chromium on this machine. |
| Agent 4 `agents/track.mjs` | Atomic `data/applications.md`, status ledger, Gmail reply-watch, `output/dashboard.html`, optional Cloudflare D1 sync. |
| Hybrid `scripts/{online,offline,pull-jobs}.mjs` + `.github/workflows/fillow-online.yml` | Discover+score on Actions (no Chromium). Local `fillow pull` + `fillow offline`. |
| Cloudflare `cloudflare/` | One Worker URL + D1. Playwright apply stays local. Actions does not sync D1 (HTTP `/api/sync` caps jobs at 50; bulk is `fillow cf sync` after offline). |
| Shared `lib/` | config, answer-engine, tracker, gmail/imap, llm, browser, cover-letter, dashboard, resume-pdf, location. |

`DRY_RUN` defaults on. Do not click Submit until a dry run is reviewed.

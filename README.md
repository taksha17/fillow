# ⚡ fillow — the agentic AI job-application crew

> **four agents · hybrid by default** — Actions discover+score → local PDFs,
> apply, Gmail · Cloudflare dashboard as an index · ~1–1:30 min per application
> · zero clicks when you say so

`node ≥ 18` · `ESM, no build step` · `Playwright` · `NVIDIA NIM` · `zero-token discovery`

---

## 🧠 Wait — what is fillow?

fillow is an **agentic AI project**, not a software engineering one. It is not
a scraper, not a SaaS, and not a pile of scripts pretending to be a pipeline.
It is a small crew of purpose-built **AI agents** that runs your entire
job-application workflow autonomously, on a schedule, with the safety gates a
human would insist on.

The agents don't just autocomplete forms — they reason, decide, and act. And
they do it under a strict authority ladder, so the LLM fills gaps but **never
invents who you are**:

```
1. profile-locked facts   (passport, residence, GitHub, LinkedIn)
2. preference force-lists (always_yes / always_no keyword rules)
3. claims library         (short claims for free-text skill questions)
4. NVIDIA NIM             (tone-controlled answers for everything else)
```

Every layer wins over everything below it.

---

## 🤖 Meet the crew

| Station | Agent | Job | Co-built with |
|---|---|---|---|
| 🔎 **1 — Discover** | `agents/discover.mjs` | Public ATS APIs (Ashby, Greenhouse, Lever, Workday) · liveness gate · dedup · seed boards → `data/jobs.tsv` | **GLM 5.3-flash** (NVIDIA NIM + Qwen agent) |
| 🎯 **2 — Evaluate & Tailor** | `agents/evaluate-tailor.mjs` | Semantic scoring (Jaccard similarity, company tier, job age) · NIM-verified legitimacy gate · LLM-rewritten resume bullets per JD · dynamic skill reordering · tailored resume PDF + cover letter per job (cached per company) | **NVIDIA Nemotron 3 Ultra** (Kilo AI + Claude Code agent) |
| 📝 **3 — Prefill & Submit** | `agents/apply.mjs` | Playwright per-ATS fill · layered answer engine · Gmail IMAP OTP · auto-submit with gates | **Grok 4.6** (Cursor agent) |
| 📊 **4 — Track & Dashboard** | `agents/track.mjs` | Canonical tracker · status ledger · Gmail reply-watch · dashboard | **Grok 4.6** (Cursor agent) |

> PRD & architecture were co-built by **GLM 5.3** (NVIDIA NIM + Claude Code
> agent).

A failing board or job never blocks the batch — every job carries its own
status (`applied` / `failed` / `review` / `dry_run`).

---

## ⚙️ How a run works

Hybrid by default so a 40–50 apply day stays under **1000 GitHub Actions
minutes/month**. Playwright, Gmail IMAP, and Jake's Resume PDFs never run in
Actions. Full write-up: [HYBRID.md](HYBRID.md).

```
GitHub Actions  (cron 14:00 UTC ≈ 9:00 AM America/Chicago CDT)
  fillow online
    Agent 1   public ATS APIs → data/jobs.tsv
    Agent 2a  semantic score + MIN_MATCH_SCORE + Greenhouse location + legitimacy
    upload    jobs-tsv artifact

this machine
  fillow pull && fillow offline
    Agent 2b  semantic score + legitimacy gate · LLM-rewritten resume bullets · dynamic skill reorder · 1-page Jake's Resume PDF + cover letter (cached per company, batch-generated)
    Agent 3   prefill → layered answers → OTP → SUBMIT gates
    Agent 4   tracker → Gmail reply-watch → dashboard
    optional  fillow cf sync   (D1 is a copy, never canonical)

all-local fallback: fillow run   (same four agents, no Actions)
```

---

## 🛡️ The gates (why you can trust it)

- `DRY_RUN=true` until you have reviewed a run — nothing is submitted until
  then, ever.
- `REVIEW_MODE=true` fills the form and leaves the browser open.
- **Liveness gate** — dead postings never cost evaluation time.
- **Legitimacy gate** — suspicious postings are report-only, never
  auto-submitted.
- **Blacklist** — `data/blacklist.md` respected by discovery and apply.
- **Humanized pacing** — per-board delays, per-run caps, humanized fills. The
  anti-spam mitigations are not optional tuning; they are the mitigation.
- Gmail app passwords only. Secrets live in `.env`, never committed.

---

## 🚀 Quickstart

```bash
git clone <this-repo> && cd fillow
npm install
cp .env.example .env
cp config/profile.example.yaml config/profile.yaml
# edit .env and config/profile.yaml — your profile, your rules
npx playwright install chromium   # only needed for live apply

node bin/fillow.mjs doctor
node bin/fillow.mjs run           # all-local; DRY_RUN=true by default
# hybrid: enable Actions (fillow-online.yml), then:
#   fillow pull && fillow offline
```

After `npm link` (or `npx fillow`) the same commands are just `fillow doctor`
/ `fillow run`.

---

## 🎛️ Commands

| Command | What it does |
|---|---|
| `fillow online` | Agent 1 + 2a — discover + score/gate (GitHub Actions) |
| `fillow pull` | Download latest Actions `jobs.tsv` into `data/` |
| `fillow offline` | Agent 2b + 3 + 4 — PDFs, apply, Gmail, track (this machine) |
| `fillow run` | All four agents on this machine |
| `fillow discover` | Agent 1 — public ATS APIs → `data/jobs.tsv` |
| `fillow evaluate` | Agent 2 — semantic score + legitimacy gate · LLM-rewritten bullets · skill reorder · resume PDF + cover letter (`--score-only` skips PDFs) |
| `fillow apply` | Agent 3 — form fill, Gmail OTP, submit gates |
| `fillow track` | Agent 4 — `data/applications.md`, reply-watch, dashboard |
| `fillow doctor` | Setup check |
| `fillow gmail` | Prove Gmail IMAP (app password) |
| `fillow cf setup` | Optional hosted dashboard + D1 |

`npm start` = `fillow run`. `npm run online|offline|pull|scrape|evaluate|apply|track` are aliases.

---

## 🔧 Config

- **Identity** lives only in `config/profile.yaml` (name, email, phone,
  passport, GitHub, LinkedIn). The LLM does not invent these.
- **Secrets** live only in `.env`. Never commit it.
- **Tracker** is `data/applications.md` (canonical). Cloudflare D1 is a copy,
  never authoritative.

Gmail IMAP (Agent 3 OTP + Agent 4 replies): enable IMAP, create a Google
[App password](https://myaccount.google.com/apppasswords), set
`GMAIL_APP_PASSWORD`, then `fillow gmail`.

---

## 📦 Data contract

**User layer** (never auto-generated, yours): `config/profile.yaml`, `.env`,
`data/applications.md`, `data/blacklist.md`, `reports/`, `output/`.

**Derived layer** (safe to delete, rebuilt on next run): `data/fillow.db`,
`data/jobs.tsv`, `data/tailored/`.

Local files are always the source of truth. Cloudflare D1 never becomes
authoritative.

---

## 🙏 Lineage & credits

### Standing on the shoulders of

- **[career-ops](https://github.com/career-ops-hq/career-ops)** (by Santiago
  Fernández de Valderrama) — the evaluation and tracking discipline fillow is
  built on: structured scoring, files-as-canonical tracking, liveness and
  legitimacy gates, the canonical tracker format. Upstream reference — never
  modified; concepts ported, not code.
- **Fillow v1 — "Job Search Co-pilot"** (the author's own Python predecessor:
  Python + Playwright + Chrome MV3 extension + FastAPI dashboard) — the proven
  layering this repo unifies: the layered answer engine, public board APIs,
  humanized fills, Gmail IMAP OTP handling.

### AI co-builders

| Piece | Model | Delivered through |
|---|---|---|
| Agent 1 — Discovery | GLM 5.3-flash | NVIDIA NIM + Qwen agent |
| Agent 2 — Evaluate & Tailor | NVIDIA Nemotron 3 Ultra | Kilo AI + Claude Code agent (semantic scoring, LLM bullet rewrite, skill reorder, company-grouped PDF generation) |
| Agents 3 & 4 — Prefill & Submit, Track & Dashboard | Grok 4.6 | Cursor agent |
| PRD & architecture | GLM 5.3 | NVIDIA NIM + Claude Code agent |

---

## 🗺️ Roadmap

- ✅ Unified four-agent pipeline (`fillow run` = full local workflow)
- ✅ Hybrid: Actions discover+score, local PDFs/apply/Gmail, Cloudflare index
- ✅ Semantic scoring (Jaccard similarity, company tier weighting, job age recency)
- ✅ LLM-rewritten resume bullets per JD with template fallback
- ✅ Dynamic skill reordering per job
- ✅ Company-grouped PDF caching (one PDF per company, reused)
- ✅ Batch PDF generation with concurrency control
- ✅ Auto-submit with explicit safety gates
- ✅ Local Cloudflare Worker dashboard + D1 (`cloudflare/`)
- ⬜ Hosted Cloudflare Pages UI (React/Vite + TailwindCSS)
- ⬜ Real-time dashboard updates (WebSocket)
- ⬜ OAuth — Gmail/LinkedIn authentication

---

## 📄 License

[PolyForm Noncommercial 1.0.0](LICENSE) — personal use and personal
modifications are allowed. Selling fillow, wrapping it as a paid product, or
other commercial use is not. Apache 2.0 / MIT would have allowed that.

This is source-available, not OSI "open source" (those definitions require
commercial use). You can still publish the repo publicly.

---

## 📚 Docs

- [HYBRID.md](HYBRID.md) — Actions vs local vs Cloudflare
- [ARCHITECTURE.md](ARCHITECTURE.md) — pipeline design
- [AGENTS.md](AGENTS.md) — conventions for people and coding agents
- [PRD.md](PRD.md) — requirements
- [CLOUDFLARE.md](CLOUDFLARE.md) — optional hosted dashboard + D1

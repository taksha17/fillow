# ⚡ fillow

<p align="center">
  <img src="fillow_logo.png" alt="fillow logo" width="160"/>
</p>

**Your AI-powered job‑application crew.** Run locally, sync to Cloudflare,
never spam.

> **Four agents** — discover → evaluate & tailor → prefill & submit → track & dashboard  
> **~1–1:30 min** per application · **DRY_RUN** by default · **Hybrid** (Actions +
> local + Cloudflare index) · **zero‑token discovery** · **Jake’s Resume format**

<!-- Badges row -->
<p align="center">
  <a href="https://github.com/taksha17/fillow/actions?query=branch%3Amain+status%3Asuccess">
    <img alt="Build status" src="https://github.com/taksha17/fillow/workflows/fillow-online/badge.svg?branch=main&style=flat-square"/>
  </a>
  <a href="https://www.npmjs.com/package/fillow">
    <img alt="npm version" src="https://img.shields.io/npm/v/fillow?color=%23cb3837&style=flat-square"/>
  </a>
  <a href="LICENSE">
    <img alt="License" src="https://img.shields.io/badge/License-PolyForm%20Noncommercial%201.0.0-brightgreen?style=flat-square"/>
  </a>
</p>

---

## 🛈 What is this?

fillow is **not** a scraper, not a SaaS, and not a pile of scripts. It is a
small crew of purpose-built **AI agents** that runs your entire job-application
workflow autonomously on a schedule, with the safety gates a human would insist
on.

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

| Station | Agent | What it does | Co-built with |
|---|---|---|---|
| 🔎 **1 — Discover** | `agents/discover.mjs` | Public ATS APIs (Ashby, Greenhouse, Lever, Workday) · liveness gate · seed boards → `data/jobs.tsv` | **GLM 5.3‑flash** (NVIDIA NIM + Qwen agent) |
| 🎯 **2 — Evaluate & Tailor** | `agents/evaluate-tailor.mjs` | Semantic scoring · legitimacy gate · LLM-rewritten bullets · 1‑page Jake's Resume PDF + cover letter per job | **NVIDIA Nemotron 3 Ultra** (Kilo AI + Claude Code agent) |
| 📝 **3 — Prefill & Submit** | `agents/apply.mjs` | Playwright per‑ATS fill · layered answer engine · Gmail IMAP OTP · auto‑submit with gates | **Grok 4.6** (Cursor agent) |
| 📊 **4 — Track & Dashboard** | `agents/track.mjs` | Canonical tracker · status ledger · Gmail reply‑watch · dashboard | **Grok 4.6** (Cursor agent) |

> **PRD & architecture** were co‑built by **GLM 5.3** (NVIDIA NIM + Claude Code agent).

A failing board or job never blocks the batch — every job carries its own
status (`applied` / `failed` / `review` / `dry_run`).

---

## ⚖️ Usage & Legal Disclaimer

fillow automates interactions with job boards and ATS platforms (Ashby, Greenhouse, Lever, Workday, etc.). You are responsible for complying with each platform's **Terms of Service**.

- Provided **as-is** with no guarantee of application quality or outcomes.
- **DRY_RUN=true** is the default and should remain enabled until you have reviewed a full run — nothing is submitted until then.
- **Recommended limits:** keep `MAX_APPLIES_PER_RUN ≤ 3` and `APPLY_DELAY_S ≥ 6` unless you know exactly what you are doing. Aggressive settings can get your IP or account flagged by ATS providers.
- Job-board autofill and OTP handling may improve over time, but these are the author's own patterns and may not work on every platform.

---

## 🚀 Quickstart — your first run

```bash
# 1️⃣ Clone & install
git clone https://github.com/taksha17/fillow.git
cd fillow
npm install

# 2️⃣ Copy config (generic templates are already committed)
cp .env.example .env
cp config/profile.example.yaml config/profile.yaml
# → edit these files: your name, contact, passport, GitHub, LinkedIn

# 3️⃣ Install browsers (only needed for live apply)
npx playwright install chromium

# 4️⃣ Run your first DRY_RUN (safe — nothing is submitted)
node bin/fillow.mjs run
# → opens a browser, scores jobs, writes a tracker file, stops before submit

# 5️⃣ Review the dashboard
# → http://localhost:... or your Cloudflare Workers URL
# → you'll see application links + ↓ resume markdown download buttons
```

After `npm link` (or `npx fillow`) the same commands are just
`fillow doctor` / `fillow run`.

---

## ▶️ Commands cheat‑sheet

| Command | What it does | When to use |
|---|---|---|
| `fillow run` | Full pipeline on this machine | Local development, DRY_RUN first |
| `fillow discover` | Agent 1 — scrape ATS APIs → `data/jobs.tsv` | You want fresh job list |
| `fillow evaluate` | Agent 2 — score, legitimacy, tailored PDF + markdown | You want resumes generated |
| `fillow apply` | Agent 3 — form fill, Gmail OTP, submit gates | You’re ready to apply |
| `fillow track` | Agent 4 — tracker, reply‑watch, dashboard | You want status + email watch |
| `fillow doctor` | Setup check | First run, or after env changes |
| `fillow setup` | Onboarding wizard — profile checklist + one-time board session | After cloning, before first apply |
| `fillow enrich` | Pull GitHub/LinkedIn into resume data (opt-in, 24h cache) | When you want richer tailored resumes |
| `fillow auth` | Platform auth matrix (NIM, Gmail, GitHub, LLM fallbacks, Cloudflare, Supabase) | Verify integrations after .env edits |
| `fillow gmail` | Prove Gmail IMAP (app password) | Before running apply/track |
| `fillow cf setup` | Optional: hosted dashboard + D1 | You want a shareable URL |

`npm start` = `fillow run`. `npm run online|offline|pull|scrape|evaluate|apply|track` are aliases.

---

## 🤖 Drive it from your own agent

fillow is built to be **OSS and agent-native**: every agent is a plain ES module
(Node ≥ 18, zero build step), so *your* coding agent — Cursor, Claude Code,
Kilo, Qwen Code, whatever you use — can run the crew directly, no CLI required:

```js
import { scrapeJobs } from "./agents/discover.mjs";             // Agent 1
import { evaluateTailor } from "./agents/evaluate-tailor.mjs";  // Agent 2
import { applyJobs } from "./agents/apply.mjs";                 // Agent 3
import { trackDashboard } from "./agents/track.mjs";            // Agent 4

const cfg = (await import("./lib/config.mjs")).loadConfig();
const jobs = await scrapeJobs(cfg);
await evaluateTailor(cfg);
await applyJobs(jobs, cfg);
await trackDashboard([], cfg);
```

Or just execute them standalone — each file runs directly:

```bash
node agents/discover.mjs
node agents/evaluate-tailor.mjs --score-only
```

The safety gates travel with the API: `DRY_RUN`, caps, pacing, and identity
facts all live in `cfg`, so an external agent **cannot bypass them**. Full
contract (exports, `emit` progress hooks, per-job isolation): [AGENTS.md](AGENTS.md) →
*Agent Programmatic Interface*.

---

## 🛡️ The gates (why you can trust it)

- `DRY_RUN=true` until you have reviewed a run — **nothing is submitted until then, ever.**
- `REVIEW_MODE=true` fills the form and leaves the browser open.
- **Liveness gate** — dead postings never cost evaluation time.
- **Legitimacy gate** — suspicious postings are report‑only, never auto‑submitted.
- **Blacklist** — `data/blacklist.md` is respected by discovery and apply.
- **Humanized pacing** — per‑board delays, per‑run caps, humanized fills. The anti‑spam mitigations are not optional tuning; they are the mitigation.
- Gmail app passwords only. Secrets live in `.env`, never committed.

---

## 📦 Data contract

**User layer** (never auto‑generated, *yours*): `config/profile.yaml`, `.env`,
`data/applications.md`, `data/blacklist.md`, `reports/`, `output/`.

**Derived layer** (safe to delete, rebuilt on next run): `data/fillow.db`,
`data/jobs.tsv`, `data/tailored/`.

Local files are always the source of truth. Cloudflare D1 never becomes
authoritative.

**Config file lookup**: the loader checks `config/profile.yaml` first, then falls back to a flat `config.yaml` at the repo root if the dedicated directory doesn't exist. For new setups, prefer `config/profile.yaml` — the `config.yaml` fallback is for people who want a flat layout.

---

## 🙏 Lineage & credits

### Standing on the shoulders of

- **[career‑ops](https://github.com/career-ops-hq/career-ops)** (by Santiago
  Fernández de Valderrama) — the evaluation and tracking discipline fillow is
  built on: structured scoring, files‑as‑canonical tracking, liveness and
  legitimacy gates, the canonical tracker format. Upstream reference — never
  modified; concepts ported, not code.
- **Fillow v1** — "Job Search Co‑pilot" (the author's own Python predecessor:
  Python + Playwright + Chrome MV3 extension + FastAPI dashboard) — the proven
  layering this repo unifies.

### AI co‑builders

| Piece | Model | Delivered through |
|---|---|---|
| Agent 1 — Discovery | GLM 5.3‑flash | NVIDIA NIM + Qwen agent |
| Agent 2 — Evaluate & Tailor | NVIDIA Nemotron 3 Ultra | Kilo AI + Claude Code agent |
| Agents 3 & 4 — Prefill & Submit, Track & Dashboard | Grok 4.6 | Cursor agent |
| PRD & architecture | GLM 5.3 | NVIDIA NIM + Claude Code agent |

---

## 🗺️ Roadmap

- ✅ Unified four‑agent pipeline (`fillow run` = full local workflow)
- ✅ Hybrid: Actions discover+score, local PDFs/apply/Gmail, Cloudflare index
- ✅ Semantic scoring, LLM‑rewritten bullets, dynamic skill reorder, company‑grouped PDF caching
- ⬜ Hosted Cloudflare Pages UI (React/Vite + TailwindCSS)
- ⬜ Real‑time dashboard updates (WebSocket)
- ⬜ OAuth — Gmail/LinkedIn authentication

---

## 📄 License

[PolyForm Noncommercial 1.0.0](LICENSE) — personal use and personal modifications are allowed. Selling fillow, wrapping it as a paid product, or other commercial use is not. Apache 2.0 / MIT would have allowed that.

This is source‑available, not OSI "open source" (those definitions require commercial use). You can still publish the repo publicly.

---

## 📚 Docs

- [HYBRID.md](HYBRID.md) — Actions vs local vs Cloudflare
- [ARCHITECTURE.md](ARCHITECTURE.md) — pipeline design
- [AGENTS.md](AGENTS.md) — conventions for people and coding agents
- [PRD.md](PRD.md) — requirements
- [CLOUDFLARE.md](CLOUDFLARE.md) — optional hosted dashboard + D1
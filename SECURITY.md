# SECURITY

This file tells you how to report a vulnerability and what security invariants the project guarantees.

## Supported versions

| Version | Supported |
|---|---|
| Latest `main` | ✅ |

If you're on an older commit, update before reporting.

---

## How to report a vulnerability

**Please do not file a public issue for security vulnerabilities.**

***Directly email the maintainer*** with a description, steps to reproduce, and a minimal proof-of-concept. If you don't hear back within 7 days, follow up once more.

pgp key: none required for submission; just be thorough.

In the issue title, prefix with `[SECURITY]`.

---

## Security invariants (what "safe" means)

| Invariant | Status |
|---|---|
| Secrets live only in `.env` (never committed, never in code) | ✅ Always enforced |
| `.gitignore` covers `.env`, `data/`, `reports/`, `output/`, `node_modules/` | ✅ Always enforced |
| `DRY_RUN=true` until the user explicitly reviews a run | ✅ Default; cannot be bypassed by code |
| `apply.mjs` never submits without `review_mode=false` and DRY_RUN=false | ✅ Safety gate |
| LLM (NVIDIA NIM) never learns from calls — stateless, in-memory only | ✅ Design decision |
| Anti-spam pacing (`REQUEST_DELAY_S`, `APPLY_DELAY_S`, `MAX_APPLIES_PER_RUN`) | ✅ Always on; users cannot disable without editing config |

### Secrets flow

- `NVIDIA_API_KEY` — only in `.env` (config loader injects it into `cfg.secrets.nvidia_api_key`)
- `GMAIL_APP_PASSWORD` — only in `.env` (OTP + reply-watch)
- Session storage (`mygreenhouse_state.json`) — encrypted by Chromium, kept in `data/` (gitignored)

---

## Responsible disclosure & trust checklist

Before you paste your Gmail app password or API key into any config:

1. Never commit `.env` (the `.gitignore` already blocks it).
2. Keep `DRY_RUN=true` until after you've reviewed a full `npm run` output.
3. Never let `auto_submit` + `DRY_RUN=false` run on a database you don't fully trust. If an agent behaves badly, stop it immediately, inspect `data/applications.md` and the status-ledger, then reset.
4. Never supply a Gmail App Password for any third-party service claiming to read your mailbox. Only Google‑authenticated integrations are supported.

---

## What we collect

**Nothing.** There is no telemetry, no analytics, no phone-home, no remote error reporting. All state is locally written to `data/`, `reports/`, and `output/` (and optionally synced to your own Cloudflare D1).

History is preserved locally forever in `data/applications.md` and `data/status-ledger.md`. That means the software never forgets — you do.

---

## What to do if you find a problem

**Data leak or secret exposure**

If a `nvapi-*`, `sk-*`, GMAIL app password, or similar token appears in a repo file, please email the maintainer immediately and include the file path and how you found it.

**Bad chem on a job posting**

If you suspect our content claims of "applied" are false or that we auto-submitted a live job, reply to the issue once opened.

**API misuse**

If you see a legitimate reason why the discovery or evaluation logic is missing a legitimate board, open an issue describing the board and the working URL schema for it.

---

Thank you for helping keep fillow safe.
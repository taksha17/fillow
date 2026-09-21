# Contributing to fillow

Thanks for your interest in contributing. This document tells you how to get your changes in.

## Code of conduct

Be kind. No destructive operations are run in production without your explicit permission. Treat this as a gentleperson agreement: we test first, we think before we ship, and we don't auto-push.

## First time setup

```bash
git clone https://github.com/taksha17/fillow.git
cd fillow
npm install
node doctor.mjs     # must pass
npm test            # must pass
```

## How to contribute — the two paths

### A — Add a new ATS provider (highest-leverage)

You're on `ashby/` / `greenhouse/` / `lever/` / `workday/` and you want to add `successfactors/`, `workday`, `oracle/`, `iCIMS`, etc.

**Only file to edit: `providers/<your-provider>.mjs`.**

Each provider is a small module with this exact interface:

```js
// providers/<your-provider>.mjs
import { fetchJson } from "./http.mjs";

export async function fetchYourProviderBoard(companyId) {
  const url = `https://boards-api.<yourboard>.io/v1/boards/${companyId}/jobs`; // whatever the ATS public API is
  const response = await fetchJson(url);
  if (!response.ok) return [];
  const data = await response.json();
  return data.jobs.map((item) => ({
    source: "yourprovider",
    external_id: `${company}:${jobId}`,
    title: item.title || "",
    company: item.company?.name || "",
    location: item.location?.name || "",
    url: item.apply_url || "",
    apply_url: item.apply_url || "",
    description: item.description || "",
    board_token: companyId,
    ats: "yourprovider",
  }));
}
```

Rules of thumb:

- **Never hardcode API keys.** All API keys come from `cfg.secrets.<your-provider>.api_key` or from environment vars loaded via `lib/config.mjs` into `cfg.secrets`. If a key is missing, return `[]` (silently skip, never throw).
- **Always return an array.** Even on 404/400/empty — `[]`, not an exception.
- **Do not include `resume_md` in the provider payload.** Tailored resumes are built in `lib/resume-pdf.mjs` only, from `data/tailored/`.
- **Board keys = lowercase slug** used by the board's own API (e.g. `stepsalant196914051` from `https://boards.greenhouse.io/pinterest/jobs/7567385` posted 2026-04-21 you code in the seed). Use the one-liners in `agents/discover.mjs` to test.

### B — Fix a bug, improve a score, or polish an agent

This is just **fix what's broken** and don't break the agents' shared convention:

- Keep comments narrating **what** and avoiding "how it works" as much as possible
- Use JSDoc for public functions (hooks, exports, machine-readable signatures)
- If you change a file, add a test that covers the change
- Commit messages: fix: ..., feat: ..., chore: ..., docs: ...

## Where things live — a quick orientation

| Directory | Purpose |
|---|---|
| `agents/discover.mjs, evaluate-tailor.mjs, apply.mjs, track.mjs` | The four agents. This is the pipeline. |
| `lib/` | Shared plumbing: config, paths, dashboard, resume, score, tracker, cloudflare-sync, gmail, llm, resume-pdf, resume-source, score, tracker. |
| `providers/` | ATS APIs: ashby, greenhouse, lever. Drop a new one here to extend coverage. |
| `scripts/` | Utility scripts: check-syntax, sync-cloudflare. |
| `cloudflare/` | Worker + D1: html, worker, schema, migrations. |
| `bin/fillow.mjs` | Entry point. Calls the four agents in sequence. |
| `config/profile.yaml` | Candidate identity only (`first_name`, `email`, `passport`, `resume`, `github`, etc.). No LLM output. Never edit the user's file yourself. |
| `data/` | Not committed. Only `.md` files: `applications.md`, `blacklist.md`, `cover_letter.txt`, `jobs.tsv`, `fillow.db` (cache). |
| `reports/` | Report dirs: `reports/<nnn>-<company>-<score>` |

## The PR bar — what must be true to merge

1. **All tests pass** (`npm test` — check "Tests" block for tally).
2. **Syntax check passes** (`npm run lint`).
3. **No secrets landing in commits.** Scan with `git diff --cached | grep -iE "nvapi|sk-|app password|gmail_token"` and fix before pushing.
4. **`dry_run` behavior honored.** If a change touches `apply.mjs` or `lib/score.mjs`, a real DRY_RUN pipeline must still do nothing. Users should see: "applied: false, status: dry_run".
5. **No breaking changes to the pipeline** (agents stay decoupled and JSON-based: discover → evaluate → apply → track).
6. **No removal of safety gates.** `liveness gate`, `legitimacy gate`, `rank threshold gate`, `location gate`, `greenhouse-us location gate` must all stay.
7. **Match_score ≤ 100** for any score that goes through the pipeline.
8. From `agents/evaluate-tailor.mjs`, if a new output variation is supported, **update the user-facing docs** (`ARCHITECTURE.md` and/or `AGENTS.md`) with it.

## 🧪 Testing cheat sheet

```bash
npm test                      # full suite (~85 total)
npm run evaluate              # one tailored resume + sync (dry-run safe)
npm run scrape                # proven discovery, seeds, output in data/jobs.tsv
npm run cf:sync               # sync data/jobs.tsv → Cloudflare D1
npm run cf:deploy             # Cloudflare deployment
npm run dashboard             # local dashboard in output/dashboard.html

node tests/engine.test.mjs    # agent engine primitives
node tests/apply-track.test.mjs # all four agents wired together (the acceptance test)
node tests/resume.test.mjs    # resume model + render Resume markdown + special characters
node tests/apply-track.test.mjs

npm run lint                  # syntax check all *.mjs files
```

### Tips for contributors

- **`MIN_RESUME_TOKENS`** = 0. So no resume files generate some templates when there are no experience. (That's fine.)
- **The seeded boards** in `config/profile.yaml` include successfactors, oracle, workday as extras beyond the primary ashby/greenhouse/lever — support them only when you can test them end-to-end.
- **Every first Friday of the month** we clean up the backlog. Feel free to ask questions before starting on a change.

## Where contributors get stuck (fixes)

**That "profile fallback" message**

Fillow reads `config/profile.yaml` OR `config/profile.yaml` if the flat file `config.yaml` doesn't exist. Check both places if you get keyword errors.

**Do not name the third parser.** Implementation detail that isn't relevant to contributors, and it's listed in `lib/paths.mjs`:
`export const PATHS = { profileFallback: join(ROOT, "config.yaml"), … }`.

### Tailoring pipeline architecture, in three minutes

Discovered jobs come from `agents/discover.mjs` → `data/jobs.tsv` (source, external_id, title, company, location, url, apply_url, ats, match_score, status). `readTracker()`/`readJobs()`/`loadBlacklist()` are the key functions. `matchJobByUrlTokens` is how the join key works to match a tracker row to a job row (UUIDs + timestamps in the URL).

**Agents 2** — score each job, then backend `ATherefore.js` decides what makes it into the final bucket. Parameters: minimum threshold (config: `minMatchScore` → 78), legitimacy gates (repost/lore which are suspicious flags such as "very old posting", "no location", "no compensation", or the greenhouse location rule: yes if in AmE, else report_only). The B plant legs get maximized by `FILLLow_SCORE_ONLY` and `rimMAX_TAILOR_PER_RUN` (12).

**Agent 2 customizations you can add:** new tech keywords to fetch, a cure comp matrix board, an extended greenhouse location display, or company-tier research (the south-hill card, vote-ipa weighted aggregate).

**Agent 3** — the apply flow is manual: `fillow run` fills a browser, or you can call `fillow apply`. Do it only after `npm run evaluate` has passed and you've reviewed an actual submission.

**Agent 4** — track the results into the canonical tracker and then filter your dashboard.

Best way to learn: read `ARCHITECTURE.md` (4 pages) and then read an agent file side-by-side with `PRD.md`. The whole thing is built to move fast but don't break things. The agents don't invent anything — the LLM only does rewriting; the model which picks the CMS matches is mandated to use the fact-based answer engine.

1. **Read** the architecture (4 lines at the top of `ARCHITECTURE.md`).
2. **Read** the README's "How a run works" diagram.
3. **Run** `npm test` (passing is required to understand the pipeline's shape).
4. **Read** the source of an agent (`agents/discover.mjs` is 153 lines, readable).
5. **Read** `agents/evaluate-tailor.mjs` (Phase 2b is less readable, but the 47-line `tailorResumeForJob` in `lib/resume-source.mjs` is where the resume formatting happens).
6. **Play with it** — `npm run evaluate`, or make a `new ResumeMarkdown` change the formatting to two columns, run the acceptance test (`npm test`), push.

## Your first contribution

The single best way to add value to fillow today is:

1. Open a GitHub issue on `github.com/taksha17/fillow` titled: "feat: add Improve `README`"
2. Fork the repo.
3. Fix the whitespace on line 19 of the JavaScript file `lib/resume-source.mjs` (function `tailorResumeForJob`).
4. Submit a PR.

You don't need to wade into XYZ-issue112 before any other eng pull request goes in. First-time-or-new contributor rule: if the tests pass and the diff is simple, the bar is high.

Once you've done that, you can move on to adding a new ATS provider.

See you in the PR queue!
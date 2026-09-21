# Agent 3 fill caveats (cross-ATS)

Incident-driven notes so we stop rediscovering the same form bugs.
Patterns drawn from live Stripe/Greenhouse fills, Fillow v1, and OSS
([ChamPro/ats-autofill](https://github.com/ChamPro/ats-autofill),
[devdattatalele/auto-apply](https://github.com/devdattatalele/auto-apply)).

## Pipeline (every board)

1. **Scrape** questions (public Greenhouse API `?questions=true` + DOM labels).
2. **Profile/resume first** — never call NIM for a fact already in `profile.yaml`.
3. **Align to ATS option strings** — type the board’s label (`US`), not the profile wording (`United States`).
4. **Multi-strategy dropdown** — type-to-filter → open+scan options → keyboard Enter; verify readback.
5. **Retry empties once** — reopen custom selects that stayed on `Select...`.
6. **NIM only for residual free-text** — with resume excerpt; never invent employers/degrees.
7. **REVIEW_MODE never Submit** — completeness is the form’s job + our empty-required notes.

## ATS matrix

| ATS | Question source | Hard widgets | Status in fillow |
|-----|-----------------|--------------|------------------|
| Greenhouse | Public boards API + embed DOM | react-select, intl-tel `#country` dial, education typeahead, OFCCP EEO | Primary; Stripe-proven |
| Ashby | DOM labels / yes-no buttons | Custom option buttons, typeahead | Supported |
| Lever | `/apply` DOM | ARIA dropdowns | Supported |
| Workday | Auth gate + multi-step | Account/login, conditionals | Review-only fallback |
| Others | DOM best-effort | Unknown widgets | Skip or review |

No Greenhouse **Harvest** API key is required for public job questions.
Agent 1 lists jobs via `boards-api.greenhouse.io/.../jobs`; Agent 3 loads
`.../jobs/{id}?questions=true`.

## Recurring question classes

| Kind | Profile source | Common ATS mismatch |
|------|----------------|---------------------|
| work_country / residence | `country_of_residence` | `United States` vs `US` / `USA` |
| phone_country | dial code | `#country` is `+1`, not residence |
| city_state | `greenhouse_location` | `City, State, United States` |
| school | `school` + aliases | Catalog miss → try `Other` |
| degree | `degree` | `Master of Science` → `Master's Degree` |
| gender | `gender` | Male / Man / Men; never Female |
| hispanic | `hispanic` | Yes / No |
| veteran | `veteran` | OFCCP: `I am not a protected veteran` (options often missing until menu opens) |
| work_auth / sponsorship | prefs + `requires_sponsorship` | Exact Yes/No |
| remote | prefs | Long Greenhouse strings |
| messaging_opt_in | default No | WhatsApp / SMS |
| free_text | claims → NIM residual | Never invent metrics |

## Dropdown rules (do not regress)

- Open the menu and **wait for options** before deciding the pick failed.
- Prefer **clicking a visible option** over bare Enter (Enter can submit).
- After fill, **read the control back**; `Select...` means empty.
- Do not re-open a committed select just to “repair” — can clear it.
- Skip honeypots / “leave blank” fields.
- **Never** use Playwright string `hasText("US")` — it substring-matches **Australia** first. Use `getByText(..., { exact: true })` or exact/alias checkbox scoring.
- Greenhouse **school** catalogs: one primary name then **Other**; empty typeahead → bail immediately (do not loop every alias).
- Multi-select countries: check the exact label (`US`), uncheck siblings; checkbox `name` is often `question_N[]`.

## What we did not vendor

- ChamPro’s injected `dom-toolkit` (Claude-plugin / in-page) — we stay Playwright + Node.
- auto-apply’s learner CSV — optional later; profile locks beat learned guesses.
- Vision/screenshot agents for every ATS — too slow for 40–50 apps/day.

## When a new board breaks a fill

1. Capture the empty label + option list (API or open-menu scrape).
2. Add an alias or kind rule in `lib/field-kinds.mjs` / `lib/form-controls.mjs`.
3. Add a unit test with the real option strings.
4. Only then re-run REVIEW_MODE — do not invent a one-off Stripe branch.

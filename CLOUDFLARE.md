# Cloudflare hosting (Workers Free + D1 Free)

One hosted URL. The four agents are stages of the fillow CLI, not four websites.
Playwright apply stays on your machine; GitHub Actions runs **discover + score
only**; Cloudflare hosts the **single workflow dashboard + D1**.
Local files remain canonical. See [HYBRID.md](HYBRID.md).

Free plan (no credit card): [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) · [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)

| Resource | Workers Free |
|---|---|
| Worker requests | 100,000 / day |
| D1 row reads | 5 million / day |
| D1 row writes | 100,000 / day |
| D1 storage | 5 GB |

## 1. Create the free account

1. Open https://dash.cloudflare.com/sign-up
2. Sign up with email (or GitHub / Google).
3. Stay on **Free**. Skip adding a domain and skip Workers Paid.
4. Confirm the email if Cloudflare asks.

## 2. Connect this repo

```bash
npm run cf:setup
```

That command:

1. Device-logs Wrangler into your account (prints a URL + short code; 5 minutes to approve).
2. Creates D1 database `fillow` and writes `database_id` into `cloudflare/wrangler.toml`.
3. Applies `cloudflare/schema.sql` on the remote DB.
4. Generates `FILLLOW_SYNC_TOKEN` into `.env` and `cloudflare/.dev.vars`, and stores it as a Worker secret.

If you already signed up, you can also log in by itself:

```bash
npx wrangler login --device --browser=false
```

Visit the printed URL, enter the code, then re-run `npm run cf:setup`.

## 3. Push data and publish

```bash
npm run cf:sync -- --remote
npm run cf:deploy
```

`cf:deploy` prints `https://fillow.<subdomain>.workers.dev`. Put that in `.env`:

```
FILLLOW_SYNC_URL=https://fillow.<subdomain>.workers.dev
FILLLOW_SYNC_TOKEN=<already set by cf:setup>
```

Agent 4 (`npm run track` / `fillow offline`) POSTs applications to `/api/sync`
after each local run. Bulk job rows go through `npm run cf:sync` (D1 execute),
which stays inside the free write budget. Do **not** point GitHub Actions at
`/api/sync` — that HTTP path only sends 50 job rows (Workers CPU).

## Local (no account)

```bash
npm run cf:schema:local   # already done once
npm run cf:sync           # local D1
npm run cf:dev            # http://127.0.0.1:8787
```

## What is hosted vs local

| Piece | Where it runs |
|---|---|
| Dashboard (`/`, `/api/*`) | Cloudflare Worker |
| Applications + jobs index | D1 (`fillow`) — copy, never canonical |
| Discover + score (Agent 1 + 2a) | GitHub Actions (`fillow online`) or this machine |
| Jake's Resume PDFs (Agent 2b) | This machine (`fillow offline`) |
| Apply / Gmail OTP (Agent 3) | This machine — never Actions, never Workers |
| Track + reply-watch (Agent 4) | This machine |
| `data/applications.md`, `config/profile.yaml` | Local, source of truth |
| `data/jobs.tsv` handoff | Actions artifact → `fillow pull` |

import { dashboardHtml, loginHtml, metricsFrom } from "./html.mjs";
import { fetchGreenhouseBoard } from "../../providers/greenhouse.mjs";
import { fetchAshbyBoard } from "../../providers/ashby.mjs";
import { fetchLeverCompany } from "../../providers/lever.mjs";
import { fetchWorkdayBoard } from "../../providers/workday.mjs";
import { matchesTargets } from "../../lib/filters.mjs";
import { verifySupabaseJwt } from "../../lib/jwt-verify.mjs";

const DISCOVER_KEY = "discover";
const DISCOVER_LAST_RUN_KEY = "discover:last_run";
const MAX_JOB_UPSERTS = 150;
// Phase 1 of the multi-user plan: unauthenticated dashboard views and the
// legacy sync-token CLI share the "local" default user; JWT-authenticated
// users get their own isolated rows.
const DEFAULT_USER_ID = "local";
const SESSION_COOKIE = "fillow_session";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

function getCookie(request, name) {
  const raw = request.headers.get("cookie") || "";
  const m = raw.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : "";
}

function authHeader(request) {
  return (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
}

/**
 * Identity resolution, strongest first:
 *   1. Supabase JWT — from the HttpOnly session cookie (browser) or a Bearer
 *      header (CLI / API clients)
 *   2. Legacy FILLLOW_SYNC_TOKEN — the pre-auth CLI sync path → default user
 *   3. null — unauthenticated reads fall back to the default user's view
 */
async function resolveUser(request, env) {
  const bearer = authHeader(request);
  if (env.SUPABASE_URL) {
    const token = getCookie(request, SESSION_COOKIE) || bearer;
    if (token && token !== env.FILLLOW_SYNC_TOKEN) {
      const v = await verifySupabaseJwt(token, { supabaseUrl: env.SUPABASE_URL });
      if (v.ok) {
        return {
          userId: String(v.payload.sub),
          email: String(v.payload.email || ""),
          name: String(v.payload.user_metadata?.full_name || ""),
          via: "jwt",
        };
      }
    }
  }
  if (bearer && env.FILLLOW_SYNC_TOKEN && bearer === env.FILLLOW_SYNC_TOKEN) {
    return { userId: DEFAULT_USER_ID, email: "", name: "", via: "sync-token" };
  }
  return null;
}

/** Reads use the resolved user, else the public default-user view. */
function viewUser(user) {
  return user?.userId || DEFAULT_USER_ID;
}

async function readSettings(db, userId, key) {
  const row = await db
    .prepare("SELECT value FROM settings WHERE user_id = ? AND key = ?")
    .bind(userId, key)
    .first();
  if (!row) return null;
  try {
    return JSON.parse(row.value);
  } catch {
    return null;
  }
}

async function writeSettings(db, userId, key, value) {
  const now = new Date().toISOString();
  await db
    .prepare(
      "INSERT INTO settings (user_id, key, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at"
    )
    .bind(userId, key, JSON.stringify(value), now)
    .run();
}

/** Agent 1 in the Worker: fetch public ATS boards, apply discover filters, upsert into D1. */
async function runDiscover(db, userId, payload = {}) {
  const stored = (await readSettings(db, userId, DISCOVER_KEY)) || {};
  const boards = payload.boards || stored.boards || {};
  const filters = payload.filters || stored.filters || {};
  const sources = [
    ["greenhouse", boards.greenhouse || [], fetchGreenhouseBoard],
    ["ashby", boards.ashby || [], fetchAshbyBoard],
    ["lever", boards.lever || [], fetchLeverCompany],
    ["workday", boards.workday || [], fetchWorkdayBoard],
  ];

  const fetched = [];
  const perBoard = [];
  for (const [name, tokens, fetcher] of sources) {
    for (const token of tokens.slice(0, 12)) {
      const label = `${name}/${token}`;
      try {
        const batch = await fetcher(token);
        perBoard.push({ board: label, count: batch.length, ok: true });
        fetched.push(...batch);
      } catch (err) {
        perBoard.push({ board: label, count: 0, ok: false, error: String(err.message || err).slice(0, 140) });
      }
    }
  }

  const kept = fetched.filter((job) => {
    try {
      return matchesTargets(job, filters);
    } catch {
      return true;
    }
  });

  const seen = new Set();
  const unique = [];
  for (const job of kept) {
    const key = `${job.source}:${job.external_id}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(job);
  }

  let existing = new Set();
  if (unique.length) {
    const { results } = await db
      .prepare("SELECT source, external_id FROM job_postings WHERE user_id = ?")
      .bind(userId)
      .all();
    existing = new Set((results || []).map((r) => `${r.source}:${r.external_id}`.toLowerCase()));
  }
  const fresh = unique.filter((j) => !existing.has(`${j.source}:${j.external_id}`.toLowerCase()));
  const capped = fresh.slice(0, MAX_JOB_UPSERTS);

  const stmts = capped.map((job) =>
    db
      .prepare(
        `INSERT INTO job_postings (user_id, source, external_id, title, company, location, url, apply_url, ats, match_score, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, source, external_id) DO UPDATE SET
           title=excluded.title, company=excluded.company, location=excluded.location,
           url=excluded.url, apply_url=excluded.apply_url, ats=excluded.ats,
           match_score=excluded.match_score, status=excluded.status`
      )
      .bind(
        userId,
        job.source || "unknown",
        job.external_id || job.url || "",
        job.title || "",
        job.company || "",
        job.location || "",
        job.url || "",
        job.apply_url || "",
        job.ats || "",
        String(job.match_score ?? ""),
        job.status || "discovered"
      )
  );
  if (stmts.length) await db.batch(stmts);

  const summary = {
    ok: true,
    fetched: fetched.length,
    kept: kept.length,
    fresh: fresh.length,
    upserted: capped.length,
    cappedAt: MAX_JOB_UPSERTS,
    perBoard,
    ranAt: new Date().toISOString(),
  };
  await writeSettings(db, userId, DISCOVER_LAST_RUN_KEY, summary);
  return summary;
}

async function allApplications(db, userId) {
  const { results } = await db
    .prepare("SELECT id, date, company, role, score, status, pdf, report, notes, url FROM applications WHERE user_id = ? ORDER BY id ASC")
    .bind(userId)
    .all();
  return results || [];
}

function sessionCookie(token, maxAgeSeconds) {
  const secure = true; // workers.dev is always HTTPS
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Secure=${secure}; Max-Age=${maxAgeSeconds}`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!env.DB) return json({ error: "D1 binding DB missing" }, 500);
    const user = await resolveUser(request, env);
    const authConfigured = Boolean(env.SUPABASE_URL);

    // ---- auth routes ----
    if (request.method === "GET" && (url.pathname === "/auth/login" || url.pathname === "/auth/callback")) {
      if (!authConfigured) {
        return html(
          loginHtml("", "", {
            mode: "unconfigured",
            note: "Multi-user auth is not configured on this deployment. Set SUPABASE_URL and SUPABASE_ANON_KEY (Cloudflare dashboard → Worker → Settings → Variables) to enable sign-up and sign-in. Until then the dashboard runs in single-user mode.",
          })
        );
      }
      return html(loginHtml(env.SUPABASE_URL, env.SUPABASE_ANON_KEY || "", { mode: url.pathname }));
    }

    if (request.method === "GET" && url.pathname === "/auth/me") {
      return json({
        authenticated: Boolean(user?.via === "jwt"),
        user: user?.via === "jwt" ? { id: user.userId, email: user.email, name: user.name } : null,
        view: viewUser(user),
        authConfigured,
      });
    }

    if (request.method === "POST" && url.pathname === "/auth/session") {
      if (!authConfigured) return json({ error: "auth not configured" }, 400);
      let body = {};
      try {
        body = await request.json();
      } catch {
        return json({ error: "invalid json" }, 400);
      }
      const v = await verifySupabaseJwt(String(body.access_token || ""), { supabaseUrl: env.SUPABASE_URL });
      if (!v.ok) return json({ error: `invalid token: ${v.error}` }, 401);
      const maxAge = Math.max(60, Math.floor(Number(v.payload.exp) - Date.now() / 1000));
      return new Response(JSON.stringify({ ok: true, user: { id: v.payload.sub, email: v.payload.email || "" } }), {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
          "set-cookie": sessionCookie(String(body.access_token), maxAge),
        },
      });
    }

    if (request.method === "POST" && url.pathname === "/auth/logout") {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "set-cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`,
        },
      });
    }

    if (request.method === "GET" && url.pathname === "/auth/logout") {
      return new Response(null, {
        status: 302,
        headers: {
          location: "/",
          "set-cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`,
        },
      });
    }

    // ---- multi-user gate: with auth configured, the dashboard IS the product.
    // Anonymous visitors get the sign-up/login page — never another user's data.
    // (Without SUPABASE_URL the Worker stays in single-user mode for the CLI.)
    if (authConfigured && !user) {
      if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
        return new Response(null, {
          status: 302,
          headers: { location: "/auth/login" },
        });
      }
      if (url.pathname.startsWith("/api/")) {
        return json({ error: "authentication required — sign in at /auth/login" }, 401);
      }
    }

    // ---- data reads resolve to the caller's user; unconfigured mode keeps the local view ----
    const userId = viewUser(user);

    if (request.method === "GET" && url.pathname === "/") {
      // First-run redirect: a fresh sign-up has no data and no local tool setup —
      // send them to the repo to install fillow, once. Later visits get the dashboard.
      if (user?.via === "jwt") {
        const SETUP_SEEN_KEY = "setup_seen";
        const [jobCountFirst, appsCountFirst, seenSetup] = await Promise.all([
          env.DB.prepare("SELECT COUNT(*) AS n FROM job_postings WHERE user_id = ?").bind(userId).first(),
          env.DB.prepare("SELECT COUNT(*) AS n FROM applications WHERE user_id = ?").bind(userId).first(),
          readSettings(env.DB, userId, SETUP_SEEN_KEY),
        ]);
        const hasData = Number(jobCountFirst?.n) > 0 || Number(appsCountFirst?.n) > 0;
        if (!hasData && !seenSetup) {
          await writeSettings(env.DB, userId, SETUP_SEEN_KEY, { at: new Date().toISOString() });
          return new Response(null, {
            status: 302,
            headers: { location: "https://github.com/taksha17/fillow" },
          });
        }
      }

      const rows = await allApplications(env.DB, userId);
      const [jobCount, companyQuery, statusQuery, recentQuery, scoredQuery] = await Promise.all([
        env.DB.prepare("SELECT COUNT(*) AS n FROM job_postings WHERE user_id = ?").bind(userId).first(),
        env.DB.prepare(
          "SELECT company, COUNT(*) AS n FROM job_postings WHERE user_id = ? AND company != '' GROUP BY company ORDER BY n DESC LIMIT 16"
        ).bind(userId).all(),
        env.DB.prepare("SELECT status, COUNT(*) AS n FROM job_postings WHERE user_id = ? GROUP BY status").bind(userId).all(),
        env.DB.prepare(
          "SELECT title, company, location, ats, match_score, status, url FROM job_postings WHERE user_id = ? ORDER BY rowid DESC LIMIT 24"
        ).bind(userId).all(),
        env.DB.prepare("SELECT COUNT(*) AS n FROM job_postings WHERE user_id = ? AND match_score != ''").bind(userId).first(),
      ]);
      const jobStatuses = Object.fromEntries((statusQuery.results || []).map((r) => [r.status || "discovered", Number(r.n) || 0]));
      const discoverSettings = (await readSettings(env.DB, userId, DISCOVER_KEY)) || { boards: {}, filters: {} };
      const lastRun = await readSettings(env.DB, userId, DISCOVER_LAST_RUN_KEY);
      return html(
        dashboardHtml(rows, undefined, {
          jobs: Number(jobCount?.n) || 0,
          scored: Number(scoredQuery?.n) || 0,
          jobStatuses,
          companies: companyQuery.results || [],
          recentJobs: recentQuery.results || [],
          discover: discoverSettings,
          lastRun,
          user: user?.via === "jwt" ? { email: user.email, name: user.name } : null,
          authConfigured,
        })
      );
    }

    if (request.method === "GET" && url.pathname === "/api/dashboard") {
      const rows = await allApplications(env.DB, userId);
      return json({ metrics: metricsFrom(rows), applications: rows, user: userId });
    }

    if (request.method === "GET" && url.pathname === "/api/applications") {
      return json({ applications: await allApplications(env.DB, userId) });
    }

    if (request.method === "GET" && url.pathname === "/api/jobs") {
      const { results } = await env.DB.prepare(
        "SELECT source, external_id, title, company, location, url, apply_url, ats, match_score, status FROM job_postings WHERE user_id = ? LIMIT 500"
      ).bind(userId).all();
      return json({ jobs: results || [] });
    }

    if (request.method === "GET" && url.pathname.startsWith("/api/resume/")) {
      const num = Number(url.pathname.slice("/api/resume/".length));
      if (!num) return json({ error: "invalid application number" }, 400);
      const row = await env.DB.prepare(
        "SELECT resume_md, company FROM applications WHERE id = ? AND user_id = ?"
      ).bind(num, userId).first();
      if (!row || !row.resume_md) {
        return json({ error: "file not available on server — resume_md missing; re-run fillow track / repair-dashboard" }, 404);
      }
      const slug = String(row.company || "resume").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "resume";
      return new Response(row.resume_md, {
        headers: {
          "content-type": "text/markdown; charset=utf-8",
          "content-disposition": `attachment; filename="resume-${slug}.md"`,
          "cache-control": "no-store",
        },
      });
    }

    if (request.method === "GET" && url.pathname === "/api/settings") {
      return json({
        settings: (await readSettings(env.DB, userId, DISCOVER_KEY)) || { boards: {}, filters: {} },
        lastRun: await readSettings(env.DB, userId, DISCOVER_LAST_RUN_KEY),
      });
    }

    // ---- mutations: require an identity (JWT user or legacy sync token) ----
    if (!user) return json({ error: "unauthorized" }, 401);
    const actorId = user.userId;

    if (request.method === "POST" && url.pathname === "/api/settings") {
      let payload;
      try {
        payload = await request.json();
      } catch {
        return json({ error: "invalid json" }, 400);
      }
      const value = { boards: payload.boards || {}, filters: payload.filters || {} };
      await writeSettings(env.DB, actorId, DISCOVER_KEY, value);
      return json({ ok: true, saved: value });
    }

    if (request.method === "POST" && url.pathname === "/api/discover") {
      let payload = {};
      try {
        payload = await request.json();
      } catch {
        payload = {};
      }
      const summary = await runDiscover(env.DB, actorId, payload);
      return json(summary);
    }

    if (request.method === "POST" && url.pathname === "/api/sync") {
      let payload;
      try {
        payload = await request.json();
      } catch {
        return json({ error: "invalid json" }, 400);
      }
      const apps = payload.applications || [];
      const jobs = payload.jobs || [];
      const now = new Date().toISOString();
      for (const row of apps) {
        await env.DB.prepare(
          `INSERT INTO applications (user_id, id, date, company, role, score, status, pdf, report, notes, url, resume_md, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             date=excluded.date, company=excluded.company, role=excluded.role, score=excluded.score,
             status=excluded.status, pdf=excluded.pdf, report=excluded.report, notes=excluded.notes,
             url=excluded.url, resume_md=excluded.resume_md, updated_at=excluded.updated_at
           WHERE applications.user_id = excluded.user_id`
        )
          .bind(
            actorId,
            Number(row.num || row.id) || null,
            row.date || "",
            row.company || "",
            row.role || "",
            row.score || "",
            row.status || "pending",
            row.pdf || "",
            row.report || "",
            row.notes || "",
            row.url || "",
            row.resume_md || "",
            now
          )
          .run();
      }
      for (const job of jobs) {
        await env.DB.prepare(
          `INSERT INTO job_postings (user_id, source, external_id, title, company, location, url, apply_url, ats, match_score, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id, source, external_id) DO UPDATE SET
             title=excluded.title, company=excluded.company, location=excluded.location,
             url=excluded.url, apply_url=excluded.apply_url, ats=excluded.ats,
             match_score=excluded.match_score, status=excluded.status`
        )
          .bind(
            actorId,
            job.source || "unknown",
            job.external_id || job.url || "",
            job.title || "",
            job.company || "",
            job.location || "",
            job.url || "",
            job.apply_url || "",
            job.ats || "",
            String(job.match_score ?? ""),
            job.status || "discovered"
          )
          .run();
      }
      const metrics = metricsFrom(apps);
      await env.DB.prepare(
        `INSERT INTO dashboard_metrics (user_id, captured_at, total, conversion_rate, by_status)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id, captured_at) DO UPDATE SET total=excluded.total, conversion_rate=excluded.conversion_rate, by_status=excluded.by_status`
      )
        .bind(actorId, now, metrics.total, metrics.conversion_rate, JSON.stringify(metrics.byStatus))
        .run();
      if (payload.settings && (payload.settings.boards || payload.settings.filters)) {
        await writeSettings(env.DB, actorId, DISCOVER_KEY, {
          boards: payload.settings.boards || {},
          filters: payload.settings.filters || {},
        });
      }
      return json({ ok: true, applications: apps.length, jobs: jobs.length });
    }

    return json({ error: "not found" }, 404);
  },
};

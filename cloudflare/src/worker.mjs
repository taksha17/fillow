import { dashboardHtml, metricsFrom } from "./html.mjs";

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

async function allApplications(db) {
  const { results } = await db.prepare(
    "SELECT id, date, company, role, score, status, pdf, report, notes, url FROM applications ORDER BY id ASC"
  ).all();
  return results || [];
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!env.DB) return json({ error: "D1 binding DB missing" }, 500);

    if (request.method === "GET" && url.pathname === "/") {
      const rows = await allApplications(env.DB);
      const [jobCount, companyQuery, statusQuery, recentQuery, scoredQuery] = await Promise.all([
        env.DB.prepare("SELECT COUNT(*) AS n FROM job_postings").first(),
        env.DB.prepare(
          "SELECT company, COUNT(*) AS n FROM job_postings WHERE company != '' GROUP BY company ORDER BY n DESC LIMIT 16"
        ).all(),
        env.DB.prepare("SELECT status, COUNT(*) AS n FROM job_postings GROUP BY status").all(),
        env.DB.prepare(
          "SELECT title, company, location, ats, match_score, status, url FROM job_postings ORDER BY rowid DESC LIMIT 24"
        ).all(),
        env.DB.prepare("SELECT COUNT(*) AS n FROM job_postings WHERE match_score != ''").first(),
      ]);
      const jobStatuses = Object.fromEntries((statusQuery.results || []).map((r) => [r.status || "discovered", Number(r.n) || 0]));
      return html(
        dashboardHtml(rows, undefined, {
          jobs: Number(jobCount?.n) || 0,
          scored: Number(scoredQuery?.n) || 0,
          jobStatuses,
          companies: companyQuery.results || [],
          recentJobs: recentQuery.results || [],
        })
      );
    }

    if (request.method === "GET" && url.pathname === "/api/dashboard") {
      const rows = await allApplications(env.DB);
      return json({ metrics: metricsFrom(rows), applications: rows });
    }

    if (request.method === "GET" && url.pathname === "/api/applications") {
      return json({ applications: await allApplications(env.DB) });
    }

    if (request.method === "GET" && url.pathname === "/api/jobs") {
      const { results } = await env.DB.prepare(
        "SELECT source, external_id, title, company, location, url, apply_url, ats, match_score, status FROM job_postings LIMIT 500"
      ).all();
      return json({ jobs: results || [] });
    }

    if (request.method === "GET" && url.pathname.startsWith("/api/resume/")) {
      const num = Number(url.pathname.slice("/api/resume/".length));
      if (!num) return json({ error: "invalid application number" }, 400);
      const row = await env.DB.prepare("SELECT resume_md, company FROM applications WHERE id = ?").first(num);
      if (!row || !row.resume_md) return json({ error: "no resume on file for this application" }, 404);
      const slug = String(row.company || "resume").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "resume";
      return new Response(row.resume_md, {
        headers: {
          "content-type": "text/markdown; charset=utf-8",
          "content-disposition": `attachment; filename="resume-${slug}.md"`,
          "cache-control": "no-store",
        },
      });
    }

    if (request.method === "POST" && url.pathname === "/api/sync") {
      const expected = env.FILLLOW_SYNC_TOKEN;
      const got = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
      if (!expected || got !== expected) return json({ error: "unauthorized" }, 401);
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
          `INSERT INTO applications (id, date, company, role, score, status, pdf, report, notes, url, resume_md, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             date=excluded.date, company=excluded.company, role=excluded.role, score=excluded.score,
             status=excluded.status, pdf=excluded.pdf, report=excluded.report, notes=excluded.notes,
             url=excluded.url, resume_md=excluded.resume_md, updated_at=excluded.updated_at`
        )
          .bind(
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
          `INSERT INTO job_postings (source, external_id, title, company, location, url, apply_url, ats, match_score, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(source, external_id) DO UPDATE SET
             title=excluded.title, company=excluded.company, location=excluded.location,
             url=excluded.url, apply_url=excluded.apply_url, ats=excluded.ats,
             match_score=excluded.match_score, status=excluded.status`
        )
          .bind(
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
        `INSERT INTO dashboard_metrics (captured_at, total, conversion_rate, by_status)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(captured_at) DO UPDATE SET total=excluded.total, conversion_rate=excluded.conversion_rate, by_status=excluded.by_status`
      )
        .bind(now, metrics.total, metrics.conversion_rate, JSON.stringify(metrics.byStatus))
        .run();
      return json({ ok: true, applications: apps.length, jobs: jobs.length });
    }

    return json({ error: "not found" }, 404);
  },
};

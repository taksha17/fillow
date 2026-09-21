import { existsSync, readFileSync } from "node:fs";
import { PATHS } from "./paths.mjs";
import { readTracker, urlFromNotes, metricsFromRows } from "./tracker.mjs";
import { readJobs, matchJobByUrlTokens } from "./jobs-tsv.mjs";
import { tailoredResumePath } from "./resume-pdf.mjs";

export function syncPayload() {
  const jobs = existsSync(PATHS.jobsTsv) ? readJobs() : [];
  const applications = readTracker().map((row) => {
    const job = matchJobByUrlTokens(row.url || urlFromNotes(row.notes), jobs);
    const mdPath = job ? tailoredResumePath(job).replace(/\.pdf$/, ".md") : "";
    return {
      ...row,
      url: urlFromNotes(row.notes),
      resume_md: mdPath && existsSync(mdPath) ? readFileSync(mdPath, "utf8") : "",
    };
  });
  const metrics = metricsFromRows(applications);
  return { applications, jobs, metrics, captured_at: new Date().toISOString() };
}

function sqlStr(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

export function syncSql(payload = syncPayload()) {
  const lines = [];
  for (const row of payload.applications) {
    lines.push(
      `INSERT INTO applications (id, date, company, role, score, status, pdf, report, notes, url, resume_md, updated_at)
VALUES (${Number(row.num) || "NULL"}, ${sqlStr(row.date)}, ${sqlStr(row.company)}, ${sqlStr(row.role)}, ${sqlStr(row.score)}, ${sqlStr(row.status)}, ${sqlStr(row.pdf)}, ${sqlStr(row.report)}, ${sqlStr(row.notes)}, ${sqlStr(row.url)}, ${sqlStr(row.resume_md)}, ${sqlStr(payload.captured_at)})
ON CONFLICT(id) DO UPDATE SET
  date=excluded.date, company=excluded.company, role=excluded.role, score=excluded.score,
  status=excluded.status, pdf=excluded.pdf, report=excluded.report, notes=excluded.notes,
  url=excluded.url, resume_md=excluded.resume_md, updated_at=excluded.updated_at;`
    );
  }
  for (const job of payload.jobs) {
    lines.push(
      `INSERT INTO job_postings (source, external_id, title, company, location, url, apply_url, ats, match_score, status)
VALUES (${sqlStr(job.source)}, ${sqlStr(job.external_id)}, ${sqlStr(job.title)}, ${sqlStr(job.company)}, ${sqlStr(job.location)}, ${sqlStr(job.url)}, ${sqlStr(job.apply_url)}, ${sqlStr(job.ats)}, ${sqlStr(job.match_score)}, ${sqlStr(job.status)})
ON CONFLICT(source, external_id) DO UPDATE SET
  title=excluded.title, company=excluded.company, location=excluded.location,
  url=excluded.url, apply_url=excluded.apply_url, ats=excluded.ats,
  match_score=excluded.match_score, status=excluded.status;`
    );
  }
  lines.push(
    `INSERT INTO dashboard_metrics (captured_at, total, conversion_rate, by_status)
VALUES (${sqlStr(payload.captured_at)}, ${payload.metrics.total}, ${payload.metrics.conversion_rate}, ${sqlStr(JSON.stringify(payload.metrics.byStatus))})
ON CONFLICT(captured_at) DO UPDATE SET total=excluded.total, conversion_rate=excluded.conversion_rate, by_status=excluded.by_status;`
  );
  return `${lines.join("\n")}\n`;
}

export async function pushSyncHttp(payload, { url, token } = {}) {
  if (!url || !token) return { ok: false, skipped: true, reason: "missing FILLLOW_SYNC_URL or FILLLOW_SYNC_TOKEN" };
  // Workers Free has a 10ms CPU budget. Applications stay small; bulk jobs go
  // through `wrangler d1 execute` (npm run cf:sync), not this HTTP path.
  const res = await fetch(`${url.replace(/\/$/, "")}/api/sync`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      ...payload,
      jobs: (payload.jobs || []).slice(0, 50),
    }),
  });
  const body = await res.text();
  if (!res.ok) return { ok: false, status: res.status, body: body.slice(0, 500) };
  return { ok: true, body };
}

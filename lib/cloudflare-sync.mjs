import { existsSync, readFileSync } from "node:fs";
import { PATHS } from "./paths.mjs";
import { loadConfig } from "./config.mjs";
import { readTracker, urlFromNotes, metricsFromRows, mghJobKey } from "./tracker.mjs";
import { readJobs, matchJobByUrlTokens } from "./jobs-tsv.mjs";
import { tailoredResumePath } from "./resume-pdf.mjs";

function resumeMdForRow(row, jobs) {
  const url = row.url || urlFromNotes(row.notes);
  let job = matchJobByUrlTokens(url, jobs);
  if (!job) {
    const key = mghJobKey(url) || mghJobKey(row.notes);
    if (key) job = jobs.find((j) => String(j.external_id || "").toLowerCase() === key) || null;
  }
  if (!job) {
    // Synthetic path from company + id so repair-dashboard md files still match.
    const key = mghJobKey(url) || mghJobKey(row.notes) || `tracker:${row.num}`;
    job = { company: row.company, external_id: key, title: row.role, url };
  }
  const mdPath = tailoredResumePath(job).replace(/\.pdf$/, ".md");
  if (mdPath && existsSync(mdPath)) {
    try {
      return readFileSync(mdPath, "utf8");
    } catch {
      return "";
    }
  }
  return "";
}

function safeConfig() {
  try {
    return loadConfig();
  } catch {
    return {};
  }
}

/** Agent 1 settings pushed to the Worker dashboard (boards + discover filters from profile.yaml). */
export function discoverSettings(cfg = {}) {
  return {
    boards: {
      greenhouse: cfg.greenhouse_boards || [],
      ashby: cfg.ashby_boards || [],
      lever: cfg.lever_companies || [],
      workday: cfg.workday_boards || [],
    },
    filters: {
      keywords: cfg.targets?.keywords || [],
      exclude_keywords: cfg.targets?.exclude_keywords || [],
      locations: cfg.targets?.locations || [],
      remote_ok: cfg.targets?.remote_ok !== false,
      posted_within_days: Number(cfg.targets?.posted_within_days || 0),
    },
  };
}

export function syncPayload(cfg = safeConfig(), userId = null) {
  const jobs = existsSync(PATHS.jobsTsv) ? readJobs() : [];
  const applications = readTracker().map((row) => {
    const job = matchJobByUrlTokens(row.url || urlFromNotes(row.notes), jobs);
    const resume_md = resumeMdForRow(row, jobs);
    return {
      ...row,
      url: urlFromNotes(row.notes),
      resume_md,
      user_id: userId,
      // keep prior field for callers that still look at resume_md via job path
      resume_md_path: job ? tailoredResumePath(job).replace(/\.pdf$/, ".md") : "",
    };
  });
  const metrics = metricsFromRows(applications);
  return { applications, jobs, metrics, settings: discoverSettings(cfg), captured_at: new Date().toISOString(), user_id: userId };
}

function sqlEscape(value) {
    if (value === null || value === undefined) return "NULL";
    const str = String(value);
    // Escape single quotes and backslashes for SQL string literals
    const escaped = str.replace(/'/g, "''").replace(/\\/g, "\\\\");
    return `'${escaped}'`;
}

export function syncSql(payload = syncPayload()) {
    const lines = [];
    for (const row of payload.applications) {
        lines.push(
            `INSERT INTO applications (id, user_id, date, company, role, score, status, pdf, report, notes, url, resume_md, updated_at)
 VALUES (${Number(row.num) || "NULL"}, ${sqlEscape(payload.user_id)}, ${sqlEscape(row.date)}, ${sqlEscape(row.company)}, ${sqlEscape(row.role)}, ${sqlEscape(row.score)}, ${sqlEscape(row.status)}, ${sqlEscape(row.pdf)}, ${sqlEscape(row.report)}, ${sqlEscape(row.notes)}, ${sqlEscape(row.url)}, ${sqlEscape(row.resume_md)}, ${sqlEscape(payload.captured_at)})
 ON CONFLICT(id) DO UPDATE SET
   date=excluded.date, company=excluded.company, role=excluded.role, score=excluded.score,
   status=excluded.status, pdf=excluded.pdf, report=excluded.report, notes=excluded.notes,
   url=excluded.url, resume_md=excluded.resume_md, updated_at=excluded.updated_at;`
        );
    }
    for (const job of payload.jobs) {
        lines.push(
            `INSERT INTO job_postings (source, external_id, user_id, title, company, location, url, apply_url, ats, match_score, status)
 VALUES (${sqlEscape(job.source)}, ${sqlEscape(job.external_id)}, ${sqlEscape(payload.user_id)}, ${sqlEscape(job.title)}, ${sqlEscape(job.company)}, ${sqlEscape(job.location)}, ${sqlEscape(job.url)}, ${sqlEscape(job.apply_url)}, ${sqlEscape(job.ats)}, ${sqlEscape(job.match_score)}, ${sqlEscape(job.status)})
 ON CONFLICT(user_id, source, external_id) DO UPDATE SET
   title=excluded.title, company=excluded.company, location=excluded.location,
   url=excluded.url, apply_url=excluded.apply_url, ats=excluded.ats,
   match_score=excluded.match_score, status=excluded.status;`
        );
    }
    lines.push(
        `INSERT INTO dashboard_metrics (captured_at, user_id, total, conversion_rate, by_status)
 VALUES (${sqlEscape(payload.captured_at)}, ${sqlEscape(payload.user_id)}, ${payload.metrics.total}, ${payload.metrics.conversion_rate}, ${sqlEscape(JSON.stringify(payload.metrics.byStatus))})
 ON CONFLICT(user_id, captured_at) DO UPDATE SET total=excluded.total, conversion_rate=excluded.conversion_rate, by_status=excluded.by_status;`
    );
    lines.push(
        `INSERT INTO settings (key, user_id, value, updated_at)
 VALUES ('discover', ${sqlEscape(payload.user_id)}, ${sqlEscape(JSON.stringify(payload.settings || {}))}, ${sqlEscape(payload.captured_at)})
 ON CONFLICT(user_id, key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at;`
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

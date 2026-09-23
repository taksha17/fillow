#!/usr/bin/env node
/**
 * 120-minute apply loop: retailor (force) → apply → track.
 * Retries open review jobs first, then picks new Greenhouse US IC roles.
 *
 * Usage:
 *   DISPLAY=:0 DRY_RUN=false REVIEW_MODE=false node scripts/nap-apply.mjs
 *   NAP_MINUTES=120 node scripts/nap-apply.mjs
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../lib/config.mjs";
import { readJobs } from "../lib/jobs-tsv.mjs";
import { ensureJobDescription } from "../lib/ats.mjs";
import { analyzeJD } from "../lib/jd-analyze.mjs";
import { generateSinglePdf } from "../lib/resume-pdf.mjs";
import { generateCoverLetter, writeCoverLetter } from "../lib/cover-letter.mjs";
import { launchBrowser, sleep } from "../lib/browser.mjs";
import { applyOnPage } from "../lib/form-fill.mjs";
import { makeLlmChat } from "../lib/llm.mjs";
import { appendApplication, readTracker, updateApplication } from "../lib/tracker.mjs";
import { isBlacklisted } from "../lib/blacklist.mjs";
import { pushSyncHttp, syncPayload } from "../lib/cloudflare-sync.mjs";
import { PATHS, ensureDataDirs } from "../lib/paths.mjs";
import { writeDashboard } from "../lib/dashboard.mjs";
import { metricsFromRows } from "../lib/tracker.mjs";

const NAP_MS = (Number(process.env.NAP_MINUTES) || 120) * 60 * 1000;
const PACE_MIN_S = Number(process.env.NAP_PACE_MIN) || 40;
const PACE_MAX_S = Number(process.env.NAP_PACE_MAX) || 75;
const MIN_SCORE = Number(process.env.NAP_MIN_SCORE) || 78;

const RETRY_FIRST = [
  "blend:6123761004",
  "airtable:8397515002",
  "anthropic:5198108008",
  "okta:8208377",
  "robinhood:8072766",
  "scaleai:4631848005",
];

function qualityOk(mdPath) {
  if (!existsSync(mdPath)) return { ok: false, reason: "md missing" };
  const md = readFileSync(mdPath, "utf8");
  const bullets = (md.match(/^- /gm) || []).length;
  if (bullets < 8) return { ok: false, reason: `bullets=${bullets}` };
  if (!/## Experience/i.test(md) || !/## Education/i.test(md)) return { ok: false, reason: "missing sections" };
  if (/please see resume|lorem ipsum|placeholder|TODO fill/i.test(md)) return { ok: false, reason: "stub" };
  if (md.length < 800) return { ok: false, reason: `chars=${md.length}` };
  return { ok: true, bullets, chars: md.length };
}

function trackerUrlsAndIds() {
  const rows = readTracker();
  const urls = new Set();
  const ids = new Set();
  const companies = new Set();
  for (const row of rows) {
    const notes = String(row.notes || "");
    for (const m of notes.matchAll(/https?:\/\/\S+/g)) urls.add(m[0].replace(/[)\\|,]+$/, ""));
    for (const m of notes.matchAll(/(?:gh_jid=|\/jobs\/|\/job\/)([0-9a-f-]{6,})/gi)) ids.add(m[1]);
    for (const m of notes.matchAll(/ashbyhq\.com\/[^/]+\/([0-9a-f-]{36})/gi)) ids.add(m[1]);
    if (row.company) companies.add(String(row.company).toLowerCase());
  }
  return { urls, ids, companies, rows };
}

function isMgmtTitle(title) {
  return /\b(manager|director|vp of|head of|principal architect|lead data scientist)\b/i.test(title || "");
}

function isBadLocation(loc) {
  const l = String(loc || "").toLowerCase();
  return /\bpoland\b|\bindia\b|\bchina\b|\bbeijing\b|\breykjav|\bbelgrade\b|\beu\b only/.test(l);
}

function pickNextJobs(all, seen, { urls, ids, companies }, limit = 1) {
  const out = [];
  const scored = all
    .filter((j) => j.status === "ready" || !j.status)
    .map((j) => ({ ...j, match_score: Number(j.match_score) || 0 }))
    .filter((j) => j.match_score >= MIN_SCORE)
    .filter((j) => !isMgmtTitle(j.title))
    .filter((j) => !isBadLocation(j.location))
    .filter((j) => ["greenhouse", "ashby", "lever"].includes(String(j.ats || "").toLowerCase()))
    .filter((j) => !isBlacklisted(j.company))
    .filter((j) => {
      // Skip known-bad geo roles even if location string is vague
      if (/china|singapore|united kingdom|\buk\b|poland|warsaw/i.test(`${j.title || ""} ${j.location || ""}`)) return false;
      const eid = String(j.external_id || "");
      const bare = eid.includes(":") ? eid.split(":").pop() : eid;
      if (seen.has(eid) || ids.has(bare) || ids.has(eid)) return false;
      const u = j.apply_url || j.url || "";
      if (u && [...urls].some((x) => x.includes(bare) || (u && x === u))) return false;
      // Never re-apply companies already contacted (applied/submitted/review/rejected).
      if (companies.has(String(j.company || "").toLowerCase())) return false;
      return true;
    })
    .sort((a, b) => {
      const atsRank = (x) => (String(x.ats).toLowerCase() === "greenhouse" ? 0 : String(x.ats).toLowerCase() === "ashby" ? 1 : 2);
      return b.match_score - a.match_score || atsRank(a) - atsRank(b) || String(a.company).localeCompare(String(b.company));
    });

  const usedCompany = new Set();
  for (const job of scored) {
    const c = String(job.company || "").toLowerCase();
    if (usedCompany.has(c)) continue;
    usedCompany.add(c);
    out.push(job);
    if (out.length >= limit) break;
  }
  return out;
}

async function retailor(cfg, job, liveDir) {
  await ensureJobDescription(job);
  console.log(`  JD chars: ${(job.description || "").length}`);
  try {
    job._jd_analysis = await analyzeJD(job, cfg);
    console.log(`  JD: ${job._jd_analysis?._source || "?"} seniority=${job._jd_analysis?.seniority_level || "?"}`);
  } catch (err) {
    console.warn(`  JD analysis failed: ${err.message}`);
    job._jd_analysis = null;
  }
  const pdf = await generateSinglePdf(cfg, job, { force: true });
  const md = pdf.replace(/\.pdf$/, ".md");
  const q = qualityOk(md);
  console.log(`  PDF quality=${JSON.stringify(q)}`);
  if (!q.ok) throw new Error(`quality gate: ${q.reason}`);
  const base = `${job.company}-${String(job.external_id).replace(/:/g, "-")}`;
  const livePdf = join(liveDir, `${base}.pdf`);
  const liveMd = join(liveDir, `${base}.md`);
  copyFileSync(pdf, livePdf);
  copyFileSync(md, liveMd);
  return livePdf;
}

function recordResult(job, out) {
  const url = job.apply_url || job.url || "";
  const patch = {
    status: out.status,
    score: job.match_score,
    pdf: "✅",
    notes: out.notes || "",
  };
  const updated = updateApplication({ company: job.company, role: job.title, url }, patch);
  if (updated.updated) return updated;
  return appendApplication({
    company: job.company,
    role: job.title,
    score: job.match_score,
    status: out.status,
    pdf: "✅",
    notes: out.notes || "",
    url,
  });
}

async function syncCf(cfg) {
  if (!cfg.secrets?.fillow_sync_url || !cfg.secrets?.fillow_sync_token) return;
  const cf = await pushSyncHttp(syncPayload(), {
    url: cfg.secrets.fillow_sync_url,
    token: cfg.secrets.fillow_sync_token,
  });
  if (cf.ok) console.log("  Cloudflare sync ok");
  else if (!cf.skipped) console.warn(`  Cloudflare sync failed: ${cf.status || cf.reason}`);
}

async function main() {
  ensureDataDirs();
  const cfg = loadConfig();
  const liveDir = join(PATHS.tailored, "agent3-live");
  mkdirSync(liveDir, { recursive: true });
  const deadline = Date.now() + NAP_MS;
  const seen = new Set();
  const llmChat = makeLlmChat(cfg);

  console.log(`[nap-apply] minutes=${NAP_MS / 60000} dry_run=${cfg.runtime.dry_run} zip=${cfg.candidate.zip_code} office=${cfg.candidate.office_preference}`);
  if (cfg.runtime.dry_run) {
    console.error("DRY_RUN=true — refusing live nap loop");
    process.exit(1);
  }

  let session = null;
  let applied = 0;
  let review = 0;
  let failed = 0;

  const queue = [];
  const all0 = readJobs();
  for (const id of RETRY_FIRST) {
    const job = all0.find((j) => j.external_id === id);
    if (job) queue.push(job);
  }

  try {
    while (Date.now() < deadline) {
      if (!queue.length) {
        const meta = trackerUrlsAndIds();
        const next = pickNextJobs(readJobs(), seen, meta, 3);
        if (!next.length) {
          console.log("  no more Greenhouse candidates — sleeping 3m");
          await sleep(180000);
          continue;
        }
        queue.push(...next);
      }

      const job = queue.shift();
      const eid = String(job.external_id || "");
      if (seen.has(eid)) continue;
      seen.add(eid);

      const leftMin = ((deadline - Date.now()) / 60000).toFixed(1);
      console.log(`\n=== [${leftMin}m left] ${job.company} — ${job.title} (${job.match_score})`);

      let resumePath;
      try {
        resumePath = await retailor(cfg, job, liveDir);
      } catch (err) {
        console.error(`  retailor failed: ${err.message}`);
        failed += 1;
        continue;
      }

      try {
        const coverText = await generateCoverLetter(cfg, job);
        const coverPath = writeCoverLetter(coverText, job);
        if (!session) session = await launchBrowser(cfg);
        const page = await session.context.newPage();
        const out = await applyOnPage(page, job, {
          cfg,
          resumePath,
          coverPath,
          coverText,
          llmChat,
          humanize: true,
          reviewMode: false,
          autoSubmit: true,
          pauseSeconds: cfg.runtime.pre_submit_pause_seconds ?? 4,
        });
        await page.close().catch(() => {});
        recordResult(job, out);
        if (out.status === "review" && Array.isArray(out.stuck_labels) && out.stuck_labels.length) {
          console.log(`  stuck labels: ${out.stuck_labels.slice(0, 4).join(" | ")}`);
        }
        const rows = readTracker();
        writeDashboard(rows, cfg.dashboard?.title || "fillow — Application Dashboard");
        await syncCf(cfg);
        console.log(`  => ${out.status}: ${(out.notes || "").slice(0, 200)}`);
        if (out.status === "applied" || out.status === "submitted") applied += 1;
        else if (out.status === "review") review += 1;
        else failed += 1;
      } catch (err) {
        console.error(`  apply failed: ${err.message}`);
        recordResult(job, { status: "failed", notes: String(err.message || err).slice(0, 400) });
        failed += 1;
      }

      if (Date.now() >= deadline) break;
      const delay = PACE_MIN_S + Math.random() * (PACE_MAX_S - PACE_MIN_S);
      console.log(`  pacing ${delay.toFixed(0)}s… (totals applied=${applied} review=${review} failed=${failed})`);
      await sleep(delay * 1000);
    }
  } finally {
    if (session) {
      await session.context.close().catch(() => {});
      await session.browser.close().catch(() => {});
    }
  }

  const rows = readTracker();
  const metrics = metricsFromRows(rows);
  console.log(`\n[nap-apply] DONE applied=${applied} review=${review} failed=${failed}`);
  console.log(`  tracker ${metrics.total} rows ${JSON.stringify(metrics.byStatus)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

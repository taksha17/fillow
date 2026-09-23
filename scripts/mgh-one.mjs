#!/usr/bin/env node
/**
 * One live MyGreenhouse apply in a maximized, focused Agent Window.
 *
 *   DISPLAY=:0 DRY_RUN=false node scripts/mgh-one.mjs
 *   DISPLAY=:0 DRY_RUN=true  node scripts/mgh-one.mjs   # fill only, no submit
 *   DISPLAY=:0 DRY_RUN=false node scripts/mgh-one.mjs --retry-url 'https://my.greenhouse.io/jobs/torcrobotics/8765533002'
 */
import { existsSync } from "node:fs";
import { loadConfig } from "../lib/config.mjs";
import { readJobs, updateJobStatus, upsertJobs } from "../lib/jobs-tsv.mjs";
import { isBlacklisted } from "../lib/blacklist.mjs";
import { isUsJobLocation } from "../lib/location.mjs";
import {
  readTracker,
  mghJobKey,
  appendApplication,
  updateApplication,
  urlFromNotes,
} from "../lib/tracker.mjs";
import { withSession, pause, watchWindowSize } from "../lib/bsk.mjs";
import {
  scrapeMyGreenhouseQueries,
  applyMyGreenhouseJob,
  seedCommonQaBank,
  mghCanonicalUrl,
} from "../lib/mygreenhouse.mjs";
import { resolveResumePath, generateSinglePdf, tailoredResumePath } from "../lib/resume-pdf.mjs";
import { ensureJobDescription } from "../lib/ats.mjs";
import { analyzeJD } from "../lib/jd-analyze.mjs";
import { makeLlmChat } from "../lib/llm.mjs";
import { writeDashboard } from "../lib/dashboard.mjs";
import { pushSyncHttp, syncPayload } from "../lib/cloudflare-sync.mjs";

function matchesTargets(job, targets) {
  const hay = `${job.title} ${job.location} ${job.company}`.toLowerCase();
  for (const ex of targets.exclude_keywords || []) {
    if (ex && hay.includes(ex.toLowerCase())) return false;
  }
  const keywords = targets.keywords || [];
  if (!keywords.length) return true;
  return keywords.some((k) => hay.includes(k.toLowerCase()));
}

function contacted() {
  const companies = new Set();
  const keys = new Set();
  for (const row of readTracker()) {
    const notes = String(row.notes || "");
    const falsePos = /FALSE_POSITIVE/i.test(notes);
    const status = String(row.status || "").toLowerCase();
    // Allow retry of false-positive "applied"/review rows — they never landed.
    if (falsePos && /review|applied|submitted/i.test(status)) continue;
    if (row.company) companies.add(String(row.company).toLowerCase());
    const k = mghJobKey(row.notes);
    if (k) keys.add(k);
  }
  return { companies, keys };
}

function pickOne(jobs, seen) {
  return jobs.find((j) => {
    if (!isUsJobLocation(j)) return false;
    if (isBlacklisted(j.company)) return false;
    const key = mghJobKey(j.external_id) || mghJobKey(j.apply_url || j.url);
    // Skip only this exact posting — other roles at the same company are OK.
    if (key && seen.keys.has(key)) return false;
    return true;
  });
}

/** Prefer a never-contacted company; else fall back to a new job key at a known company. */
function pickNext(jobs, seen) {
  const fresh = jobs.find((j) => {
    if (!isUsJobLocation(j)) return false;
    if (isBlacklisted(j.company)) return false;
    const key = mghJobKey(j.external_id) || mghJobKey(j.apply_url || j.url);
    if (key && seen.keys.has(key)) return false;
    if (seen.companies.has(String(j.company || "").toLowerCase())) return false;
    return true;
  });
  if (fresh) return fresh;
  return pickOne(jobs, seen);
}

function jobFromUrl(url) {
  const m = String(url || "").match(/my\.greenhouse\.io\/jobs\/([^/?#]+)\/(\d+)/i);
  if (!m) return null;
  return {
    company: m[1],
    title: `${m[1]} #${m[2]}`,
    apply_url: `https://my.greenhouse.io/jobs/${m[1]}/${m[2]}`,
    url: `https://my.greenhouse.io/jobs/${m[1]}/${m[2]}`,
    external_id: `mgh:${m[1].toLowerCase()}:${m[2]}`,
    source: "mygreenhouse",
    board_token: m[1],
    location: "United States",
    status: "ready",
  };
}

function pickFalsePositiveRetry(preferUrl = "") {
  const preferKey = mghJobKey(preferUrl);
  if (preferUrl && preferKey) {
    const fromUrl = jobFromUrl(preferUrl);
    if (fromUrl) {
      const row = readTracker().find((r) => mghJobKey(urlFromNotes(r.notes) || r.url) === preferKey);
      if (row) {
        fromUrl.title = row.role || fromUrl.title;
        fromUrl.company = row.company || fromUrl.company;
        fromUrl.match_score = row.score || "";
        fromUrl._tracker_num = row.num;
      }
      fromUrl._retry = true;
      return fromUrl;
    }
  }
  const rows = readTracker().filter((r) => {
    const status = String(r.status || "");
    if (!/review|applied|submitted/i.test(status)) return false;
    const notes = String(r.notes || "");
    if (/CONFIRMED|do not retry/i.test(notes)) return false;
    const url = urlFromNotes(notes) || r.url;
    if (!mghJobKey(url)) return false;
    // Parsed notes may drop "| FALSE_POSITIVE…" when markdown escapes split cells.
    return /FALSE_POSITIVE|unconfirmed|BrowserSkill/i.test(notes) || /review/i.test(status);
  });
  rows.sort((a, b) => Number(b.num) - Number(a.num));
  const row = rows[0];
  if (!row) return null;
  const url = urlFromNotes(row.notes) || row.url;
  const job = jobFromUrl(url);
  if (!job) return null;
  job.title = row.role || job.title;
  job.company = row.company || job.company;
  job.match_score = row.score || "";
  job._tracker_num = row.num;
  job._retry = true;
  return job;
}

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  if (i < 0) return "";
  return String(process.argv[i + 1] || "").trim();
}

async function main() {
  const cfg = loadConfig();
  seedCommonQaBank(cfg.candidate, cfg.answer_preferences || {});
  const llmChat = makeLlmChat(cfg);
  const seen = contacted();
  // Only retry a specific URL when --retry-url is passed. Otherwise discover a new job.
  const retryUrl = argValue("--retry-url");
  const screen = watchWindowSize();

  console.log(
    `[mgh-one] dry_run=${cfg.runtime.dry_run} maximized Agent Window ${screen.width}x${screen.height}`
  );
  console.log("[mgh-one] watch mode: each field scrolls into view + pauses so you can read values");

  const result = await withSession(
    async (sessionId) => {
      let job = retryUrl ? pickFalsePositiveRetry(retryUrl) : null;
      if (job) {
        console.log(`[mgh-one] retrying false-positive #${job._tracker_num} (${job.company})`);
      } else {
        console.log("[mgh-one] discover (US-scoped search)…");
        const scraped = await scrapeMyGreenhouseQueries(
          sessionId,
          ["Software Engineer", "Machine Learning Engineer", "Backend Engineer"],
          { limitPerQuery: 15 }
        );
        const kept = scraped.filter(
          (j) =>
            !isBlacklisted(j.company)
            && matchesTargets(j, cfg.targets || {})
            && isUsJobLocation(j)
        );
        upsertJobs(kept);
        console.log(`[mgh-one] scraped=${scraped.length} us_kept=${kept.length}`);
        job = pickNext(kept, seen) || pickNext(readJobs().filter((j) => j.source === "mygreenhouse"), seen);
      }

      if (!job) {
        console.log("[mgh-one] no uncontacted US job found");
        return null;
      }

      // Prefer board token as company for tracker identity
      job = {
        ...job,
        apply_url: mghCanonicalUrl(job) || job.apply_url,
        url: mghCanonicalUrl(job) || job.url,
      };
      console.log(`\n[mgh-one] APPLYING → ${job.company} — ${job.title}`);
      console.log(`  url=${job.apply_url}`);
      console.log("  (watch the large Agent Window — fields scroll into view as they fill)\n");

      await ensureJobDescription(job);
      try {
        job._jd_analysis = await analyzeJD(job, cfg);
      } catch {
        job._jd_analysis = null;
      }

      // Always prefer a per-job Jake PDF. Profile resume_path must not skip generation.
      let resumePath = null;
      const tailored = tailoredResumePath(job);
      if (tailored && existsSync(tailored)) {
        resumePath = tailored;
      } else {
        console.log("[mgh-one] generating Jake PDF (per-job tailored)…");
        try {
          resumePath = await generateSinglePdf(cfg, job, { force: true });
        } catch (err) {
          console.warn(`[mgh-one] Jake PDF failed: ${String(err.message || err).slice(0, 160)}`);
        }
      }
      if (!resumePath || !existsSync(resumePath)) {
        resumePath = resolveResumePath(job, cfg);
        console.warn(`[mgh-one] falling back to profile resume: ${resumePath}`);
      }
      console.log(`[mgh-one] resume=${resumePath}`);

      await pause(1500);
      const out = await applyMyGreenhouseJob(sessionId, job, cfg, {
        dryRun: cfg.runtime.dry_run,
        resumePath,
        llmChat,
        oneShot: true,
      });

      const finalUrl = mghCanonicalUrl(job) || out.url;
      if (job.external_id) {
        updateJobStatus(job.external_id, out.status === "dry_run" ? "dry_run" : out.status, {
          notes: out.notes,
        });
      }

      return {
        company: job.company,
        role: job.title,
        title: job.title,
        score: job.match_score,
        status: out.status,
        notes: out.notes,
        url: finalUrl,
        pdf: resumePath && existsSync(resumePath) ? "✅" : "❌",
        ats: "mygreenhouse",
        _tracker_num: job._tracker_num,
        _retry: job._retry,
      };
    },
    { maximized: true, name: "mgh-one-watch" }
  );

  if (!result) {
    console.log("[mgh-one] DONE — nothing applied");
    return;
  }

  console.log(`\n[mgh-one] => ${result.status}: ${(result.notes || "").slice(0, 200)}`);
  if (result._retry && result._tracker_num) {
    const updated = updateApplication(
      { num: result._tracker_num, url: result.url },
      {
        status: result.status,
        notes: `RETRY ${new Date().toISOString().slice(0, 19)}: ${result.notes}`,
        pdf: result.pdf,
      }
    );
    console.log(
      updated.updated
        ? `[mgh-one] tracker #${result._tracker_num} updated → ${result.status}`
        : `[mgh-one] tracker update missed for #${result._tracker_num}`
    );
  } else {
    const recorded = appendApplication(result);
    console.log(
      recorded.skipped
        ? `[mgh-one] tracker skip: ${recorded.reason}`
        : `[mgh-one] tracker #${recorded.num}`
    );
  }
  const dash = writeDashboard(readTracker(), cfg.dashboard?.title || "fillow — Application Dashboard");
  console.log(`[mgh-one] dashboard ${dash}`);
  if (cfg.secrets.fillow_sync_url && cfg.secrets.fillow_sync_token) {
    const out = await pushSyncHttp(syncPayload(), {
      url: cfg.secrets.fillow_sync_url,
      token: cfg.secrets.fillow_sync_token,
    });
    console.log(
      out.ok
        ? "[mgh-one] Cloudflare sync ok"
        : `[mgh-one] Cloudflare sync: ${JSON.stringify(out).slice(0, 160)}`
    );
  }
  console.log("[mgh-one] DONE");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

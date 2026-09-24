#!/usr/bin/env node
/**
 * Agent 3 (MyGreenhouse / BrowserSkill) — apply inside the logged-in
 * MyGreenhouse session using the profile already on the account + answer engine
 * for residual questions.
 *
 *   DRY_RUN=true  fillow mgh apply          # open+fill, never Submit
 *   DRY_RUN=false fillow mgh apply          # live Submit
 */
import { existsSync } from "node:fs";
import { loadConfig } from "../lib/config.mjs";
import { readJobs, updateJobStatus } from "../lib/jobs-tsv.mjs";
import { isBlacklisted } from "../lib/blacklist.mjs";
import { withSession, pause } from "../lib/bsk.mjs";
import { applyMyGreenhouseJob, seedCommonQaBank, mghCanonicalUrl } from "../lib/mygreenhouse.mjs";
import { resolveResumePath } from "../lib/resume-pdf.mjs";
import { ensureJobDescription } from "../lib/ats.mjs";
import { analyzeJD } from "../lib/jd-analyze.mjs";
import { makeLlmChat } from "../lib/llm.mjs";
import { isUsJobLocation } from "../lib/location.mjs";
import { readTracker, mghJobKey } from "../lib/tracker.mjs";

function alreadyAppliedKeys() {
  const companies = new Set();
  const keys = new Set();
  const companyRoles = new Set();
  for (const row of readTracker()) {
    if (row.company) companies.add(String(row.company).toLowerCase());
    const k = mghJobKey(row.notes) || mghJobKey(row.url);
    if (k) keys.add(k);
    if (row.company && row.role) {
      companyRoles.add(`${String(row.company).toLowerCase()}||${String(row.role).toLowerCase()}`);
    }
  }
  return { companies, keys, companyRoles };
}

export async function applyMyGreenhouse(jobs, cfg = loadConfig()) {
  seedCommonQaBank(cfg.candidate);
  const llmChat = makeLlmChat(cfg);
  const seen = alreadyAppliedKeys();

  const pool = (jobs?.length ? jobs : readJobs()).filter((j) => {
    if (isBlacklisted(j.company)) return false;
    if (!isUsJobLocation(j)) return false;
    const status = j.status || "";
    if (status && !["ready", "discovered"].includes(status)) return false;
    const url = mghCanonicalUrl(j) || j.apply_url || j.url || "";
    if (!(String(j.source) === "mygreenhouse" || /my\.greenhouse\.io\/jobs\//i.test(url))) return false;
    const key = mghJobKey(j.external_id) || mghJobKey(url);
    if (key && seen.keys.has(key)) return false;
    if (seen.companies.has(String(j.company || "").toLowerCase())) return false;
    if (seen.companyRoles.has(`${String(j.company || "").toLowerCase()}||${String(j.title || "").toLowerCase()}`)) {
      return false;
    }
    return true;
  });

  const cap = cfg.runtime.max_applies_per_run ?? 3;
  const taken = pool.slice(0, cap);
  console.log(
    `MyGreenhouse apply via BrowserSkill: ${taken.length}/${pool.length} (cap=${cap} dry_run=${cfg.runtime.dry_run})`
  );
  if (!taken.length) {
    console.log("  no MyGreenhouse jobs ready — run: fillow mgh discover && fillow mgh evaluate");
    return [];
  }

  const results = [];
  await withSession(async (sessionId) => {
    for (let i = 0; i < taken.length; i += 1) {
      const job = taken[i];
      const canon = mghCanonicalUrl(job);
      console.log(`\n>>> [${i + 1}/${taken.length}] ${job.company} — ${job.title}`);
      try {
        await ensureJobDescription(job);
        if (!job._jd_analysis) {
          try {
            job._jd_analysis = await analyzeJD(job, cfg);
          } catch {
            job._jd_analysis = null;
          }
        }
        let resumePath = resolveResumePath(job, cfg);
        const out = await applyMyGreenhouseJob(sessionId, job, cfg, {
          dryRun: cfg.runtime.dry_run,
          resumePath,
          llmChat,
          uploadResume: false,
        });
        const finalUrl = mghCanonicalUrl(job) || canon || out.url;
        results.push({
          company: job.company,
          role: job.title,
          title: job.title,
          score: job.match_score,
          status: out.status,
          notes: out.notes,
          url: finalUrl,
          pdf: "—",
          ats: "mygreenhouse",
        });
        if (job.external_id) {
          updateJobStatus(job.external_id, out.status === "dry_run" ? "dry_run" : out.status, {
            notes: out.notes,
          });
        }
        // Prevent same-batch / same-session re-picks
        if (job.company) seen.companies.add(String(job.company).toLowerCase());
        const k = mghJobKey(job.external_id) || mghJobKey(finalUrl);
        if (k) seen.keys.add(k);
        console.log(`  => ${out.status}: ${(out.notes || "").slice(0, 180)}`);
      } catch (err) {
        console.error(`  failed: ${err.message}`);
        results.push({
          company: job.company,
          role: job.title,
          title: job.title,
          score: job.match_score,
          status: "failed",
          notes: String(err.message || err).slice(0, 400),
          url: canon || job.apply_url || job.url,
          pdf: "❌",
          ats: "mygreenhouse",
        });
        if (job.external_id) updateJobStatus(job.external_id, "failed", { notes: String(err.message || err).slice(0, 200) });
      }
      if (i < taken.length - 1) await pause(35_000 + Math.random() * 20_000);
    }
  });

  return results;
}

const isCli = process.argv[1]?.endsWith("apply-mygreenhouse.mjs");
if (isCli) {
  applyMyGreenhouse()
    .then(async (results) => {
      if (results.length) {
        const { trackMyGreenhouse } = await import("./track-mygreenhouse.mjs");
        await trackMyGreenhouse(results);
      }
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

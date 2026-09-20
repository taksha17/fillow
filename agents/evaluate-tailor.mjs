import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../lib/config.mjs";
import { readJobs, writeJobs } from "../lib/jobs-tsv.mjs";
import { legitimacyGate, rankJobs } from "../lib/score.mjs";
import { detectAts } from "../lib/ats.mjs";
import { applyGreenhouseLocation } from "../lib/location.mjs";
import { PATHS, ensureDataDirs } from "../lib/paths.mjs";
import { generateCoverLetter, writeCoverLetter } from "../lib/cover-letter.mjs";
import {
  generateTailoredResumesBatch,
  jobResumeKey,
  maybeEnrich,
} from "../lib/resume-pdf.mjs";

function pad(n) {
  return String(n).padStart(3, "0");
}

export function scoreOnlyRequested(argv = process.argv, env = process.env) {
  return argv.includes("--score-only") || env.FILLLOW_SCORE_ONLY === "true";
}

export async function evaluateTailor(cfg = loadConfig(), opts = {}) {
  const scoreOnly = opts.scoreOnly ?? scoreOnlyRequested();
  const jobs = readJobs();
  if (!jobs.length) {
    console.log("No jobs in data/jobs.tsv — run fillow pull or fillow discover first");
    return [];
  }
  ensureDataDirs();

  console.log("\n[Phase 2a] Scoring & Legitimacy");
  const scoredJobs = rankJobs(jobs, cfg.targets, cfg.candidate);

  const survivors = [];
  let reportNum = 1;
  for (const job of scoredJobs) {
    const legit = legitimacyGate(job, { minDescriptionLength: 300 });
    if (job.match_score < cfg.runtime.min_match_score) {
      job.status = "below_threshold";
      continue;
    }
    if (detectAts(job) === "greenhouse") {
      Object.assign(job, applyGreenhouseLocation(job, cfg.candidate));
      if (!job.greenhouse_location_ok) {
        job.status = "report_only";
        job.notes = `greenhouse location: search "${job.greenhouse_location}" — posting is outside city/state/United States`;
      }
    }
    if (job.status !== "report_only" && !legit.ok) {
      job.status = "report_only";
      job.notes = `legitimacy: ${legit.flags.join(",")}`;
    } else if (job.status !== "report_only") {
      job.status = "ready";
    }
    const slug = `${pad(reportNum)}-${(job.company || "company").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${new Date().toISOString().slice(0, 10)}`;
    const reportPath = join(PATHS.reports, `${slug}.md`);
    writeFileSync(
      reportPath,
      `# ${job.title} @ ${job.company}\n\n- score: ${job.match_score}\n- status: ${job.status}\n- url: ${job.url}\n- location: ${job.location}\n- greenhouse_location: ${job.greenhouse_location || ""}\n- legitimacy: ${legit.ok ? "ok" : legit.flags.join(", ")}\n`,
      "utf8"
    );
    job.report = reportPath;
    reportNum += 1;
    survivors.push(job);
  }

  const readyJobs = survivors.filter((j) => j.status === "ready");
  console.log(`  ${readyJobs.length} jobs ready for tailoring`);

  if (scoreOnly) {
    console.log("\n[Phase 2b] skipped (score-only — Jake's Resume PDFs stay on the local machine)");
    writeJobs(scoredJobs);
    console.log(`\nEvaluated ${jobs.length}; ${readyJobs.length} ready (min=${cfg.runtime.min_match_score})`);
    return survivors;
  }

  const tailorCap = cfg.runtime.max_tailor_per_run ?? 12;
  const toTailor = readyJobs.slice(0, tailorCap);

  if (toTailor.length > 0) {
    console.log("\n[Phase 2b] Jake's Resume + cover letters (1 page, Times New Roman, per job)");
    if (readyJobs.length > toTailor.length) {
      console.log(`  Tailoring top ${toTailor.length} of ${readyJobs.length} (MAX_TAILOR_PER_RUN)`);
    }

    let extra = {};
    try {
      extra = await maybeEnrich(cfg);
    } catch (err) {
      console.warn(`  Profile enrich skipped: ${err.message}`);
    }

    const coverResults = await Promise.allSettled(
      toTailor.map(async (job) => {
        const coverText = await generateCoverLetter(cfg, job);
        const coverPath = writeCoverLetter(coverText, job);
        job.cover_letter = coverPath;
        return coverPath;
      })
    );
    for (const result of coverResults) {
      if (result.status === "rejected") {
        console.warn(`  Cover letter failed: ${result.reason?.message || result.reason}`);
      }
    }

    let pdfResults = new Map();
    try {
      pdfResults = await generateTailoredResumesBatch(cfg, toTailor, 2, extra);
    } catch (err) {
      console.warn(`  Resume batch failed: ${err.message}`);
    }

    let successCount = 0;
    for (const job of toTailor) {
      const pdfPath = pdfResults.get(jobResumeKey(job));
      if (pdfPath) job.tailored_resume = pdfPath;
      if (job.cover_letter && job.tailored_resume) successCount += 1;
    }
    console.log(`  ${successCount}/${toTailor.length} tailored successfully`);
  }

  writeJobs(scoredJobs);
  mkdirSync(PATHS.tailored, { recursive: true });
  console.log(`\nEvaluated ${jobs.length}; ${readyJobs.length} ready (min=${cfg.runtime.min_match_score})`);
  return survivors;
}

const isCli = process.argv[1]?.endsWith("evaluate-tailor.mjs");
if (isCli) {
  evaluateTailor(undefined, { scoreOnly: scoreOnlyRequested() }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

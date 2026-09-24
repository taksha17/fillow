import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../lib/config.mjs";
import { readJobs, writeJobs } from "../lib/jobs-tsv.mjs";
import { legitimacyGate, rankJobs, verifyBorderlineJobs } from "../lib/score.mjs";
import { detectAts } from "../lib/ats.mjs";
import { applyGreenhouseLocation } from "../lib/location.mjs";
import { PATHS, ensureDataDirs } from "../lib/paths.mjs";
import { generateCoverLetter, writeCoverLetter } from "../lib/cover-letter.mjs";
import {
  generateTailoredResumesBatch,
  jobResumeKey,
  maybeEnrich,
  tailoredResumePath,
} from "../lib/resume-pdf.mjs";
import { analyzeJD } from "../lib/jd-analyze.mjs";
import { runAgentCli } from "../lib/progress.mjs";

function pad(n) {
    return String(n).padStart(3, "0");
}

function jobId(job) {
    return `${job.source || "job"}:${job.external_id || job.url || ""}`;
}

export function scoreOnlyRequested(argv = process.argv, env = process.env) {
    return argv.includes("--score-only") || env.FILLLOW_SCORE_ONLY === "true";
}

/**
 * Pick which ready jobs get tailored this run: skip jobs that already have a
 * tailored PDF so repeated runs walk the backlog instead of re-selecting the
 * same top slice every time.
 */
export function selectTailorBatch(readyJobs, cap, alreadyTailored = () => false) {
    const limit = Math.max(0, Number(cap) || 0);
    const picked = [];
    for (const job of readyJobs) {
        if (alreadyTailored(job)) continue;
        if (picked.length >= limit) break;
        picked.push(job);
    }
    return picked;
}

/**
 * Score jobs and apply legitimacy gates.
 * @returns {Array} Array of scored jobs with status set
 */
async function scoreAndLegitimacyCheck(jobs, cfg, emit, { scoreOnly = false, log = console.log } = {}) {
    emit?.("phase.start", { phase: "evaluate.score", label: "Scoring & Legitimacy", total: jobs.length });
    const scoredJobs = rankJobs(jobs, cfg.targets, cfg.candidate);

    if (!scoreOnly) {
        emit?.("phase.start", { phase: "evaluate.nim-verify", label: "NIM verification (borderline)", total: scoredJobs.length });
        await verifyBorderlineJobs(scoredJobs, cfg.candidate, cfg);
        scoredJobs.sort((a, b) => (b.match_score ?? 0) - (a.match_score ?? 0));
        emit?.("phase.complete", { phase: "evaluate.nim-verify", total: scoredJobs.length, summary: "complete" });
    }

    const survivors = [];
    let reportNum = 1;
    for (const job of scoredJobs) {
        const id = jobId(job);
        emit?.("item.start", { phase: "evaluate.score", job_id: id, item: `${job.company || "unknown"} — ${job.title || "unknown"}` });
        try {
            if (job.match_score < cfg.runtime.min_match_score) {
                job.status = "below_threshold";
                emit?.("item.done", { phase: "evaluate.score", job_id: id, result: { status: job.status, score: job.match_score } });
                continue;
            }
            const legit = legitimacyGate(job, { minDescriptionLength: 300 });
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
            emit?.("item.done", { phase: "evaluate.score", job_id: id, result: { status: job.status, score: job.match_score } });
        } catch (err) {
            emit?.("item.error", { phase: "evaluate.score", job_id: id, message: err.message });
            job.status = "failed";
            job.notes = err.message;
            survivors.push(job);
        }
    }

    const readyJobs = survivors.filter((j) => j.status === "ready");
    log(`  ${readyJobs.length} jobs ready for tailoring`);
    emit?.("phase.complete", { phase: "evaluate.score", total: jobs.length, summary: `${readyJobs.length} ready` });
    return { survivors, scoredJobs };
}

/**
 * Perform tailoring operations: JD analysis, cover letters, and resume generation.
 * @returns {number} Number of successfully tailored jobs
 */
async function performTailoring(toTailor, cfg, emit, { log = console.log, totalReady = 0, doneCount = 0, backlog = 0 } = {}) {
    if (toTailor.length === 0) return 0;

    emit?.("phase.start", { phase: "evaluate.tailor", label: "Jake's Resume + cover letters", total: toTailor.length });
    log("\n[Phase 2b] Jake's Resume + cover letters (1 page, Times New Roman, per job)");
    log(`  Tailoring next ${toTailor.length} of ${totalReady} ready — ${doneCount} already tailored${backlog > 0 ? `, ${backlog} queued for later runs` : ""}`);

    // JD Analysis
    emit?.("phase.start", { phase: "evaluate.jd-analyze", label: "JD analysis", total: toTailor.length });
    let analyzedCount = 0;
    for (let idx = 0; idx < toTailor.length; idx += 1) {
        const job = toTailor[idx];
        emit?.("item.start", { phase: "evaluate.jd-analyze", job_id: jobId(job), item: `Analyzing: ${job.company || "unknown"} — ${job.title || "unknown"}` });
        try {
            job._jd_analysis = await analyzeJD(job, cfg);
            analyzedCount += 1;
            emit?.("item.done", { phase: "evaluate.jd-analyze", job_id: jobId(job), result: { skills: (job._jd_analysis?.required_skills || []).length, seniority: job._jd_analysis?.seniority_level || null } });
        } catch (err) {
            emit?.("item.error", { phase: "evaluate.jd-analyze", job_id: jobId(job), message: err.message });
            job._jd_analysis = null;
        }
    }
    emit?.("phase.complete", { phase: "evaluate.jd-analyze", total: toTailor.length, summary: `${analyzedCount} analyzed` });
    log(`  JD analysis: ${analyzedCount}/${toTailor.length} complete`);

    // Profile Enrichment
    let extra = {};
    try {
        extra = await maybeEnrich(cfg);
    } catch (err) {
        warn(`  Profile enrich skipped: ${err.message}`);
    }

    // Cover Letters
    const coverResults = await Promise.allSettled(
        toTailor.map(async (job) => {
            emit?.("item.start", { phase: "evaluate.tailor", job_id: jobId(job), item: `${job.company || "unknown"} — ${job.title || "unknown"}` });
            try {
                const coverText = await generateCoverLetter(cfg, job);
                const coverPath = writeCoverLetter(coverText, job);
                job.cover_letter = coverPath;
                emit?.("item.done", { phase: "evaluate.tailor", job_id: jobId(job), result: { cover_letter: coverPath } });
                return coverPath;
            } catch (err) {
                emit?.("item.error", { phase: "evaluate.tailor", job_id: jobId(job), message: err.message });
                throw err;
            }
        })
    );
    for (const result of coverResults) {
        if (result.status === "rejected") {
            warn(`  Cover letter failed: ${result.reason?.message || result.reason}`);
        }
    }

    // Resume Generation
    let pdfResults = new Map();
    try {
        pdfResults = await generateTailoredResumesBatch(cfg, toTailor, 2, extra);
    } catch (err) {
        warn(`  Resume batch failed: ${err.message}`);
    }

    let successCount = 0;
    for (const job of toTailor) {
        const pdfPath = pdfResults.get(jobResumeKey(job));
        if (pdfPath) job.tailored_resume = pdfPath;
        if (job.cover_letter && job.tailored_resume) successCount += 1;
        emit?.("item.done", { phase: "evaluate.tailor", job_id: jobId(job), result: { resume: job.tailored_resume || null, cover_letter: job.cover_letter || null } });
    }
    log(`  ${successCount}/${toTailor.length} tailored successfully`);
    return successCount;
}

export async function evaluateTailor(cfg = loadConfig(), opts = {}) {
    const emit = opts.emit || null;
    const log = emit ? (message, data = {}) => emit("log", { message, ...data }) : console.log;
    const warn = emit ? (message, data = {}) => emit("warn", { message, ...data }) : console.warn;
    const scoreOnly = opts.scoreOnly ?? scoreOnlyRequested();
    const jobs = readJobs();
    if (!jobs.length) {
        log("No jobs in data/jobs.tsv — run fillow pull or fillow discover first");
        return [];
    }
    ensureDataDirs();

    // Score and legitimacy check
    const { survivors, scoredJobs } = await scoreAndLegitimacyCheck(jobs, cfg, emit, { scoreOnly, log });
    const readyJobs = survivors.filter((j) => j.status === "ready");

    if (scoreOnly) {
        log("\n[Phase 2b] skipped (score-only — Jake's Resume PDFs stay on the local machine)");
        writeJobs(scoredJobs);
        log(`\nEvaluated ${jobs.length}; ${readyJobs.length} ready (min=${cfg.runtime.min_match_score})`);
        return survivors;
    }

    // Tailoring
    const tailorCap = cfg.runtime.max_tailor_per_run ?? 12;
    const alreadyTailored = (job) => existsSync(tailoredResumePath(job));
    const doneJobs = readyJobs.filter(alreadyTailored);
    for (const job of doneJobs) {
        if (!job.tailored_resume) job.tailored_resume = tailoredResumePath(job);
    }
    const toTailor = selectTailorBatch(readyJobs, tailorCap, alreadyTailored);
    const backlog = readyJobs.length - doneJobs.length - toTailor.length;
    
    const successCount = await performTailoring(toTailor, cfg, emit, { log, totalReady: readyJobs.length, doneCount: doneJobs.length, backlog });

    writeJobs(scoredJobs);
    mkdirSync(PATHS.tailored, { recursive: true });
    log(`\nEvaluated ${jobs.length}; ${readyJobs.length} ready (min=${cfg.runtime.min_match_score})`);
    emit?.("phase.complete", { phase: "evaluate.tailor", total: toTailor.length, summary: `${toTailor.length} requested` });
    return survivors;
}

const isCli = process.argv[1]?.endsWith("evaluate-tailor.mjs");
if (isCli) {
  runAgentCli({
    agent: "evaluate",
    run: async (emit) => evaluateTailor(undefined, { scoreOnly: scoreOnlyRequested(), emit }),
    summarize: (jobs) => `${jobs.length} jobs evaluated`,
  }).catch((err) => {
    console.error(`  evaluate-tailor failed: ${err?.stack || err}`);
    process.exitCode = 1;
  });
}

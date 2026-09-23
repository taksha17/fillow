import { existsSync } from "node:fs";
import { loadConfig } from "../lib/config.mjs";
import { isBlacklisted } from "../lib/blacklist.mjs";
import { readJobs } from "../lib/jobs-tsv.mjs";
import { detectAts } from "../lib/ats.mjs";
import { generateCoverLetter, writeCoverLetter } from "../lib/cover-letter.mjs";
import { launchBrowser, sleep } from "../lib/browser.mjs";
import { applyOnPage, result } from "../lib/form-fill.mjs";
import { makeLlmChat } from "../lib/llm.mjs";
import { resolveResumePath } from "../lib/resume-pdf.mjs";
import { runAgentCli } from "../lib/progress.mjs";
import {
  bsk,
  assertExtensionConnected,
  isWatchMode,
  watchWindowSize,
  raiseAgentWindow,
} from "../lib/bsk.mjs";
import { applyMyGreenhouseJob } from "../lib/mygreenhouse.mjs";



function jobId(job) {
  return `${job.source || "job"}:${job.external_id || job.url || ""}`;
}

function resumeFor(job, cfg) {
  return resolveResumePath(job, cfg);
}

/**
 * Per-job engine: bsk only when apply_engine=bsk AND the job is
 * Greenhouse-family (the proven logged-in fill flow). Everything else
 * keeps the original Playwright path. Strict patterns only — never
 * mghCanonicalUrl(), whose URL fallback accepts any non-search URL.
 */
export function pickApplyEngine(job = {}, cfg = {}) {
  const engine = String(cfg?.runtime?.apply_engine || "playwright").toLowerCase();
  if (engine !== "bsk") return "playwright";
  const url = String(job.apply_url || job.url || "");
  const externalId = String(job.external_id || "");
  if (String(job.source || "") === "mygreenhouse") return "bsk";
  if (/my\.greenhouse\.io\/jobs\//i.test(url)) return "bsk";
  if (/^mgh:[^:]+:\d+$/i.test(externalId)) return "bsk";
  if (job.board_token && /^\d+$/.test(externalId.split(":").pop())) return "bsk";
  if (/(boards|job-boards)\.greenhouse\.io/i.test(url)) return "bsk";
  return "playwright";
}

export async function applyJobs(jobs, cfg = loadConfig(), opts = {}) {
  const emit = opts.emit || null;
  const log = emit ? (message, data = {}) => emit("log", { message, ...data }) : console.log;
  const pool = (jobs?.length ? jobs : readJobs()).filter((j) => j.status === "ready" || j.status === "discovered");
  const cap = cfg.runtime.max_applies_per_run;
  const taken = pool.slice(0, cap);
  const results = [];
  const humanize = cfg.runtime.humanize_fills !== false;
  const llmChat = makeLlmChat(cfg);
  const reviewMode = cfg.runtime.review_mode || !cfg.runtime.auto_submit;
  const pauseSeconds = cfg.runtime.pre_submit_pause_seconds ?? 4;
  const spamBoards = new Set(); // Moved inside function to reset on each call

  if (emit) emit("phase.start", { phase: "apply", label: "Apply to jobs", total: taken.length });

  let session = null;
  let bskSessionId = null;
  const ensureBskSession = () => {
    if (!bskSessionId) {
      log("  Fillow Browser (bsk): connecting to logged-in Chromium…");
      assertExtensionConnected();
      const maximized = isWatchMode();
      const startArgs = ["session", "start", "--name", "fillow-apply"];
      if (!maximized) startArgs.push("--no-focus");
      let watchW = 1400;
      let watchH = 900;
      if (maximized) {
        process.env.BSK_MAXIMIZED = "1";
        ({ width: watchW, height: watchH } = watchWindowSize());
        startArgs.push("--width", String(watchW), "--height", String(watchH));
      }
      const started = bsk(startArgs, { json: true });
      bskSessionId = started.session_id;
      if (!bskSessionId) throw new Error("bsk session start returned no session_id");
      if (maximized) {
        try {
          bsk(
            ["window", "resize", "--session", bskSessionId, "--width", String(watchW), "--height", String(watchH)],
            { json: false }
          );
          raiseAgentWindow(watchW, watchH);
        } catch {
          // ignore
        }
      }
    }
    return bskSessionId;
  };
  try {
    for (let idx = 0; idx < taken.length; idx += 1) {
      const job = taken[idx];
      const id = jobId(job);
      if (emit) emit("item.start", { phase: "apply", job_id: id, item: `${job.company || "unknown"} — ${job.title || "unknown"}` });

      if (isBlacklisted(job.company)) {
        results.push(result(job, "skipped", "blacklist"));
        if (emit) emit("item.done", { phase: "apply", job_id: id, result: { status: "skipped", reason: "blacklist" } });
        continue;
      }
      if (cfg.runtime.dry_run) {
        const resumePath = resumeFor(job, cfg);
        results.push(result(job, "dry_run", "DRY_RUN=true; browser skipped", {
          pdf: resumePath && existsSync(resumePath) ? "✅" : "❌",
        }));
        if (emit) emit("item.done", { phase: "apply", job_id: id, result: { status: "dry_run" } });
        continue;
      }

      const ats = detectAts(job);
      if (spamBoards.has(ats)) {
        results.push(result(job, "review", `${ats} previously flagged spam this run — review mode`));
        if (emit) emit("item.done", { phase: "apply", job_id: id, result: { status: "review", reason: "spam_board" } });
        continue;
      }

      const resumePath = resumeFor(job, cfg);

      if (pickApplyEngine(job, cfg) === "bsk") {
        try {
          const sessionId = ensureBskSession();
          log(`  Fillow Browser (bsk): ${job.company || "unknown"} — ${job.title || "unknown"}`);
          const out = await applyMyGreenhouseJob(sessionId, job, cfg, {
            dryRun: !(cfg.runtime.auto_submit && !cfg.runtime.review_mode),
            resumePath: resumePath && existsSync(resumePath) ? resumePath : null,
            llmChat,
          });
          results.push(result(job, out.status, out.notes, {
            url: out.url,
            pdf: resumePath && existsSync(resumePath) ? "✅" : "—",
          }));
          if (emit) emit("item.done", { phase: "apply", job_id: id, result: { status: out.status, notes: out.notes } });
        } catch (err) {
          results.push(result(job, "failed", String(err.message || err).slice(0, 500)));
          if (emit) emit("item.error", { phase: "apply", job_id: id, message: String(err.message || err).slice(0, 500) });
        }
        const delay = (cfg.runtime.apply_delay_seconds || 6) * (0.5 + Math.random());
        await sleep(delay * 1000);
        continue;
      }

      if (!resumePath || !existsSync(resumePath)) {
        results.push(result(job, "failed", `Resume missing: ${resumePath || "(unset)"}`));
        if (emit) emit("item.error", { phase: "apply", job_id: id, message: `Resume missing: ${resumePath || "(unset)"}` });
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
          humanize,
          reviewMode,
          autoSubmit: cfg.runtime.auto_submit && !cfg.runtime.review_mode,
          pauseSeconds,
        });
        if (/possible spam/i.test(out.notes || "")) spamBoards.add(ats);
        results.push(out);
        if (!cfg.runtime.keep_browser_open) {
          try {
            await page.close();
          } catch {
            // ignore
          }
        }
        if (emit) emit("item.done", { phase: "apply", job_id: id, result: { status: out.status, notes: out.notes } });
      } catch (err) {
        results.push(result(job, "failed", String(err.message || err).slice(0, 500)));
        if (emit) emit("item.error", { phase: "apply", job_id: id, message: String(err.message || err).slice(0, 500) });
      }

      const delay = (cfg.runtime.apply_delay_seconds || 6) * (0.5 + Math.random());
      await sleep(delay * 1000);
    }
  } finally {
    if (bskSessionId) {
      try {
        bsk(["session", "stop", bskSessionId], { json: false });
      } catch {
        // ignore stop errors
      }
    }
    if (session && !cfg.runtime.keep_browser_open) {
      try {
        await session.context.close();
      } catch {
        // ignore
      }
      try {
        await session.browser.close();
      } catch {
        // ignore
      }
    } else if (session) {
      log("  keep_browser_open: leaving Playwright session up");
    }
  }

  if (emit) emit("phase.complete", { phase: "apply", total: taken.length, summary: `${results.length} applied` });
  log(`📝 Apply: ${results.length} of cap ${cap} (dry_run=${cfg.runtime.dry_run} review=${reviewMode})`);
  return results;
}

const isCli = process.argv[1]?.endsWith("apply.mjs");
if (isCli) {
  runAgentCli({
    agent: "apply",
    run: async (emit) => applyJobs(undefined, loadConfig(), { emit }),
    summarize: (results) => `${results.length} applications`,
  }).catch((err) => {
    console.error(`  apply failed: ${err?.stack || err}`);
    process.exitCode = 1;
  });
}

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

const spamBoards = new Set();

function resumeFor(job, cfg) {
  return resolveResumePath(job, cfg);
}

export async function applyJobs(jobs, cfg = loadConfig()) {
  const pool = (jobs?.length ? jobs : readJobs()).filter((j) => j.status === "ready" || j.status === "discovered");
  const cap = cfg.runtime.max_applies_per_run;
  const taken = pool.slice(0, cap);
  const results = [];
  const humanize = cfg.runtime.humanize_fills !== false;
  const llmChat = makeLlmChat(cfg);
  const reviewMode = cfg.runtime.review_mode || !cfg.runtime.auto_submit;
  const pauseSeconds = cfg.runtime.pre_submit_pause_seconds ?? 4;

  let session = null;
  try {
    for (const job of taken) {
      if (isBlacklisted(job.company)) {
        results.push(result(job, "skipped", "blacklist"));
        continue;
      }
      if (cfg.runtime.dry_run) {
        const resumePath = resumeFor(job, cfg);
        results.push(result(job, "dry_run", "DRY_RUN=true; browser skipped", {
          pdf: resumePath && existsSync(resumePath) ? "✅" : "❌",
        }));
        continue;
      }

      const ats = detectAts(job);
      if (spamBoards.has(ats)) {
        results.push(result(job, "review", `${ats} previously flagged spam this run — review mode`));
        continue;
      }

      const resumePath = resumeFor(job, cfg);
      if (!resumePath || !existsSync(resumePath)) {
        results.push(result(job, "failed", `Resume missing: ${resumePath || "(unset)"}`));
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
      } catch (err) {
        results.push(result(job, "failed", String(err.message || err).slice(0, 500)));
      }

      const delay = (cfg.runtime.apply_delay_seconds || 6) * (0.5 + Math.random());
      await sleep(delay * 1000);
    }
  } finally {
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
      console.log("  keep_browser_open: leaving Playwright session up");
    }
  }

  console.log(`📝 Apply: ${results.length} of cap ${cap} (dry_run=${cfg.runtime.dry_run} review=${reviewMode})`);
  return results;
}

const isCli = process.argv[1]?.endsWith("apply.mjs");
if (isCli) {
  applyJobs().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

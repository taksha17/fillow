#!/usr/bin/env node
import dotenv from "dotenv";
import { evaluateTailor } from "../agents/evaluate-tailor.mjs";
import { applyJobs } from "../agents/apply.mjs";
import { trackDashboard } from "../agents/track.mjs";
import { loadConfig } from "../lib/config.mjs";
import { readJobs } from "../lib/jobs-tsv.mjs";

dotenv.config();

export async function runOffline(cfg = loadConfig()) {
  console.log("fillow offline — tailor PDFs + apply + track");
  console.log("  Playwright, NIM answers, and Gmail IMAP stay on this machine");
  console.log(`  dry_run=${cfg.runtime.dry_run} review_mode=${cfg.runtime.review_mode} cap=${cfg.runtime.max_applies_per_run}`);

  const jobs = readJobs();
  if (!jobs.length) {
    console.log("No jobs in data/jobs.tsv — run fillow pull (or fillow discover) first");
    return { evaluated: [], results: [] };
  }

  console.log("\n[Phase 2b] Evaluate & tailor");
  const evaluated = await evaluateTailor(cfg, { scoreOnly: false });

  console.log("\n[Phase 3] Prefill & submit");
  const ready = evaluated.filter((j) => j.status === "ready");
  const results = await applyJobs(ready, cfg);

  console.log("\n[Phase 4] Track");
  await trackDashboard(results, cfg);

  console.log("\nfillow offline complete");
  console.log(`  evaluated=${evaluated.length} apply_results=${results.length}`);
  return { evaluated, results };
}

const isCli = process.argv[1]?.endsWith("offline.mjs");
if (isCli) {
  runOffline().catch((err) => {
    console.error("Offline half failed:", err);
    process.exit(1);
  });
}

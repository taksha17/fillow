#!/usr/bin/env node
import dotenv from "dotenv";
import { scrapeJobs } from "./agents/discover.mjs";
import { evaluateTailor } from "./agents/evaluate-tailor.mjs";
import { applyJobs } from "./agents/apply.mjs";
import { trackDashboard } from "./agents/track.mjs";
import { loadConfig } from "./lib/config.mjs";

dotenv.config();

async function runPipeline() {
  const cfg = loadConfig();
  console.log("fillow workflow starting (all-local; see HYBRID.md for Actions + fillow offline)");
  console.log(`  dry_run=${cfg.runtime.dry_run} review_mode=${cfg.runtime.review_mode} min_score=${cfg.runtime.min_match_score} cap=${cfg.runtime.max_applies_per_run}`);

  console.log("\n[Phase 1] Discovery");
  const discovered = await scrapeJobs(cfg);

  console.log("\n[Phase 2] Evaluate & tailor");
  const evaluated = await evaluateTailor(cfg);

  console.log("\n[Phase 3] Prefill & submit");
  const ready = evaluated.filter((j) => j.status === "ready");
  const results = await applyJobs(ready, cfg);

  console.log("\n[Phase 4] Track");
  await trackDashboard(results, cfg);

  console.log("\nfillow workflow complete");
  console.log(`  discovered=${discovered.length} evaluated=${evaluated.length} apply_results=${results.length}`);
}

runPipeline().catch((err) => {
  console.error("Workflow failed:", err);
  process.exit(1);
});

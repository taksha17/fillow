#!/usr/bin/env node
import dotenv from "dotenv";
import { scrapeJobs } from "../agents/discover.mjs";
import { evaluateTailor } from "../agents/evaluate-tailor.mjs";
import { loadConfig } from "../lib/config.mjs";

dotenv.config();

export async function runOnline(cfg = loadConfig()) {
  console.log("fillow online — discover + score/gate");
  console.log("  no Playwright, no Gmail, no submit (see HYBRID.md)");
  console.log(`  dry_run=${cfg.runtime.dry_run} min_score=${cfg.runtime.min_match_score}`);

  console.log("\n[Phase 1] Discovery");
  const discovered = await scrapeJobs(cfg);

  console.log("\n[Phase 2a] Evaluate (score-only)");
  const evaluated = await evaluateTailor(cfg, { scoreOnly: true });
  const ready = evaluated.filter((j) => j.status === "ready");

  console.log("\nfillow online complete");
  console.log(`  discovered=${discovered.length} scored=${evaluated.length} ready=${ready.length}`);
  console.log("  handoff: data/jobs.tsv  →  Actions artifact  →  fillow pull");
  return { discovered, evaluated };
}

const isCli = process.argv[1]?.endsWith("online.mjs");
if (isCli) {
  runOnline().catch((err) => {
    console.error("Online half failed:", err);
    process.exit(1);
  });
}

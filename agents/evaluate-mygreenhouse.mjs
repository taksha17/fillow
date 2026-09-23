#!/usr/bin/env node
/**
 * Agent 2 wrapper for the MyGreenhouse lane — same scoring + Jake PDFs as
 * agents/evaluate-tailor.mjs; jobs come from data/jobs.tsv (including mgh:*).
 *
 *   fillow mgh evaluate
 *   fillow mgh evaluate --score-only
 */
import { evaluateTailor, scoreOnlyRequested } from "./evaluate-tailor.mjs";
import { runAgentCli } from "../lib/progress.mjs";

export async function evaluateMyGreenhouse(cfg, opts = {}) {
  console.log("MyGreenhouse evaluate — reuses Agent 2 (score + tailor)");
  return evaluateTailor(cfg, opts);
}

const isCli = process.argv[1]?.endsWith("evaluate-mygreenhouse.mjs");
if (isCli) {
  runAgentCli({
    agent: "evaluate",
    run: async (emit) => evaluateMyGreenhouse(undefined, { scoreOnly: scoreOnlyRequested(), emit }),
    summarize: (jobs) => `${jobs.length} jobs evaluated (mgh lane)`,
  }).catch((err) => {
    console.error(`  evaluate-mygreenhouse failed: ${err?.stack || err}`);
    process.exitCode = 1;
  });
}

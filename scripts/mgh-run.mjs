#!/usr/bin/env node
/**
 * Full MyGreenhouse lane on this machine (BrowserSkill):
 *   discover (logged-in scrape) → evaluate/tailor → apply (in-session) → track
 *
 *   DRY_RUN=true  node scripts/mgh-run.mjs
 *   DRY_RUN=false node scripts/mgh-run.mjs
 */
import { loadConfig } from "../lib/config.mjs";
import { discoverMyGreenhouse } from "../agents/discover-mygreenhouse.mjs";
import { evaluateMyGreenhouse } from "../agents/evaluate-mygreenhouse.mjs";
import { applyMyGreenhouse } from "../agents/apply-mygreenhouse.mjs";
import { trackMyGreenhouse } from "../agents/track-mygreenhouse.mjs";

export async function runMyGreenhouse(cfg = loadConfig()) {
  console.log("fillow mgh run — BrowserSkill MyGreenhouse lane");
  console.log(`  dry_run=${cfg.runtime.dry_run} cap=${cfg.runtime.max_applies_per_run}`);

  console.log("\n[Agent 1] MyGreenhouse discover");
  await discoverMyGreenhouse(cfg);

  console.log("\n[Agent 2] Evaluate & tailor");
  const evaluated = await evaluateMyGreenhouse(cfg, { scoreOnly: false });
  const ready = (evaluated || []).filter((j) => j.status === "ready" && String(j.source) === "mygreenhouse");

  console.log("\n[Agent 3] MyGreenhouse apply");
  const results = await applyMyGreenhouse(ready.length ? ready : undefined, cfg);

  console.log("\n[Agent 4] Track");
  await trackMyGreenhouse(results, cfg);

  console.log(`\nmgh run complete — applied_batch=${results.length}`);
  return { evaluated, results };
}

const isCli = process.argv[1]?.endsWith("mgh-run.mjs");
if (isCli) {
  runMyGreenhouse().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

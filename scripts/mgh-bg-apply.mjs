#!/usr/bin/env node
/**
 * Background MyGreenhouse apply loop via BrowserSkill.
 * Sessions use --no-focus + a tiny Agent Window so the popup does not steal
 * the user's single work screen.
 *
 *   DISPLAY=:0 DRY_RUN=false MAX_APPLIES_PER_RUN=8 node scripts/mgh-bg-apply.mjs
 */
import { loadConfig } from "../lib/config.mjs";
import { readJobs } from "../lib/jobs-tsv.mjs";
import { isBlacklisted } from "../lib/blacklist.mjs";
import { readTracker } from "../lib/tracker.mjs";
import { applyMyGreenhouse } from "../agents/apply-mygreenhouse.mjs";
import { trackMyGreenhouse } from "../agents/track-mygreenhouse.mjs";
import { minimizeAgentWindow } from "../lib/bsk.mjs";

function contactedCompanies() {
  const set = new Set();
  for (const row of readTracker()) {
    if (row.company) set.add(String(row.company).toLowerCase());
  }
  return set;
}

async function main() {
  const cfg = loadConfig();
  console.log(`[mgh-bg] dry_run=${cfg.runtime.dry_run} cap=${cfg.runtime.max_applies_per_run}`);
  minimizeAgentWindow();

  const contacted = contactedCompanies();
  const pool = readJobs().filter((j) => {
    if (String(j.source) !== "mygreenhouse") return false;
    const status = j.status || "discovered";
    if (!["ready", "discovered"].includes(status)) return false;
    if (isBlacklisted(j.company)) return false;
    if (contacted.has(String(j.company || "").toLowerCase())) return false;
    return true;
  });
  console.log(`[mgh-bg] uncontacted mgh jobs: ${pool.length}`);
  if (!pool.length) {
    console.log("[mgh-bg] nothing to apply — run: fillow mgh discover");
    return;
  }

  const results = await applyMyGreenhouse(pool, cfg);
  minimizeAgentWindow();
  if (results.length) await trackMyGreenhouse(results, cfg);
  console.log(`[mgh-bg] DONE results=${results.length}`);
  for (const r of results) {
    console.log(`  ${r.status} | ${r.company} | ${(r.notes || "").slice(0, 100)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

#!/usr/bin/env node
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../lib/config.mjs";
import { PATHS } from "../lib/paths.mjs";
import { enrichFromPublicProfiles } from "../lib/resume-source.mjs";

const force = process.argv.includes("--force");
const cachePath = join(PATHS.tailored, "profile-enrich.json");

let cfg;
try {
  cfg = loadConfig();
} catch (err) {
  console.error(`fillow enrich needs a config: ${err.message}`);
  process.exit(1);
}

if (!cfg.runtime.enrich_profiles) {
  console.log("enrich_profiles is off — this runs only when you ask (opt-in). Set ENRICH_PROFILES=true or runtime.enrich_profiles: true to let Agent 2 use the gathered facts.");
}

if (force && existsSync(cachePath)) rmSync(cachePath);

const wasCached = !force && existsSync(cachePath);
const extra = await enrichFromPublicProfiles(cfg);

console.log(wasCached ? "🗃  using 24h cache" : "🔍 fresh scrape (GitHub + LinkedIn, in parallel)");
console.log(`  experience rows: ${extra.experience?.length || 0}`);
console.log(`  education rows: ${extra.education?.length || 0}`);
console.log(`  project rows:   ${extra.projects?.length || 0}`);
console.log(`  captured:       ${extra.captured_at}`);
console.log(`  cache file:     ${cachePath}`);
if (extra.projects?.length) {
  console.log("\nprojects (top):");
  for (const p of extra.projects.slice(0, 8)) {
    console.log(`  · ${p.name}${p.stack ? ` (${p.stack})` : ""}${p.description ? ` — ${String(p.description).slice(0, 80)}` : ""}`);
  }
}

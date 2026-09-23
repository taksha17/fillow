#!/usr/bin/env node
/**
 * Agent 1 (MyGreenhouse / BrowserSkill) — scrape jobs from the logged-in
 * MyGreenhouse session into data/jobs.tsv (source=mygreenhouse).
 *
 * Requires: bsk CLI + connected Chrome extension (already signed into MGH).
 *
 *   node agents/discover-mygreenhouse.mjs
 *   fillow mgh discover --query "Machine Learning Engineer"
 */
import { loadConfig } from "../lib/config.mjs";
import { upsertJobs } from "../lib/jobs-tsv.mjs";
import { isBlacklisted } from "../lib/blacklist.mjs";
import { matchesTargets } from "./discover.mjs";
import { withSession, pause } from "../lib/bsk.mjs";
import { scrapeMyGreenhouseQueries } from "../lib/mygreenhouse.mjs";
import { isUsJobLocation } from "../lib/location.mjs";

function parseArgs(argv) {
  const out = { queries: [], limit: 30 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--query" && argv[i + 1]) {
      out.queries.push(argv[++i]);
    } else if (a === "--limit" && argv[i + 1]) {
      out.limit = Number(argv[++i]) || 30;
    }
  }
  return out;
}

export async function discoverMyGreenhouse(cfg = loadConfig(), opts = {}) {
  const queries = opts.queries?.length
    ? opts.queries
    : (cfg.targets?.keywords || []).slice(0, 6).map(String);
  if (!queries.length) queries.push("Software Engineer", "Machine Learning Engineer");

  console.log(`MyGreenhouse discover via BrowserSkill (${queries.length} queries)`);
  const jobs = await withSession(async (sessionId) => {
    await pause(500);
    return scrapeMyGreenhouseQueries(sessionId, queries, { limitPerQuery: opts.limit || 30 });
  });

  const filtered = jobs.filter(
    (j) => !isBlacklisted(j.company) && matchesTargets(j, cfg.targets || {}) && isUsJobLocation(j)
  );
  const droppedLoc = jobs.length - jobs.filter((j) => isUsJobLocation(j)).length;
  const written = upsertJobs(filtered);
  console.log(
    `  scraped=${jobs.length} kept=${filtered.length} (dropped_non_us≈${droppedLoc}) added=${written.added} total=${written.total}`
  );
  return filtered;
}

const isCli = process.argv[1]?.endsWith("discover-mygreenhouse.mjs");
if (isCli) {
  const args = parseArgs(process.argv.slice(2));
  discoverMyGreenhouse(loadConfig(), args).catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}

import { loadConfig } from "../lib/config.mjs";
import { readJobs, upsertJobs } from "../lib/jobs-tsv.mjs";
import { isBlacklisted, loadBlacklist } from "../lib/blacklist.mjs";
import { checkLiveness } from "../providers/liveness.mjs";
import { fetchAshbyBoard } from "../providers/ashby.mjs";
import { fetchGreenhouseBoard } from "../providers/greenhouse.mjs";
import { fetchLeverCompany } from "../providers/lever.mjs";
import { fetchWorkdayBoard } from "../providers/workday.mjs";
import { sleep } from "../providers/http.mjs";

const DEAD_REASONS = new Set(["http_404", "http_410", "expired_copy"]);

const BOARD_FETCHERS = {
  greenhouse: { items: (cfg) => cfg.greenhouse_boards, fetcher: fetchGreenhouseBoard },
  ashby: { items: (cfg) => cfg.ashby_boards, fetcher: fetchAshbyBoard },
  lever: { items: (cfg) => cfg.lever_companies, fetcher: fetchLeverCompany },
  workday: { items: (cfg) => cfg.workday_boards, fetcher: fetchWorkdayBoard },
};

export function livenessVerdict(liveness) {
  if (liveness.live) return "live";
  return DEAD_REASONS.has(liveness.reason) ? "expired" : "uncertain";
}

export function matchesTargets(job, targets) {
  const hay = `${job.title} ${job.location} ${job.company}`.toLowerCase();
  for (const ex of targets.exclude_keywords || []) {
    if (ex && hay.includes(ex.toLowerCase())) return false;
  }
  const keywords = targets.keywords || [];
  if (!keywords.length) return true;
  return keywords.some((k) => hay.includes(k.toLowerCase()));
}

async function runBoards(label, items, fetcher, delayMs) {
  const out = [];
  for (const item of items) {
    try {
      const batch = await fetcher(item);
      console.log(`  ${label}/${item}: ${batch.length}`);
      out.push(...batch);
    } catch (err) {
      console.warn(`  ${label}/${item} failed: ${err.message}`);
    }
    if (delayMs) await sleep(delayMs);
  }
  return out;
}

async function checkLivenessBatch(jobs, concurrency = 6) {
  const results = new Map();
  let index = 0;
  async function worker() {
    while (index < jobs.length) {
      const job = jobs[index++];
      results.set(job, await checkLiveness(job.apply_url || job.url));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  return results;
}

export async function scrapeJobs(cfg = loadConfig()) {
  const ats = new Set(cfg.runtime.ats_filter || ["ashby", "greenhouse"]);
  const delayMs = Math.round((cfg.runtime.request_delay_seconds || 1.2) * 1000);
  const blacklist = loadBlacklist();
  const jobs = [];

  for (const board of ["greenhouse", "ashby", "lever", "workday"]) {
    if (!ats.has(board)) continue;
    const { items, fetcher } = BOARD_FETCHERS[board];
    jobs.push(...(await runBoards(board, items(cfg), fetcher, delayMs)));
  }

  const existing = new Set(readJobs().map((j) => `${j.source}:${j.external_id}`.toLowerCase()));
  const seen = new Set();
  const unique = [];
  for (const job of jobs) {
    const key = `${job.source}:${job.external_id}`.toLowerCase();
    if (seen.has(key) || existing.has(key)) continue;
    seen.add(key);
    unique.push(job);
  }

  const onTarget = unique.filter((job) => !isBlacklisted(job.company, blacklist) && matchesTargets(job, cfg.targets));

  const livenessByJob = await checkLivenessBatch(onTarget);
  const alive = [];
  let expired = 0;
  let uncertain = 0;
  for (const job of onTarget) {
    const verdict = livenessVerdict(livenessByJob.get(job));
    if (verdict === "expired") {
      expired += 1;
      continue;
    }
    if (verdict === "uncertain") uncertain += 1;
    alive.push(job);
  }

  const result = upsertJobs(alive);
  console.log(`📡 Discovery: ${jobs.length} fetched, ${unique.length} new, ${alive.length} on-target (dropped ${expired} expired, ${uncertain} uncertain-kept), ${result.added} recorded`);
  return alive;
}

if (process.argv[1]?.endsWith("discover.mjs")) {
  scrapeJobs().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

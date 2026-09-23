import { loadConfig } from "../lib/config.mjs";
import { readJobs, upsertJobs } from "../lib/jobs-tsv.mjs";
import { isBlacklisted, loadBlacklist } from "../lib/blacklist.mjs";
import { checkLiveness } from "../providers/liveness.mjs";
import { fetchAshbyBoard } from "../providers/ashby.mjs";
import { fetchGreenhouseBoard } from "../providers/greenhouse.mjs";
import { fetchLeverCompany } from "../providers/lever.mjs";
import { fetchWorkdayBoard } from "../providers/workday.mjs";
import { sleep } from "../providers/http.mjs";
import { runAgentCli } from "../lib/progress.mjs";
import { withSession } from "../lib/bsk.mjs";
import { scrapeMyGreenhouseQueries } from "../lib/mygreenhouse.mjs";
import { scrapeWorkdayBoards } from "../lib/workday-bsk.mjs";
import { matchesTargets } from "../lib/filters.mjs";

export { matchesTargets } from "../lib/filters.mjs";

const DEAD_REASONS = new Set(["http_404", "http_410", "expired_copy"]);
const noop = () => {};

function jobId(job) {
  return `${job.source || "job"}:${job.external_id || job.url || ""}`;
}

const BOARD_FETCHERS = {
  greenhouse: { items: (cfg) => cfg.greenhouse_boards, fetcher: fetchGreenhouseBoard },
  ashby: { items: (cfg) => cfg.ashby_boards, fetcher: fetchAshbyBoard },
  lever: { items: (cfg) => cfg.lever_companies, fetcher: fetchLeverCompany },
  workday: { items: (cfg) => cfg.workday_boards, fetcher: fetchWorkdayBoard },
};

/**
 * Per-run discovery engine: 'bsk' adds the MyGreenhouse logged-in search
 * (via the Fillow Browser skill) on top of the public ATS APIs; 'api' (the
 * default) keeps the original public-API-only behavior.
 */
export function pickDiscoverEngine(cfg = {}) {
  const engine = String(cfg?.runtime?.discover_engine || "api").toLowerCase();
  return engine === "bsk" ? "bsk" : "api";
}

function mygreenhouseQueries(cfg = {}) {
  const keywords = (cfg.targets?.keywords || []).slice(0, 6).map(String).filter(Boolean);
  return keywords.length ? keywords : ["Software Engineer", "Machine Learning Engineer"];
}

async function runBrowserSources(cfg, emit = null) {
    const log = emit ? (message) => emit("log", { message }) : (message) => console.log(message);
    const queries = mygreenhouseQueries(cfg);
    const workdayBoards = (cfg.workday_boards || []).map(String).filter(Boolean);
    log(`  Fillow Browser sources: MyGreenhouse search (${queries.length} queries) + ${workdayBoards.length} Workday portal(s)`);
    return withSession(
        async (sessionId) => {
            const jobs = [];
            try {
                jobs.push(...(await scrapeMyGreenhouseQueries(sessionId, queries, { limitPerQuery: 30 })));
            } catch (err) {
                log(`  MyGreenhouse search failed: ${err.message}`);
            }
            if (workdayBoards.length) {
                jobs.push(...(await scrapeWorkdayBoards(sessionId, workdayBoards, { emit })));
            }
            return jobs;
        },
        { name: "fillow-discover" }
    );
}

export function livenessVerdict(liveness) {
  if (liveness.live) return "live";
  return DEAD_REASONS.has(liveness.reason) ? "expired" : "uncertain";
}

async function runBoards(label, items, fetcher, delayMs, emit = null) {
    const out = [];
    const total = items.length;
    if (emit) emit("phase.start", { label: `${label} boards`, total });
    for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        if (emit) emit("item.start", { item: String(item), current: index, total });
        try {
            const batch = await fetcher(item);
            if (emit) {
                emit("item.done", { item: String(item), count: batch.length, current: index + 1, total });
                emit("item.update", { label: `${label} boards`, current: index + 1, total });
            } else {
                console.log(`  ${label}/${item}: ${batch.length}`);
            }
            out.push(...batch);
        } catch (err) {
            if (emit) {
                emit("item.error", { item: String(item), message: err.message, current: index + 1, total });
            } else {
                console.warn(`  ${label}/${item} failed: ${err.message}`);
            }
        }
        // Only delay if not the last item
        if (delayMs && index < items.length - 1) await sleep(delayMs);
    }
    if (emit) emit("phase.complete", { label: `${label} boards`, total });
    return out;
}

async function checkLivenessBatch(jobs, concurrency = 6, emit = null) {
    const results = new Map();
    if (jobs.length === 0) {
        if (emit) emit("phase.complete", { label: "Liveness checks", total: 0 });
        return results;
    }
    let index = 0;
    if (emit) emit("phase.start", { label: "Liveness checks", total: jobs.length });
    async function worker() {
        while (index < jobs.length) {
            const job = jobs[index++];
            const liveness = await checkLiveness(job.apply_url || job.url);
            results.set(job, liveness);
            if (emit) {
                emit("item.done", { item: jobId(job), current: index, total: jobs.length });
                emit("item.update", { label: "Liveness checks", current: index, total: jobs.length });
            }
        }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
    if (emit) emit("phase.complete", { label: "Liveness checks", total: jobs.length });
    return results;
}

function filterJobsByTargetsAndBlacklist(jobs, blacklist, targets) {
    return jobs.filter((job) => !isBlacklisted(job.company, blacklist) && matchesTargets(job, targets));
}

export async function scrapeJobs(cfg = loadConfig(), emit = null) {
    const log = emit ? (message, data = {}) => emit("log", { message, ...data }) : console.log;
    const ats = new Set(cfg.runtime.ats_filter || ["ashby", "greenhouse"]);
    const delayMs = Math.round((cfg.runtime.request_delay_seconds || 1.2) * 1000);
    const blacklist = loadBlacklist();
    const jobs = [];

    if (emit) emit("phase.start", { label: "Discovery", total: 4 });
    for (const board of ["greenhouse", "ashby", "lever", "workday"]) {
        if (!ats.has(board)) continue;
        const { items, fetcher } = BOARD_FETCHERS[board];
        jobs.push(...(await runBoards(board, items(cfg), fetcher, delayMs, emit)));
    }

    if (pickDiscoverEngine(cfg) === "bsk") {
        try {
            jobs.push(...(await runBrowserSources(cfg, emit)));
        } catch (err) {
            log(`  Fillow Browser discovery failed (continuing with API jobs): ${err.message}`);
        }
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

    const onTarget = filterJobsByTargetsAndBlacklist(unique, blacklist, cfg.targets);

    const livenessByJob = await checkLivenessBatch(onTarget, 6, emit);
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
    log(`📡 Discovery: ${jobs.length} fetched, ${unique.length} new, ${alive.length} on-target (dropped ${expired} expired, ${uncertain} uncertain-kept), ${result.added} recorded`);
    if (emit) emit("phase.complete", { label: "Discovery", total: 4 });
    return alive;
}

const isCli = process.argv[1]?.endsWith("discover.mjs");
if (isCli) {
  runAgentCli({
    agent: "discover",
    run: async (emit) => scrapeJobs(loadConfig(), emit),
    summarize: (jobs) => `${jobs.length} jobs discovered`,
  }).catch((err) => {
    console.error(`  discover failed: ${err?.stack || err}`);
    process.exitCode = 1;
  });
}

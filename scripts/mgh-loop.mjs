#!/usr/bin/env node
/**
 * Continuous MyGreenhouse lane (BrowserSkill, --no-focus tiny Agent Window):
 *   discover → score/tailor Jake PDFs → apply → track → repeat
 *
 *   LOOP_MINUTES=120 MAX_APPLIES_PER_RUN=5 DRY_RUN=false node scripts/mgh-loop.mjs
 */
import { existsSync } from "node:fs";
import { loadConfig } from "../lib/config.mjs";
import { readJobs, writeJobs } from "../lib/jobs-tsv.mjs";
import { isBlacklisted } from "../lib/blacklist.mjs";
import { readTracker } from "../lib/tracker.mjs";
import { rankJobs } from "../lib/score.mjs";
import { ensureJobDescription } from "../lib/ats.mjs";
import { analyzeJD } from "../lib/jd-analyze.mjs";
import { resolveResumePath, generateSinglePdf } from "../lib/resume-pdf.mjs";
import { discoverMyGreenhouse } from "../agents/discover-mygreenhouse.mjs";
import { applyMyGreenhouse } from "../agents/apply-mygreenhouse.mjs";
import { trackMyGreenhouse } from "../agents/track-mygreenhouse.mjs";
import { minimizeAgentWindow, pause } from "../lib/bsk.mjs";
import { isUsJobLocation } from "../lib/location.mjs";
import { mghJobKey } from "../lib/tracker.mjs";

const QUERY_BATCHES = [
  ["Machine Learning Engineer", "ML Engineer", "AI Engineer"],
  ["Software Engineer", "Backend Engineer", "Full Stack Engineer"],
  ["Data Scientist", "Applied Scientist", "Data Engineer"],
  ["LLM Engineer", "NLP Engineer", "Research Engineer"],
  ["MLOps", "AI/ML", "Machine Learning"],
];

function contactedIndex() {
  const companies = new Set();
  const keys = new Set();
  for (const row of readTracker()) {
    if (row.company) companies.add(String(row.company).toLowerCase());
    const k = mghJobKey(row.notes);
    if (k) keys.add(k);
  }
  return { companies, keys };
}

function mghPool(contacted) {
  return readJobs().filter((j) => {
    if (String(j.source) !== "mygreenhouse") return false;
    const status = j.status || "discovered";
    if (!["ready", "discovered"].includes(status)) return false;
    if (isBlacklisted(j.company)) return false;
    if (!isUsJobLocation(j)) return false;
    const key = mghJobKey(j.external_id) || mghJobKey(j.apply_url || j.url);
    if (key && contacted.keys.has(key)) return false;
    if (contacted.companies.has(String(j.company || "").toLowerCase())) return false;
    return true;
  });
}

/** Score + Jake-tailor only the next apply batch (does not re-walk the full TSV). */
async function tailorBatch(jobs, cfg) {
  if (!jobs.length) return [];
  const scored = rankJobs(jobs, cfg.targets, cfg.candidate);
  const min = cfg.runtime.min_match_score ?? 70;
  const all = readJobs();
  const byKey = new Map(all.map((j) => [`${j.source}:${j.external_id}`.toLowerCase(), j]));

  for (const job of scored) {
    const key = `${job.source}:${job.external_id}`.toLowerCase();
    const row = byKey.get(key) || job;
    row.match_score = job.match_score;
    if (Number(job.match_score) < min) {
      row.status = "below_threshold";
      continue;
    }
    row.status = "ready";
    try {
      await ensureJobDescription(row);
    } catch (err) {
      console.warn(`  JD fetch ${row.company}: ${err.message}`);
    }
    try {
      row._jd_analysis = await analyzeJD(row, cfg);
    } catch {
      row._jd_analysis = null;
    }
    let resumePath = resolveResumePath(row, cfg);
    if (!resumePath || !existsSync(resumePath)) {
      try {
        resumePath = await generateSinglePdf(cfg, row, { force: true });
        console.log(`  tailored: ${row.company} → ${resumePath}`);
      } catch (err) {
        console.warn(`  tailor ${row.company}: ${err.message}`);
      }
    } else {
      console.log(`  resume ready: ${row.company}`);
    }
  }

  writeJobs([...byKey.values()]);
  return scored.filter((j) => Number(j.match_score) >= min);
}

async function oneCycle(cfg, cycle, queries) {
  console.log(`\n======== mgh-loop cycle ${cycle} @ ${new Date().toISOString()} ========`);
  console.log(`  queries: ${queries.join(" | ")}`);
  minimizeAgentWindow();

  try {
    await discoverMyGreenhouse(cfg, { queries, limit: 20 });
  } catch (err) {
    console.warn(`[cycle ${cycle}] discover: ${err.message}`);
  }
  minimizeAgentWindow();

  const contacted = contactedIndex();
  const pool = mghPool(contacted);
  const cap = cfg.runtime.max_applies_per_run ?? 5;
  const batch = pool
    .sort((a, b) => Number(b.match_score || 0) - Number(a.match_score || 0))
    .slice(0, cap);
  console.log(`[cycle ${cycle}] pool=${pool.length} batch=${batch.length}`);

  if (!batch.length) {
    console.log(`[cycle ${cycle}] nothing to tailor/apply`);
    return [];
  }

  console.log(`[cycle ${cycle}] tailor`);
  await tailorBatch(batch, cfg);

  console.log(`[cycle ${cycle}] apply`);
  const results = await applyMyGreenhouse(batch, cfg);
  minimizeAgentWindow();
  if (results.length) await trackMyGreenhouse(results, cfg);

  for (const r of results) {
    console.log(`  ${r.status} | ${r.company} | ${(r.notes || "").slice(0, 90)}`);
  }
  return results;
}

async function main() {
  const cfg = loadConfig();
  const minutes = Math.max(1, Number(process.env.LOOP_MINUTES || 120));
  const betweenSec = Math.max(30, Number(process.env.LOOP_PAUSE_SEC || 90));
  const deadline = Date.now() + minutes * 60_000;

  console.log(
    `[mgh-loop] start minutes=${minutes} dry_run=${cfg.runtime.dry_run} cap=${cfg.runtime.max_applies_per_run} pause=${betweenSec}s`
  );

  let cycle = 0;
  let totalApplied = 0;
  while (Date.now() < deadline) {
    cycle += 1;
    const queries = QUERY_BATCHES[(cycle - 1) % QUERY_BATCHES.length];
    try {
      const results = await oneCycle(cfg, cycle, queries);
      totalApplied += results.filter((r) => ["applied", "submitted"].includes(r.status)).length;
    } catch (err) {
      console.error(`[cycle ${cycle}] fatal: ${err.message || err}`);
    }

    const leftMin = ((deadline - Date.now()) / 60_000).toFixed(1);
    if (Date.now() >= deadline) break;
    console.log(`[mgh-loop] cycle ${cycle} done — applied_so_far≈${totalApplied}; sleep ${betweenSec}s (${leftMin}m left)`);
    await pause(betweenSec * 1000);
  }

  console.log(`[mgh-loop] DONE cycles=${cycle} applied_approx=${totalApplied}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

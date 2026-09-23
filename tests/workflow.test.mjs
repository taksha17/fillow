import test from "node:test";
import assert from "node:assert/strict";
import { scrapeJobs } from "../agents/discover.mjs";
import { evaluateTailor, selectTailorBatch } from "../agents/evaluate-tailor.mjs";
import { applyJobs } from "../agents/apply.mjs";
import { trackDashboard } from "../agents/track.mjs";
import { runOnline } from "../scripts/online.mjs";
import { runOffline } from "../scripts/offline.mjs";
import { appendApplication, readTracker } from "../lib/tracker.mjs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("all four agents export the pipeline entry points", () => {
  assert.equal(typeof scrapeJobs, "function");
  assert.equal(typeof evaluateTailor, "function");
  assert.equal(typeof applyJobs, "function");
  assert.equal(typeof trackDashboard, "function");
  assert.equal(typeof runOnline, "function");
  assert.equal(typeof runOffline, "function");
});

test("selectTailorBatch walks the backlog, skipping already-tailored jobs", () => {
  const jobs = [
    { company: "A" },
    { company: "B" },
    { company: "C" },
    { company: "D" },
  ];
  const done = (job) => job.done === true;
  jobs[0].done = true;
  const first = selectTailorBatch(jobs, 2, done);
  assert.deepEqual(first.map((j) => j.company), ["B", "C"]);
  first.forEach((j) => { j.done = true; });
  const second = selectTailorBatch(jobs, 2, done);
  assert.deepEqual(second.map((j) => j.company), ["D"]);
  second.forEach((j) => { j.done = true; });
  assert.deepEqual(selectTailorBatch(jobs, 2, done), []);
});

test("selectTailorBatch cap 0 or empty input yields empty batch", () => {
  assert.deepEqual(selectTailorBatch([{ company: "A" }], 0, () => false), []);
  assert.deepEqual(selectTailorBatch([], 5, () => false), []);
});

test("Agent 3 → 4 handoff records dry-run rows", async () => {
  const results = await applyJobs(
    [
      { title: "SWE", company: "Acme", status: "ready", match_score: 88, apply_url: "https://jobs.ashbyhq.com/acme/sync-1" },
      { title: "MLE", company: "Bolt", status: "ready", match_score: 91, apply_url: "https://jobs.ashbyhq.com/bolt/sync-2" },
    ],
    {
      candidate: {},
      runtime: { dry_run: true, max_applies_per_run: 3, auto_submit: true, review_mode: false, apply_delay_seconds: 0 },
      answer_preferences: {},
      gmail: {},
      secrets: {},
    }
  );
  assert.equal(results.length, 2);
  assert.ok(results.every((r) => r.status === "dry_run"));

  const path = join(mkdtempSync(join(tmpdir(), "fillow-sync-")), "applications.md");
  for (const item of results) {
    appendApplication({
      company: item.company,
      role: item.role,
      score: item.score,
      status: item.status,
      notes: item.notes,
      url: item.url,
    }, path);
  }
  const rows = readTracker(path);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].status, "dry_run");
  assert.equal(rows[1].company, "Bolt");
});

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../lib/paths.mjs";
import { HELP } from "../bin/fillow.mjs";
import { scoreOnlyRequested } from "../agents/evaluate-tailor.mjs";
import { runOnline } from "../scripts/online.mjs";
import { runOffline } from "../scripts/offline.mjs";
import { pullJobs } from "../scripts/pull-jobs.mjs";

const cli = join(ROOT, "bin", "fillow.mjs");

function fillow(args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: ROOT, encoding: "utf8" });
}

test("fillow help lists hybrid commands", () => {
  const r = fillow(["help"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /fillow online/);
  assert.match(r.stdout, /fillow offline/);
  assert.match(r.stdout, /fillow pull/);
  assert.match(r.stdout, /--score-only/);
  assert.match(HELP, /HYBRID\.md/);
});

test("scoreOnlyRequested reads argv and env", () => {
  assert.equal(scoreOnlyRequested(["node", "x", "--score-only"], {}), true);
  assert.equal(scoreOnlyRequested(["node", "x"], { FILLLOW_SCORE_ONLY: "true" }), true);
  assert.equal(scoreOnlyRequested(["node", "x"], { FILLLOW_SCORE_ONLY: "false" }), false);
});

test("hybrid entry points export", () => {
  assert.equal(typeof runOnline, "function");
  assert.equal(typeof runOffline, "function");
  assert.equal(typeof pullJobs, "function");
  assert.ok(existsSync(join(ROOT, ".github", "workflows", "fillow-online.yml")));
});

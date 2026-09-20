import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { ROOT } from "../lib/paths.mjs";
import { HELP } from "../bin/fillow.mjs";

const cli = join(ROOT, "bin", "fillow.mjs");

function fillow(args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: ROOT, encoding: "utf8" });
}

test("fillow help lists the four agents", () => {
  const r = fillow(["help"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /fillow run/);
  assert.match(r.stdout, /discover/);
  assert.match(r.stdout, /evaluate/);
  assert.match(r.stdout, /apply/);
  assert.match(r.stdout, /track/);
  assert.match(HELP, /DRY_RUN/);
  assert.match(HELP, /fillow online/);
});

test("fillow unknown command exits 1", () => {
  const r = fillow(["not-a-command"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Unknown command/);
});

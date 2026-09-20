#!/usr/bin/env node
import { readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { ROOT } from "../lib/paths.mjs";

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, acc);
    else if (name.endsWith(".mjs")) acc.push(path);
  }
  return acc;
}

const files = walk(ROOT);
let failed = 0;
for (const file of files) {
  const r = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (r.status !== 0) {
    failed += 1;
    console.error(r.stderr || r.stdout || file);
  }
}
if (failed) {
  console.error(`syntax check failed: ${failed}/${files.length}`);
  process.exit(1);
}
console.log(`syntax ok: ${files.length} files`);

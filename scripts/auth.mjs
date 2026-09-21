#!/usr/bin/env node
import { loadConfig } from "../lib/config.mjs";
import { authMatrix, formatAuthMatrix } from "../lib/auth.mjs";

let cfg;
try {
  cfg = loadConfig();
} catch (err) {
  console.error(`fillow auth requires a config: ${err.message}`);
  process.exit(1);
}

console.log("fillow auth — platform connections\n");
const checks = await authMatrix(cfg);
console.log(formatAuthMatrix(checks));

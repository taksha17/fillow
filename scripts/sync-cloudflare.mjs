#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import dotenv from "dotenv";
import { ROOT } from "../lib/paths.mjs";
import { pushSyncHttp, syncPayload, syncSql } from "../lib/cloudflare-sync.mjs";

dotenv.config({ path: join(ROOT, ".env") });

const remote = process.argv.includes("--remote");
const sqlPath = join(ROOT, "cloudflare", ".sync.sql");
const payload = syncPayload();
writeFileSync(sqlPath, syncSql(payload), "utf8");
console.log(`Wrote ${sqlPath} (${payload.applications.length} applications, ${payload.jobs.length} jobs)`);

if (process.env.FILLLOW_SYNC_URL && process.env.FILLLOW_SYNC_TOKEN) {
  const out = await pushSyncHttp(payload, {
    url: process.env.FILLLOW_SYNC_URL,
    token: process.env.FILLLOW_SYNC_TOKEN,
  });
  console.log(out.ok ? "HTTP sync ok" : `HTTP sync skipped/failed: ${JSON.stringify(out)}`);
  if (out.ok) process.exit(0);
}

const args = [
  "wrangler",
  "d1",
  "execute",
  "fillow",
  "--config",
  "cloudflare/wrangler.toml",
  "--file",
  "cloudflare/.sync.sql",
  "--yes",
  remote ? "--remote" : "--local",
];

const r = spawnSync("npx", args, { cwd: ROOT, stdio: "inherit", encoding: "utf8" });
process.exit(r.status || 0);

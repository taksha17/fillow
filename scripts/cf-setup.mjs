#!/usr/bin/env node
/**
 * Interactive Cloudflare Workers Free + D1 Free setup.
 * Sign up at https://dash.cloudflare.com/sign-up (no card for this plan).
 * Then this script: device-login, create D1 `fillow`, write database_id, apply schema.
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { ROOT } from "../lib/paths.mjs";

const SIGNUP = "https://dash.cloudflare.com/sign-up";
const wranglerToml = join(ROOT, "cloudflare", "wrangler.toml");
const envFile = join(ROOT, ".env");
const devVars = join(ROOT, "cloudflare", ".dev.vars");

function run(args, opts = {}) {
  return spawnSync("npx", ["--yes", "wrangler", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: opts.stdio || "pipe",
    ...opts,
  });
}

function upsertEnv(path, key, value) {
  if (!existsSync(path)) return false;
  let text = readFileSync(path, "utf8");
  const line = `${key}=${value}`;
  if (new RegExp(`^${key}=`, "m").test(text)) {
    text = text.replace(new RegExp(`^${key}=.*$`, "m"), line);
  } else {
    text = `${text.trimEnd()}\n${line}\n`;
  }
  writeFileSync(path, text);
  return true;
}

function parseD1List(stdout) {
  try {
    const parsed = JSON.parse(stdout || "[]");
    const rows = Array.isArray(parsed) ? parsed : parsed.result || parsed.databases || [];
    const match = rows.find((r) => r && r.name === "fillow");
    return match?.uuid || match?.id || "";
  } catch {
    return "";
  }
}

function extractDatabaseId(text) {
  const quoted = text.match(/database_id\s*=\s*"([0-9a-f-]{36})"/i);
  if (quoted) return quoted[1];
  const uuid = text.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return uuid ? uuid[1] : "";
}

console.log("fillow Cloudflare setup (Workers Free + D1 Free)");
console.log(`If you do not have an account yet, open:\n  ${SIGNUP}\nStay on the free plan. No credit card for Workers/D1 Free.\n`);

const who = run(["whoami"]);
if (who.status !== 0) {
  console.log("Not logged in. Approve Wrangler in the browser (device login, 5 minutes).\n");
  const login = run(["login", "--device", "--browser=false"], { stdio: "inherit" });
  if (login.status !== 0) {
    console.error("wrangler login failed. Create the account first, then re-run: npm run cf:setup");
    process.exit(1);
  }
} else {
  console.log((who.stdout || "").trim() || "Already logged in.");
}

let id = "";
const listed = run(["d1", "list", "--json", "--config", "cloudflare/wrangler.toml"]);
if (listed.status === 0) {
  id = parseD1List(listed.stdout);
  if (id) console.log(`Reusing existing D1 database fillow (${id})`);
}

if (!id) {
  const created = run(["d1", "create", "fillow", "--config", "cloudflare/wrangler.toml"]);
  const out = `${created.stdout || ""}\n${created.stderr || ""}`;
  console.log(out.trim());
  id = extractDatabaseId(out);
  if (created.status !== 0 && !id && !/already exists|duplicate/i.test(out)) {
    console.error("Could not create D1 database. Copy its database_id into cloudflare/wrangler.toml, then re-run.");
    process.exit(created.status || 1);
  }
}

if (id) {
  let toml = readFileSync(wranglerToml, "utf8");
  toml = toml.replace(/database_id\s*=\s*"[^"]+"/, `database_id = "${id}"`);
  writeFileSync(wranglerToml, toml);
  console.log(`Wrote database_id ${id} to cloudflare/wrangler.toml`);
}

const schema = run(
  ["d1", "execute", "fillow", "--config", "cloudflare/wrangler.toml", "--remote", "--file", "cloudflare/schema.sql", "--yes"],
  { stdio: "inherit" }
);
if (schema.status !== 0) {
  console.error("Schema apply failed.");
  process.exit(schema.status || 1);
}

const token = `fillow_${randomBytes(24).toString("hex")}`;
writeFileSync(devVars, `FILLLOW_SYNC_TOKEN=${token}\n`);
upsertEnv(envFile, "FILLLOW_SYNC_TOKEN", token);

const secret = run(
  ["secret", "put", "FILLLOW_SYNC_TOKEN", "--config", "cloudflare/wrangler.toml"],
  { input: `${token}\n`, stdio: ["pipe", "inherit", "inherit"] }
);
if (secret.status !== 0) {
  console.log("Could not store the Worker secret automatically. After deploy run:");
  console.log(`  printf '%s' '${token}' | npx wrangler secret put FILLLOW_SYNC_TOKEN --config cloudflare/wrangler.toml`);
}

console.log(`
Next:
  npm run cf:sync -- --remote     # push local tracker + jobs into D1
  npm run cf:deploy               # publish Worker (*.workers.dev)

Then set FILLLOW_SYNC_URL in .env to https://fillow.<your-subdomain>.workers.dev
FILLLOW_SYNC_TOKEN is already in .env and cloudflare/.dev.vars.

Playwright apply cannot run on Workers Free. Keep DRY_RUN local; the hosted
piece is dashboard + D1, fed by npm run cf:sync after each local pipeline run.
`);

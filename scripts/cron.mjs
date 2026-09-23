#!/usr/bin/env node
/**
 * fillow cron — 1-click management of the daily discover+score schedule
 * in .github/workflows/fillow-online.yml (the "git cron job").
 *
 *   fillow cron status                    show the schedule
 *   fillow cron enable                    (re)enable the daily cron at 9:00 AM America/Chicago
 *   fillow cron enable --at 9:30          different time (add --tz "America/New_York")
 *   fillow cron disable                   comment the cron out (workflow_dispatch stays)
 *   fillow cron run                       trigger one run now via gh
 *
 * Changing the file needs a commit + push to take effect — never done automatically.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { ROOT } from "../lib/paths.mjs";

const WORKFLOW_PATH = join(ROOT, ".github", "workflows", "fillow-online.yml");

export function parseCronSchedule(text) {
  const entries = [];
  for (const line of String(text || "").split("\n")) {
    const m = line.match(/^(\s*)(#\s*)?- cron:\s*"?([^"\n]+?)"?\s*$/);
    if (m) entries.push({ indent: m[1], disabled: Boolean(m[2]), cron: m[3].trim() });
  }
  return entries;
}

export function setCronSchedule(text, cronExpr) {
  const lines = String(text || "").split("\n");
  let replaced = false;
  const out = lines.map((line) => {
    const m = line.match(/^(\s*)(#\s*)?- cron:\s*"?([^"\n]+?)"?\s*$/);
    if (!m) return line;
    if (cronExpr === null) return `${m[1]}# - cron: "${m[3]}"`;
    if (replaced) return `${m[1]}# - cron: "${m[3]}"`;
    replaced = true;
    return `${m[1]}- cron: "${cronExpr}"`;
  });
  return out.join("\n");
}

function tzOffsetMinutes(tz, date = new Date()) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(dtf.formatToParts(date).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute), Number(parts.second));
  // whole minutes only — cron has no sub-minute granularity
  return Math.round((asUtc - date.getTime()) / 60000);
}

/** Local wall time in a tz → fixed-UTC cron expression (±1h across DST changes — noted in output). */
export function localToUtcCron(hh, mm, tz = "UTC", date = new Date()) {
  let total = hh * 60 + mm - tzOffsetMinutes(tz, date);
  total = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")} ${String(total % 60).padStart(2, "0")} * * *`;
}

function parseTimeArg(raw) {
  const m = String(raw || "").match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!m) throw new Error(`--at expects a time like 9:30 or "9am" (got "${raw}")`);
  let hh = Number(m[1]);
  const mm = Number(m[2] || 0);
  const ampm = (m[3] || "").toLowerCase();
  if (ampm === "pm" && hh < 12) hh += 12;
  if (ampm === "am" && hh === 12) hh = 0;
  if (hh > 23 || mm > 59) throw new Error(`--at out of range: ${raw}`);
  return [hh, mm];
}

function usage() {
  process.stderr.write(`fillow cron — manage the daily discover+score schedule

  fillow cron status
  fillow cron enable [--at 9:30] [--tz "America/Chicago"]
  fillow cron disable
  fillow cron run        (gh workflow run — one immediate pass)

Schedule changes are written to .github/workflows/fillow-online.yml.
Commit + push for GitHub to pick the new schedule up.
`);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = {};
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === "--at") args.at = rest[++i];
    else if (rest[i] === "--tz") args.tz = rest[++i];
    else {
      usage();
      process.exit(1);
    }
  }

  if (cmd === "run") {
    const res = spawnSync("gh", ["workflow", "run", "fillow-online.yml"], { stdio: "inherit" });
    process.exit(res.status ?? 1);
  }

  const text = readFileSync(WORKFLOW_PATH, "utf8");

  if (cmd === "status") {
    const entries = parseCronSchedule(text);
    if (!entries.length) {
      process.stdout.write("No cron schedule found in fillow-online.yml (manual/workflow_dispatch only).\n");
      return;
    }
    for (const e of entries) {
      process.stdout.write(`${e.disabled ? "disabled" : "enabled "}  ${e.cron}  (UTC)\n`);
    }
    const active = entries.filter((e) => !e.disabled);
    process.stdout.write(active.length ? "Daily discover+score: ON\n" : "Daily discover+score: OFF (fillow cron enable to turn on)\n");
    return;
  }

  if (cmd === "enable") {
    const [hh, mm] = parseTimeArg(args.at ?? "9:00");
    const tz = args.tz || "America/Chicago";
    const expr = localToUtcCron(hh, mm, tz);
    const next = setCronSchedule(text, expr);
    writeFileSync(WORKFLOW_PATH, next);
    process.stdout.write(`Schedule set: ${tz} ${hh}:${String(mm).padStart(2, "0")} → cron "${expr}" (UTC)\n`);
    process.stdout.write(`Written to .github/workflows/fillow-online.yml — commit + push to take effect.\n`);
    process.stdout.write(`Note: the cron stays fixed in UTC, so it drifts ±1h across DST changes.\n`);
    return;
  }

  if (cmd === "disable") {
    const next = setCronSchedule(text, null);
    writeFileSync(WORKFLOW_PATH, next);
    process.stdout.write("Daily cron commented out (workflow_dispatch still works). Commit + push to take effect.\n");
    return;
  }

  usage();
  process.exit(cmd ? 1 : 0);
}

const isCli = process.argv[1]?.endsWith("cron.mjs");
if (isCli) {
  main().catch((err) => {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  });
}

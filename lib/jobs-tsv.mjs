import { existsSync, readFileSync } from "node:fs";
import { writeFileAtomic } from "./atomic-write.mjs";
import { PATHS, ensureDataDirs } from "./paths.mjs";

export const JOBS_HEADER = [
  "source",
  "external_id",
  "title",
  "company",
  "location",
  "url",
  "apply_url",
  "ats",
  "match_score",
  "status",
].join("\t");

function parseTsv(text) {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];
  const header = lines[0].split("\t");
  return lines.slice(1).map((line) => {
    const cells = line.split("\t");
    const row = {};
    header.forEach((key, i) => {
      row[key] = cells[i] || "";
    });
    return row;
  });
}

export function readJobs(path = PATHS.jobsTsv) {
  if (!existsSync(path)) return [];
  return parseTsv(readFileSync(path, "utf8"));
}

export function writeJobs(jobs, path = PATHS.jobsTsv) {
  ensureDataDirs();
  const lines = [JOBS_HEADER];
  for (const job of jobs) {
    lines.push(
      [
        job.source || "",
        job.external_id || "",
        job.title || "",
        job.company || "",
        job.location || "",
        job.url || "",
        job.apply_url || job.url || "",
        job.ats || "",
        job.match_score ?? "",
        job.status || "discovered",
      ]
        .map((v) => String(v).replace(/\t/g, " ").replace(/\n/g, " "))
        .join("\t")
    );
  }
  writeFileAtomic(path, `${lines.join("\n")}\n`);
}

export function upsertJobs(incoming, path = PATHS.jobsTsv) {
  const existing = readJobs(path);
  const seen = new Set(existing.map((j) => `${j.source}:${j.external_id}`.toLowerCase()));
  const added = [];
  for (const job of incoming) {
    const key = `${job.source}:${job.external_id}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    existing.push(job);
    added.push(job);
  }
  writeJobs(existing, path);
  return { total: existing.length, added: added.length, jobs: existing };
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const UUID_RE_G = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

export function jobIdTokens(url) {
  const tokens = new Set();
  const raw = String(url || "");
  for (const m of raw.matchAll(UUID_RE_G)) tokens.add(m[0].toLowerCase());
  try {
    const u = new URL(raw);
    for (const value of u.searchParams.values()) {
      if (UUID_RE.test(value)) tokens.add(value.toLowerCase());
      else if (/^\d{5,}$/.test(value)) tokens.add(value);
    }
    for (const seg of u.pathname.split("/")) {
      const s = decodeURIComponent(seg);
      if (UUID_RE.test(s)) tokens.add(s.toLowerCase());
      else if (/^\d{5,}$/.test(s)) tokens.add(s);
    }
  } catch {
    for (const m of raw.matchAll(/\d{5,}/g)) tokens.add(m[0]);
  }
  return [...tokens];
}

export function matchJobByUrlTokens(url, jobs) {
  const tokens = jobIdTokens(url);
  if (!tokens.length) return null;
  for (const job of jobs) {
    const ext = String(job.external_id || "").toLowerCase();
    if (!ext) continue;
    if (tokens.some((t) => ext.includes(t))) return job;
  }
  return null;
}

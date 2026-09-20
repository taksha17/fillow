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

import { existsSync } from "node:fs";
import { writeFileAtomic } from "./atomic-write.mjs";
import { PATHS, ensureDataDirs } from "./paths.mjs";
import { readTracker } from "./tracker.mjs";
import { readJobs, matchJobByUrlTokens } from "./jobs-tsv.mjs";
import { tailoredResumePath } from "./resume-pdf.mjs";
import { dashboardHtml } from "../cloudflare/src/html.mjs";

function localResumeHref(jobs) {
  return (row) => {
    const job = matchJobByUrlTokens(row.url || "", jobs);
    if (!job) return "";
    const md = tailoredResumePath(job).replace(/\.pdf$/, ".md");
    if (!existsSync(md)) return "";
    return `../data/tailored/${md.replace(/\\/g, "/").split("/").pop()}`;
  };
}

export function buildDashboardHtml(rows = readTracker(), title = "fillow") {
  const jobs = existsSync(PATHS.jobsTsv) ? readJobs() : [];
  return dashboardHtml(rows, title, { source: "local", resumeHref: localResumeHref(jobs) });
}

export function writeDashboard(rows, title) {
  ensureDataDirs();
  const html = buildDashboardHtml(rows, title);
  writeFileAtomic(PATHS.dashboard, html);
  return PATHS.dashboard;
}

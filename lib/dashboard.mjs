import { writeFileAtomic } from "./atomic-write.mjs";
import { PATHS, ensureDataDirs } from "./paths.mjs";
import { readTracker } from "./tracker.mjs";
import { dashboardHtml } from "../cloudflare/src/html.mjs";

export function buildDashboardHtml(rows = readTracker(), title = "fillow") {
  return dashboardHtml(rows, title, { source: "local" });
}

export function writeDashboard(rows, title) {
  ensureDataDirs();
  const html = buildDashboardHtml(rows, title);
  writeFileAtomic(PATHS.dashboard, html);
  return PATHS.dashboard;
}

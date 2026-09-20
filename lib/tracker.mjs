import { existsSync, readFileSync } from "node:fs";
import { writeFileAtomic } from "./atomic-write.mjs";
import { PATHS, ensureDataDirs } from "./paths.mjs";

export const HEADER = "| # | Date | Company | Role | Score | Status | PDF | Report | Notes |";
export const SEPARATOR = "|---|------|---------|------|-------|--------|-----|--------|-------|";

function escapeCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}

function parseRow(line) {
  if (!line.startsWith("|") || line.includes("---")) return null;
  const cells = line.split("|").slice(1, -1).map((c) => c.trim());
  if (cells[0] === "#") return null;
  if (cells.length < 9) return null;
  return {
    num: cells[0],
    date: cells[1],
    company: cells[2],
    role: cells[3],
    score: cells[4],
    status: cells[5],
    pdf: cells[6],
    report: cells[7],
    notes: cells[8],
  };
}

export function emptyTracker() {
  return `# Applications Tracker\n\n${HEADER}\n${SEPARATOR}\n`;
}

export function readTracker(path = PATHS.applications) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").map(parseRow).filter(Boolean);
}

function render(rows) {
  const lines = ["# Applications Tracker", "", HEADER, SEPARATOR];
  for (const row of rows) {
    lines.push(
      `| ${escapeCell(row.num)} | ${escapeCell(row.date)} | ${escapeCell(row.company)} | ${escapeCell(row.role)} | ${escapeCell(row.score)} | ${escapeCell(row.status)} | ${escapeCell(row.pdf)} | ${escapeCell(row.report)} | ${escapeCell(row.notes)} |`
    );
  }
  return `${lines.join("\n")}\n`;
}

export function normalizeUrl(url) {
  return String(url || "").trim().toLowerCase().replace(/\/+$/, "");
}

export function hasUrl(rows, url) {
  const key = normalizeUrl(url);
  if (!key) return false;
  return rows.some((row) => normalizeUrl(row.notes).includes(key) || normalizeUrl(row.notes) === key);
}

export function appendApplication(entry, path = PATHS.applications) {
  ensureDataDirs();
  const rows = existsSync(path) ? readTracker(path) : [];
  const url = entry.url || entry.apply_url || "";
  if (url && hasUrl(rows, url)) {
    return { skipped: true, reason: "duplicate_url", rows };
  }
  const nextNum = rows.reduce((max, row) => Math.max(max, Number.parseInt(row.num, 10) || 0), 0) + 1;
  const notes = [entry.notes, url].filter(Boolean).join(" ");
  rows.push({
    num: String(nextNum),
    date: entry.date || new Date().toISOString().slice(0, 10),
    company: entry.company || "",
    role: entry.role || "",
    score: entry.score || "",
    status: entry.status || "pending",
    pdf: entry.pdf || "❌",
    report: entry.report || "",
    notes,
  });
  writeFileAtomic(path, render(rows));
  return { skipped: false, num: nextNum, rows };
}

export function updateApplication(match, patch, path = PATHS.applications) {
  ensureDataDirs();
  if (!existsSync(path)) return { updated: false };
  const rows = readTracker(path);
  const url = match.url || match.apply_url || "";
  const row = rows.find((r) => {
    if (match.num && String(r.num) === String(match.num)) return true;
    if (url && hasUrl([r], url)) return true;
    if (match.company && match.role) {
      return r.company.toLowerCase() === String(match.company).toLowerCase()
        && r.role.toLowerCase() === String(match.role).toLowerCase();
    }
    return false;
  });
  if (!row) return { updated: false, rows };
  if (patch.status) row.status = patch.status;
  if (patch.score) row.score = patch.score;
  if (patch.pdf) row.pdf = patch.pdf;
  if (patch.report) row.report = patch.report;
  if (patch.notes) row.notes = [row.notes, patch.notes].filter(Boolean).join(" | ");
  writeFileAtomic(path, render(rows));
  return { updated: true, row, rows };
}

export function appendLedger(entry, path = PATHS.ledger) {
  ensureDataDirs();
  const header = "# Status ledger\n\n| Time | Company | Role | From | To | Reason |\n|---|---|---|---|---|---|\n";
  const line = `| ${new Date().toISOString()} | ${escapeCell(entry.company)} | ${escapeCell(entry.role)} | ${escapeCell(entry.from || "")} | ${escapeCell(entry.to)} | ${escapeCell(entry.reason || "")} |\n`;
  const prev = existsSync(path) ? readFileSync(path, "utf8") : header;
  writeFileAtomic(path, prev.endsWith("\n") ? `${prev}${line}` : `${prev}\n${line}`);
}

export function ensureTracker(path = PATHS.applications) {
  ensureDataDirs();
  if (!existsSync(path)) writeFileAtomic(path, emptyTracker());
}

export function metricsFromRows(rows) {
  const byStatus = {};
  for (const row of rows) {
    const status = row.status || "unknown";
    byStatus[status] = (byStatus[status] || 0) + 1;
  }
  const byDay = {};
  for (const row of rows) {
    byDay[row.date] = (byDay[row.date] || 0) + 1;
  }
  const submitted = rows.filter((r) => /applied|submitted|under_review|interview|offer/i.test(r.status)).length;
  const offers = rows.filter((r) => /offer/i.test(r.status)).length;
  return {
    total: rows.length,
    byStatus,
    byDay,
    conversion_rate: submitted ? offers / submitted : 0,
  };
}

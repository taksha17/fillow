import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { PATHS, ensureDataDirs } from "./paths.mjs";

export const STUCK_PATH = `${PATHS.data}/stuck-questions.jsonl`;
export const QA_BANK_PATH = `${PATHS.data}/qa-bank.json`;

/**
 * Append stuck/empty required labels when Agent 3 lands in review.
 * This is the feed for porting lasting heuristics — not auto-answered.
 */
export function recordStuck({ company, title, ats, url, labels = [], notes = "" } = {}) {
  ensureDataDirs();
  const clean = [...new Set((labels || []).map((l) => String(l || "").replace(/\s+/g, " ").trim()).filter((l) => l.length > 2))];
  if (!clean.length && !notes) return null;
  const row = {
    at: new Date().toISOString(),
    company: company || "",
    title: title || "",
    ats: ats || "",
    url: url || "",
    labels: clean,
    notes: String(notes || "").slice(0, 500),
  };
  appendFileSync(STUCK_PATH, `${JSON.stringify(row)}\n`, "utf8");
  return row;
}

export function readStuck(limit = 200) {
  if (!existsSync(STUCK_PATH)) return [];
  const lines = readFileSync(STUCK_PATH, "utf8").split("\n").filter(Boolean);
  return lines.slice(-limit).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  }).filter(Boolean);
}

/** Frequency table of stuck labels — highest first. */
export function summarizeStuck(limit = 40) {
  const counts = new Map();
  for (const row of readStuck(2000)) {
    for (const label of row.labels || []) {
      const key = label.toLowerCase();
      const cur = counts.get(key) || { label, n: 0, companies: new Set() };
      cur.n += 1;
      if (row.company) cur.companies.add(row.company);
      counts.set(key, cur);
    }
  }
  return [...counts.values()]
    .map((x) => ({ label: x.label, n: x.n, companies: [...x.companies].slice(0, 8) }))
    .sort((a, b) => b.n - a.n)
    .slice(0, limit);
}

/**
 * Curated Q→A bank (exact/substring match). Profile facts still win in answer-engine.
 * Shape: [{ match: "why anthropic", answer: "...", options?: ["Yes","No"] }]
 */
export function loadQaBank() {
  if (!existsSync(QA_BANK_PATH)) return [];
  try {
    const data = JSON.parse(readFileSync(QA_BANK_PATH, "utf8"));
    return Array.isArray(data) ? data : data.entries || [];
  } catch {
    return [];
  }
}

export function saveQaBank(entries) {
  ensureDataDirs();
  mkdirSync(PATHS.data, { recursive: true });
  writeFileSync(QA_BANK_PATH, `${JSON.stringify({ updated_at: new Date().toISOString(), entries }, null, 2)}\n`, "utf8");
}

export function upsertQaBankEntry({ match, answer, notes = "" }) {
  const needle = String(match || "").toLowerCase().trim();
  if (!needle || !answer) return null;
  const entries = loadQaBank();
  const idx = entries.findIndex((e) => String(e.match || "").toLowerCase() === needle);
  const row = { match: needle, answer: String(answer), notes, updated_at: new Date().toISOString() };
  if (idx >= 0) entries[idx] = { ...entries[idx], ...row };
  else entries.push(row);
  saveQaBank(entries);
  return row;
}

/** First bank hit whose match is a substring of the question. */
export function qaBankAnswer(question, bank = loadQaBank()) {
  const q = String(question || "").toLowerCase();
  if (!q) return null;
  for (const entry of bank) {
    const m = String(entry.match || "").toLowerCase();
    if (m && q.includes(m) && entry.answer) return String(entry.answer);
  }
  return null;
}

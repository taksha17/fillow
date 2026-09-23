#!/usr/bin/env node
/**
 * Repair dashboard fidelity:
 *  1) Fix misleading statuses (form still open ≠ submitted)
 *  2) Ensure every tracker row has resume .md for Cloudflare /api/resume/:id
 *  3) Rebuild local dashboard + push sync (resume_md included)
 *
 *   node scripts/repair-dashboard.mjs
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { loadConfig } from "../lib/config.mjs";
import {
  readTracker,
  metricsFromRows,
  mghJobKey,
  urlFromNotes,
} from "../lib/tracker.mjs";
import { writeFileAtomic } from "../lib/atomic-write.mjs";
import { PATHS, ensureDataDirs } from "../lib/paths.mjs";
import { readJobs, matchJobByUrlTokens } from "../lib/jobs-tsv.mjs";
import {
  tailoredResumePath,
  renderResumeMarkdown,
  generateSinglePdf,
} from "../lib/resume-pdf.mjs";
import { baseResumeFromConfig, tailorResumeForJob } from "../lib/resume-source.mjs";
import { writeDashboard } from "../lib/dashboard.mjs";
import { pushSyncHttp, syncPayload } from "../lib/cloudflare-sync.mjs";
import { fetchRecentMail } from "../lib/gmail.mjs";

function escapeCell(v) {
  return String(v ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function renderTracker(rows) {
  const lines = [
    "# Applications",
    "",
    "| # | Date | Company | Role | Score | Status | PDF | Report | Notes |",
    "|---|---|---|---|---|---|---|---|---|",
  ];
  for (const row of rows) {
    lines.push(
      `| ${escapeCell(row.num)} | ${escapeCell(row.date)} | ${escapeCell(row.company)} | ${escapeCell(row.role)} | ${escapeCell(row.score)} | ${escapeCell(row.status)} | ${escapeCell(row.pdf)} | ${escapeCell(row.report)} | ${escapeCell(row.notes)} |`
    );
  }
  return `${lines.join("\n")}\n`;
}

function inferredStatus(row) {
  const notes = String(row.notes || "");
  if (/still open after submit|form incomplete|empty:|auth gate|flagged possible spam/i.test(notes)) {
    return "review";
  }
  if (/^bsk |navigate failed|operation interrupted/i.test(notes) || row.status === "failed") {
    return "failed";
  }
  if (/dry_run/i.test(notes) || row.status === "dry_run") return "dry_run";
  if (/Submitted via|applied:/i.test(notes) && /applied|submitted/i.test(row.status)) {
    return row.status === "submitted" ? "submitted" : "applied";
  }
  return row.status || "applied";
}

function findJobForRow(row, jobs) {
  const url = urlFromNotes(row.notes) || row.url || "";
  const byTokens = matchJobByUrlTokens(url, jobs);
  if (byTokens) return byTokens;
  const key = mghJobKey(url) || mghJobKey(row.notes);
  if (key) {
    const hit = jobs.find((j) => String(j.external_id || "").toLowerCase() === key);
    if (hit) return hit;
  }
  const co = String(row.company || "").toLowerCase();
  const role = String(row.role || "").toLowerCase();
  if (co && role) {
    return (
      jobs.find(
        (j) =>
          String(j.company || "").toLowerCase() === co
          && String(j.title || "").toLowerCase() === role
      ) || null
    );
  }
  return null;
}

async function ensureResumeMd(cfg, row, job) {
  ensureDataDirs();
  mkdirSync(PATHS.tailored, { recursive: true });

  const synthetic = job || {
    company: row.company,
    title: row.role,
    external_id: mghJobKey(row.notes) || `tracker:${row.num}`,
    url: urlFromNotes(row.notes) || "",
    apply_url: urlFromNotes(row.notes) || "",
  };

  const pdfPath = tailoredResumePath(synthetic);
  const mdPath = pdfPath.replace(/\.pdf$/, ".md");

  if (existsSync(mdPath) && readFileSync(mdPath, "utf8").trim().length > 80) {
    return { mdPath, pdfPath, created: false };
  }

  // Fast path: write tailored markdown without launching Chromium.
  const base = baseResumeFromConfig(cfg);
  const model = tailorResumeForJob(base, synthetic, {});
  writeFileSync(mdPath, `${renderResumeMarkdown(cfg.candidate, model)}\n`, "utf8");

  // Best-effort PDF if missing (skip on failure — md is what Cloudflare serves).
  if (!existsSync(pdfPath) && process.env.REPAIR_PDFS === "true") {
    try {
      await generateSinglePdf(cfg, synthetic, { force: false });
    } catch {
      // ignore
    }
  }

  return { mdPath, pdfPath, created: true };
}

async function gmailProbe(cfg, companies) {
  if (!cfg.gmail?.imap_user || !cfg.gmail?.app_password) {
    return { ok: false, reason: "no gmail creds", hits: [] };
  }
  try {
    const messages = await fetchRecentMail({
      user: cfg.gmail.imap_user,
      password: cfg.gmail.app_password,
      query: 'X-GM-RAW "newer_than:7d (application OR thank you OR received OR applying OR greenhouse OR lever OR ashby OR careers)"',
      limit: 40,
    });
    const hits = [];
    for (const co of companies) {
      const needle = String(co || "").toLowerCase();
      if (needle.length < 3) continue;
      const msg = messages.find((m) => `${m.from} ${m.subject} ${m.body}`.toLowerCase().includes(needle));
      if (msg) hits.push({ company: co, subject: msg.subject, from: msg.from });
    }
    return { ok: true, scanned: messages.length, hits };
  } catch (err) {
    return { ok: false, reason: err.message, hits: [] };
  }
}

async function main() {
  const cfg = loadConfig();
  const jobs = readJobs();
  let rows = readTracker();

  let statusFixed = 0;
  for (const row of rows) {
    const next = inferredStatus(row);
    if (next && next !== row.status) {
      console.log(`status #${row.num} ${row.company}: ${row.status} → ${next}`);
      row.status = next;
      statusFixed += 1;
    }
  }
  if (statusFixed) writeFileAtomic(PATHS.applications, renderTracker(rows));

  console.log("\nEnsuring resume markdown for Cloudflare downloads…");
  let mdReady = 0;
  let mdCreated = 0;
  const recentCompanies = [];
  for (const row of rows) {
    if (/failed|dry_run/i.test(row.status || "")) continue;
    const job = findJobForRow(row, jobs);
    try {
      const out = await ensureResumeMd(cfg, row, job);
      if (existsSync(out.mdPath)) mdReady += 1;
      if (out.created) mdCreated += 1;
      if (existsSync(out.pdfPath)) row.pdf = "✅";
      recentCompanies.push(row.company);
    } catch (err) {
      console.warn(`  resume #${row.num} ${row.company}: ${err.message}`);
    }
  }
  writeFileAtomic(PATHS.applications, renderTracker(rows));

  const dash = writeDashboard(readTracker(), cfg.dashboard?.title || "fillow — Application Dashboard");
  const payload = syncPayload();
  const withMd = payload.applications.filter((a) => (a.resume_md || "").length > 80).length;
  console.log(`\nresume_md ready for sync: ${withMd}/${payload.applications.length} (created ${mdCreated})`);

  if (cfg.secrets.fillow_sync_url && cfg.secrets.fillow_sync_token) {
    const apps = payload.applications;
    const CHUNK = 12;
    let okChunks = 0;
    for (let i = 0; i < apps.length; i += CHUNK) {
      const chunk = {
        applications: apps.slice(i, i + CHUNK),
        jobs: [],
        metrics: payload.metrics,
        captured_at: payload.captured_at,
      };
      const out = await pushSyncHttp(chunk, {
        url: cfg.secrets.fillow_sync_url,
        token: cfg.secrets.fillow_sync_token,
      });
      if (out.ok) okChunks += 1;
      else console.warn(`  chunk ${i / CHUNK + 1} failed: ${JSON.stringify(out).slice(0, 200)}`);
    }
    console.log(`Cloudflare resume sync: ${okChunks}/${Math.ceil(apps.length / CHUNK) || 0} chunks ok`);
  }

  console.log("\nGmail confirmation probe (last 7 days)…");
  const uniqCos = [...new Set(recentCompanies.filter(Boolean))].slice(-40);
  const mail = await gmailProbe(cfg, uniqCos);
  if (!mail.ok) console.log(`  gmail: ${mail.reason}`);
  else {
    console.log(`  scanned ${mail.scanned} messages; company hits ${mail.hits.length}`);
    for (const h of mail.hits.slice(0, 15)) {
      console.log(`   • ${h.company}: ${h.subject} ← ${h.from}`);
    }
    if (!mail.hits.length) {
      console.log("  No matching confirmation/recruiting emails for recent companies (yet).");
    }
  }

  const metrics = metricsFromRows(readTracker());
  console.log("\nDone:", { statusFixed, mdReady, mdCreated, dashboard: dash, totals: metrics });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

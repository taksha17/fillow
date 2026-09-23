import { loadConfig } from "../lib/config.mjs";
import { appendApplication, ensureTracker, metricsFromRows, readTracker } from "../lib/tracker.mjs";
import { writeDashboard } from "../lib/dashboard.mjs";
import { watchReplies } from "../lib/reply-watch.mjs";
import { PATHS } from "../lib/paths.mjs";
import { pushSyncHttp, syncPayload } from "../lib/cloudflare-sync.mjs";
import { runAgentCli } from "../lib/progress.mjs";

async function optionalSupabaseSync(cfg, rows, metrics, emit = null) {
    const log = emit ? (message, data = {}) => emit("log", { message, ...data }) : console.log;
    const warn = emit ? (message, data = {}) => emit("warn", { message, ...data }) : console.warn;
  
    if (!cfg.secrets.supabase_url || !cfg.secrets.supabase_anon_key) return false;
    const url = `${cfg.secrets.supabase_url.replace(/\/$/, "")}/rest/v1/dashboard_metrics`;
    try {
        const res = await fetch(url, {
            method: "POST",
            headers: {
                apikey: cfg.secrets.supabase_anon_key,
                Authorization: `Bearer ${cfg.secrets.supabase_anon_key}`,
                "Content-Type": "application/json",
                Prefer: "resolution=merge-duplicates",
            },
            body: JSON.stringify({
                captured_at: new Date().toISOString(),
                total: metrics.total,
                by_status: metrics.byStatus,
                conversion_rate: metrics.conversion_rate,
                rows: rows.length,
            }),
        });
        if (!res.ok) {
            warn(`  Supabase sync HTTP ${res.status} (local files remain canonical)`);
            return false;
        }
        return true;
    } catch (err) {
        warn("  Supabase sync failed (local files remain canonical):", err.message);
        return false;
    }
}

export async function trackDashboard(results = [], cfg = loadConfig(), opts = {}) {
    const emit = opts.emit || null;
    const log = emit ? (message, data = {}) => emit("log", { message, ...data }) : console.log;
    const warn = emit ? (message, data = {}) => emit("warn", { message, ...data }) : console.warn;

  if (emit) emit("phase.start", { phase: "track", label: "Track applications", total: 4 });

  ensureTracker();
  const recorded = [];
  if (emit) emit("item.start", { phase: "track", item: "Recording applications" });
  for (const item of results) {
    const out = appendApplication({
      date: item.date,
      company: item.company,
      role: item.role || item.title,
      score: item.score || item.match_score || "",
      status: item.status || "pending",
      pdf: item.pdf || "❌",
      report: item.report || "",
      notes: item.notes || "",
      url: item.url || item.apply_url || "",
    });
    recorded.push(out);
  }
  if (emit) emit("item.done", { phase: "track", item: "Recording applications", count: recorded.length });

  if (emit) emit("item.start", { phase: "track", item: "Reply watch" });
  const replyUpdates = await watchReplies(cfg, { useLlm: false });
  if (emit) emit("item.done", { phase: "track", item: "Reply watch", count: replyUpdates.length });

  if (emit) emit("item.start", { phase: "track", item: "Dashboard" });
  const rows = readTracker();
  const metrics = metricsFromRows(rows);
  const dash = writeDashboard(rows, cfg.dashboard?.title || "fillow — Application Dashboard");
  if (emit) emit("item.done", { phase: "track", item: "Dashboard", count: rows.length });

if (emit) emit("item.start", { phase: "track", item: "Sync" });
    await optionalSupabaseSync(cfg, rows, metrics, emit);
    if (cfg.secrets.fillow_sync_url && cfg.secrets.fillow_sync_token) {
        const cf = await pushSyncHttp(syncPayload(), {
            url: cfg.secrets.fillow_sync_url,
            token: cfg.secrets.fillow_sync_token,
        });
        if (cf.ok) log("   Cloudflare D1 sync ok");
        else if (!cf.skipped) warn(`   Cloudflare D1 sync failed: ${cf.status || cf.reason}`);
    }
    if (emit) emit("item.done", { phase: "track", item: "Sync" });

  if (emit) emit("phase.complete", { phase: "track", total: 4, summary: `${recorded.length} recorded, ${replyUpdates.length} reply updates` });
  log(`📊 Tracker ${PATHS.applications}: ${metrics.total} rows`);
  log(`   statuses: ${JSON.stringify(metrics.byStatus)}`);
  log(`   dashboard: ${dash}`);
  if (replyUpdates.length) log(`   reply-watch updates: ${replyUpdates.length}`);
  return { recorded, metrics, dashboard: dash, replyUpdates };
}

const isCli = process.argv[1]?.endsWith("track.mjs");
if (isCli) {
  runAgentCli({
    agent: "track",
    run: async (emit) => trackDashboard([], loadConfig(), { emit }),
    summarize: (result) => `${result.recorded.length} recorded, ${result.replyUpdates.length} reply updates`,
  }).catch((err) => {
    console.error(`  track failed: ${err?.stack || err}`);
    process.exitCode = 1;
  });
}

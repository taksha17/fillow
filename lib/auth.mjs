import { checkGmailInbox, gmailConfigured } from "./gmail.mjs";

const TIMEOUT_MS = 8000;

async function probe(url, { headers = {} } = {}) {
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "fillow-auth/0.1", ...headers },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return response;
}

function entry(platform, required, status, detail, hint) {
  return { platform, required, status, detail, hint };
}

export async function checkNim(cfg) {
  const key = cfg.secrets?.nvidia_api_key || "";
  if (!key) {
    return entry("NVIDIA NIM (LLM fallback)", false, "off", "not set", "optional — used when Groq is unavailable; also for score verify");
  }
  try {
    const res = await probe("https://integrate.api.nvidia.com/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (res.status === 401) return entry("NVIDIA NIM (LLM fallback)", false, "fail", "401 Unauthorized — key rejected", "rotate the key; it may have been revoked");
    if (!res.ok) return entry("NVIDIA NIM (LLM fallback)", false, "warn", `HTTP ${res.status}`, "service reachable but key state unclear");
    return entry("NVIDIA NIM (LLM fallback)", false, "ok", `${cfg.ai?.model || "nemotron"} reachable`);
  } catch (err) {
    return entry("NVIDIA NIM (LLM fallback)", false, "fail", err.message, "network error reaching NIM");
  }
}

export async function checkGmail(cfg) {
  if (!gmailConfigured(cfg)) {
    return entry("Gmail IMAP", true, "missing", "GMAIL_IMAP_USER / GMAIL_APP_PASSWORD not set", "needed for Agent 3 OTP + Agent 4 reply-watch — https://myaccount.google.com/apppasswords");
  }
  try {
    const inbox = await checkGmailInbox(cfg);
    return entry("Gmail IMAP", true, "ok", `${cfg.gmail.imap_user} (inbox: ${inbox.exists} messages)`);
  } catch (err) {
    return entry("Gmail IMAP", true, "fail", err.message, "check the app password (not your account password)");
  }
}

export async function checkGithub(cfg) {
  const token = cfg.secrets?.github_token || "";
  if (!token) {
    return entry("GitHub", false, "off", "unauthenticated (60 req/hr)", "optional — set GITHUB_TOKEN to raise enrich rate limit 60 → 5,000/hr");
  }
  try {
    const res = await probe("https://api.github.com/rate_limit", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) return entry("GitHub", false, "fail", "401 Unauthorized", "rotate GITHUB_TOKEN");
    if (!res.ok) return entry("GitHub", false, "fail", `HTTP ${res.status}`, "github.com unreachable or key bad");
    const data = await res.json();
    const core = data?.resources?.core;
    return entry("GitHub", false, "ok", `authenticated (${core?.remaining}/${core?.limit}/hr)`);
  } catch (err) {
    return entry("GitHub", false, "fail", err.message, "network error reaching GitHub");
  }
}

export async function checkGroq(cfg) {
  const key = cfg.secrets?.groq_api_key || "";
  if (!key) {
    return entry("Groq", true, "missing", "GROQ_API_KEY not set", "add it to .env — primary LLM for answers");
  }
  try {
    const res = await probe("https://api.groq.com/openai/v1/models", { headers: { Authorization: `Bearer ${key}` } });
    if (res.status === 401) return entry("Groq", true, "fail", "401 Unauthorized", "rotate GROQ_API_KEY");
    if (!res.ok) return entry("Groq", true, "warn", `HTTP ${res.status}`);
    return entry("Groq", true, "ok", "models reachable");
  } catch (err) {
    return entry("Groq", true, "fail", err.message);
  }
}

export async function checkOpenAi(cfg) {
  const key = cfg.secrets?.openai_api_key || "";
  if (!key) return entry("OpenAI (LLM fallback)", false, "off", "not set", "optional — last-resort fallback");
  try {
    const res = await probe("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${key}` } });
    if (res.status === 401) return entry("OpenAI (LLM fallback)", false, "fail", "401 Unauthorized", "rotate OPENAI_API_KEY");
    if (!res.ok) return entry("OpenAI (LLM fallback)", false, "warn", `HTTP ${res.status}`);
    return entry("OpenAI (LLM fallback)", false, "ok", "models reachable");
  } catch (err) {
    return entry("OpenAI (LLM fallback)", false, "fail", err.message);
  }
}

export async function checkCloudflare(cfg) {
  const url = process.env.FILLLOW_SYNC_URL || cfg.secrets?.fillow_sync_url || "";
  const token = process.env.FILLLOW_SYNC_TOKEN || cfg.secrets?.fillow_sync_token || "";
  if (!url) return entry("Cloudflare (hosted dashboard)", false, "off", "FILLLOW_SYNC_URL not set", "optional — run npm run cf:setup to host the dashboard");
  try {
    const base = String(url).replace(/\/api\/sync\/?$/, "");
    const res = await probe(`${base}/api/dashboard`);
    if (!res.ok) return entry("Cloudflare (hosted dashboard)", false, "fail", `worker HTTP ${res.status}`, "deploy the worker: npm run cf:deploy");
    const suffix = token ? "sync token set" : "FILLLOW_SYNC_TOKEN missing — cf:sync will 401";
    return entry("Cloudflare (hosted dashboard)", false, token ? "ok" : "warn", `worker up (${base}) · ${suffix}`);
  } catch (err) {
    return entry("Cloudflare (hosted dashboard)", false, "fail", err.message, "worker unreachable");
  }
}

export async function checkSupabase(cfg) {
  const url = cfg.secrets?.supabase_url || "";
  const key = cfg.secrets?.supabase_anon_key || "";
  if (!url || !key) return entry("Supabase (optional sync)", false, "off", "not set", "optional secondary index — D1 is the primary");
  try {
    const res = await probe(`${String(url).replace(/\/$/, "")}/rest/v1/`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (res.status === 401) return entry("Supabase (optional sync)", false, "fail", "401 Unauthorized", "check SUPABASE_ANON_KEY");
    if (!res.ok && res.status !== 404) return entry("Supabase (optional sync)", false, "warn", `HTTP ${res.status}`);
    return entry("Supabase (optional sync)", false, "ok", "REST gateway reachable");
  } catch (err) {
    return entry("Supabase (optional sync)", false, "fail", err.message);
  }
}

export async function authMatrix(cfg) {
  const checks = await Promise.all([
    checkGroq(cfg),
    checkNim(cfg),
    checkGmail(cfg),
    checkGithub(cfg),
    checkOpenAi(cfg),
    checkCloudflare(cfg),
    checkSupabase(cfg),
  ]);
  return checks;
}

export function formatAuthMatrix(checks) {
  const icons = { ok: "✅", warn: "🟡", off: "➖", missing: "❌", fail: "❌" };
  const lines = checks.map((c) => {
    const icon = icons[c.status] || "?";
    const req = c.required ? "required" : "optional";
    const hint = c.hint ? `\n      → ${c.hint}` : "";
    return `${icon} ${c.platform.padEnd(30, "·")} ${c.detail || ""} (${req})${hint}`;
  });
  const failedRequired = checks.filter((c) => c.required && (c.status === "missing" || c.status === "fail"));
  const footer = failedRequired.length
    ? `\n${failedRequired.length} required integration(s) need attention — the pipeline will not run fully.`
    : "\nAll required integrations are connected.";
  return lines.join("\n") + footer + "\n";
}

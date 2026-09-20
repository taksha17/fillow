import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import dotenv from "dotenv";
import yaml from "js-yaml";
import { PATHS, ROOT, profilePath } from "./paths.mjs";
import { greenhouseLocationQuery } from "./location.mjs";

dotenv.config({ path: PATHS.env });

function envBool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return raw === "true" || raw === "1";
}

function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function normalizeEducationRow(row = {}) {
  return {
    school: String(row.school || "").trim(),
    degree: String(row.degree || "").trim(),
    location: String(row.location || row.school_location || "").trim(),
    dates: String(row.dates || row.graduation || "").trim(),
  };
}

export function educationFromProfile(raw = {}) {
  const rows = [];
  const seen = new Set();
  const push = (row) => {
    const edu = normalizeEducationRow(row);
    if (!edu.school) return;
    const key = edu.school.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    rows.push(edu);
  };
  const c = raw.candidate || {};
  if (c.school) {
    push({
      school: c.school,
      degree: c.degree,
      location: c.school_location,
      dates: c.graduation,
    });
  }
  for (const row of raw.resume?.education || []) push(row);
  return rows;
}

export function loadConfig() {
  const path = profilePath();
  if (!existsSync(path)) {
    throw new Error(`Missing profile config at ${PATHS.profile}. Copy config/profile.example.yaml to config/profile.yaml`);
  }
  const raw = yaml.load(readFileSync(path, "utf8"));
  if (!raw || typeof raw !== "object") {
    throw new Error(`Invalid YAML in ${path}`);
  }

  const candidate = raw.candidate || {};
  if (!candidate.first_name || !candidate.email) {
    throw new Error("config candidate.first_name and candidate.email are required");
  }

  const runtimeYaml = raw.runtime || {};
  const dryRun = envBool("DRY_RUN", runtimeYaml.dry_run ?? true);
  const reviewMode = envBool("REVIEW_MODE", false);
  const minMatch = envInt("MIN_MATCH_SCORE", runtimeYaml.min_match_score ?? 78);
  const maxApplies = envInt("MAX_APPLIES_PER_RUN", runtimeYaml.max_applies_per_run ?? 3);
  const maxTailor = envInt("MAX_TAILOR_PER_RUN", runtimeYaml.max_tailor_per_run ?? 12);
  const enrichProfiles = envBool("ENRICH_PROFILES", runtimeYaml.enrich_profiles ?? false);

  const resumePath = candidate.resume_path
    ? (candidate.resume_path.startsWith("/") ? candidate.resume_path : resolve(ROOT, candidate.resume_path))
    : null;
  const education = educationFromProfile(raw);

  return {
    path,
    candidate: {
      ...candidate,
      full_name: `${candidate.first_name} ${candidate.last_name || ""}`.trim(),
      current_title: candidate.current_title || raw.resume?.current_title || "",
      greenhouse_location: greenhouseLocationQuery({
        ...candidate,
        country_of_residence: candidate.country_of_residence,
      }),
      education,
      school_aliases: Array.isArray(candidate.school_aliases) ? candidate.school_aliases.filter(Boolean) : [],
      resume_path: resumePath,
    },
    answer_preferences: raw.answer_preferences || {
      tone: "optimistic",
      how_heard: "Linkedin",
      eeo_default: "Prefer not to say",
      always_yes: [],
      always_no: [],
      claims: {},
    },
    targets: raw.targets || { keywords: [], exclude_keywords: [], locations: [], remote_ok: true },
    runtime: {
      dry_run: dryRun,
      review_mode: reviewMode,
      max_applies_per_run: maxApplies,
      max_tailor_per_run: maxTailor,
      enrich_profiles: enrichProfiles,
      min_match_score: minMatch,
      headless: envBool("HEADLESS", runtimeYaml.headless ?? false),
      request_delay_seconds: runtimeYaml.request_delay_seconds ?? 1.2,
      apply_delay_seconds: runtimeYaml.apply_delay_seconds ?? 6,
      ats_filter: runtimeYaml.ats_filter || raw.ats_filter || ["ashby", "greenhouse"],
      use_mygreenhouse: runtimeYaml.use_mygreenhouse ?? raw.use_mygreenhouse ?? false,
      skip_aggregators: runtimeYaml.skip_aggregators ?? raw.skip_aggregators ?? true,
      auto_submit: runtimeYaml.auto_submit ?? raw.auto_submit ?? true,
      keep_browser_open: envBool("KEEP_BROWSER_OPEN", runtimeYaml.keep_browser_open ?? raw.keep_browser_open ?? false),
      humanize_fills: runtimeYaml.humanize_fills ?? raw.humanize_fills ?? true,
      slow_mo_ms: runtimeYaml.slow_mo_ms ?? raw.slow_mo_ms ?? 120,
      pre_submit_pause_seconds: runtimeYaml.pre_submit_pause_seconds ?? raw.pre_submit_pause_seconds ?? 4,
    },
    ai: raw.ai || {
      provider: "nvidia_nim",
      model: "nvidia/nemotron-3.5-lightning-30b-a3b",
      max_tokens: 4096,
      temperature: 0.3,
    },
    gmail: {
      imap_user: process.env.GMAIL_IMAP_USER || raw.gmail?.imap_user || "",
      app_password: String(process.env.GMAIL_APP_PASSWORD || raw.gmail?.app_password || "").replace(/\s+/g, ""),
      otp_regex: raw.gmail?.otp_regex || "^[0-9]{6}$|^[0-9]{4}$",
    },
    job_boards: raw.job_boards || { primary: ["ashby", "greenhouse"], fallback: [] },
    greenhouse_boards: raw.greenhouse_boards || [],
    lever_companies: raw.lever_companies || [],
    ashby_boards: raw.ashby_boards || [],
    workday_boards: raw.workday_boards || [],
    dashboard: raw.dashboard || {},
    resume: { ...(raw.resume || {}), education },
    secrets: {
      nvidia_api_key: process.env.NVIDIA_API_KEY || "",
      groq_api_key: process.env.GROQ_API_KEY || "",
      openai_api_key: process.env.OPENAI_API_KEY || "",
      github_token: process.env.GITHUB_TOKEN || "",
      supabase_url: process.env.SUPABASE_URL || "",
      supabase_anon_key: process.env.SUPABASE_ANON_KEY || "",
      fillow_sync_url: process.env.FILLLOW_SYNC_URL || "",
      fillow_sync_token: process.env.FILLLOW_SYNC_TOKEN || "",
    },
  };
}

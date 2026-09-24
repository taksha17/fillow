#!/usr/bin/env node
import { existsSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { loadConfig } from "./lib/config.mjs";
import { PATHS, ensureDataDirs } from "./lib/paths.mjs";
import { checkGmailInbox, gmailConfigured } from "./lib/gmail.mjs";

const checks = [];

function check(name, ok, detail) {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const nodeMajor = Number(process.versions.node.split(".")[0]);
check("Node >= 18", nodeMajor >= 18, `v${process.versions.node}`);

let cfg = null;
try {
  cfg = loadConfig();
  check("profile.yaml", true, cfg.path);
  check("candidate identity", Boolean(cfg.candidate.email && cfg.candidate.first_name));
} catch (err) {
  check("profile.yaml", false, err.message);
}

check(".env present", existsSync(PATHS.env), PATHS.env);
if (cfg) {
  check("GROQ_API_KEY", Boolean(cfg.secrets.groq_api_key), cfg.secrets.groq_api_key ? "set" : "missing (primary LLM for answers)");
  check("NVIDIA_API_KEY", Boolean(cfg.secrets.nvidia_api_key), cfg.secrets.nvidia_api_key ? "set" : "missing (optional NIM fallback / score verify)");
  if (gmailConfigured(cfg)) {
    try {
      const inbox = await checkGmailInbox(cfg);
      check("Gmail IMAP", true, `${cfg.gmail.imap_user} inbox=${inbox.exists}`);
    } catch (err) {
      check("Gmail IMAP", false, err.message);
    }
  } else {
    check("Gmail IMAP", true, "optional until OTP apply — run: node bin/fillow.mjs gmail");
  }
  const resumeOk = Boolean(cfg.candidate.resume_path && existsSync(cfg.candidate.resume_path));
  check("resume file", true, resumeOk ? cfg.candidate.resume_path : `missing at ${cfg.candidate.resume_path} (copy or symlink before live apply)`);
  check("resume facts", true, cfg.resume?.experience?.length ? `${cfg.resume.experience.length} experience rows` : "profile resume.experience empty — Agent 2 uses claims + current_company");
  check("profile enrich", true, cfg.runtime.enrich_profiles ? "ENRICH_PROFILES on (GitHub/LinkedIn public pages)" : "off (set ENRICH_PROFILES=true to scrape public profiles)");
  check("DRY_RUN", true, String(cfg.runtime.dry_run));
  check("board seeds", cfg.ashby_boards.length + cfg.greenhouse_boards.length > 0, `ashby=${cfg.ashby_boards.length} greenhouse=${cfg.greenhouse_boards.length}`);
}

ensureDataDirs();
check("data dirs", existsSync(PATHS.data) && existsSync(PATHS.reports));

try {
  const yamlMod = await import("js-yaml");
  check("js-yaml", Boolean(yamlMod.default?.load || yamlMod.load), "importable");
} catch {
  check("js-yaml", false, "run npm install");
}

const agents = ["discover.mjs", "evaluate-tailor.mjs", "apply.mjs", "track.mjs"];
for (const file of agents) {
  check(`agents/${file}`, existsSync(`${PATHS.root}/agents/${file}`));
}

const gh = spawnSync("gh", ["--version"], { encoding: "utf8" });
check("gh CLI (fillow pull)", true, gh.status === 0 ? "installed — fillow pull can fetch Actions artifacts" : "optional — install https://cli.github.com/ to pull the online jobs.tsv");
check("hybrid workflow", existsSync(`${PATHS.root}/.github/workflows/fillow-online.yml`), "discover+score on Actions; PDFs/apply/Gmail stay local");

// rate-limit / etiquette warnings
const maxApplies = Number(process.env.MAX_APPLIES_PER_RUN || "3");
const applyDelay = Number(process.env.APPLY_DELAY_S || "6");
if (maxApplies > 3) {
  console.warn(`⚠️  MAX_APPLIES_PER_RUN=${maxApplies} exceeds recommended max of 3 — consider lowering to stay under ATS anti-spam radar`);
}
if (applyDelay < 6) {
  console.warn(`⚠️  APPLY_DELAY_S=${applyDelay}s below recommended minimum of 6s — consider raising to be gentler on boards`);
}

try {
  await import("playwright");
  check("playwright", true, "importable (run npx playwright install chromium before live apply)");
} catch {
  check("playwright", false, "run npm install");
}

const syntax = spawnSync(process.execPath, ["scripts/check-syntax.mjs"], { encoding: "utf8" });
check("syntax", syntax.status === 0, syntax.status === 0 ? `${readdirSync(PATHS.root).filter((f) => f.endsWith(".mjs")).length} root modules` : syntax.stdout || syntax.stderr);

const failed = checks.filter((c) => !c.ok);
if (failed.length) {
  console.log(`\n${failed.length} check(s) failed`);
  process.exit(1);
}
console.log("\nfillow doctor: all checks passed");

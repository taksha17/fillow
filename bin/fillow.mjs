#!/usr/bin/env node
import { spawn } from "node:child_process";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT } from "../lib/paths.mjs";
import { parseProgressOptions } from "../lib/progress.mjs";

export const HELP = `fillow — one CLI, four agents, hybrid by default

  fillow online       Agent 1 + 2a   discover + score/gate (GitHub Actions)
  fillow pull         download latest Actions jobs.tsv into data/
  fillow offline      Agent 2b + 3+4 Jake's PDFs, apply, Gmail, track (local)
  fillow run          all four agents on this machine (no Actions)

  fillow discover     Agent 1  public ATS APIs → data/jobs.tsv
  fillow evaluate     Agent 2  score, gate, tailor  (--score-only skips PDFs)
  fillow apply        Agent 3  Playwright fill / OTP / submit
  fillow track        Agent 4  tracker, Gmail watch, dashboard

  fillow mgh discover   Agent 1 via BrowserSkill — scrape logged-in MyGreenhouse
  fillow mgh evaluate   Agent 2 on jobs.tsv (incl. mgh:* rows)
  fillow mgh apply      Agent 3 via BrowserSkill — apply inside MyGreenhouse
  fillow mgh track      Agent 4 tracker sync
  fillow mgh run        discover → evaluate → apply → track (local, logged-in Chrome)
  fillow mgh loop       continuous discover → tailor → apply → track (BrowserSkill bg)

  fillow doctor       environment check
  fillow setup        onboarding wizard — profile checklist, board setup (--boards saves the Greenhouse session)
  fillow enrich       Agent 2 sub-agent — pull GitHub/LinkedIn into resume data (--force fresh, 24h cache)
  fillow auth         platform auth matrix (NIM, Gmail, GitHub, LLM fallbacks, Cloudflare, Supabase)
  fillow gmail        IMAP login (OTP + reply-watch)
  fillow lint         syntax check
  fillow test         node --test
  fillow cf setup     optional Workers + D1 hosting
  fillow cf dev       local dashboard  http://127.0.0.1:8787
  fillow cf sync      push local tracker into D1  (--remote)
  fillow cf deploy    publish Worker to *.workers.dev

npm start = fillow run. npm run online|offline|pull|scrape|evaluate|apply|track are aliases.

Setup: copy .env.example → .env and config/profile.example.yaml → config/profile.yaml
Default DRY_RUN=true. Playwright apply and Gmail IMAP stay on this machine.
MyGreenhouse lane needs BrowserSkill (bsk) + Chrome extension connected & signed in.
See HYBRID.md and MYGREENHOUSE.md.
`;

const scripts = {
  run: ["run-workflow.mjs"],
  start: ["run-workflow.mjs"],
  online: ["scripts/online.mjs"],
  offline: ["scripts/offline.mjs"],
  pull: ["scripts/pull-jobs.mjs"],
  doctor: ["doctor.mjs"],
  auth: ["scripts/auth.mjs"],
  setup: ["scripts/setup.mjs"],
  enrich: ["scripts/enrich.mjs"],
  discover: ["agents/discover.mjs"],
  scrape: ["agents/discover.mjs"],
  evaluate: ["agents/evaluate-tailor.mjs"],
  apply: ["agents/apply.mjs"],
  track: ["agents/track.mjs"],
  gmail: ["scripts/gmail-check.mjs"],
  lint: ["scripts/check-syntax.mjs"],
};

const mghScripts = {
  discover: ["agents/discover-mygreenhouse.mjs"],
  evaluate: ["agents/evaluate-mygreenhouse.mjs"],
  apply: ["agents/apply-mygreenhouse.mjs"],
  track: ["agents/track-mygreenhouse.mjs"],
  run: ["scripts/mgh-run.mjs"],
  loop: ["scripts/mgh-loop.mjs"],
};

const cfScripts = {
  setup: ["scripts/cf-setup.mjs"],
  sync: ["scripts/sync-cloudflare.mjs"],
  dev: ["node_modules/wrangler/bin/wrangler.js", "dev", "--config", "cloudflare/wrangler.toml"],
  deploy: ["node_modules/wrangler/bin/wrangler.js", "deploy", "--config", "cloudflare/wrangler.toml"],
};

function runNode(parts, extraArgs) {
  const args = [join(ROOT, parts[0]), ...parts.slice(1), ...extraArgs];
  const child = spawn(process.execPath, args, { cwd: ROOT, stdio: "inherit" });
  child.on("exit", (code) => process.exit(code ?? 1));
}

export function main(argv = process.argv.slice(2)) {
  const cmd = argv[0];
  const rest = argv.slice(1);

  if (!cmd || cmd === "help" || cmd === "-h" || cmd === "--help") {
    process.stdout.write(HELP);
    return 0;
  }

  if (cmd === "test") {
    const child = spawn(process.execPath, ["--test", join(ROOT, "tests", "*.mjs")], {
      cwd: ROOT,
      stdio: "inherit",
      shell: true,
    });
    child.on("exit", (code) => process.exit(code ?? 1));
    return undefined;
  }

  if (cmd === "cf") {
    const mapped = cfScripts[rest[0]];
    if (!mapped) {
      process.stderr.write("Unknown fillow cf command. Try: setup | dev | sync | deploy\n");
      return 1;
    }
    runNode(mapped, rest.slice(1));
    return undefined;
  }

  if (cmd === "mgh") {
    const mapped = mghScripts[rest[0]];
    if (!mapped) {
      process.stderr.write("Unknown fillow mgh command. Try: discover | evaluate | apply | track | run | loop\n");
      return 1;
    }
    runNode(mapped, rest.slice(1));
    return undefined;
  }

  if (scripts[cmd]) {
    runNode(scripts[cmd], rest);
    return undefined;
  }

  process.stderr.write(`Unknown command: ${cmd}\n\n${HELP}`);
  return 1;
}

const invoked = fileURLToPath(import.meta.url) === resolve(process.argv[1] || "");
if (invoked) {
  const code = main();
  if (code !== undefined) process.exit(code);
}

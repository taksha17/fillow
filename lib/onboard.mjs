import { existsSync } from "node:fs";
import { loadConfig } from "./config.mjs";
import { PATHS } from "./paths.mjs";

const PROFILE_FIELDS = [
  ["candidate.first_name", "First name"],
  ["candidate.last_name", "Last name"],
  ["candidate.email", "Email"],
  ["candidate.phone", "Phone"],
  ["candidate.location", "City, State"],
  ["candidate.country_of_residence", "Country of residence"],
  ["candidate.passport_country", "Passport country"],
  ["candidate.github", "GitHub URL"],
  ["candidate.linkedin", "LinkedIn URL"],
  ["resume.experience", "Work experience rows"],
  ["resume.projects", "Project rows"],
  ["resume.education", "Education rows"],
];

function get(obj, path) {
  return path.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), obj);
}

export function profileChecklist(cfg) {
  return PROFILE_FIELDS.map(([key, label]) => {
    const value = get(cfg, key);
    const set = Array.isArray(value) ? value.length > 0 : Boolean(value);
    return { key, label, set };
  });
}

export function boardSetupGuide() {
  return [
    {
      board: "greenhouse",
      one_time: true,
      mechanism: "MyGreenhouse unified account",
      how: "fillow setup --boards opens a headful browser, logs you in once (the Gmail security code is read automatically), and data/mygreenhouse_state.json is reused by Agent 3 on every Greenhouse apply.",
    },
    {
      board: "workday",
      one_time: false,
      mechanism: "per-tenant company accounts",
      how: "each Workday company portal is a separate account; Agent 3 fills identity from your profile and uses Gmail OTP where the tenant offers it.",
    },
    {
      board: "ashby",
      one_time: false,
      mechanism: "no candidate accounts",
      how: "forms are per-posting; identity + resume upload come straight from config/profile.yaml — no login required.",
    },
    {
      board: "lever",
      one_time: false,
      mechanism: "no candidate accounts",
      how: "same as Ashby — pure form fill per posting.",
    },
  ];
}

export function sessionStatus() {
  return {
    greenhouse: { saved: existsSync(PATHS.mghSession), path: PATHS.mghSession },
  };
}

export async function bootstrapGreenhouseSession(cfg) {
  if (!cfg.gmail?.imap_user || !cfg.gmail?.app_password) {
    throw new Error("Gmail IMAP must be configured (GMAIL_IMAP_USER + GMAIL_APP_PASSWORD) so the security code can be read automatically.");
  }
  const { launchBrowser, dismissCookies, sleep, jitter } = await import("./browser.mjs");
  const { pollOtp } = await import("./gmail.mjs");

  const live = { ...cfg, runtime: { ...cfg.runtime, headless: false } };
  const { browser, context } = await launchBrowser(live);
  try {
    const page = await context.newPage();
    await page.goto("https://my.greenhouse.io/users/sign_in", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1000 + jitter(0, 500));
    await dismissCookies(page);

    const email = process.env.MYGREENHOUSE_EMAIL || cfg.gmail.imap_user;
    const emailField = page.locator("#email-address, input[type='email']").first();
    await emailField.fill(email);
    await page.waitForTimeout(400 + jitter(0, 400));

    const startedAt = Date.now();
    await page.locator("button:has-text('Send security code')").first().click();

    const result = await pollOtp({
      user: cfg.gmail.imap_user,
      password: cfg.gmail.app_password,
      otpRegex: cfg.gmail.otp_regex,
      timeoutMs: 120000,
      notBeforeMs: startedAt,
    });
    if (!result?.code) throw new Error("OTP not found in Gmail within 120s — check the email landed in INBOX.");

    const codeSelectors = [
      "input[autocomplete='one-time-code']",
      "input[inputmode='numeric']",
      "input[name*='code' i]",
      "input[id*='code' i]",
      "input[type='text']",
      "input[type='tel']",
    ];
    let filled = false;
    for (const sel of codeSelectors) {
      const loc = page.locator(sel).first();
      try {
        if (await loc.count()) {
          await loc.fill(result.code, { timeout: 1500 });
          filled = true;
          break;
        }
      } catch {
        // next selector
      }
    }
    if (!filled) {
      const digits = page.locator("input[maxlength='1']");
      const count = await digits.count();
      if (!count || count < 4 || result.code.length !== count) {
        throw new Error("Could not locate the security-code input on the page");
      }
      for (let i = 0; i < count; i += 1) {
        await digits.nth(i).fill(result.code[i]);
      }
    }

    for (const sel of ["button:has-text('Sign in')", "button:has-text('Verify')", "button:has-text('Continue')", "button[type='submit']"]) {
      const btn = page.locator(sel).first();
      try {
        if (await btn.count()) {
          await btn.click({ timeout: 3000 });
          break;
        }
      } catch {
        // next selector
      }
    }

    for (let i = 0; i < 40; i += 1) {
      await page.waitForTimeout(1500);
      const url = page.url();
      if (!url.includes("sign_in") && /my\.greenhouse\.io/.test(url)) break;
      if (i === 39) throw new Error("Login did not complete — still on the sign-in page.");
    }

    await context.storageState({ path: PATHS.mghSession });
    return PATHS.mghSession;
  } finally {
    await browser.close();
  }
}

export async function runSetup(saveBoards = false) {
  let cfg;
  try {
    cfg = loadConfig();
  } catch (err) {
    console.error(`✗ config: ${err.message}`);
    console.error("  copy config/profile.example.yaml → config/profile.yaml and fill in your identity, then re-run.");
    process.exitCode = 1;
    return;
  }

  console.log("── profile checklist ──");
  for (const row of profileChecklist(cfg)) {
    console.log(`  ${row.set ? "✅" : "❌"} ${row.label}${row.set ? "" : `  (${row.key} in config/profile.yaml)`}`);
  }
  const resumeOk = cfg.candidate.resume_path && existsSync(cfg.candidate.resume_path);
  console.log(`  ${resumeOk ? "✅" : "❌"} Base resume file${resumeOk ? "" : `  (${cfg.candidate.resume_path || "candidate.resume_path"} missing)`}`);

  console.log("\n── board one-time setup ──");
  const sessions = sessionStatus();
  for (const b of boardSetupGuide()) {
    const mark = b.board === "greenhouse" ? (sessions.greenhouse.saved ? "✅ session saved" : "➖ no session yet") : b.one_time ? "➖" : "🔹 n/a";
    console.log(`  ${mark}  ${b.board.padEnd(10)} ${b.mechanism}`);
    console.log(`       ${b.how}`);
  }

  if (saveBoards) {
    console.log("\n── greenhouse session bootstrap ──");
    const path = await bootstrapGreenhouseSession(cfg);
    console.log(`  ✅ session saved to ${path}`);
    console.log("  set use_mygreenhouse: true in config/profile.yaml so Agent 3 reuses it.");
  } else {
    console.log("\nnext: fillow auth (verify platform connections) · fillow setup --boards (save the Greenhouse session) · fillow enrich (pull GitHub/LinkedIn into the resume data).");
  }
}

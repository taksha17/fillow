#!/usr/bin/env node
import dotenv from "dotenv";
import { join } from "node:path";
import { ROOT } from "../lib/paths.mjs";
import { loadConfig } from "../lib/config.mjs";
import { checkGmailInbox, gmailConfigured } from "../lib/gmail.mjs";

dotenv.config({ path: join(ROOT, ".env") });

const SIGNIN = "https://myaccount.google.com/signinoptions/two-step-verification";
const APPS = "https://myaccount.google.com/apppasswords";
const IMAP = "https://mail.google.com/mail/u/0/#settings/fwdandpop";

const cfg = loadConfig();
if (!gmailConfigured(cfg)) {
  console.error(`Gmail IMAP is not configured for Agent 3 OTP.

1. Turn on 2-Step Verification:
   ${SIGNIN}
2. Create an App password (choose Mail / Other → fillow):
   ${APPS}
3. Enable IMAP in Gmail settings:
   ${IMAP}
4. Put these in .env (never in git):
   GMAIL_IMAP_USER=${cfg.candidate.email || cfg.gmail.imap_user || "you@gmail.com"}
   GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx

Then re-run: npm run gmail:check
`);
  process.exit(1);
}

try {
  const out = await checkGmailInbox(cfg);
  console.log(`Gmail IMAP ok for ${cfg.gmail.imap_user} (INBOX ${out.exists} messages)`);
  console.log("Agent 3 can poll OTP; Agent 4 can watch replies.");
} catch (err) {
  console.error("Gmail IMAP login failed:", err.message);
  console.error("Use a Google App Password, not your normal Gmail password. IMAP must be enabled.");
  process.exit(1);
}

import { classifyReply, classifyReplyAi, fetchRecentMail } from "./gmail.mjs";
import { appendLedger, readTracker, updateApplication } from "./tracker.mjs";
import { statusAdvances } from "./gmail.mjs";

function companyMatch(from, subject, body, company) {
  const blob = `${from} ${subject} ${body}`.toLowerCase();
  const name = String(company || "").toLowerCase();
  return name && blob.includes(name);
}

export async function watchReplies(cfg, { limit = 30, useLlm = false } = {}) {
  if (!cfg.gmail.imap_user || !cfg.gmail.app_password) {
    console.log("  Gmail reply-watch skipped (no IMAP password)");
    return [];
  }
  const rows = readTracker();
  if (!rows.length) return [];
  let messages = [];
  try {
    messages = await fetchRecentMail({
      user: cfg.gmail.imap_user,
      password: cfg.gmail.app_password,
      query: 'X-GM-RAW "newer_than:14d (application OR interview OR recruiting OR greenhouse OR lever OR ashby)"',
      limit,
    });
  } catch (err) {
    console.warn("  Gmail reply-watch failed:", err.message);
    return [];
  }

  const updates = [];
  const seenSubjects = new Set();
  for (const msg of messages) {
    if (seenSubjects.has(msg.subject)) continue;
    seenSubjects.add(msg.subject);
    const matches = rows
      .filter((r) => companyMatch(msg.from, msg.subject, msg.body, r.company))
      .sort((a, b) => Number(b.num) - Number(a.num));
    const row = matches[0];
    if (!row) continue;
    let status = classifyReply(msg.subject, msg.body, row.company);
    if (!status && useLlm) {
      try {
        status = await classifyReplyAi(cfg, msg.subject, msg.body);
      } catch {
        status = null;
      }
    }
    if (!status) continue;
    if (status === row.status) continue;
    if (!statusAdvances(row.status, status)) continue;
    // Don't let a generic "thank you for applying" email mark incomplete fills as submitted.
    if (
      status === "submitted"
      && /still open after submit|form incomplete|empty:|auth gate/i.test(String(row.notes || ""))
    ) {
      continue;
    }
    const from = row.status;
    updateApplication({ num: row.num }, { status, notes: `email: ${msg.subject}` });
    appendLedger({
      company: row.company,
      role: row.role,
      from,
      to: status,
      reason: msg.subject,
    });
    row.status = status;
    updates.push({ num: row.num, company: row.company, status, subject: msg.subject });
  }
  console.log(`  reply-watch: ${updates.length} status change(s)`);
  return updates;
}

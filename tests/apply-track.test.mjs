import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { decodeMime, extractOtp, classifyReply, statusAdvances, normalizeAppPassword } from "../lib/gmail.mjs";
import { detectAts, parseGreenhouseIds, greenhouseEmbedUrl } from "../lib/ats.mjs";
import { confirmationText, spamFlagged, phoneDigits } from "../lib/browser.mjs";
import { appendApplication, readTracker, updateApplication } from "../lib/tracker.mjs";
import { buildDashboardHtml } from "../lib/dashboard.mjs";
import { templateCoverLetter } from "../lib/cover-letter.mjs";
import { applyJobs } from "../agents/apply.mjs";

test("extractOtp finds greenhouse-style codes", () => {
  assert.equal(extractOtp("Your security code is 123456"), "123456");
  assert.equal(extractOtp("Your one-time code: 998877"), "998877");
  assert.equal(extractOtp("Your security code is 123456", "^[0-9]{6}$|^[0-9]{4}$"), "123456");
  assert.equal(extractOtp("enter the 8-character code: AB12CD34", "^[0-9]{4,8}$|^[0-9A-Za-z]{8}$"), "AB12CD34");
  assert.equal(extractOtp("Your verification code is 12345678"), "12345678");
  assert.equal(extractOtp("no code here"), null);
  assert.equal(normalizeAppPassword("abcd efgh ijkl mnop"), "abcdefghijklmnop");
});

test("decodeMime unwraps quoted-printable OTP mail", () => {
  const raw = [
    "From: Greenhouse <no-reply@greenhouse.io>",
    "Subject: Your security code",
    "",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: quoted-printable",
    "",
    "Your security code is 654321",
    "",
  ].join("\r\n");
  assert.match(decodeMime(raw), /654321/);
});

test("classifyReply maps recruiting language", () => {
  assert.equal(classifyReply("Thanks for applying", "We received your application"), "submitted");
  assert.equal(classifyReply("Update", "Unfortunately we will not be moving forward"), "rejected");
  assert.equal(classifyReply("Interview", "Please pick a slot on Calendly"), "interview");
  assert.equal(classifyReply("Offer", "We are pleased to offer you"), "offer");
});

test("classifyReply rejects OTP and security emails", () => {
  assert.equal(classifyReply("Security code", "Your security code is 123456"), null);
  assert.equal(classifyReply("Verification", "Your verification code is 654321"), null);
  assert.equal(classifyReply("Security code for your application to Stripe", "Copy and paste this code"), null);
  assert.equal(classifyReply("One-time password", "Your OTP is 123456"), null);
});

test("classifyReply under_review requires status keywords", () => {
  assert.equal(classifyReply("Security code", "Security code for your application to Stripe"), null);
  assert.equal(classifyReply("Update", "Just checking in on your application to Stripe", "Stripe"), "under_review");
  assert.equal(classifyReply("Status", "We have an update on your Stripe application", "Stripe"), "under_review");
  assert.equal(classifyReply("Hello", "Just saying hi from Stripe", "Stripe"), null);
});

test("statusAdvances only moves forward", () => {
  assert.equal(statusAdvances("pending", "submitted"), true);
  assert.equal(statusAdvances("submitted", "under_review"), true);
  assert.equal(statusAdvances("under_review", "interview"), true);
  assert.equal(statusAdvances("interview", "offer"), true);
  assert.equal(statusAdvances("submitted", "rejected"), true);
  assert.equal(statusAdvances("under_review", "submitted"), false);
  assert.equal(statusAdvances("submitted", "interview"), true);
  assert.equal(statusAdvances("applied", "submitted"), true);
  assert.equal(statusAdvances("applied", "under_review"), true);
  assert.equal(statusAdvances("submitted", "submitted"), false);
  assert.equal(statusAdvances("pending", null), false);
  assert.equal(statusAdvances("pending", "dry_run"), false);
});

test("detectAts and greenhouse embed url", () => {
  assert.equal(detectAts({ url: "https://jobs.ashbyhq.com/openai/abc" }), "ashby");
  assert.equal(detectAts({ apply_url: "https://boards.greenhouse.io/stripe/jobs/1" }), "greenhouse");
  const ids = parseGreenhouseIds({ external_id: "stripe:99", url: "" });
  assert.equal(ids.board, "stripe");
  assert.equal(ids.jobId, "99");
  assert.equal(greenhouseEmbedUrl("stripe", "99"), "https://job-boards.greenhouse.io/embed/job_app?for=stripe&token=99");
});

test("confirmation and spam detectors", () => {
  assert.equal(confirmationText("Thank you for applying to Stripe"), true);
  assert.equal(spamFlagged("This application was flagged as possible spam"), true);
  assert.equal(phoneDigits("1-682-374-5705"), "6823745705");
});

test("tracker can update status after apply", () => {
  const dir = mkdtempSync(join(tmpdir(), "fillow-track-"));
  const path = join(dir, "applications.md");
  appendApplication({ company: "Acme", role: "SWE", url: "https://jobs.example/x", status: "dry_run" }, path);
  const upd = updateApplication({ url: "https://jobs.example/x" }, { status: "applied", notes: "gmail confirm" }, path);
  assert.equal(upd.updated, true);
  assert.equal(readTracker(path)[0].status, "applied");
});

test("dashboard html includes metrics", () => {
  const html = buildDashboardHtml([
    { num: "1", date: "2026-09-19", company: "Acme", role: "SWE", score: "80", status: "applied", notes: "ok" },
  ]);
  assert.match(html, /Acme/);
  assert.match(html, /applications/);
});

test("cover letter template uses profile facts only", () => {
  const text = templateCoverLetter(
    { full_name: "Ada Lovelace", location: "Austin, TX", current_company: "Example", email: "t@x.com" },
    { title: "ML Engineer", company: "OpenAI" }
  );
  assert.match(text, /Ada Lovelace/);
  assert.match(text, /OpenAI/);
  assert.doesNotMatch(text, /Harvard|Stanford PhD/);
});

test("applyJobs dry-run never launches a browser", async () => {
  const results = await applyJobs(
    [{ title: "SWE", company: "Acme", status: "ready", apply_url: "https://jobs.ashbyhq.com/acme/1" }],
    {
      candidate: { resume_path: "/tmp/nope.pdf" },
      runtime: { dry_run: true, max_applies_per_run: 3, auto_submit: true, review_mode: false, apply_delay_seconds: 0 },
      answer_preferences: {},
      gmail: {},
      secrets: {},
    }
  );
  assert.equal(results[0].status, "dry_run");
});

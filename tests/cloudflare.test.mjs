import test from "node:test";
import assert from "node:assert/strict";
import { syncSql } from "../lib/cloudflare-sync.mjs";
import { dashboardHtml } from "../cloudflare/src/html.mjs";

test("syncSql upserts applications into D1", () => {
  const sql = syncSql({
    captured_at: "2026-09-19T00:00:00.000Z",
    metrics: { total: 1, conversion_rate: 0, byStatus: { dry_run: 1 } },
    applications: [
      {
        num: "1",
        date: "2026-09-19",
        company: "Acme",
        role: "SWE",
        score: "80",
        status: "dry_run",
        pdf: "❌",
        report: "",
        notes: "https://jobs.example/1",
        url: "https://jobs.example/1",
      },
    ],
    jobs: [
      {
        source: "ashby",
        external_id: "acme:1",
        title: "SWE",
        company: "acme",
        location: "Remote",
        url: "https://jobs.example/1",
        apply_url: "https://jobs.example/1",
        ats: "ashby",
        match_score: "80",
        status: "ready",
      },
    ],
  });
  assert.match(sql, /INSERT INTO applications/);
  assert.match(sql, /Acme/);
  assert.match(sql, /ON CONFLICT\(id\)/);
  assert.match(sql, /job_postings/);
  assert.doesNotMatch(sql, /^BEGIN;/m);
});

test("hosted dashboard html renders D1 rows", () => {
  const html = dashboardHtml([{ id: 1, date: "2026-09-19", company: "Acme", role: "SWE", score: "80", status: "applied", notes: "ok" }]);
  assert.match(html, /Acme/);
  assert.match(html, /Cloudflare/);
  assert.match(html, /One workflow/);
  assert.match(html, /Discover/);
  assert.match(html, /Evaluate/);
  const withJobs = dashboardHtml(
    [{ id: 1, date: "2026-09-19", company: "Acme", role: "SWE", score: "80", status: "applied", notes: "ok" }],
    undefined,
    { jobs: 1270, companies: [{ company: "Stripe", n: 12 }], recentJobs: [{ company: "stripe", title: "SWE", status: "discovered" }] }
  );
  assert.match(withJobs, /1,270/);
  assert.match(withJobs, /Stripe/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { dashboardHtml, loginHtml } from "../cloudflare/src/html.mjs";

function inlineScripts(page) {
  return [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
}

test("login page: inline script parses — classic scripts cannot use top-level await", async () => {
  const { loginHtml: fresh } = await import("../cloudflare/src/html.mjs?" + Date.now());
  const page = fresh("https://x.supabase.co", "anon-key-123", { mode: "/auth/login" });
  const scripts = inlineScripts(page);
  assert.ok(scripts.length >= 1, "login page should carry an inline script");
  for (const s of scripts) {
    assert.doesNotThrow(() => new Function(s), "inline script must be valid classic-script JS");
  }
});

test("dashboard: authenticated users get the generic product view", () => {
  const html = dashboardHtml([], undefined, {
    source: "cloudflare",
    user: { email: "newuser@example.com" },
    authConfigured: true,
    jobs: 0,
    scored: 0,
    jobStatuses: {},
    companies: [],
    recentJobs: [],
    discover: { boards: {}, filters: {} },
    lastRun: null,
  });
  assert.match(html, /your pipeline/);
  assert.match(html, /Cloudflare \+ D1 workspace/);
  assert.match(html, /Your pool is empty/);
  assert.match(html, /Your isolated workspace/);
  assert.doesNotMatch(html, /npm start/);
  assert.doesNotMatch(html, /local files win/);
});

test("dashboard: default/local view keeps the CLI-era copy", () => {
  const html = dashboardHtml(
    [{ num: 1, date: "2026-09-23", company: "Acme", role: "Eng", status: "applied", url: "" }],
    undefined,
    {
      source: "cloudflare",
      jobs: 3,
      scored: 1,
      jobStatuses: { discovered: 3 },
      companies: [{ company: "Acme", n: 3 }],
      recentJobs: [],
      discover: { boards: {}, filters: {} },
      lastRun: null,
    }
  );
  assert.match(html, /npm start/);
  assert.match(html, /local files win/);
  assert.doesNotMatch(html, /Your isolated workspace/);
});

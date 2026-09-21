import test from "node:test";
import assert from "node:assert/strict";
import { authMatrix, formatAuthMatrix } from "../lib/auth.mjs";

const baseCfg = {
  secrets: {},
  gmail: {},
  ai: { model: "test-model" },
};

test("authMatrix reports missing platforms without throwing", async () => {
  const rows = await authMatrix(baseCfg);
  assert.equal(rows.length, 7);
  const nim = rows.find((r) => r.platform === "NVIDIA NIM");
  assert.equal(nim.status, "missing");
  assert.equal(nim.required, true);
  const gmail = rows.find((r) => r.platform === "Gmail IMAP");
  assert.equal(gmail.status, "missing");
  const github = rows.find((r) => r.platform === "GitHub");
  const supabase = rows.find((r) => r.platform === "Supabase (optional sync)");
  assert.ok(["off", "ok", "fail", "warn"].includes(github.status));
  assert.equal(supabase.status, "off");
});

test("formatAuthMatrix flags required failures in the footer", async () => {
  const rows = await authMatrix(baseCfg);
  const text = formatAuthMatrix(rows);
  assert.match(text, /NVIDIA NIM/);
  assert.match(text, /Gmail IMAP/);
  assert.match(text, /required integration\(s\) need attention/);
});

test("formatAuthMatrix footer is green when required platforms are ok", () => {
  const text = formatAuthMatrix([
    { platform: "NVIDIA NIM", required: true, status: "ok", detail: "reachable" },
    { platform: "Gmail IMAP", required: true, status: "ok", detail: "inbox 10" },
  ]);
  assert.match(text, /All required integrations are connected/);
});

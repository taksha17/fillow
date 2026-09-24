import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

/**
 * The harness contract: any external AI CLI (Cursor, Claude Code, Qwen Code,
 * Kilo...) must be able to drive Agent 1 with zero repo knowledge — a bare
 * absolute-path import, no build step, documented surface only.
 */
const DISCOVER_URL = pathToFileURL(resolve("agents/discover.mjs")).href;

test("harness: Agent 1 imports via absolute path with the documented surface", async () => {
  const discover = await import(DISCOVER_URL);
  assert.equal(typeof discover.scrapeJobs, "function", "scrapeJobs(cfg, emit) export");
  assert.equal(typeof discover.pickDiscoverEngine, "function", "pickDiscoverEngine(cfg) export");
  assert.equal(typeof discover.matchesTargets, "function", "matchesTargets(job, targets) export");
  assert.equal(typeof discover.livenessVerdict, "function", "livenessVerdict(liveness) export");
});

test("harness: pure helpers behave per the SKILL.md contract", async () => {
  const discover = await import(DISCOVER_URL);
  assert.equal(discover.pickDiscoverEngine({ runtime: { discover_engine: "bsk" } }), "bsk");
  assert.equal(discover.pickDiscoverEngine({}), "api");
  assert.equal(
    discover.matchesTargets(
      { title: "ML Engineer", location: "Remote", published_at: "2099-01-01" },
      { keywords: ["ML Engineer"], locations: [], exclude_keywords: [] }
    ),
    true
  );
  assert.equal(discover.livenessVerdict({ live: true }), "live");
  assert.equal(discover.livenessVerdict({ live: false, reason: "http_404" }), "expired");
});

test("harness: the discover skill is vendored with valid frontmatter", () => {
  const md = readFileSync(new URL("../skills/fillow-discover/SKILL.md", import.meta.url), "utf8");
  assert.match(md, /^---\nname:\s*fillow-discover\n/m);
  assert.match(md, /scrapeJobs/);
  assert.match(md, /DISCOVER_ENGINE=bsk/);
  assert.match(md, /harness-agnostic/i);
  assert.match(md, /never invent/i);
});

test("harness: skill installer resolves every target and lists vendored skills", async () => {
  const skill = await import(pathToFileURL(resolve("scripts/skill.mjs")).href);
  const skills = skill.availableSkills();
  assert.ok(skills.includes("fillow-discover"), `vendored skills: ${skills.join(", ")}`);
  for (const t of ["qwen", "cursor", "claude", "kilo"]) {
    const dir = skill.resolveTarget(t);
    assert.match(dir, new RegExp(`${t}`), `target ${t} resolves under home`);
  }
  assert.throws(() => skill.resolveTarget("warp"), /unknown harness target/);
  assert.throws(() => skill.installSkill("nope", "qwen"), /no such skill/);
  assert.ok(existsSync(resolve("skills", "fillow-discover", "SKILL.md")));
});

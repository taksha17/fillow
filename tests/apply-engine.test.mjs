import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pickApplyEngine } from "../agents/apply.mjs";

const bskCfg = { runtime: { apply_engine: "bsk" } };
const pwCfg = { runtime: { apply_engine: "playwright" } };

test("apply engine: default is playwright", () => {
  assert.equal(pickApplyEngine({ source: "mygreenhouse" }, {}), "playwright");
  assert.equal(pickApplyEngine({ source: "mygreenhouse" }, { runtime: {} }), "playwright");
});

test("apply engine: playwright engine never routes to bsk, even for mygreenhouse jobs", () => {
  assert.equal(
    pickApplyEngine({ source: "mygreenhouse", url: "https://my.greenhouse.io/jobs/acme/1" }, pwCfg),
    "playwright"
  );
});

test("apply engine: bsk engine routes MyGreenhouse jobs to bsk", () => {
  assert.equal(pickApplyEngine({ source: "mygreenhouse" }, bskCfg), "bsk");
  assert.equal(pickApplyEngine({ url: "https://my.greenhouse.io/jobs/acme/123" }, bskCfg), "bsk");
  assert.equal(pickApplyEngine({ external_id: "mgh:acme:123" }, bskCfg), "bsk");
});

test("apply engine: bsk engine routes public Greenhouse boards to bsk", () => {
  assert.equal(pickApplyEngine({ url: "https://boards.greenhouse.io/acme/jobs/123" }, bskCfg), "bsk");
  assert.equal(pickApplyEngine({ apply_url: "https://job-boards.greenhouse.io/acme/jobs/123" }, bskCfg), "bsk");
});

test("apply engine: bsk engine leaves non-Greenhouse jobs on playwright", () => {
  assert.equal(pickApplyEngine({ source: "ashby", url: "https://jobs.ashbyhq.com/acme/1" }, bskCfg), "playwright");
  assert.equal(pickApplyEngine({ source: "lever", url: "https://jobs.lever.co/acme/1" }, bskCfg), "playwright");
});

test("apply engine: engine key is case-insensitive", () => {
  assert.equal(pickApplyEngine({ source: "mygreenhouse" }, { runtime: { apply_engine: "BSK" } }), "bsk");
});

test("apply engine: config surfaces document the key", () => {
  const profile = readFileSync(new URL("../config/profile.example.yaml", import.meta.url), "utf8");
  assert.match(profile, /apply_engine:\s*playwright/);
  const envExample = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
  assert.match(envExample, /^APPLY_ENGINE=playwright$/m);
});

test("fillow-browser skill is vendored and rebranded", () => {
  const md = readFileSync(new URL("../skills/fillow-browser/SKILL.md", import.meta.url), "utf8");
  assert.match(md, /^name:\s*fillow-browser-skill$/m);
  assert.match(md, /# Fillow Browser Skill/);
  assert.match(md, /apply_engine:\s*bsk/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pickDiscoverEngine } from "../agents/discover.mjs";

test("discover engine: default is api", () => {
  assert.equal(pickDiscoverEngine({}), "api");
  assert.equal(pickDiscoverEngine({ runtime: {} }), "api");
  assert.equal(pickDiscoverEngine({ runtime: { discover_engine: "playwright" } }), "api");
});

test("discover engine: bsk key routes to bsk", () => {
  assert.equal(pickDiscoverEngine({ runtime: { discover_engine: "bsk" } }), "bsk");
});

test("discover engine: key is case-insensitive", () => {
  assert.equal(pickDiscoverEngine({ runtime: { discover_engine: "BSK" } }), "bsk");
});

test("discover engine: config surfaces document the key", () => {
  const profile = readFileSync(new URL("../config/profile.example.yaml", import.meta.url), "utf8");
  assert.match(profile, /discover_engine:\s*api/);
  const envExample = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
  assert.match(envExample, /^DISCOVER_ENGINE=api$/m);
});

test("fillow-browser skill documents the discover engine", () => {
  const md = readFileSync(new URL("../skills/fillow-browser/SKILL.md", import.meta.url), "utf8");
  assert.match(md, /discover_engine:\s*bsk/);
  assert.match(md, /fillow-discover/);
});

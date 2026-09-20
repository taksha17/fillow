import test from "node:test";
import assert from "node:assert/strict";
import { livenessVerdict, matchesTargets } from "../agents/discover.mjs";

test("liveness verdict: true expiry signals drop the posting", () => {
  assert.equal(livenessVerdict({ live: false, reason: "http_404" }), "expired");
  assert.equal(livenessVerdict({ live: false, reason: "http_410" }), "expired");
  assert.equal(livenessVerdict({ live: false, reason: "expired_copy" }), "expired");
});

test("liveness verdict: access blocks and timeouts are uncertain, never expired", () => {
  assert.equal(livenessVerdict({ live: false, reason: "bot_challenge" }), "uncertain");
  assert.equal(livenessVerdict({ live: false, reason: "timeout" }), "uncertain");
  assert.equal(livenessVerdict({ live: false, reason: "http_403" }), "uncertain");
  assert.equal(livenessVerdict({ live: false, reason: "http_429" }), "uncertain");
  assert.equal(livenessVerdict({ live: false, reason: "http_503" }), "uncertain");
  assert.equal(livenessVerdict({ live: true, reason: "http_200" }), "live");
});

test("matchesTargets applies exclude keywords then keyword match", () => {
  const targets = { keywords: ["ML Engineer"], exclude_keywords: ["internship"] };
  assert.equal(matchesTargets({ title: "ML Engineer", location: "Remote", company: "Acme" }, targets), true);
  assert.equal(matchesTargets({ title: "ML Engineer Internship", location: "Remote", company: "Acme" }, targets), false);
  assert.equal(matchesTargets({ title: "Accountant", location: "Remote", company: "Acme" }, targets), false);
});

test("matchesTargets with no keywords keeps everything", () => {
  assert.equal(matchesTargets({ title: "Anything", location: "", company: "" }, { keywords: [], exclude_keywords: [] }), true);
});

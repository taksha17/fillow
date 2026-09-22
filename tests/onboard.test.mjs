import test from "node:test";
import assert from "node:assert/strict";
import { profileChecklist, boardSetupGuide } from "../lib/onboard.mjs";

test("profileChecklist marks empty and filled fields", () => {
  const cfg = {
    candidate: { first_name: "Ada", email: "a@x.com", github: "https://github.com/you" },
    resume: { experience: [{ company: "X" }], projects: [], education: [{ school: "UT" }] },
  };
  const list = profileChecklist(cfg);
  assert.equal(list.find((r) => r.key === "candidate.first_name").set, true);
  assert.equal(list.find((r) => r.key === "candidate.email").set, true);
  assert.equal(list.find((r) => r.key === "candidate.github").set, true);
  assert.equal(list.find((r) => r.key === "candidate.phone").set, false);
  assert.equal(list.find((r) => r.key === "resume.projects").set, false);
  assert.equal(list.length, 12);
});

test("boardSetupGuide documents the one-time Greenhouse session and per-posting boards", () => {
  const guide = boardSetupGuide();
  const gh = guide.find((b) => b.board === "greenhouse");
  assert.equal(gh.one_time, true);
  assert.match(gh.mechanism, /MyGreenhouse/);
  for (const b of guide.filter((x) => x.board !== "greenhouse")) {
    assert.equal(b.one_time, false);
  }
});

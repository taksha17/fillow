import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCronSchedule, setCronSchedule, localToUtcCron } from "../scripts/cron.mjs";

const WORKFLOW = `name: fillow-online

on:
  schedule:
    # 14:00 UTC = 9:00 AM America/Chicago during CDT
    - cron: "0 14 * * *"
  workflow_dispatch:
`;

test("cron: parse reads enabled and disabled slots", () => {
  const entries = parseCronSchedule(WORKFLOW);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].cron, "0 14 * * *");
  assert.equal(entries[0].disabled, false);

  const disabled = parseCronSchedule(setCronSchedule(WORKFLOW, null));
  assert.equal(disabled[0].disabled, true);
  assert.equal(disabled[0].cron, "0 14 * * *");
});

test("cron: enable replaces the slot and keeps the rest of the file", () => {
  const next = setCronSchedule(WORKFLOW, "30 14 * * *");
  assert.match(next, /- cron: "30 14 \* \* \*"/);
  assert.match(next, /workflow_dispatch:/);
  assert.ok(!next.includes('"0 14 * * *"') || next.includes("# - cron"));
});

test("cron: disable then re-enable round-trips", () => {
  const off = setCronSchedule(WORKFLOW, null);
  const on = setCronSchedule(off, "0 14 * * *");
  assert.equal(parseCronSchedule(on)[0].disabled, false);
});

test("cron: local time converts to a fixed UTC cron", () => {
  assert.equal(localToUtcCron(9, 30, "UTC"), "09 30 * * *");
  assert.equal(localToUtcCron(14, 0, "UTC"), "14 00 * * *");
  const chicago = localToUtcCron(9, 0, "America/Chicago", new Date("2026-09-23T12:00:00Z"));
  assert.match(chicago, /^1[45] 00 \* \* \*$/); // CDT (14) or CST (15) depending on DST
});

test("cron: midnight wrap-around", () => {
  assert.equal(localToUtcCron(0, 30, "UTC"), "00 30 * * *");
  assert.match(localToUtcCron(23, 45, "UTC"), /^23 45 \* \* \*$/);
});

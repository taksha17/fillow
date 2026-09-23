import test from "node:test";
import assert from "node:assert/strict";
import { parseMgJobCard } from "../lib/mygreenhouse.mjs";

test("parseMgJobCard extracts title company location from card text", () => {
  const job = parseMgJobCard(
    "Machine Learning Engineer ZoomInfo Technologies LLC Hybrid Boston, MA $128,100 - $201,300 Posted · 1 day ago",
    "zoominfo",
    "8769474002",
    "https://my.greenhouse.io/jobs/zoominfo/8769474002"
  );
  assert.equal(job.source, "mygreenhouse");
  assert.equal(job.external_id, "mgh:zoominfo:8769474002");
  assert.equal(job.ats, "greenhouse");
  assert.equal(job.company, "zoominfo");
  assert.match(job.location, /Hybrid/i);
  assert.equal(job.board_token, "zoominfo");
  assert.equal(job.apply_url, "https://my.greenhouse.io/jobs/zoominfo/8769474002");
});

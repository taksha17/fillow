#!/usr/bin/env node
/**
 * Agent 4 wrapper for the MyGreenhouse lane — same tracker / Gmail / Cloudflare sync.
 *
 *   fillow mgh track
 */
import { trackDashboard } from "./track.mjs";
import { loadConfig } from "../lib/config.mjs";

export async function trackMyGreenhouse(results = [], cfg = loadConfig()) {
  console.log("MyGreenhouse track — reuses Agent 4");
  return trackDashboard(results, cfg);
}

const isCli = process.argv[1]?.endsWith("track-mygreenhouse.mjs");
if (isCli) {
  trackMyGreenhouse().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

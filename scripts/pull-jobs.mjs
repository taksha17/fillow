#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { PATHS, ensureDataDirs } from "../lib/paths.mjs";

const ARTIFACT = process.env.FILLLOW_JOBS_ARTIFACT || "jobs-tsv";
const WORKFLOW = process.env.FILLLOW_ONLINE_WORKFLOW || "fillow-online.yml";

function gh(args) {
  return spawnSync("gh", args, { encoding: "utf8" });
}

function argValue(argv, flag) {
  const i = argv.indexOf(flag);
  if (i === -1) return "";
  return argv[i + 1] || "";
}

export function pullJobs(argv = process.argv.slice(2)) {
  ensureDataDirs();
  const ver = gh(["--version"]);
  if (ver.status !== 0) {
    console.error("gh CLI required for fillow pull. Install https://cli.github.com/ then: gh auth login");
    process.exit(1);
  }

  let id = argValue(argv, "--run");
  if (!id) {
    const list = gh([
      "run",
      "list",
      "--workflow",
      WORKFLOW,
      "--status",
      "success",
      "--limit",
      "1",
      "--json",
      "databaseId,createdAt,headBranch,displayTitle",
    ]);
    if (list.status !== 0) {
      console.error(list.stderr || "gh run list failed");
      process.exit(1);
    }
    const runs = JSON.parse(list.stdout || "[]");
    if (!runs.length) {
      console.error(`No successful ${WORKFLOW} runs found.`);
      console.error(`Dispatch from the Actions tab or: gh workflow run ${WORKFLOW}`);
      process.exit(1);
    }
    id = String(runs[0].databaseId);
    console.log(`pulling ${ARTIFACT} from run ${id} (${runs[0].createdAt || "unknown time"})`);
  } else {
    console.log(`pulling ${ARTIFACT} from run ${id}`);
  }

  const dl = spawnSync("gh", ["run", "download", String(id), "-n", ARTIFACT, "-D", PATHS.data], {
    stdio: "inherit",
  });
  if (dl.status !== 0) process.exit(dl.status ?? 1);

  const nested = join(PATHS.data, "data", "jobs.tsv");
  if (!existsSync(PATHS.jobsTsv) && existsSync(nested)) {
    renameSync(nested, PATHS.jobsTsv);
  }
  if (!existsSync(PATHS.jobsTsv)) {
    console.error("download finished but data/jobs.tsv is missing");
    process.exit(1);
  }
  console.log(`ok  ${PATHS.jobsTsv}`);
  return PATHS.jobsTsv;
}

const isCli = process.argv[1]?.endsWith("pull-jobs.mjs");
if (isCli) pullJobs();

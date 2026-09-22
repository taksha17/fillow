#!/usr/bin/env node
import { runSetup } from "../lib/onboard.mjs";

const saveBoards = process.argv.includes("--boards");
runSetup(saveBoards).catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

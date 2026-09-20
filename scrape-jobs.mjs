#!/usr/bin/env node
/**
 * scrape-jobs.mjs — Agent 1: Job Scraping
 * Specialized sub-agents per job board with parallel execution
 */

import { execSync } from "child_process";
import { readFileSync } from "fs";
import dotenv from "dotenv";
dotenv.config();

export async function scrapeJobs() {
  const boards = primaryBoards.concat(fallbackBoards);
  console.log(`📡 Scraping jobs from ${boards.length} boards...`);

  // Execute scraping in parallel for primary boards
  const primaryPromises = boards.primary.map(board => 
    runScraper(board, "primary")
  );

  // Execute fallback boards separately
  const fallbackPromises = boards.fallback.map(board =>
    runScraper(board, "fallback")
  );

  const results = await Promise.all([
    ...primaryPromises,
    ...fallbackPromises
  ]);

  console.log(`✅ Scraped ${results.length} job postings`);
  return results;
}

function runScraper(board, type) {
  return new Promise((resolve) => {
    try {
      const cmd = `node scrapers/${board}-scraper.mjs --${type}`;
      const output = execSync(cmd, { timeout: 30000 }).toString();
      resolve({ board, type, output, status: "success" });
    } catch (error) {
      resolve({ board, type, error: error.message, status: "failed" });
    }
  });
}

// Board configurations
const primaryBoards = ["ashby", "greenhouse", "workday", "successfactors", "oracle"];
const fallbackBoards = {
  primary: ["ashby", "greenhouse"],
  fallback: ["indeed", "glassdoor", "linkedin", "monster"]
};

export { primaryBoards, fallbackBoards };
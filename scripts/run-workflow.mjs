#!/usr/bin/env node
import { runAgentCli } from './lib/progress.mjs';
import { createDashboard } from './lib/progress.mjs';
import { loadConfig } from './lib/config.mjs';
import { scrapeJobs } from './agents/discover.mjs';
import { evaluateTailor } from './agents/evaluate-tailor.mjs';
import { applyJobs } from './agents/apply.mjs';
import { trackDashboard } from './agents/track.mjs';

async function runFullWorkflow(emit) {
  const cfg = loadConfig();
  
  // Create dashboard for TUI
  const dashboard = createDashboard('run');
  dashboard.updateDashboard();
  
  // Update dashboard with agent start
  dashboard.updateAgent('discover', { status: 'running', jobs: 0, errors: 0 });
  dashboard.logAgent('discover', 'Starting job discovery...');
  
  try {
    const jobs = await scrapeJobs(cfg, emit);
    dashboard.updateAgent('discover', { status: 'complete', jobs: jobs.length });
    dashboard.logAgent('discover', `Found ${jobs.length} jobs`);
  } catch (err) {
    dashboard.updateAgent('discover', { status: 'error', errors: 1 });
    dashboard.logAgent('discover', `Error: ${err.message}`);
    throw err;
  }
  
  dashboard.updateAgent('evaluate', { status: 'running', jobs: 0, errors: 0 });
  dashboard.logAgent('evaluate', 'Starting job evaluation and tailoring...');
  
  try {
    const survivors = await evaluateTailor(cfg, { emit });
    const readyJobs = survivors.filter(j => j.status === 'ready');
    dashboard.updateAgent('evaluate', { status: 'complete', jobs: readyJobs.length });
    dashboard.logAgent('evaluate', `Ready for tailoring: ${readyJobs.length} jobs`);
  } catch (err) {
    dashboard.updateAgent('evaluate', { status: 'error', errors: 1 });
    dashboard.logAgent('evaluate', `Error: ${err.message}`);
    throw err;
  }
  
  dashboard.updateAgent('apply', { status: 'running', jobs: 0, errors: 0 });
  dashboard.logAgent('apply', 'Starting application process...');
  
  try {
    const applied = await applyJobs([], cfg, { emit });
    dashboard.updateAgent('apply', { status: 'complete', jobs: applied.length });
    dashboard.logAgent('apply', `Applied to ${applied.length} jobs`);
  } catch (err) {
    dashboard.updateAgent('apply', { status: 'error', errors: 1 });
    dashboard.logAgent('apply', `Error: ${err.message}`);
    throw err;
  }
  
  dashboard.updateAgent('track', { status: 'running', jobs: 0, errors: 0 });
  dashboard.logAgent('track', 'Starting tracking and dashboard...');
  
  try {
    const tracked = await trackDashboard([], cfg, { emit });
    dashboard.updateAgent('track', { status: 'complete', jobs: tracked.recorded.length });
    dashboard.logAgent('track', `Tracked ${tracked.recorded.length} applications`);
    dashboard.logAgent('track', `Dashboard: ${tracked.dashboard}`);
  } catch (err) {
    dashboard.updateAgent('track', { status: 'error', errors: 1 });
    dashboard.logAgent('track', `Error: ${err.message}`);
    throw err;
  }
  
  dashboard.clearScreen();
  console.log('\n' + '='.repeat(60));
  console.log('WORKFLOW COMPLETED SUCCESSFULLY');
  console.log('='.repeat(60));
  console.log(`Total agents processed: discover, evaluate, apply, track`);
  console.log(`Dashboard generated: ${tracked.dashboard}`);
  console.log('\n');
  
  return { jobs: [], survivors: [], applied, tracked };
}

runAgentCli({
  agent: 'run',
  run: runFullWorkflow,
  summarize: (result) => 
    `Workflow completed: ${result.applied.length} applications, ${result.tracked.recorded.length} tracked`,
}).catch(() => {
  process.exitCode = 1;
});
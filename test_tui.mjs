#!/usr/bin/env node
import { createDashboard } from './lib/progress.mjs';

async function testTUI() {
  console.log('Testing TUI Dashboard...\n');
  
  const dashboard = createDashboard('test');
  
  // Simulate agent workflow
  dashboard.updateAgent('discover', { status: 'running', jobs: 0, errors: 0 });
  dashboard.logAgent('discover', 'Fetching job listings from ATS...');
  await new Promise(resolve => setTimeout(resolve, 500));
  
  dashboard.updateAgent('discover', { jobs: 45 });
  dashboard.logAgent('discover', `Found ${dashboard.agents.discover.jobs} jobs`);
  await new Promise(resolve => setTimeout(resolve, 300));
  
  dashboard.updateAgent('discover', { status: 'complete' });
  dashboard.logAgent('discover', 'Discovery complete');
  
  dashboard.updateAgent('evaluate', { status: 'running', jobs: 0, errors: 0 });
  dashboard.logAgent('evaluate', 'Evaluating job matches...');
  await new Promise(resolve => setTimeout(resolve, 800));
  
  dashboard.updateAgent('evaluate', { jobs: 32, match_score: '82%' });
  dashboard.logAgent('evaluate', `Selected ${dashboard.agents.evaluate.jobs} jobs for tailoring`);
  await new Promise(resolve => setTimeout(resolve, 500));
  
  dashboard.updateAgent('evaluate', { status: 'complete' });
  dashboard.logAgent('evaluate', 'Evaluation complete');
  
  dashboard.updateAgent('apply', { status: 'running', jobs: 0, errors: 0 });
  dashboard.logAgent('apply', 'Starting application automation...');
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  dashboard.updateAgent('apply', { jobs: 12 });
  dashboard.logAgent('apply', `Applied to ${dashboard.agents.apply.jobs} jobs`);
  await new Promise(resolve => setTimeout(resolve, 700));
  
  dashboard.updateAgent('apply', { status: 'complete' });
  dashboard.logAgent('apply', 'Application complete');
  
  dashboard.updateAgent('track', { status: 'running', jobs: 0, errors: 0 });
  dashboard.logAgent('track', 'Tracking applications and generating dashboard...');
  await new Promise(resolve => setTimeout(resolve, 600));
  
  dashboard.updateAgent('track', { jobs: 12 });
  dashboard.logAgent('track', `Tracking ${dashboard.agents.track.jobs} applications`);
  await new Promise(resolve => setTimeout(resolve, 400));
  
  dashboard.updateAgent('track', { status: 'complete' });
  dashboard.logAgent('track', 'Dashboard generated successfully');
  
  console.log('\n' + '='.repeat(60));
  console.log('TUI TEST COMPLETED');
  console.log('='.repeat(60));
  console.log(`Final Agent Status:`);
  console.log(`- Discover: ${dashboard.agents.discover.status} (${dashboard.agents.discover.jobs} jobs)`);
  console.log(`- Evaluate: ${dashboard.agents.evaluate.status} (${dashboard.agents.evaluate.jobs} jobs)`);
  console.log(`- Apply: ${dashboard.agents.apply.status} (${dashboard.agents.apply.jobs} jobs)`);
  console.log(`- Track: ${dashboard.agents.track.status} (${dashboard.agents.track.jobs} jobs)`);
}

testTUI().catch(console.error);
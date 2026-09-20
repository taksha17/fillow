import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PATHS, ensureDataDirs } from "./paths.mjs";
import { timesFontCss } from "./times-font.mjs";
import { resolvePlaywrightBrowsersPath } from "./playwright-path.mjs";
import {
  baseResumeFromConfig,
  tailorResumeForJob,
  rewriteBulletsWithLlm,
  enrichFromPublicProfiles,
} from "./resume-source.mjs";

export { resolvePlaywrightBrowsersPath };

export const FIT_STEPS = [
  { fs: 10.5, lh: 1.12, drop: 0 },
  { fs: 10, lh: 1.1, drop: 0 },
  { fs: 9.5, lh: 1.08, drop: 0 },
  { fs: 9, lh: 1.06, drop: 1 },
  { fs: 8.75, lh: 1.05, drop: 2 },
];

const SKILL_LABELS = {
  languages: "Languages",
  frameworks: "Frameworks",
  tools: "Developer Tools",
  libraries: "Libraries",
};

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}

export function displayLink(url) {
  return String(url || "").replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/+$/, "");
}

export function jobResumeKey(job) {
  return String(job?.external_id || job?.url || `${job?.company || "job"}-${job?.title || ""}`);
}

function safeSlug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "job";
}

export function tailoredResumePath(job) {
  return join(PATHS.tailored, `${safeSlug(job?.company)}-${safeSlug(job?.external_id || job?.url || job?.title)}.pdf`);
}

export function resolveResumePath(job, cfg) {
  const tailored = tailoredResumePath(job);
  if (existsSync(tailored)) return tailored;
  if (job?.tailored_resume && existsSync(job.tailored_resume)) return job.tailored_resume;
  if (job?.resume_path && existsSync(job.resume_path)) return job.resume_path;
  const fallback = cfg?.candidate?.resume_path;
  return fallback && existsSync(fallback) ? fallback : fallback || null;
}

export function getTailoredResumePath(job) {
  return resolveResumePath(job, null);
}

export function countPdfPages(buf) {
  const text = Buffer.isBuffer(buf) ? buf.toString("latin1") : String(buf || "");
  const counts = [...text.matchAll(/\/Type\s*\/Pages[^]*?\/Count\s+(\d+)/g)].map((m) => Number(m[1]));
  if (counts.length) return Math.max(...counts);
  const pages = text.match(/\/Type\s*\/Page(?!s)/g);
  return pages ? pages.length : 1;
}

function contactBits(candidate) {
  const bits = [];
  if (candidate.phone) bits.push(esc(candidate.phone));
  if (candidate.email) bits.push(`<a href="mailto:${esc(candidate.email)}">${esc(candidate.email)}</a>`);
  if (candidate.linkedin) {
    const href = esc(candidate.linkedin);
    bits.push(`<a href="${href}">${esc(displayLink(candidate.linkedin))}</a>`);
  }
  if (candidate.github) {
    const href = esc(candidate.github);
    bits.push(`<a href="${href}">${esc(displayLink(candidate.github))}</a>`);
  }
  if (candidate.location) bits.push(esc(candidate.location));
  return bits.join(` <span class="sep">|</span> `);
}

function renderEducation(rows) {
  if (!rows?.length) return "";
  return `<section><h2>Education</h2>${rows
    .map(
      (e) => `<div class="block">
      <div class="row"><span class="left">${esc(e.school)}</span><span class="right">${esc(e.location)}</span></div>
      <div class="row sub"><span class="left">${esc(e.degree)}</span><span class="right">${esc(e.dates)}</span></div>
    </div>`
    )
    .join("")}</section>`;
}

function renderExperience(rows) {
  if (!rows?.length) return "";
  return `<section><h2>Experience</h2>${rows
    .map((e) => {
      const bullets = (e.bullets || []).map((b) => `<li>${esc(b)}</li>`).join("");
      return `<div class="block">
      <div class="row"><span class="left">${esc(e.company)}</span><span class="right">${esc(e.location)}</span></div>
      <div class="row sub"><span class="left">${esc(e.title)}</span><span class="right">${esc(e.dates)}</span></div>
      ${bullets ? `<ul>${bullets}</ul>` : ""}
    </div>`;
    })
    .join("")}</section>`;
}

function renderProjects(rows) {
  if (!rows?.length) return "";
  return `<section><h2>Projects</h2>${rows
    .map((p) => {
      const title = p.stack ? `${esc(p.name)} <span class="pipe">|</span> <em>${esc(p.stack)}</em>` : esc(p.name);
      const bullets = (p.bullets || []).map((b) => `<li>${esc(b)}</li>`).join("");
      return `<div class="block">
      <div class="row"><span class="left">${title}</span><span class="right">${esc(p.dates)}</span></div>
      ${bullets ? `<ul>${bullets}</ul>` : ""}
    </div>`;
    })
    .join("")}</section>`;
}

function renderSkills(skills) {
  const lines = Object.entries(SKILL_LABELS)
    .map(([key, label]) => {
      const items = (skills?.[key] || []).filter(Boolean);
      if (!items.length) return "";
      return `<p><strong>${label}:</strong> ${esc(items.join(", "))}</p>`;
    })
    .filter(Boolean);
  if (!lines.length) return "";
  return `<section class="skills"><h2>Technical Skills</h2>${lines.join("")}</section>`;
}

export function buildJakeHtml(candidate, model, { fs = 10.5, lh = 1.12 } = {}) {
  const name = esc(candidate.full_name || `${candidate.first_name || ""} ${candidate.last_name || ""}`.trim());
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${name} — Resume</title>
<style>
${timesFontCss()}
@page { size: letter; margin: 0.4in 0.45in; }
* { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  font-family: "Times New Roman", Times, "Liberation Serif", serif;
  font-size: ${fs}pt;
  line-height: ${lh};
  color: #000;
  background: #fff;
}
.header { text-align: center; margin: 0 0 6px; }
.name {
  font-size: 2.05em;
  font-weight: 700;
  font-variant: small-caps;
  letter-spacing: 0.6px;
  line-height: 1.05;
}
.contact { font-size: 0.92em; margin-top: 2px; }
.contact a { color: #000; text-decoration: underline; }
.sep { margin: 0 0.2em; }
section { margin-top: 7px; }
h2 {
  font-size: 1.08em;
  font-weight: 700;
  font-variant: small-caps;
  letter-spacing: 0.45px;
  border-bottom: 0.7px solid #000;
  margin: 0 0 3px;
  padding: 0;
  line-height: 1.2;
}
.block { margin: 0 0 4px; }
.row { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
.left { font-weight: 700; }
.right { white-space: nowrap; text-align: right; }
.sub .left { font-weight: 400; font-style: italic; }
.sub .right { font-style: italic; font-weight: 400; }
.pipe { font-weight: 400; }
ul {
  margin: 1px 0 0 13px;
  padding: 0;
}
li {
  margin: 0;
  padding: 0;
  text-align: justify;
  text-justify: inter-word;
}
.skills p {
  margin: 0;
  text-align: justify;
  text-justify: inter-word;
}
</style>
</head>
<body>
  <header class="header">
    <div class="name">${name}</div>
    <div class="contact">${contactBits(candidate)}</div>
  </header>
  ${renderEducation(model.education)}
  ${renderExperience(model.experience)}
  ${renderProjects(model.projects)}
  ${renderSkills(model.skills)}
</body>
</html>`;
}

async function tailorModel(cfg, job, extra, drop = 0) {
  const base = tailorResumeForJob(baseResumeFromConfig(cfg, extra), job, { dropPerRole: drop });
  return base;
}

async function prepareTailoredModel(cfg, job, extra = {}) {
  const model = tailorResumeForJob(baseResumeFromConfig(cfg, extra), job, { dropPerRole: 0 });
  if (model.experience[0]?.bullets?.length) {
    model.experience[0].bullets = await rewriteBulletsWithLlm(cfg, job, model.experience[0].bullets);
  }
  return model;
}

async function launchPdfBrowser() {
  const { chromium } = await import("playwright");
  const args = ["--no-sandbox", "--disable-dev-shm-usage"];
  process.env.PLAYWRIGHT_BROWSERS_PATH = resolvePlaywrightBrowsersPath();
  try {
    try {
      return await chromium.launch({ headless: true, channel: "chrome", args });
    } catch {
      return await chromium.launch({ headless: true, args });
    }
  } catch (err) {
    throw new Error(`Playwright Chromium missing for resume PDF (${err.message}). Run: npx playwright install chromium`);
  }
}

async function renderPdfFromHtml(page, html, pdfPath, step) {
  await page.setContent(html, { waitUntil: "domcontentloaded" });
  await page.addStyleTag({ content: `html{font-size:${step.fs}pt;line-height:${step.lh};}` });
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
  });
  const overflow = await page.evaluate(() => {
    const body = document.body;
    const limit = (11 - 0.8) * 96;
    return body.scrollHeight > limit + 8;
  });
  const buf = await page.pdf({
    path: pdfPath,
    format: "Letter",
    printBackground: true,
    preferCSSPageSize: true,
    margin: { top: "0.4in", bottom: "0.4in", left: "0.45in", right: "0.45in" },
    pageRanges: overflow ? undefined : "1",
  });
  return { overflow, pages: countPdfPages(buf) };
}

export async function renderTailoredResume(cfg, job, extra = {}, step = FIT_STEPS[0], prepared) {
  const model = prepared
    ? tailorResumeForJob(prepared, job, { dropPerRole: step.drop })
    : await tailorModel(cfg, job, extra, step.drop);
  const html = buildJakeHtml(cfg.candidate, model, step);
  return { html, model };
}

export async function generateSinglePdf(cfg, job, { extra = {}, force = false, browser } = {}) {
  ensureDataDirs();
  mkdirSync(PATHS.tailored, { recursive: true });
  const pdfPath = tailoredResumePath(job);
  if (!force && existsSync(pdfPath)) return pdfPath;

  const owned = !browser;
  const chrome = browser || (await launchPdfBrowser());
  const page = await chrome.newPage();
  const prepared = await prepareTailoredModel(cfg, job, extra);
  try {
    let lastHtml = "";
    for (const step of FIT_STEPS) {
      const { html } = await renderTailoredResume(cfg, job, extra, step, prepared);
      lastHtml = html;
      const { overflow, pages } = await renderPdfFromHtml(page, html, pdfPath, step);
      if (!overflow && pages <= 1) return pdfPath;
    }
    if (process.env.FILLLOW_DEBUG_RESUME === "1") {
      writeFileSync(pdfPath.replace(/\.pdf$/, ".html"), lastHtml, "utf8");
    }
    await page.setContent(lastHtml, { waitUntil: "domcontentloaded" });
    await page.pdf({
      path: pdfPath,
      format: "Letter",
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: "0.38in", bottom: "0.38in", left: "0.42in", right: "0.42in" },
      pageRanges: "1",
    });
    return pdfPath;
  } finally {
    await page.close().catch(() => {});
    if (owned) await chrome.close().catch(() => {});
  }
}

export async function generateTailoredResumePdf(cfg, job, extra, opts = {}) {
  return generateSinglePdf(cfg, job, { extra: extra || {}, ...opts });
}

export async function generateTailoredResumesBatch(cfg, jobs, concurrency = 2, extra = {}) {
  const results = new Map();
  if (!jobs?.length) return results;
  let browser;
  try {
    browser = await launchPdfBrowser();
  } catch (err) {
    console.warn(`  ${err.message}`);
    for (const job of jobs) results.set(jobResumeKey(job), null);
    return results;
  }

  const queue = [...jobs];
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), jobs.length) }, async () => {
    while (queue.length) {
      const job = queue.shift();
      const key = jobResumeKey(job);
      try {
        const path = await generateSinglePdf(cfg, job, { extra, browser });
        results.set(key, path);
      } catch (err) {
        console.warn(`  PDF failed for ${job.company || key}: ${err.message}`);
        results.set(key, null);
      }
    }
  });
  await Promise.all(workers);
  await browser.close().catch(() => {});
  return results;
}

export async function maybeEnrich(cfg) {
  if (!cfg.runtime?.enrich_profiles) return {};
  console.log("  Enriching from public GitHub/LinkedIn (optional, slower)");
  return enrichFromPublicProfiles(cfg);
}

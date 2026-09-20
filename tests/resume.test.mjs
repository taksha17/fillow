import test from "node:test";
import assert from "node:assert/strict";
import { githubLogin, linkedinSlug, parseJsonArray, parseLinkedInHtml, baseResumeFromConfig, tailorResumeForJob } from "../lib/resume-source.mjs";
import { buildJakeHtml, displayLink, esc, FIT_STEPS, jobResumeKey, tailoredResumePath, countPdfPages, resolvePlaywrightBrowsersPath } from "../lib/resume-pdf.mjs";

const candidate = {
  first_name: "Ada",
  last_name: "Lovelace",
  full_name: "Ada Lovelace",
  email: "ada@example.com",
  phone: "555-0100",
  linkedin: "https://www.linkedin.com/in/ada",
  github: "https://github.com/ada",
  location: "Austin, TX",
  current_company: "Analytical Engines",
};

const cfg = {
  candidate,
  resume: {
    current_title: "Software Engineer",
    education: [],
    experience: [
      {
        title: "Software Engineer",
        company: "Analytical Engines",
        location: "Austin, TX",
        dates: "Present",
        bullets: [
          "Ship production Python APIs and data pipelines",
          "Build React/Next.js frontend take-homes in TypeScript",
        ],
      },
    ],
    projects: [{ name: "Note Engine", stack: "TypeScript, React", bullets: ["Local note search in React"] }],
    skills: {
      languages: ["Python", "TypeScript", "SQL"],
      frameworks: ["React", "FastAPI"],
      tools: ["Git", "Docker"],
      libraries: ["pandas"],
    },
  },
  answer_preferences: { claims: { general: "See resume for production impact and stack." } },
};

test("github and linkedin slugs come from profile URLs", () => {
  assert.equal(githubLogin("https://github.com/you"), "you");
  assert.equal(linkedinSlug("https://www.linkedin.com/in/you/"), "you");
  assert.equal(githubLogin("https://github.com/orgs/foo"), "");
});

test("Jake HTML is Times New Roman, justified, and omits empty education", () => {
  const model = baseResumeFromConfig(cfg);
  const html = buildJakeHtml(candidate, model);
  assert.match(html, /font-family:\s*"Times New Roman"/);
  assert.match(html, /text-align:\s*justify/);
  assert.match(html, />Experience</);
  assert.match(html, />Projects</);
  assert.match(html, />Technical Skills</);
  assert.doesNotMatch(html, />Education</);
  assert.doesNotMatch(html, /University/);
  assert.match(html, /Analytical Engines/);
  assert.match(html, /Note Engine/);
});

test("each job reorders skills toward the posting", () => {
  const base = baseResumeFromConfig(cfg);
  const py = tailorResumeForJob(base, { title: "Python Backend", description: "Python FastAPI pandas Docker" });
  const fe = tailorResumeForJob(base, { title: "Frontend Engineer", description: "React TypeScript Next.js" });
  assert.equal(py.skills.languages[0], "Python");
  assert.equal(fe.skills.languages[0], "TypeScript");
  assert.notEqual(py.skills.frameworks[0], fe.skills.frameworks[0]);
});

test("identity facts are escaped and links are display-stripped", () => {
  assert.equal(esc("<script>"), "&lt;script&gt;");
  assert.equal(displayLink("https://github.com/ada"), "github.com/ada");
});

test("resume path is stable per job, not per company", () => {
  const a = { company: "Stripe", external_id: "111", title: "SWE" };
  const b = { company: "Stripe", external_id: "222", title: "ML" };
  assert.notEqual(tailoredResumePath(a), tailoredResumePath(b));
  assert.equal(jobResumeKey(a), "111");
});

test("JSON bullet arrays survive markdown fences", () => {
  assert.deepEqual(parseJsonArray("```json\n[\"Shipped APIs\"]\n```"), ["Shipped APIs"]);
});

test("LinkedIn JSON-LD is optional and never invents schools", () => {
  const html = `<script type="application/ld+json">{"@type":"Person","alumniOf":{"name":"Example College"}}</script>`;
  const extra = parseLinkedInHtml(html);
  assert.equal(extra.education[0].school, "Example College");
  const empty = baseResumeFromConfig({ ...cfg, resume: { ...cfg.resume, education: [] } }, { education: [] });
  assert.equal(empty.education.length, 0);
});

test("fit steps shrink type before dropping content", () => {
  assert.ok(FIT_STEPS[0].fs > FIT_STEPS.at(-1).fs);
  assert.equal(FIT_STEPS[0].drop, 0);
  assert.ok(FIT_STEPS.at(-1).drop >= 1);
});

test("PDF page counter reads the Pages Count", () => {
  const fake = Buffer.from("%PDF-1.4 /Type /Pages /Count 1 <<>>");
  assert.equal(countPdfPages(fake), 1);
});

test("Playwright browsers path falls back when the env cache is empty", () => {
  const resolved = resolvePlaywrightBrowsersPath();
  assert.match(resolved, /ms-playwright|playwright/);
});

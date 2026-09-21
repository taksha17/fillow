import test from "node:test";
import assert from "node:assert/strict";
import {
  githubLogin,
  linkedinSlug,
  parseJsonArray,
  parseBulletLines,
  parseLinkedInHtml,
  baseResumeFromConfig,
  tailorResumeForJob,
  pickRelevantBullets,
} from "../lib/resume-source.mjs";
import {
  buildJakeHtml,
  displayLink,
  esc,
  FIT_STEPS,
  jobResumeKey,
  tailoredResumePath,
  countPdfPages,
  resolvePlaywrightBrowsersPath,
  renderResumeMarkdown,
} from "../lib/resume-pdf.mjs";
import { htmlToPlainText } from "../lib/ats.mjs";
import { extractSkillTokens } from "../lib/similarity.mjs";

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
  school: "Example College",
  degree: "B.S. Mathematics",
  school_location: "London, UK",
  graduation: "1843",
  education: [
    { school: "Example College", degree: "B.S. Mathematics", location: "London, UK", dates: "1843" },
  ],
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
          "Operate Kafka event streams and Docker/Kubernetes on AWS",
          "Ran A/B tests for ranking and personalization",
          "Wrote ETL in pandas for 100GB telemetry",
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

test("Jake HTML is Times New Roman, justified, and includes education from candidate", () => {
  const model = baseResumeFromConfig(cfg);
  const html = buildJakeHtml(candidate, model);
  assert.match(html, /font-family:\s*"Times New Roman"/);
  assert.match(html, /text-align:\s*justify/);
  assert.match(html, />Experience</);
  assert.match(html, />Projects</);
  assert.match(html, />Technical Skills</);
  assert.match(html, />Education</);
  assert.match(html, /Example College/);
  assert.match(html, /Analytical Engines/);
  assert.match(html, /Note Engine/);
});

test("each job reorders skills and caps bullets toward the posting", () => {
  const base = baseResumeFromConfig(cfg);
  const py = tailorResumeForJob(base, { title: "Python Backend", description: "Python FastAPI pandas Docker Kafka" });
  const fe = tailorResumeForJob(base, { title: "Frontend Engineer", description: "React TypeScript Next.js" });
  assert.equal(py.skills.languages[0], "Python");
  assert.equal(fe.skills.languages[0], "TypeScript");
  assert.notEqual(py.skills.frameworks[0], fe.skills.frameworks[0]);
  assert.ok(py.experience[0].bullets.length <= 4);
  assert.ok(py.experience[0].bullets.some((b) => /Python|Kafka|pandas/i.test(b)));
});

test("pickRelevantBullets keeps original order among the selected subset", () => {
  const tokens = new Set(extractSkillTokens("ranking personalization pytorch kafka"));
  const picked = pickRelevantBullets(
    [
      "Unrelated admin task",
      "Built ranking with PyTorch",
      "Shipped Kafka personalization pipeline",
      "Wrote docs",
      "More ranking work",
    ],
    tokens,
    { maxKeep: 2 }
  );
  assert.equal(picked.length, 2);
  assert.ok(picked[0].includes("PyTorch"));
  assert.ok(picked[1].includes("Kafka"));
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

test("htmlToPlainText unwraps Greenhouse entity-escaped content", () => {
  const raw = "&lt;h2&gt;Who we are&lt;/h2&gt; &lt;p&gt;Stripe builds payments.&lt;/p&gt;";
  const text = htmlToPlainText(raw);
  assert.match(text, /Who we are/);
  assert.match(text, /Stripe builds payments/);
  assert.doesNotMatch(text, /&lt;|&gt;|<h2>/);
});

test("JSON bullet arrays survive markdown fences and line fallbacks", () => {
  assert.deepEqual(parseJsonArray("```json\n[\"Shipped APIs\"]\n```"), ["Shipped APIs"]);
  assert.deepEqual(parseBulletLines("1. Shipped production APIs\n2. Built ranking models", 2), [
    "Shipped production APIs",
    "Built ranking models",
  ]);
});

test("LinkedIn JSON-LD is optional and never invents schools", () => {
  const html = `<script type="application/ld+json">{"@type":"Person","alumniOf":{"name":"Example College"}}</script>`;
  const extra = parseLinkedInHtml(html);
  assert.equal(extra.education[0].school, "Example College");
  const empty = baseResumeFromConfig(
    { ...cfg, candidate: { ...candidate, education: [], school: "" }, resume: { ...cfg.resume, education: [] } },
    { education: [] }
  );
  assert.equal(empty.education.length, 0);
});

test("markdown follows Jake section order Education → Experience → Projects → Skills", () => {
  const model = baseResumeFromConfig(cfg);
  const md = renderResumeMarkdown(candidate, model);
  const edu = md.indexOf("## Education");
  const exp = md.indexOf("## Experience");
  const proj = md.indexOf("## Projects");
  const skills = md.indexOf("## Technical Skills");
  assert.ok(edu >= 0 && exp > edu && proj > exp && skills > proj);
});

test("fit steps shrink type before dropping content", () => {
  assert.ok(FIT_STEPS[0].fs > FIT_STEPS.at(-1).fs);
  assert.equal(FIT_STEPS[0].drop, 0);
  assert.ok(FIT_STEPS.at(-1).drop >= 1);
  assert.ok(FIT_STEPS[0].maxBullets >= FIT_STEPS.at(-1).maxBullets);
});

test("PDF page counter reads the Pages Count", () => {
  const fake = Buffer.from("%PDF-1.4 /Type /Pages /Count 1 <<>>");
  assert.equal(countPdfPages(fake), 1);
});

test("Playwright browsers path falls back when the env cache is empty", () => {
  const resolved = resolvePlaywrightBrowsersPath();
  assert.match(resolved, /ms-playwright|playwright/);
});

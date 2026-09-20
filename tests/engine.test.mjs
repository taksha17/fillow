import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { answerQuestions, heuristicAnswer, alignOptions } from "../lib/answer-engine.mjs";
import { educationFromProfile } from "../lib/config.mjs";
import { appendApplication, readTracker } from "../lib/tracker.mjs";
import { scoreJob } from "../lib/score.mjs";
import { isBlacklisted } from "../lib/blacklist.mjs";

const candidate = {
  first_name: "Ada",
  last_name: "Lovelace",
  email: "t@example.com",
  phone: "555",
  github: "https://github.com/you",
  linkedin: "https://www.linkedin.com/in/you",
  passport_country: "India",
  country_of_residence: "United States",
  requires_sponsorship: true,
  current_company: "Example LLC",
  years_experience: "3–4 years",
};

const prefs = {
  tone: "optimistic",
  how_heard: "Linkedin",
  always_yes: ["authorized to work", "react"],
  always_no: ["previously employed by"],
  claims: { frontend: "Yes — shipped Next.js/React work.", general: "AI/ML engineer." },
};

test("profile locks beat heuristics", () => {
  assert.equal(heuristicAnswer("Passport country", candidate, {}, prefs), "India");
  assert.equal(heuristicAnswer("GitHub", candidate, {}, prefs), "https://github.com/you");
});

test("always_yes / always_no force lists", () => {
  assert.equal(heuristicAnswer("Are you authorized to work in the US?", candidate, {}, prefs), "Yes");
  assert.equal(heuristicAnswer("Were you previously employed by this company?", candidate, {}, prefs), "No");
});

test("option alignment copies ATS strings", () => {
  const aligned = alignOptions(
    { Q: "yes" },
    { Q: ["Yes", "No"] }
  );
  assert.equal(aligned.Q, "Yes");
});

test("option alignment maps Yes onto long Greenhouse remote options", () => {
  const aligned = alignOptions(
    { remote: "Yes" },
    { remote: ["Yes, I intend to work remotely.", "No, I intend to work from an office location."] }
  );
  assert.equal(aligned.remote, "Yes, I intend to work remotely.");
});

test("EEO questions decline when profile has no gender", () => {
  assert.match(
    heuristicAnswer("Gender", candidate, {}, { ...prefs, eeo_default: "Prefer not to say" }, ["Male", "Female", "I don't wish to answer"]),
    /don't wish|prefer not/i
  );
});

test("EEO uses profile gender, hispanic, and veteran when set", () => {
  const c = { ...candidate, gender: "Male", hispanic: "No", veteran: "No" };
  assert.equal(heuristicAnswer("Gender", c, {}, prefs, ["Male", "Female", "I don't wish to answer"]), "Male");
  assert.equal(heuristicAnswer("Hispanic / Latino", c, {}, prefs, ["Yes", "No"]), "No");
  assert.match(
    heuristicAnswer("Veteran Status", c, {}, prefs, ["I am a veteran", "I am not a veteran"]),
    /not a veteran/i
  );
});

test("education questions stay blank when the profile has no schools", () => {
  assert.equal(heuristicAnswer("School", candidate, {}, prefs), "");
  assert.equal(
    heuristicAnswer("School", { ...candidate, education: [{ school: "Example College" }] }, {}, prefs),
    "Example College"
  );
});

test("candidate.school and degree are the education fields Agent 3 reads", () => {
  assert.deepEqual(educationFromProfile({ candidate: { school: "" }, resume: { education: [] } }), []);
  const rows = educationFromProfile({
    candidate: { school: "UT Dallas", degree: "B.S. Computer Science", school_location: "Richardson, TX", graduation: "2022" },
    resume: { education: [] },
  });
  assert.equal(rows[0].school, "UT Dallas");
  assert.equal(rows[0].degree, "B.S. Computer Science");
  assert.equal(rows[0].location, "Richardson, TX");
  assert.equal(rows[0].dates, "2022");
});

test("answerQuestions applies locks after LLM", async () => {
  const answers = await answerQuestions({
    questions: ["Passport country?", "Are you authorized to work in the US?"],
    candidate,
    job: { title: "SWE", company: "Acme" },
    prefs,
    optionsByQuestion: {
      "Are you authorized to work in the US?": ["Yes", "No"],
    },
    llmChat: async () => JSON.stringify({
      "Passport country?": "France",
      "Are you authorized to work in the US?": "No",
    }),
  });
  assert.equal(answers["Passport country?"], "India");
  assert.equal(answers["Are you authorized to work in the US?"], "Yes");
});

test("tracker append is atomic and dedupes by url", () => {
  const dir = mkdtempSync(join(tmpdir(), "fillow-tracker-"));
  const path = join(dir, "applications.md");
  const a = appendApplication({ company: "Acme", role: "SWE", url: "https://jobs.example/1", status: "dry_run" }, path);
  const b = appendApplication({ company: "Acme", role: "SWE", url: "https://jobs.example/1", status: "applied" }, path);
  assert.equal(a.skipped, false);
  assert.equal(b.skipped, true);
  const rows = readTracker(path);
  assert.equal(rows.length, 1);
  assert.match(readFileSync(path, "utf8"), /Acme/);
});

test("heuristics fill residence country and employer from profile", () => {
  assert.equal(heuristicAnswer("Please select the country where you currently reside.", candidate, {}, prefs), "United States");
  assert.equal(heuristicAnswer("Who is your current or previous employer?", candidate, {}, prefs), "Example LLC");
  assert.equal(heuristicAnswer("Do you opt-in to receive WhatsApp messages?", candidate, {}, prefs), "No");
  assert.equal(
    heuristicAnswer(
      "If located in the US, in what city and state do you reside?",
      { ...candidate, location: "Austin, TX", greenhouse_location: "Austin, Texas, United States" },
      {},
      prefs
    ),
    "Austin, Texas, United States"
  );
  assert.equal(
    heuristicAnswer(
      "If this role offers the option to work from a remote location, do you intend to work remotely?",
      candidate,
      {},
      prefs,
      ["Yes, I intend to work remotely.", "No, I intend to work from an office location."]
    ),
    "Yes, I intend to work remotely."
  );
});

test("scoreJob rewards title keyword hits", () => {
  const score = scoreJob(
    { title: "Machine Learning Engineer", company: "x", location: "Remote US", description: "python llm rag kafka" },
    { keywords: ["Machine Learning Engineer"], exclude_keywords: [], remote_ok: true }
  );
  assert.ok(score >= 78, `expected >= 78, got ${score}`);
});

test("blacklist matches punctuation-insensitively", () => {
  assert.equal(isBlacklisted("Acme Corp", ["Acme Corp"]), true);
  assert.equal(isBlacklisted("Other", ["Acme Corp"]), false);
});

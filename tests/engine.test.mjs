import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { answerQuestions, heuristicAnswer, alignOptions, needsLlmAnswer } from "../lib/answer-engine.mjs";
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

test("generic company-association questions are No without per-company bank/profile", () => {
  const yn = ["Yes", "No"];
  assert.equal(
    heuristicAnswer("Have you been a previous employee at Blend?", candidate, { company: "blend" }, prefs, yn),
    "No"
  );
  assert.equal(
    heuristicAnswer("Have you ever been employed by WorldQuant?", candidate, { company: "worldquant" }, prefs, yn),
    "No"
  );
  assert.equal(
    heuristicAnswer("Are you related to a current employee-owner of CFD Research?", candidate, {}, prefs, yn),
    "No"
  );
  assert.equal(
    heuristicAnswer(
      "Do you have any relatives or family members currently employed at Torc Robotics?",
      candidate,
      {},
      prefs,
      yn
    ),
    "No"
  );
  assert.equal(
    heuristicAnswer(
      "Do you or any of your immediate family members or close personal friends work for a government agency or significant commercial partners of Blend Labs?",
      candidate,
      {},
      prefs,
      yn
    ),
    "No"
  );
  // Must not hijack current-employer free text
  assert.equal(
    heuristicAnswer("Who is your current or previous employer?", candidate, {}, prefs),
    "Example LLC"
  );
});

test("without-sponsorship auth is No when requires_sponsorship", () => {
  assert.equal(
    heuristicAnswer(
      "Are you authorized to work lawfully in the United States for Blend without company sponsorship?",
      candidate,
      {},
      prefs,
      ["Yes", "No"]
    ),
    "No"
  );
});

test("state / years / SF office heuristics", () => {
  const c = { ...candidate, location: "Austin, TX" };
  assert.match(
    heuristicAnswer("State you will be working from", c, {}, prefs),
    /Texas|TX/i
  );
  assert.match(
    heuristicAnswer("How many years of industry experience do you have?", c, {}, prefs),
    /3/
  );
  assert.equal(
    heuristicAnswer(
      "Are you currently 1) based in San Francisco Bay Area/New York City and 2) willing to come into the SF or NYC Airtable office 2-3x per week?",
      c,
      {},
      prefs,
      ["Yes", "No"]
    ),
    "No"
  );
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
    questions: [
      "Passport country?",
      "Are you authorized to work in the US?",
      "Please select the country where you currently reside.",
      "Do you opt-in to receive WhatsApp messages from Stripe Recruiting?",
    ],
    candidate: { ...candidate, greenhouse_location: "Austin, Texas, United States" },
    job: { title: "SWE", company: "Acme" },
    prefs,
    optionsByQuestion: {
      "Are you authorized to work in the US?": ["Yes", "No"],
      "Do you opt-in to receive WhatsApp messages from Stripe Recruiting?": ["Yes", "No"],
    },
    llmChat: async () => JSON.stringify({
      "Passport country?": "France",
      "Are you authorized to work in the US?": "No",
      "Please select the country where you currently reside.": "US",
      "Do you opt-in to receive WhatsApp messages from Stripe Recruiting?": "Yes",
    }),
  });
  assert.equal(answers["Passport country?"], "India");
  assert.equal(answers["Are you authorized to work in the US?"], "Yes");
  assert.equal(answers["Please select the country where you currently reside."], "United States");
  assert.equal(answers["Do you opt-in to receive WhatsApp messages from Stripe Recruiting?"], "No");
});

test("NIM is skipped when profile or resume already has the answer", async () => {
  let called = 0;
  await answerQuestions({
    questions: ["GitHub", "Are you authorized to work in the US?"],
    candidate,
    prefs,
    optionsByQuestion: { "Are you authorized to work in the US?": ["Yes", "No"] },
    llmChat: async () => {
      called += 1;
      return "{}";
    },
  });
  assert.equal(called, 0);
});

test("NIM only receives questions with no profile or resume fact", async () => {
  let asked = "";
  const answers = await answerQuestions({
    questions: ["GitHub", "Why do you want this role?"],
    candidate: { ...candidate, education: [{ school: "UTA", degree: "MS CS" }], experience: [{ title: "Engineer", company: "Acme", dates: "2024", bullets: ["Shipped APIs"] }] },
    job: { title: "SWE", company: "Acme" },
    prefs: { ...prefs, claims: {} },
    llmChat: async (_sys, user) => {
      asked = user;
      return JSON.stringify({ "Why do you want this role?": "Because of the ML platform." });
    },
  });
  assert.match(asked, /Why do you want this role/);
  assert.match(asked, /Unanswered questions/);
  assert.match(asked, /UTA/);
  assert.match(asked, /Shipped APIs/);
  assert.doesNotMatch(asked, /"question": "GitHub"/);
  assert.equal(answers.GitHub, "https://github.com/you");
  assert.equal(answers["Why do you want this role?"], "Because of the ML platform.");
});

test("needsLlmAnswer treats resume placeholders as gaps", () => {
  assert.equal(needsLlmAnswer("Yes"), false);
  assert.equal(needsLlmAnswer(""), true);
  assert.equal(needsLlmAnswer("Please see resume for details."), true);
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
  assert.equal(
    heuristicAnswer(
      "Please select the country where you currently reside.",
      candidate,
      {},
      prefs,
      ["Australia", "Canada", "US", "Other"]
    ),
    "US"
  );
  assert.equal(
    heuristicAnswer(
      "Please select the country or countries you anticipate working in for the role",
      candidate,
      {},
      prefs,
      ["Australia", "Canada", "US", "Other"]
    ),
    "US"
  );
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
    "United States (remote OK)"
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

test("GitLab sponsorship does not pick an EU visa for a US applicant", () => {
  const opts = [
    "No",
    "Yes, Netherlands Highly Skilled Migrant Visa",
    "Yes, Ireland Highly Skilled Worker Visa",
    "Yes, EU Blue Card",
    "Yes, USMCA Professional (TN) Visa (USA)",
    "Yes, F-1 Visa OPT (USA)",
  ];
  const ans = heuristicAnswer(
    "Will you now or in the future require sponsorship for a visa to remain in your current location?",
    candidate,
    {},
    prefs,
    opts
  );
  assert.match(ans, /F-1 Visa OPT|USMCA/i);
  assert.doesNotMatch(ans, /Netherlands|Ireland|EU Blue/i);
});

test("GitLab Poland/UK location is No", () => {
  assert.equal(
    heuristicAnswer("Are you currently location in either Poland or the UK?", candidate, {}, prefs, ["Yes", "No"]),
    "No"
  );
});

test("Anduril export controls pick none of the above for non-US-person", () => {
  const opts = [
    "A United States citizen or national",
    "A person lawfully admitted for permanent residence of the United States (i.e., “Green Card” holder)",
    "None of the above",
  ];
  assert.equal(
    heuristicAnswer("EXPORT CONTROLS - This position requires access to information and technology that is subject to US export controls", candidate, {}, prefs, opts),
    "None of the above"
  );
});

test("qa-bank answers Anthropic / China / clearance stuck patterns", () => {
  assert.match(heuristicAnswer("Why Anthropic?", candidate, { company: "anthropic" }, prefs), /Anthropic|safety|LLM/i);
  assert.equal(heuristicAnswer("Are you legally authorized to work in China?", candidate, {}, prefs, ["Yes", "No"]), "No");
  assert.equal(heuristicAnswer("Do you have a security clearance?", candidate, {}, prefs, ["Yes", "No"]), "No");
  assert.equal(
    heuristicAnswer("Are you open to working in-person in one of our offices 25% of the time?", candidate, {}, prefs, ["Yes", "No"]),
    "Yes"
  );
});

test("zip_code and employer title from profile", () => {
  const c = { ...candidate, zip_code: "78701", location: "Austin, TX", current_title: "Applied AI Engineer" };
  assert.equal(heuristicAnswer("Zip Code / Postal Code", c, {}, prefs), "78701");
  assert.equal(heuristicAnswer("Who is your current or most recent employer?", c, {}, prefs), "Example LLC");
  assert.equal(heuristicAnswer("What is your current or more recent job title?", c, {}, prefs), "Applied AI Engineer");
});

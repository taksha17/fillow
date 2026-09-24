import test from "node:test";
import assert from "node:assert/strict";
import {
  ashbyAutocompleteTries,
  ashbyLooksSubmitted,
  ashbyRequiredStatus,
  ashbyRetryIsLocation,
  ashbyYesNoWant,
  classifyAshbyField,
  isAshbyHowHeardLabel,
  isAshbyIdentityLabel,
  isAshbyLocationLabel,
  isAshbyYesNoQuestion,
} from "../lib/ashby-fields.mjs";
import { confirmationText } from "../lib/browser.mjs";
import { heuristicAnswer, preferenceForcedYesNo } from "../lib/answer-engine.mjs";

test("identity labels skip Preferred First & Last Name", () => {
  assert.equal(isAshbyIdentityLabel("Preferred First & Last Name"), true);
  assert.equal(isAshbyIdentityLabel("Phone Number"), true);
  assert.equal(isAshbyIdentityLabel("LinkedIn Profile"), false);
});

test("location label does not match office Yes/No (OpenAI regression)", () => {
  assert.equal(isAshbyLocationLabel("Location"), true);
  assert.equal(isAshbyLocationLabel("Where are you currently located?"), true);
  assert.equal(isAshbyLocationLabel("What location do you intend to work from?"), true);
  assert.equal(isAshbyLocationLabel("Are you able to work from our US office three days per week?"), false);
  assert.equal(ashbyRetryIsLocation("Are you able to work from our US office three days per week?"), false);
  assert.equal(ashbyRetryIsLocation("Where are you currently located?"), true);
});

test("how-heard and yes/no classifiers", () => {
  assert.equal(isAshbyHowHeardLabel("How did you hear about Temporal?"), true);
  assert.equal(isAshbyYesNoQuestion("Will you now or in the future require sponsorship for employment visa status in the United States?"), true);
  assert.equal(isAshbyYesNoQuestion("Open to relocation if necessary:"), true);
  assert.equal(isAshbyYesNoQuestion("Do you have an active Full Scope Polygraph clearance?"), true);
});

test("classifyAshbyField: relocation is boolean not autocomplete (Cerebras)", () => {
  const relocation = classifyAshbyField({
    text: "Open to relocation if necessary:",
    forId: "8505490d-6f7f-456b-87f7-cca29fc69a15",
    required: true,
    target: null,
    entry: {
      hasCombo: false,
      hasDatepicker: false,
      radios: [],
      yesNoLabels: ["Yes", "No"],
      checkboxNames: [],
      hasYesNoCheckbox: true,
    },
  });
  assert.equal(relocation.kind, "boolean");

  // Even if a parent walk leaked hasCombo=true, Yes/No buttons win when we classify with entry facts
  // — scrape must set hasCombo false on the field entry; this asserts boolean path when no combo.
  const location = classifyAshbyField({
    text: "What location do you intend to work from?",
    forId: "_systemfield_location",
    required: true,
    target: null,
    entry: { hasCombo: true, hasDatepicker: false, radios: [], yesNoLabels: [], checkboxNames: [], hasYesNoCheckbox: false },
  });
  assert.equal(location.kind, "autocomplete");
});

test("classifyAshbyField: date and checkbox groups (OpenAI)", () => {
  const start = classifyAshbyField({
    text: "When can you start a new role?",
    forId: "af2cc708",
    required: true,
    target: null,
    entry: { hasCombo: false, hasDatepicker: true, radios: [], yesNoLabels: [], checkboxNames: [], hasYesNoCheckbox: false },
  });
  assert.equal(start.kind, "date");

  const offices = classifyAshbyField({
    text: "Based on this job's details, which OpenAI office/workplace could you work from?",
    forId: "29be88ae",
    required: true,
    target: null,
    entry: {
      hasCombo: false,
      hasDatepicker: false,
      radios: [],
      yesNoLabels: [],
      checkboxNames: ["San Francisco", "Remote"],
      hasYesNoCheckbox: false,
    },
  });
  assert.equal(offices.kind, "checkbox");
  assert.deepEqual(offices.options, ["San Francisco", "Remote"]);
});

test("autocomplete tries never seed long work_location_intent first", () => {
  const tries = ashbyAutocompleteTries(
    "What location do you intend to work from?",
    "Austin, TX / United States (remote OK)"
  );
  assert.equal(tries[0], "United States");
  assert.ok(!tries[0].includes("/"));
});

test("yes/no wants respect sponsorship and polygraph", () => {
  assert.equal(
    ashbyYesNoWant("Will you require sponsorship for employment visa status?", { requires_sponsorship: true }),
    "Yes"
  );
  assert.equal(
    ashbyYesNoWant("Will you require sponsorship?", { requires_sponsorship: false }),
    "No"
  );
  assert.equal(ashbyYesNoWant("Do you have an active Full Scope Polygraph clearance?", {}), "No");
  assert.equal(ashbyYesNoWant("Are you able to work from our US office three days per week?", {}), "Yes");
});

test("required status prefers Yes/No active over empty combobox sibling", () => {
  assert.equal(
    ashbyRequiredStatus({
      text: "Sponsorship?",
      yesNoLabels: ["Yes", "No"],
      yesNoActive: true,
      hasCombo: false,
    }),
    "ok"
  );
  assert.equal(
    ashbyRequiredStatus({
      text: "Sponsorship?",
      yesNoLabels: ["Yes", "No"],
      yesNoActive: false,
    }),
    "missing"
  );
  assert.equal(
    ashbyRequiredStatus({
      text: "Location",
      hasCombo: true,
      comboValue: "",
    }),
    "missing"
  );
});

test("Ashby success copy is recognized", () => {
  const body = "Success Your application was successfully submitted. We'll contact you if there are next steps.";
  assert.equal(ashbyLooksSubmitted(body), true);
  assert.equal(confirmationText(body), true);
  assert.equal(confirmationText("Thanks for taking the time to apply to MongoDB!"), true);
  assert.equal(confirmationText("thank you for applying"), true);
});

test("always_yes assessment does not hijack export-control radios", () => {
  const prefs = { always_yes: ["assessment", "authorized to work"], always_no: [] };
  const q = "Cerebras products are subject to the U.S. Export Administration Regulations. export compliance assessment to review if an individual is a U.S. person.";
  const options = [
    "I am a U.S. person – citizen of the United States.",
    "I am not a U.S. person, and I am not a current citizen or permanent resident of Cuba, Iran, North Korea, or Syria.",
    "I am not a U.S. person, and I am a current citizen or permanent resident of Cuba, Iran, North Korea, or Syria.",
  ];
  assert.equal(preferenceForcedYesNo(q, prefs, { options }), null);
  const ans = heuristicAnswer(q, { passport_country: "India", requires_sponsorship: true }, {}, prefs, options);
  assert.match(ans, /not a U\.S\. person/i);
  assert.doesNotMatch(ans, /^Yes$/i);
});

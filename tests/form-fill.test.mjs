import test from "node:test";
import assert from "node:assert/strict";
import {
  controlLooksEmpty,
  demographicQuestionsFromJob,
  eeoAnswer,
  greenhouseFieldOptions,
  greenhouseQuestionsFromJob,
  idSel,
  isEducationLabel,
  isEeoLabel,
  pickApiOption,
  pickDecline,
  pickGenderOption,
  pickVeteranOption,
  schoolNameTries,
  scoreOption,
  stripDialCode,
} from "../lib/form-controls.mjs";

test("idSel quotes Greenhouse ids that would break a # selector", () => {
  assert.equal(idSel("question_48620089"), '[id="question_48620089"]');
  assert.equal(idSel("question_48620090[]"), '[id="question_48620090"]');
  assert.equal(idSel('job_application[answers][1]'), '[id="job_application[answers][1]"]');
});

test("greenhouseFieldOptions reads values, not options", () => {
  assert.deepEqual(
    greenhouseFieldOptions({ values: [{ label: "Yes" }, { label: "No" }] }),
    ["Yes", "No"]
  );
  assert.deepEqual(greenhouseFieldOptions({ options: [{ label: "LinkedIn" }] }), ["LinkedIn"]);
});

test("greenhouseQuestionsFromJob skips identity and maps Stripe-style fields", () => {
  const qs = greenhouseQuestionsFromJob({
    questions: [
      { label: "First Name", required: true, fields: [{ name: "first_name", type: "input_text" }] },
      {
        label: "If this role offers the option to work from a remote location, do you intend to work remotely?",
        required: true,
        fields: [{
          name: "question_48620093",
          type: "multi_value_single_select",
          values: [
            { label: "Yes, I intend to work remotely." },
            { label: "No, I intend to work from an office location." },
          ],
        }],
      },
    ],
  });
  assert.equal(qs.length, 1);
  assert.equal(qs[0].fieldId, "question_48620093");
  assert.equal(qs[0].options[0], "Yes, I intend to work remotely.");
});

test("demographicQuestionsFromJob keeps decline flags", () => {
  const demo = demographicQuestionsFromJob({
    demographic_questions: {
      questions: [{
        id: 99,
        label: "Gender",
        required: true,
        answer_options: [
          { label: "Male" },
          { label: "I don't wish to answer", decline_to_answer: true },
        ],
      }],
    },
  });
  assert.equal(demo[0].id, "99");
  assert.equal(demo[0].options[1].decline, true);
});

test("scoreOption does not match Norway for No", () => {
  assert.ok(scoreOption("No", "No") >= 90);
  assert.equal(scoreOption("Norway", "No"), -1);
  assert.ok(scoreOption("Yes, I intend to work remotely.", "Yes") >= 90);
  assert.ok(scoreOption("I don't wish to answer", "Prefer not to say") >= 90);
});

test("pickApiOption maps Yes onto the remote-work Greenhouse string", () => {
  const opts = ["Yes, I intend to work remotely.", "No, I intend to work from an office location."];
  assert.equal(pickApiOption(opts, "Yes"), "Yes, I intend to work remotely.");
  assert.equal(pickApiOption(opts, "No"), "No, I intend to work from an office location.");
  assert.equal(pickApiOption(["United States", "Canada"], "United States"), "United States");
});

test("pickDecline prefers the ATS decline string", () => {
  assert.match(pickDecline(["Male", "I don't wish to answer", "Female"]), /don't wish/i);
  assert.equal(pickDecline([], "Prefer not to say"), "Prefer not to say");
});

test("education / EEO label detectors", () => {
  assert.equal(isEducationLabel("School"), true);
  assert.equal(isEducationLabel("Degree"), true);
  assert.equal(isEducationLabel("Current employer"), false);
  assert.equal(isEeoLabel("Gender"), true);
  assert.equal(isEeoLabel("Are you authorized to work in the US?"), false);
});

test("controlLooksEmpty treats Select... as empty", () => {
  assert.equal(controlLooksEmpty("Select..."), true);
  assert.equal(controlLooksEmpty("United States"), false);
  assert.equal(stripDialCode("United States +1"), "United States");
});

test("schoolNameTries tries The-prefix then stripped then other schools then Other", () => {
  const tries = schoolNameTries({
    school: "The University of Texas at Arlington",
    school_aliases: ["University of Texas at Arlington"],
    education: [
      { school: "The University of Texas at Arlington" },
      { school: "Gujarat Technological University" },
    ],
  });
  assert.equal(tries[0], "The University of Texas at Arlington");
  assert.ok(tries.includes("University of Texas at Arlington"));
  assert.ok(tries.includes("Gujarat Technological University"));
  assert.equal(tries.at(-1), "Other");
});

test("gender Male does not match Female", () => {
  assert.equal(pickGenderOption(["Female", "Male", "Decline"], "Men"), "Male");
  assert.equal(pickApiOption(["Female", "Male"], "male"), "Male");
});

test("veteran No maps to I am not a veteran", () => {
  assert.equal(pickVeteranOption(["I am a veteran", "I am not a veteran"], "No"), "I am not a veteran");
});

test("eeoAnswer uses profile facts before decline", () => {
  const c = { gender: "Male", hispanic: "No", veteran: "No" };
  assert.equal(eeoAnswer("Gender", c, {}, ["Man", "Woman", "I don't wish to answer"]), "Man");
  assert.equal(eeoAnswer("Hispanic origin", c, {}, ["Yes", "No"]), "No");
  assert.equal(eeoAnswer("Veteran Status", c, {}, ["I am a veteran", "I am not a veteran"]), "I am not a veteran");
  assert.match(eeoAnswer("Race", {}, { eeo_default: "Prefer not to say" }, ["Asian", "I don't wish to answer"]), /don't wish/i);
});

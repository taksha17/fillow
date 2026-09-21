import test from "node:test";
import assert from "node:assert/strict";
import { classifyField, valueTries, answerFromProfile } from "../lib/field-kinds.mjs";

test("classifyField maps Stripe-style labels", () => {
  assert.equal(classifyField("Please select the country where you currently reside."), "work_country");
  assert.equal(classifyField("Please select the country or countries you anticipate working in"), "work_country");
  assert.equal(classifyField("Country*"), "unknown"); // phone dial is separate
  assert.equal(classifyField("Veteran Status"), "veteran");
  assert.equal(classifyField("School"), "school");
  assert.equal(classifyField("Will you require sponsorship?"), "sponsorship");
});

test("valueTries maps United States onto US before Other", () => {
  const tries = valueTries("work_country", "United States", ["Australia", "Canada", "US", "Other"]);
  assert.equal(tries[0], "US");
  assert.ok(tries.includes("United States"));
});

test("valueTries prefers OFCCP veteran string", () => {
  const tries = valueTries("veteran", "No", []);
  assert.equal(tries[0], "I am not a protected veteran");
});

test("answerFromProfile never invents school", () => {
  assert.equal(answerFromProfile("school", {}), "");
  assert.equal(answerFromProfile("school", { school: "UTA" }), "UTA");
  assert.equal(answerFromProfile("sponsorship", { requires_sponsorship: true }), "Yes");
});

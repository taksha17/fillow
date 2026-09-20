import test from "node:test";
import assert from "node:assert/strict";
import {
  greenhouseLocationQuery,
  greenhouseJobMatchesUsSearch,
  parseCandidateLocation,
  applyGreenhouseLocation,
} from "../lib/location.mjs";

const candidate = {
  location: "Plano, TX",
  country_of_residence: "United States",
};

test("Greenhouse location search is city, state, United States", () => {
  assert.deepEqual(parseCandidateLocation("Plano, TX"), {
    city: "Plano",
    state: "Texas",
    country: "United States",
  });
  assert.equal(greenhouseLocationQuery(candidate), "Plano, Texas, United States");
});

test("Greenhouse jobs in the US or remote US pass the location gate", () => {
  assert.equal(greenhouseJobMatchesUsSearch({ location: "US-Remote, Chicago, Seattle" }, candidate), true);
  assert.equal(greenhouseJobMatchesUsSearch({ location: "Plano, TX" }, candidate), true);
  assert.equal(greenhouseJobMatchesUsSearch({ location: "United States" }, candidate), true);
  assert.equal(greenhouseJobMatchesUsSearch({ location: "" }, candidate), true);
});

test("Greenhouse jobs locked outside the US fail the location gate", () => {
  assert.equal(greenhouseJobMatchesUsSearch({ location: "Remote - India" }, candidate), false);
  assert.equal(greenhouseJobMatchesUsSearch({ location: "London, UK" }, candidate), false);
  assert.equal(greenhouseJobMatchesUsSearch({ location: "Toronto, Canada" }, candidate), false);
});

test("Agent 2 stamps the Greenhouse search string on the job", () => {
  const tagged = applyGreenhouseLocation({ location: "US-Remote", ats: "greenhouse" }, candidate);
  assert.equal(tagged.greenhouse_location, "Plano, Texas, United States");
  assert.equal(tagged.greenhouse_location_ok, true);
});

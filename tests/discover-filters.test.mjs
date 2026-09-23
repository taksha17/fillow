import { test } from "node:test";
import assert from "node:assert/strict";
import {
  matchesKeywords,
  matchesLocation,
  matchesTargets,
  postedWithinDays,
  parsePostedDate,
  looksRemote,
  stateAbbr,
} from "../lib/filters.mjs";

test("filters: keyword matching keeps original semantics", () => {
  const targets = { keywords: ["ML Engineer"], exclude_keywords: ["internship"] };
  assert.equal(matchesKeywords({ title: "ML Engineer", location: "Remote", company: "Acme" }, targets), true);
  assert.equal(matchesKeywords({ title: "ML Engineer Internship" }, targets), false);
  assert.equal(matchesKeywords({ title: "Accountant" }, targets), false);
  assert.equal(matchesKeywords({ title: "Anything" }, { keywords: [] }), true);
});

test("filters: empty locations list keeps everything", () => {
  assert.equal(matchesLocation({ location: "Berlin, Germany" }, { locations: [] }), true);
  assert.equal(matchesLocation({ location: "" }, { locations: [] }), true);
});

test("filters: location matching via name, abbreviation, and substring", () => {
  const t = { locations: ["Austin, TX"], remote_ok: false };
  assert.equal(matchesLocation({ location: "Austin, TX, United States" }, t), true);
  assert.equal(matchesLocation({ location: "Remote — Texas" }, { locations: ["Texas"], remote_ok: false }), true);
  assert.equal(matchesLocation({ location: "Dallas, TX" }, { locations: ["Texas"], remote_ok: false }), true);
  assert.equal(matchesLocation({ location: "Toronto, Canada" }, { locations: ["Texas"], remote_ok: false }), false);
  assert.equal(matchesLocation({ location: "Berlin, Germany" }, { locations: ["United States"], remote_ok: false }), false);
});

test("filters: remote jobs pass only when remote_ok", () => {
  const job = { location: "Remote — anywhere" };
  assert.equal(matchesLocation(job, { locations: ["Austin, TX"], remote_ok: true }), true);
  assert.equal(matchesLocation(job, { locations: ["Austin, TX"], remote_ok: false }), false);
  assert.equal(looksRemote("Hybrid — Austin"), false);
});

test("filters: unreadable locations are kept (uncertain-kept)", () => {
  assert.equal(matchesLocation({ location: "" }, { locations: ["Austin, TX"], remote_ok: false }), true);
});

test("filters: posted-date parsing handles ISO, epoch, and relative text", () => {
  const now = new Date("2026-09-23T12:00:00Z").getTime();
  assert.ok(parsePostedDate({ published_at: "2026-09-20T10:00:00Z" }, now));
  assert.ok(parsePostedDate({ posted: "Posted · 3 days ago" }, now));
  assert.equal(parsePostedDate({ posted: "Posted · 3 days ago" }, now).getTime(), now - 3 * 86400_000);
  assert.equal(parsePostedDate({ published_at: "not a date" }, now), null);
  assert.equal(parsePostedDate({}, now), null);
});

test("filters: recency drops only confidently old postings", () => {
  const now = new Date("2026-09-23T12:00:00Z").getTime();
  const recent = { published_at: "2026-09-20" };
  const old = { published_at: "2026-08-01" };
  const unreadable = { published_at: "" };
  assert.equal(postedWithinDays(recent, 30, now), true);
  assert.equal(postedWithinDays(old, 30, now), false);
  assert.equal(postedWithinDays(unreadable, 30, now), true);
  assert.equal(postedWithinDays(old, 0, now), true);
  assert.equal(postedWithinDays({ posted: "45 days ago" }, 30, now), false);
  assert.equal(postedWithinDays({ posted: "2 weeks ago" }, 30, now), true);
});

test("filters: full chain composes keywords + location + recency", () => {
  const targets = {
    keywords: ["ML Engineer"],
    exclude_keywords: [],
    locations: ["United States", "Remote"],
    remote_ok: true,
    posted_within_days: 30,
  };
  const now = new Date("2026-09-23T12:00:00Z").getTime();
  assert.equal(matchesTargets({ title: "ML Engineer", location: "Remote", published_at: "2026-09-22" }, targets), true);
  assert.equal(matchesTargets({ title: "ML Engineer", location: "London, UK", published_at: "2026-09-22" }, targets), false);
  assert.equal(matchesTargets({ title: "ML Engineer", location: "Remote", published_at: "2026-07-01" }, targets), false);
  assert.equal(
    matchesTargets({ title: "ML Engineer", location: "Remote", published_at: "" }, targets),
    true
  );
  assert.equal(matchesTargets({ title: "Accountant", location: "Remote", published_at: "2026-09-22" }, targets), false);
});

test("filters: state abbreviation expansion", () => {
  assert.equal(stateAbbr("Texas"), "tx");
  assert.equal(stateAbbr("texas"), "tx");
  assert.equal(stateAbbr("California"), "ca");
  assert.equal(stateAbbr("Nowhere"), "");
});

import test from "node:test";
import assert from "node:assert/strict";
import { urlFromNotes } from "../lib/tracker.mjs";
import { jobIdTokens, matchJobByUrlTokens } from "../lib/jobs-tsv.mjs";
import { renderResumeMarkdown } from "../lib/resume-pdf.mjs";

test("urlFromNotes extracts the posting URL from tracker notes", () => {
  assert.equal(
    urlFromNotes("DRY_RUN=true; browser skipped https://stripe.com/jobs/search?gh_jid=6042172 \\ \\ \\ \\ | Form filled"),
    "https://stripe.com/jobs/search?gh_jid=6042172"
  );
  assert.equal(urlFromNotes("no url here"), "");
  assert.equal(urlFromNotes(""), "");
});

test("jobIdTokens pulls UUIDs and long numeric ids from a URL", () => {
  const ashby = jobIdTokens("https://jobs.ashbyhq.com/snowflake/87566a4e-d05f-4f9c-b32a-b3c36a6f494a/application");
  assert.ok(ashby.includes("87566a4e-d05f-4f9c-b32a-b3c36a6f494a"));
  const gh = jobIdTokens("https://stripe.com/jobs/search?gh_jid=6042172");
  assert.ok(gh.includes("6042172"));
});

test("matchJobByUrlTokens matches a tracker URL to its jobs.tsv row", () => {
  const jobs = [
    { source: "greenhouse", external_id: "greenhouse:6042172", company: "stripe" },
    { source: "ashby", external_id: "ashby:87566a4e-d05f-4f9c-b32a-b3c36a6f494a", company: "snowflake" },
  ];
  assert.equal(matchJobByUrlTokens("https://stripe.com/jobs/search?gh_jid=6042172", jobs)?.company, "stripe");
  assert.equal(
    matchJobByUrlTokens("https://jobs.ashbyhq.com/snowflake/87566a4e-d05f-4f9c-b32a-b3c36a6f494a/application", jobs)?.company,
    "snowflake"
  );
  assert.equal(matchJobByUrlTokens("https://example.com/nothing", jobs), null);
});

test("renderResumeMarkdown renders sections without inventing content", () => {
  const md = renderResumeMarkdown(
    { full_name: "Ada Lovelace", email: "a@x.com", github: "https://github.com/you" },
    {
      skills: { languages: ["Python"], frameworks: [], tools: [], libraries: [] },
      experience: [{ company: "Example LLC", title: "Engineer", location: "", dates: "Present", bullets: ["Built a thing"] }],
      projects: [],
      education: [{ school: "Example U", degree: "MS CS", location: "", dates: "2024" }],
    }
  );
  assert.match(md, /# Ada Lovelace/);
  assert.match(md, /## Technical Skills/);
  assert.match(md, /\*\*Languages:\*\* Python/);
  assert.match(md, /### Example LLC/);
  assert.match(md, /- Built a thing/);
  assert.match(md, /### Example U/);
});

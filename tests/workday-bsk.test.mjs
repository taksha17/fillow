import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWorkdayPortal, mapWorkdayPosting } from "../lib/workday-bsk.mjs";

test("workday portal: parses host + site from every accepted form", () => {
  const a = parseWorkdayPortal("https://toyota.wd503.myworkdayjobs.com/TMNA");
  assert.deepEqual(
    { host: a.host, tenant: a.tenant, site: a.site },
    { host: "toyota.wd503.myworkdayjobs.com", tenant: "toyota", site: "TMNA" }
  );
  const b = parseWorkdayPortal("att.wd1.myworkdayjobs.com/ATTGeneral");
  assert.equal(b.tenant, "att");
  assert.equal(b.site, "ATTGeneral");
  const c = parseWorkdayPortal("https://acme.wd3.myworkdayjobs.com/en-US/AcmeCareers/");
  assert.equal(c.site, "AcmeCareers");
});

test("workday portal: rejects non-workday and empty entries", () => {
  assert.equal(parseWorkdayPortal(""), null);
  assert.equal(parseWorkdayPortal("https://jobs.ashbyhq.com/acme"), null);
  assert.equal(parseWorkdayPortal(null), null);
});

test("workday posting: maps CXS rows to fillow jobs", () => {
  const portal = parseWorkdayPortal("toyota.wd503.myworkdayjobs.com/TMNA");
  const job = mapWorkdayPosting(
    {
      title: "Sr. Analyst - Vehicle Planning",
      externalPath: "/job/Austin-Texas/Sr-Analyst---Vehicle-Planning_10333276-1",
      locationsText: "Austin, Texas",
      postedOn: "Posted Today",
      bulletFields: ["10333276"],
    },
    portal
  );
  assert.equal(job.source, "workday");
  assert.equal(job.external_id, "workday:10333276");
  assert.equal(job.company, "Toyota");
  assert.equal(job.ats, "workday");
  assert.equal(job.url, "https://toyota.wd503.myworkdayjobs.com/job/Austin-Texas/Sr-Analyst---Vehicle-Planning_10333276-1");
  assert.equal(job.posted, "Posted Today");
});

test("workday posting: rows without id or path are dropped", () => {
  const portal = parseWorkdayPortal("toyota.wd503.myworkdayjobs.com/TMNA");
  assert.equal(mapWorkdayPosting({ title: "x" }, portal), null);
  assert.equal(mapWorkdayPosting({ externalPath: "/job/1", bulletFields: [] }, portal), null);
});

test("workday posting: relative posted text feeds the recency filter", async () => {
  const { postedWithinDays } = await import("../lib/filters.mjs");
  const portal = parseWorkdayPortal("toyota.wd503.myworkdayjobs.com/TMNA");
  const job = mapWorkdayPosting(
    { title: "x", externalPath: "/job/x", locationsText: "", postedOn: "Posted 45 Days Ago", bulletFields: ["1"] },
    portal
  );
  assert.equal(postedWithinDays(job, 30), false);
  assert.equal(postedWithinDays(job, 60), true);
});

import { navigate, evaluate, pause } from "./bsk.mjs";

/**
 * Workday discovery via the Fillow Browser skill.
 *
 * Config entries are portal URLs like "toyota.wd503.myworkdayjobs.com/TMNA"
 * or "https://att.wd1.myworkdayjobs.com/ATTGeneral". The scraper opens the
 * portal in the logged-in Chromium session (auth-gated tenants carry their
 * cookies) and calls the same CXS JSON API the Workday UI itself uses —
 * POST /wday/cxs/{tenant}/{site}/jobs — so it never depends on DOM markup.
 */

const LOCALE_SEGMENTS = new Set(["en-us", "en", "en-gb", "fr-fr", "de-de", "es-es", "ja-jp"]);

/** "https://host/en-US/Site" | "host/Site" → { host, tenant, site, url } | null */
export function parseWorkdayPortal(entry) {
  const raw = String(entry || "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  if (!raw) return null;
  const [host, ...segments] = raw.split("/").filter(Boolean);
  if (!host || !/\.myworkdayjobs\.com$/i.test(host)) return null;
  const tenant = host.split(".")[0].toLowerCase();
  const nonLocale = segments.filter((s) => !LOCALE_SEGMENTS.has(s.toLowerCase()));
  const site = nonLocale[nonLocale.length - 1] || segments[segments.length - 1] || tenant.toUpperCase();
  if (!site) return null;
  return { host, tenant, site, url: `https://${host}/${site}` };
}

/** Map one CXS jobPosting row to a fillow job row. */
export function mapWorkdayPosting(posting = {}, portal = {}) {
  const path = String(posting.externalPath || "");
  const id = String((posting.bulletFields || [])[0] || "");
  if (!path || !id) return null;
  const host = portal.host || "";
  return {
    source: "workday",
    external_id: `workday:${id}`,
    title: String(posting.title || "").trim(),
    company: portal.company || (portal.tenant || "").replace(/^./, (c) => c.toUpperCase()),
    location: String(posting.locationsText || ""),
    description: "",
    url: `https://${host}${path}`,
    apply_url: `https://${host}${path}`,
    board_token: host,
    ats: "workday",
    posted: String(posting.postedOn || ""),
    status: "discovered",
  };
}

/** In-page synchronous XHR — carries the logged-in session's cookies, and returns without needing promise support from evaluate. */
function cxsFetchJs(tenant, site, offset, limit) {
  return `(function(){
    try {
      const x = new XMLHttpRequest();
      x.open("POST", "/wday/cxs/${tenant}/${site}/jobs", false);
      x.setRequestHeader("Content-Type", "application/json");
      x.setRequestHeader("Accept", "application/json");
      x.send(JSON.stringify({ appliedFacets: {}, limit: ${limit}, offset: ${offset}, searchText: "" }));
      return { status: x.status, body: x.responseText };
    } catch (err) {
      return { status: 0, body: String(err && err.message || err) };
    }
  })()`;
}

/**
 * Scrape one Workday portal inside an active bsk session.
 * Navigates to the portal (same-origin for the in-page XHR), pages through
 * the CXS API, returns mapped job rows. Throws on transport errors — callers
 * isolate per-portal failures.
 */
export async function scrapeWorkdayBoard(sessionId, entry, { limitPerBoard = 200 } = {}) {
  const portal = parseWorkdayPortal(entry);
  if (!portal) throw new Error(`workday portal not understood: ${entry}`);
  const perPage = 20;
  const jobs = [];
  let offset = 0;

  await navigate(sessionId, portal.url);
  await pause(1800);

  for (let page = 0; page * perPage < limitPerBoard; page += 1) {
    const res = await evaluate(sessionId, cxsFetchJs(portal.tenant, portal.site, offset, perPage));
    if (!res || res.status !== 200) {
      throw new Error(`workday/${portal.tenant} CXS HTTP ${res?.status ?? "?"}: ${String(res?.body || "").slice(0, 120)}`);
    }
    let data;
    try {
      data = typeof res.body === "string" ? JSON.parse(res.body) : res.body;
    } catch (err) {
      throw new Error(`workday/${portal.tenant} CXS JSON parse failed: ${err.message}`);
    }
    for (const posting of data.jobPostings || []) {
      const job = mapWorkdayPosting(posting, portal);
      if (job) jobs.push(job);
    }
    const total = Number(data.total || 0);
    offset += perPage;
    if (offset >= total || offset >= limitPerBoard || (data.jobPostings || []).length < perPage) break;
    await pause(900);
  }
  return jobs.slice(0, limitPerBoard);
}

/** Scrape every cfg.workday_boards portal with per-portal error isolation + pacing. */
export async function scrapeWorkdayBoards(sessionId, entries = [], { emit = null, limitPerBoard = 200 } = {}) {
  const log = emit ? (message) => emit("log", { message }) : (message) => console.log(message);
  const out = [];
  let index = 0;
  for (const entry of entries) {
    index += 1;
    const portal = parseWorkdayPortal(entry);
    const label = portal ? `${portal.tenant}/${portal.site}` : String(entry);
    try {
      const batch = await scrapeWorkdayBoard(sessionId, entry, { limitPerBoard });
      log(`  workday/${label}: ${batch.length}`);
      out.push(...batch);
    } catch (err) {
      log(`  workday/${label} failed: ${err.message}`);
    }
    if (index < entries.length) await pause(1400 + Math.random() * 600);
  }
  return out;
}

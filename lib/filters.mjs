import { expandUsState } from "./location.mjs";

const REMOTE_RE = /\b(remote|anywhere|distributed|work[ -]?from[ -]?home|wfh)\b/i;

/** Keyword + exclude filter (the original matchesTargets logic, shared with the Worker). */
export function matchesKeywords(job = {}, targets = {}) {
  const hay = `${job.title} ${job.location} ${job.company}`.toLowerCase();
  for (const ex of targets.exclude_keywords || []) {
    if (ex && hay.includes(ex.toLowerCase())) return false;
  }
  const keywords = targets.keywords || [];
  if (!keywords.length) return true;
  return keywords.some((k) => hay.includes(k.toLowerCase()));
}

export function looksRemote(location) {
  return REMOTE_RE.test(String(location || ""));
}

/**
 * Enforce targets.locations at discover time. Empty list keeps everything.
 * A job passes when its location matches any listed place (substring, with
 * US state name/abbreviation expansion) or when it looks remote and
 * remote_ok is on. Unreadable (empty) locations are kept — same
 * uncertain-kept discipline as liveness.
 */
export function matchesLocation(job = {}, targets = {}) {
  const listed = (targets.locations || [])
    .map((l) => String(l || "").toLowerCase().trim())
    .filter(Boolean);
  if (!listed.length) return true;
  const loc = String(job.location || "").toLowerCase().trim();
  if (!loc) return true;
  for (const item of listed) {
    if (loc.includes(item)) return true;
    const state = expandUsState(item);
    if (state && loc.includes(state.toLowerCase())) return true;
    const abbr = stateAbbr(item);
    if (abbr && new RegExp(`(?:^|,|\\s|—|-)${abbr}(?:$|,|\\s|—|-)`, "i").test(loc)) return true;
  }
  if (targets.remote_ok && looksRemote(loc)) return true;
  return false;
}

const ABBR_BY_STATE = {
  alabama: "al", alaska: "ak", arizona: "az", arkansas: "ar", california: "ca", colorado: "co",
  connecticut: "ct", delaware: "de", "district of columbia": "dc", florida: "fl", georgia: "ga",
  hawaii: "hi", idaho: "id", illinois: "il", indiana: "in", iowa: "ia", kansas: "ks",
  kentucky: "ky", louisiana: "la", maine: "me", maryland: "md", massachusetts: "ma",
  michigan: "mi", minnesota: "mn", mississippi: "ms", missouri: "mo", montana: "mt",
  nebraska: "ne", nevada: "nv", "new hampshire": "nh", "new jersey": "nj", "new mexico": "nm",
  "new york": "ny", "north carolina": "nc", "north dakota": "nd", ohio: "oh", oklahoma: "ok",
  oregon: "or", pennsylvania: "pa", "rhode island": "ri", "south carolina": "sc",
  "south dakota": "sd", tennessee: "tn", texas: "tx", utah: "ut", vermont: "vt",
  virginia: "va", washington: "wa", "west virginia": "wv", wisconsin: "wi", wyoming: "wy",
};

/** Reverse of expandUsState for the common states ("Texas" → "tx"). */
export function stateAbbr(name) {
  const key = String(name || "").toLowerCase().replace(/\./g, "").trim();
  return ABBR_BY_STATE[key] || "";
}

/**
 * Parse a posting date into a Date when it can be read with confidence
 * (ISO/ymd, or relative text like "Posted · 3 days ago"). Returns null
 * when unparseable — callers keep those jobs (uncertain-kept).
 */
export function parsePostedDate(job = {}, now = Date.now()) {
  const raw = String(job.published_at || job.posted || "").trim();
  if (!raw) return null;
  const rel = raw.match(/(\d+)\s*(day|hour|week|month)s?\s*ago/i);
  if (rel) {
    const n = Number(rel[1]);
    const unitMs = { day: 86400_000, hour: 3600_000, week: 7 * 86400_000, month: 30 * 86400_000 }[rel[2].toLowerCase()];
    return new Date(now - n * unitMs);
  }
  if (/yesterday/i.test(raw)) return new Date(now - 86400_000);
  if (/today|just (now|posted)/i.test(raw)) return new Date(now);
  const iso = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const d = new Date(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const epoch = Number(raw);
  if (Number.isFinite(epoch) && epoch > 1e12) return new Date(epoch);
  return null;
}

/** Drop postings confidently older than N days; unparseable dates are kept. */
export function postedWithinDays(job = {}, days, now = Date.now()) {
  const n = Number(days);
  if (!n || n <= 0) return true;
  const d = parsePostedDate(job, now);
  if (!d) return true;
  return now - d.getTime() <= n * 86400_000;
}

/** Full discover-time filter chain (keywords, locations/remote, recency). */
export function matchesTargets(job = {}, targets = {}) {
  if (!matchesKeywords(job, targets)) return false;
  if (!matchesLocation(job, targets)) return false;
  if (!postedWithinDays(job, targets.posted_within_days)) return false;
  return true;
}

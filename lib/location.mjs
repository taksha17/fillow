const US_STATES = {
  al: "Alabama",
  ak: "Alaska",
  az: "Arizona",
  ar: "Arkansas",
  ca: "California",
  co: "Colorado",
  ct: "Connecticut",
  de: "Delaware",
  dc: "District of Columbia",
  fl: "Florida",
  ga: "Georgia",
  hi: "Hawaii",
  id: "Idaho",
  il: "Illinois",
  in: "Indiana",
  ia: "Iowa",
  ks: "Kansas",
  ky: "Kentucky",
  la: "Louisiana",
  me: "Maine",
  md: "Maryland",
  ma: "Massachusetts",
  mi: "Michigan",
  mn: "Minnesota",
  ms: "Mississippi",
  mo: "Missouri",
  mt: "Montana",
  ne: "Nebraska",
  nv: "Nevada",
  nh: "New Hampshire",
  nj: "New Jersey",
  nm: "New Mexico",
  ny: "New York",
  nc: "North Carolina",
  nd: "North Dakota",
  oh: "Ohio",
  ok: "Oklahoma",
  or: "Oregon",
  pa: "Pennsylvania",
  ri: "Rhode Island",
  sc: "South Carolina",
  sd: "South Dakota",
  tn: "Tennessee",
  tx: "Texas",
  ut: "Utah",
  vt: "Vermont",
  va: "Virginia",
  wa: "Washington",
  wv: "West Virginia",
  wi: "Wisconsin",
  wy: "Wyoming",
};

const STATE_BY_NAME = Object.fromEntries(Object.values(US_STATES).map((name) => [name.toLowerCase(), name]));

const FOREIGN_ONLY = [
  "united kingdom",
  "great britain",
  "england",
  "scotland",
  "london",
  "toronto",
  "vancouver",
  "canada",
  "germany",
  "berlin",
  "munich",
  "france",
  "paris",
  "ireland",
  "dublin",
  "israel",
  "tel aviv",
  "singapore",
  "australia",
  "sydney",
  "melbourne",
  "japan",
  "tokyo",
  "brazil",
  "sao paulo",
  "mexico city",
  "netherlands",
  "amsterdam",
  "sweden",
  "stockholm",
  "switzerland",
  "zurich",
  "bangalore",
  "bengaluru",
  "hyderabad",
  "pune",
  "mumbai",
  "delhi",
];

function norm(text) {
  return String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function expandUsState(token) {
  const t = norm(token).replace(/\./g, "");
  if (!t) return "";
  if (US_STATES[t]) return US_STATES[t];
  if (STATE_BY_NAME[t]) return STATE_BY_NAME[t];
  return "";
}

export function parseCandidateLocation(location) {
  const raw = String(location || "").replace(/\s*\/\s*.*$/, "").trim();
  if (!raw) return { city: "", state: "", country: "United States" };
  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 1) {
    const state = expandUsState(parts[0]);
    return state ? { city: "", state, country: "United States" } : { city: parts[0], state: "", country: "United States" };
  }
  const state = expandUsState(parts[parts.length - 1]) || expandUsState(parts[parts.length - 1].split(/\s+/).pop());
  const city = parts.slice(0, state ? -1 : undefined).join(", ");
  return { city, state, country: "United States" };
}

export function greenhouseLocationQuery(candidate = {}) {
  const parsed = parseCandidateLocation(candidate.location);
  const city = parsed.city || "";
  const state = parsed.state || "";
  const country = candidate.country_of_residence || parsed.country || "United States";
  return [city, state, country].filter(Boolean).join(", ");
}

export function greenhouseJobMatchesUsSearch(job = {}, candidate = {}) {
  const loc = norm(job.location);
  if (!loc) return true;
  const parsed = parseCandidateLocation(candidate.location);
  const city = norm(parsed.city);
  const state = norm(parsed.state);
  const stateAbbr = Object.entries(US_STATES).find(([, name]) => name.toLowerCase() === state)?.[0] || "";

  const namedForeign = FOREIGN_ONLY.some((f) => loc.includes(f)) || (/\bindia\b/.test(loc) && !/\bindiana\b/.test(loc));
  const usExplicit = /\bunited states\b|\bu\.?s\.?a\.?\b|\bus-remote\b|\bremote us\b|\bus remote\b|\bus-/.test(loc);
  const usHit =
    usExplicit ||
    (/\bremote\b/.test(loc) && !namedForeign) ||
    (city && loc.includes(city)) ||
    (state && loc.includes(state)) ||
    (stateAbbr && new RegExp(`\\b${stateAbbr}\\b`).test(loc));

  if (namedForeign && !usExplicit) return false;
  return true;
}

export function applyGreenhouseLocation(job, candidate) {
  const query = greenhouseLocationQuery(candidate);
  const ok = greenhouseJobMatchesUsSearch(job, candidate);
  return {
    ...job,
    greenhouse_location: query,
    greenhouse_location_ok: ok,
  };
}

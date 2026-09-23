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
  "montreal",
  "quebec",
  "ottawa",
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
  "thailand",
  "bangkok",
  "spain",
  "barcelona",
  "madrid",
  "portugal",
  "lisbon",
  "poland",
  "warsaw",
  "italy",
  "milan",
  "rome",
  "belgium",
  "brussels",
  "austria",
  "vienna",
  "denmark",
  "copenhagen",
  "norway",
  "oslo",
  "finland",
  "helsinki",
  "czech",
  "prague",
  "romania",
  "bucharest",
  "hungary",
  "budapest",
  "turkey",
  "istanbul",
  "uae",
  "dubai",
  "hong kong",
  "taiwan",
  "taipei",
  "korea",
  "seoul",
  "china",
  "shanghai",
  "beijing",
  "philippines",
  "manila",
  "vietnam",
  "indonesia",
  "malaysia",
  "pakistan",
  "bangladesh",
  "argentina",
  "chile",
  "colombia",
  "south africa",
  "nigeria",
  "kenya",
  "egypt",
  "new zealand",
  "auckland",
];

/** ISO-ish country tokens after a comma that are not US state abbreviations. */
const FOREIGN_COUNTRY_CODE =
  /,\s*(uk|gb|qc|th|nl|be|ch|se|no|dk|fi|nz|au|sg|jp|cn|kr|tw|hk|ae|tr|pl|cz|ro|hu|at|pt|es|it|fr|ie|br|mx|cl|za|ph|vn|my|pk|bd|eg|ng|ke|uae)\b/i;

function namedForeignLocation(loc) {
  return (
    FOREIGN_ONLY.some((f) => loc.includes(f))
    || (/\bindia\b/.test(loc) && !/\bindiana\b/.test(loc))
    || (/\bmexico\b/.test(loc) && !/\bnew mexico\b/.test(loc))
    || FOREIGN_COUNTRY_CODE.test(loc)
  );
}

function norm(text) {
  return String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function hasUsStateOrCitySignal(loc) {
  if (/\bunited states\b|\bu\.?s\.?a\.?\b|\bus-remote\b|\bremote[ -]?us\b|\bus[ -]?remote\b|\bus only\b/.test(loc)) {
    return true;
  }
  for (const [abbr, name] of Object.entries(US_STATES)) {
    if (loc.includes(name.toLowerCase())) return true;
    if (new RegExp(`(?:^|,|\\s|—|-)${abbr}(?:$|,|\\s|—)`, "i").test(loc)) return true;
  }
  return false;
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

  const namedForeign = namedForeignLocation(loc);
  const usExplicit = hasUsStateOrCitySignal(loc);
  const usHit =
    usExplicit ||
    (/\bremote\b/.test(loc) && !namedForeign) ||
    (city && loc.includes(city)) ||
    (state && loc.includes(state)) ||
    (stateAbbr && new RegExp(`\\b${stateAbbr}\\b`).test(loc));

  if (namedForeign && !usExplicit) return false;
  void usHit;
  return true;
}

/**
 * Strict US-only gate for MyGreenhouse (and similar scrapes).
 * Rejects foreign cities/countries; requires a US or Remote (non-foreign) signal.
 */
export function isUsJobLocation(job = {}) {
  const loc = norm(job.location);
  if (!loc) return false;
  if (namedForeignLocation(loc)) return false;
  if (/\b(emea|apac|latam|europe|asia[- ]pacific|worldwide|global(?!\s*us))\b/.test(loc)) {
    return false;
  }
  if (hasUsStateOrCitySignal(loc)) return true;
  // "Remote" / "Hybrid" with no foreign country → allow (MGH search is US-scoped)
  if (/\b(remote|hybrid|united states)\b/.test(loc)) return true;
  return false;
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

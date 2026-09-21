/**
 * Cross-ATS field kinds + value aliases.
 * Ported from incident patterns in ChamPro/ats-autofill + auto-apply:
 * mis-mapping is worse than leaving empty; option match must use ATS strings.
 */

import { countryAliases, pickApiOption, pickGenderOption, pickVeteranOption, scoreOption } from "./form-controls.mjs";

export function classifyField(label = "") {
  const q = String(label || "").toLowerCase();
  if (!q) return "unknown";
  if (/\bphone\b/.test(q) && /country|code|dial|calling/.test(q)) return "phone_country";
  if (
    (q.includes("country") && (q.includes("reside") || q.includes("residence") || q.includes("live")))
    || q.includes("currently reside")
    || (q.includes("anticipate") && q.includes("working"))
    || (q.includes("countries you") && q.includes("work"))
  ) {
    return "work_country";
  }
  if ((q.includes("city") && q.includes("state")) || (q.includes("city") && q.includes("reside"))) return "city_state";
  if (q.includes("passport")) return "passport";
  if (/\bgender\b|\bsex\b/.test(q) && !q.includes("orientation")) return "gender";
  if (/hispanic|latino|latina|latinx/.test(q)) return "hispanic";
  if (/veteran/.test(q)) return "veteran";
  if (/disability/.test(q)) return "disability";
  if (/\brace\b|ethnicity|ethnic/.test(q)) return "race";
  if (/\b(school|university|college)\b/.test(q) && !/\bdegree\b/.test(q)) return "school";
  if (/\b(degree|discipline|field of study)\b/.test(q)) return "degree";
  if (/sponsor|immigration/.test(q)) return "sponsorship";
  if (/authorized to work|legally authorized|work authorization/.test(q)) return "work_auth";
  if (/work remotely|intend to work remotely|plan to work remote/.test(q)) return "remote";
  if (/whatsapp|text message|\bsms\b/.test(q)) return "messaging_opt_in";
  if (/hear about|where did you hear|vacancy/.test(q)) return "how_heard";
  if (/ever been employed|previously employed|worked for this|former employee/.test(q)) return "prior_employee";
  if (/job title/.test(q)) return "job_title";
  if (/(current|previous).*(employer|company)/.test(q) || (q.includes("employer") && q.includes("current"))) {
    return "employer";
  }
  if (/linkedin/.test(q) && !/hear/.test(q)) return "linkedin";
  if (/github/.test(q) && !/hear/.test(q)) return "github";
  if (/\bi agree\b|terms and conditions|privacy policy|consent/.test(q)) return "consent";
  if (/describe|explain|tell us|why |essay|cover letter/.test(q)) return "free_text";
  return "unknown";
}

/** Ordered try-strings for a profile answer against live ATS options. */
export function valueTries(kind, want, options = []) {
  const raw = String(want || "").trim();
  if (!raw) return [];
  const tries = [];
  const seen = new Set();
  const push = (v) => {
    const t = String(v || "").trim();
    if (!t) return;
    const k = t.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    tries.push(t);
  };

  const aligned = pickApiOption(options, raw);
  if (aligned) push(aligned);
  if (kind !== "veteran") push(raw);

  if (kind === "work_country" || kind === "passport") {
    for (const a of countryAliases(raw)) push(a.length <= 3 ? a.toUpperCase() : a.replace(/\b\w/g, (c) => c.toUpperCase()));
    push("US");
    push("USA");
    push("United States");
    push("Other");
  }
  if (kind === "gender") {
    const g = pickGenderOption(options, raw);
    if (g) push(g);
    for (const a of ["Male", "Man", "Men", "Female", "Woman", "Women"]) push(a);
  }
  if (kind === "veteran") {
    const v = pickVeteranOption(options, raw);
    if (v) push(v);
    for (const a of [
      "I am not a protected veteran",
      "I am not a veteran",
      "I identify as one or more of the classifications of a protected veteran",
      "No",
      "Yes",
    ]) push(a);
    push(raw);
  }
  if (kind === "hispanic") {
    push(pickApiOption(options, raw) || raw);
    push("No");
    push("Yes");
  }
  if (kind === "work_auth" || kind === "sponsorship" || kind === "prior_employee" || kind === "messaging_opt_in" || kind === "remote") {
    push(pickApiOption(options, raw) || raw);
    if (/^y/i.test(raw)) push("Yes");
    if (/^n/i.test(raw)) push("No");
  }
  if (kind === "school") {
    push(raw);
    push(raw.replace(/^the\s+/i, ""));
    push("Other");
  }
  if (kind === "consent") {
    for (const lab of options) {
      if (/acknowledge|agree|accept|understood/i.test(lab)) push(lab);
    }
    push("I acknowledge");
    push("I agree");
    push("Yes");
  }

  if (options.length) {
    // Prefer tries that actually exist in the option list (or score well).
    const ranked = tries
      .map((t) => ({ t, s: Math.max(...options.map((o) => scoreOption(o, t)), -1) }))
      .filter((x) => x.s >= 40 || !options.length)
      .sort((a, b) => b.s - a.s);
    if (ranked.length) return [...new Set(ranked.map((x) => x.t))];
  }
  return tries;
}

export function answerFromProfile(kind, candidate = {}, prefs = {}) {
  switch (kind) {
    case "work_country":
    case "passport":
      return candidate.country_of_residence || candidate.passport_country || "United States";
    case "city_state":
      return candidate.greenhouse_location || candidate.location || "";
    case "gender":
      return candidate.gender || "";
    case "hispanic":
      return candidate.hispanic !== undefined && candidate.hispanic !== "" ? String(candidate.hispanic) : "";
    case "veteran":
      return candidate.veteran !== undefined && candidate.veteran !== "" ? String(candidate.veteran) : "";
    case "school":
      return candidate.school || candidate.education?.[0]?.school || "";
    case "degree":
      return candidate.degree || candidate.education?.[0]?.degree || "";
    case "sponsorship":
      return candidate.requires_sponsorship ? "Yes" : "No";
    case "work_auth":
      return "Yes";
    case "remote":
      return "Yes";
    case "messaging_opt_in":
      return "No";
    case "prior_employee":
      return "No";
    case "job_title":
      return candidate.current_title || "";
    case "employer":
      return candidate.current_company || "";
    case "linkedin":
      return candidate.linkedin || "";
    case "github":
      return candidate.github || "";
    case "how_heard":
      return prefs.how_heard || "Linkedin";
    case "consent":
      return "I acknowledge";
    default:
      return "";
  }
}

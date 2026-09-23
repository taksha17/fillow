import { eeoAnswer, isAgreeLabel, isEducationLabel, isEeoLabel, pickApiOption, pickGenderOption, pickVeteranOption } from "./form-controls.mjs";
import { qaBankAnswer } from "./stuck-questions.mjs";

const FREE_TEXT_MARKERS = ["describe", "explain", "tell us", "write", "essay", "paragraph"];

export function profileLockedAnswer(question, candidate) {
  const q = (question || "").toLowerCase().trim();
  if (q.includes("passport")) return (candidate.passport_country || "").trim() || null;
  if (
    q.includes("country of residence")
    || (q.includes("country") && (q.includes("residence") || q.includes("reside")))
    || q.includes("currently reside")
    || (q.includes("anticipate") && q.includes("working"))
  ) {
    return (candidate.country_of_residence || "").trim() || null;
  }
  if ((q.includes("city") && q.includes("state")) || (q.includes("city") && q.includes("reside"))) {
    return (candidate.greenhouse_location || candidate.location || "").trim() || null;
  }
  if (/^(preferred|legal)\s+first\s+name\b/.test(q) || q === "first name") {
    return (candidate.first_name || "").trim() || null;
  }
  if (/^(preferred|legal)\s+last\s+name\b/.test(q) || q === "last name") {
    return (candidate.last_name || "").trim() || null;
  }
  if (/^(legal\s+)?name\b/.test(q) && !q.includes("company") && !q.includes("school")) {
    return (candidate.full_name || `${candidate.first_name || ""} ${candidate.last_name || ""}`.trim()).trim() || null;
  }
  if (/^email\b|email address/.test(q)) return (candidate.email || "").trim() || null;
  if (/^phone\b|phone number|mobile/.test(q)) return (candidate.phone || "").trim() || null;
  if (q === "github" || q === "github profile" || (q.startsWith("github") && !q.includes("hear"))) {
    return (candidate.github || "").trim() || null;
  }
  if (q === "linkedin" || (q.startsWith("linkedin") && !q.includes("hear") && !q.includes("vacancy"))) {
    return (candidate.linkedin || "").trim() || null;
  }
  return null;
}

export function preferenceForcedYesNo(question, prefs, { allowFreeText = false, options = null } = {}) {
  if (!prefs) return null;
  const q = (question || "").toLowerCase();
  if (!allowFreeText && FREE_TEXT_MARKERS.some((k) => q.includes(k))) return null;
  // Never force Yes/No onto multi-option radios (export control, work-auth variants, etc.)
  if (Array.isArray(options) && options.length >= 2) {
    const ynOnly = options.every((o) => /^(yes|no)\b/i.test(String(o).trim()));
    if (!ynOnly) return null;
  }
  // Substring traps: "assessment" in "export compliance assessment", etc.
  if (
    q.includes("export administration")
    || q.includes("u.s. person")
    || q.includes("us person")
    || (q.includes("export") && q.includes("subject to"))
    // "authorized to work" always_yes must not override sponsorship-aware Yes/No.
    || q.includes("sponsor")
    || q.includes("sponsorship")
    || q.includes("immigration")
    || q.includes("visa")
  ) {
    return null;
  }
  for (const needle of prefs.always_no || []) {
    if (needle && q.includes(needle.toLowerCase())) return "No";
  }
  for (const needle of prefs.always_yes || []) {
    if (needle && q.includes(needle.toLowerCase())) return "Yes";
  }
  return null;
}

export function claimForQuestion(question, prefs) {
  if (!prefs?.claims) return null;
  const q = (question || "").toLowerCase();
  const claims = prefs.claims;
  if (["react", "javascript", "typescript", "frontend", "front-end", "next.js"].some((k) => q.includes(k))) {
    return (claims.frontend || "").trim() || null;
  }
  if (["backend", "api", "python", "infra", "distributed"].some((k) => q.includes(k))) {
    return (claims.backend || "").trim() || null;
  }
  if (["describe", "proficiency", "experience", "highlight", "exceptional"].some((k) => q.includes(k))) {
    return (claims.general || claims.frontend || claims.backend || "").trim() || null;
  }
  return null;
}

export function heuristicAnswer(question, candidate, job = {}, prefs = {}, options = []) {
  const locked = profileLockedAnswer(question, candidate);
  if (locked) return pickApiOption(options, locked) || locked;
  const q = (question || "").toLowerCase();

  // Curated reference bank (stuck → lasting answers). Still below profile locks.
  // Sponsorship/right-to-work answers depend on candidate facts the engine owns — the bank never hijacks them.
  const banked = /\bsponsor|source of (?:your )?right to work/.test(q) ? null : qaBankAnswer(question);
  if (banked) return pickApiOption(options, banked) || banked;

  // Export-control / U.S. person radios — before always_yes ("assessment" substring trap).
  if (
    q.includes("u.s. person")
    || q.includes("us person")
    || q.includes("export administration")
    || (q.includes("export") && (q.includes("subject to") || q.includes("cuba") || q.includes("iran")))
  ) {
    if (options.length) {
      const usCitizen = /united states|u\.s\.|usa/i.test(candidate.passport_country || "")
        && !candidate.requires_sponsorship;
      if (usCitizen) {
        const hit = options.find((o) => /i am a u\.s\. person|i am a us person/i.test(String(o)));
        if (hit) return hit;
      }
      const notEmbargo = options.find((o) => {
        const ol = String(o).toLowerCase();
        return /not a u\.s\. person|not a us person/.test(ol)
          && /not a current citizen or permanent resident of cuba|not.*(cuba.*iran|iran.*cuba)/.test(ol);
      });
      if (notEmbargo) return notEmbargo;
      const none = options.find((o) => /none of the above/i.test(String(o)));
      if (none) return none;
    }
    return "I am not a U.S. person";
  }

  const forced = preferenceForcedYesNo(question, prefs, { options });
  if (forced) return pickApiOption(options, forced) || forced;
  const claim = claimForQuestion(question, prefs);

  if (isEeoLabel(question)) {
    return eeoAnswer(question, candidate, prefs, options);
  }
  if (isEducationLabel(question)) {
    const edu = (candidate.education || [])[0];
    if (!edu?.school) return "";
    if (/\b(degree|discipline|field of study)\b/.test(q)) return edu.degree || "";
    if (/\b(graduation|dates|year)\b/.test(q)) return edu.dates || "";
    return edu.school;
  }
  if (isAgreeLabel(question)) return pickApiOption(options, "I agree") || "I agree";
  if (q.includes("non-compete") || q.includes("non-solicitation")) return pickApiOption(options, "No") || "No";

  if (["portfolio", "website", "code sample", "twitter", "x profile"].some((k) => q.includes(k))) {
    return candidate.github || candidate.linkedin || "";
  }
  if (q.includes("hear about") || q.includes("where did you hear") || q.includes("vacancy") || q.includes("how did you hear")) {
    return pickApiOption(options, prefs.how_heard || "Linkedin")
      || pickApiOption(options, "LinkedIn")
      || pickApiOption(options, "Google job search")
      || prefs.how_heard
      || "LinkedIn";
  }
  if (q.includes("employment agreement") || q.includes("post-employment restriction") || q.includes("non-compete")) {
    return pickApiOption(options, "No") || "No";
  }
  if ((q.includes("poland") || q.includes("united kingdom") || q.includes("the uk")) && (q.includes("currently") || q.includes("located") || q.includes("location in"))) {
    return pickApiOption(options, "No") || "No";
  }
  if (q.includes("at least 18") || q.includes("18 years of age")) return pickApiOption(options, "Yes") || "Yes";
  if (q.includes("government official") || q.includes("close relative of a government")) {
    return pickApiOption(options, "No")
      || options.find((o) => /not a (current or former )?government|not a relative/i.test(String(o)))
      || "No";
  }
  if (q.includes("referred") && (q.includes("senior leader") || q.includes("decision"))) {
    return pickApiOption(options, "No") || "No";
  }
  if ((q.includes("significant fi") || q.includes("financial")) && (q.includes("relative") || q.includes("hold a role"))) {
    return pickApiOption(options, "No") || "No";
  }
  if (q.includes("confirm receipt") || (q.includes("privacy notice") && q.includes("arbitration"))) {
    return pickApiOption(options, "Confirmed") || pickApiOption(options, "Yes") || "Confirmed";
  }
  if (q.includes("use ai tools") && (q.includes("how you") || q.includes("which of the following"))) {
    return (
      options.find((o) => /regularly use ai|design or automate workflows/i.test(String(o)))
      || pickApiOption(options, "I regularly use AI tools")
      || options[options.length - 2]
      || "Yes"
    );
  }
  if (q.includes("coinbase may use ai") || (q.includes("ai tools to assist") && q.includes("application"))) {
    return pickApiOption(options, "Yes") || "Yes";
  }
  if (q.includes("clearance eligibility") || (q.includes("eligible") && q.includes("security clearance"))) {
    return pickApiOption(options, "Yes, I am eligible for a U.S. security clearance")
      || options.find((o) => /eligible/i.test(String(o)) && !/active/i.test(String(o)))
      || pickApiOption(options, "Yes")
      || "Yes";
  }
  if (q.includes("clearance level") || (q.includes("held a") && q.includes("clearance"))) {
    return pickApiOption(options, "N/A")
      || options.find((o) => /n\/a|never held/i.test(String(o)))
      || "N/A - have never held U.S. security clearance";
  }
  if (q.includes("export control") || (q.includes("itars") || q.includes("ear") && q.includes("access to information"))) {
    if (options.length) {
      const none = options.find((o) => /none of the above/i.test(String(o)));
      if (none) return none;
    }
  }
  if (q.includes("history with") && q.includes("anduril")) return pickApiOption(options, "No") || "No";
  if (q.includes("conflict of interest")) return pickApiOption(options, "No") || "No";
  if (q.includes("previously been employed") || (q.includes("ever been employed by") && !q.includes("this company"))) {
    return pickApiOption(options, "No") || "No";
  }
  if (
    (q.includes("cities") && q.includes("available"))
    || (q.includes("what cities") && q.includes("work"))
  ) {
    for (const tryCity of ["Dallas", "Austin", "Remote", "New York", "San Francisco", "Atlanta", "Seattle"]) {
      const hit = pickApiOption(options, tryCity);
      if (hit) return hit;
    }
    return options.find((o) => /dallas|remote|austin/i.test(String(o))) || options[0] || "Remote";
  }
  if (q.includes("languages you speak") || (q.includes("speak fluently") && q.includes("language"))) {
    return pickApiOption(options, "English") || "English";
  }
  if (
    q.includes("certify") && (q.includes("true and correct") || q.includes("information provided"))
  ) {
    return pickApiOption(options, "Yes") || "Yes";
  }
  if (q.includes("source of your right to work") || (q.includes("right to work") && q.includes("source"))) {
    if (options.length) {
      const need = candidate.requires_sponsorship;
      const hit = options.find((o) => {
        const ol = String(o).toLowerCase();
        if (need) return /require sponsorship|will require sponsorship|do not currently have/i.test(ol);
        return /citizen or permanent resident|unlimited right to work/i.test(ol);
      });
      if (hit) return hit;
    }
    return candidate.requires_sponsorship
      ? "I do not currently have an unlimited right to work where this role is listed and will require sponsorship"
      : "Citizen or permanent resident where this role is listed";
  }
  if (
    (q.includes("location") && (q.includes("intend") || q.includes("work from") || q.includes("based")))
    || q.includes("where will you work")
    || q.includes("work location")
  ) {
    return (
      pickApiOption(options, candidate.work_location_intent || candidate.location || "United States")
      || candidate.work_location_intent
      || candidate.location
      || "United States (remote OK)"
    );
  }
  if ((q.includes("recording") && q.includes("consent")) || (q.includes("interview") && q.includes("consent"))) {
    return pickApiOption(options, "Yes") || pickApiOption(options, "I consent") || "Yes";
  }
  if (isAgreeLabel(question) || (q.includes("consent") && !q.includes("data share"))) {
    return pickApiOption(options, "Yes") || pickApiOption(options, "I agree") || "Yes";
  }
  if (q.includes("sponsor") || q.includes("immigration")) {
    // "authorized … without company sponsorship?" → No when we need sponsorship.
    if (candidate.requires_sponsorship && q.includes("without") && (q.includes("sponsor") || q.includes("visa"))) {
      return pickApiOption(options, "No") || "No";
    }
    if (options.length) {
      if (candidate.requires_sponsorship) {
        const us = options.find((o) => /h-?1b|h1b|f-1|opt|uscis|united states|usa/i.test(String(o)) && /yes/i.test(String(o)));
        if (us) return us;
        const genericYes = options.find((o) => /^yes$/i.test(String(o).trim()));
        if (genericYes) return genericYes;
        const anyYes = options.find((o) => /^yes/i.test(String(o)) && !/netherlands|ireland|eu blue|uk|germany|canada/i.test(String(o)));
        if (anyYes) return anyYes;
      }
      const yn = candidate.requires_sponsorship ? "Yes" : "No";
      return pickApiOption(options, yn) || yn;
    }
    return candidate.requires_sponsorship ? "Yes" : "No";
  }
  if (q.includes("relocation") || (q.includes("relocat") && q.includes("open"))) {
    return pickApiOption(options, "Yes") || "Yes";
  }
  if (q.includes("polygraph") || (q.includes("clearance") && (q.includes("active") || q.includes("hold") || q.includes("have")))) {
    return pickApiOption(options, "No") || "No";
  }
  if (q.includes("maryland") || (q.includes("on-site") && q.includes("client"))) {
    return pickApiOption(options, "No") || "No";
  }
  if ((q.includes("office") && q.includes("three days")) || (q.includes("work from") && q.includes("office"))) {
    return pickApiOption(options, "Yes") || "Yes";
  }
  if (q.includes("when can you start") || (q.includes("start") && q.includes("new role"))) {
    const d = new Date();
    d.setDate(d.getDate() + 21);
    return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
  }
  if ((q.includes("office") || q.includes("workplace")) && (q.includes("work from") || q.includes("could you"))) {
    return pickApiOption(options, "Remote") || "Remote";
  }
  if (q.includes("arbitration") || q.includes("hereby certify") || (q.includes("acknowledge") && q.includes("agreement"))) {
    return pickApiOption(options, options[0]) || options[0] || "I acknowledge";
  }
  if (/\backnowledge\b/.test(q) || (q.includes("by clicking") && q.includes("acknowledge")) || (q.includes("by checking") && q.includes("confirm"))) {
    return pickApiOption(options, "Acknowledge") || pickApiOption(options, "Yes") || options[0] || "Acknowledge";
  }
  if (q.includes("authorized to work") || q.includes("legally authorized") || q.includes("legally authorised") || q.includes("work authorization")) {
    const need = candidate.requires_sponsorship;
    // "…without company sponsorship?" is a sponsorship question, not generic work auth.
    if (need && (q.includes("without") && q.includes("sponsor"))) {
      return pickApiOption(options, "No") || "No";
    }
    // Prefer the option that matches sponsorship reality when Ashby/Greenhouse lists long Yes variants.
    if (options.length) {
      const hit = options.find((o) => {
        const ol = String(o).toLowerCase();
        if (need) {
          return (/yes/i.test(ol) && /sponsor|visa|immigration|need sponsorship/i.test(ol))
            || /need sponsorship now|sponsorship in the future/i.test(ol);
        }
        return (/yes/i.test(ol) && !/sponsor|visa|immigration/i.test(ol))
          || /no restriction/i.test(ol);
      }) || options.find((o) => /^yes/i.test(String(o)));
      if (hit) {
        // Prefer "need sponsorship now" over "in the future" when requires_sponsorship.
        if (need) {
          const now = options.find((o) => /need sponsorship now/i.test(String(o)));
          if (now) return now;
        }
        return hit;
      }
    }
    return "Yes";
  }
  if (q.includes("zip") || q.includes("postal code")) {
    return candidate.zip_code || candidate.postal_code || candidate.zip || "";
  }
  if (
    (q.includes("state") && (q.includes("working from") || q.includes("work from") || q.includes("based")))
    || q.includes("state you will be")
  ) {
    const loc = candidate.location || candidate.work_location_intent || "";
    const state = (loc.match(/,\s*([A-Z]{2})\b/) || [])[1]
      || (/texas|\btx\b/i.test(loc) ? "Texas" : "")
      || loc;
    return pickApiOption(options, state) || pickApiOption(options, "TX") || pickApiOption(options, "Texas") || state;
  }
  if (
    (q.includes("years") && (q.includes("industry") || q.includes("experience") || q.includes("professional")))
    || q.includes("how many years")
  ) {
    const years = String(candidate.years_experience || "").replace(/years?/i, "").trim() || "3–4";
    return pickApiOption(options, years) || pickApiOption(options, "3") || years;
  }
  if (
    (q.includes("san francisco") || q.includes("sfba") || q.includes("new york") || q.includes("nyc"))
    && (q.includes("based") || q.includes("office") || q.includes("come into"))
  ) {
    return pickApiOption(options, "No") || "No";
  }
  if (
    (q.includes("not based") && q.includes("relocate"))
    || (q.includes("where you are currently located") && q.includes("relocate"))
  ) {
    const loc = candidate.location || "Plano, TX";
    return `${loc}. Yes — willing to relocate for this role.`;
  }
  if (
    q.includes("user-facing product") || q.includes("product feature you have led")
    || (q.includes("describe") && q.includes("product feature"))
  ) {
    return (
      (prefs.claims?.backend || "").trim()
      || (prefs.claims?.general || "").trim()
      || "Shipped LLM + RAG product search and real-time ML ranking/personalization services with measurable latency and relevance gains; see resume for metrics."
    );
  }
  if (q.includes("preference on which team") || (q.includes("which team") && q.includes("join"))) {
    const pref = String(candidate.office_preference || prefs.office_preference || "any").toLowerCase();
    if (pref === "any" || pref === "open" || pref === "flexible") {
      return (
        pickApiOption(options, "Any")
        || pickApiOption(options, "No preference")
        || pickApiOption(options, "Open to any")
        || options.find((o) => /any|no preference|open to all|flexible/i.test(String(o)))
        || "Any / open to the teams listed in the JD"
      );
    }
    return pickApiOption(options, "Backend") || pickApiOption(options, "Infrastructure") || "Backend / infrastructure (open to the teams listed in the JD)";
  }
  if (
    (q.includes("office") && (q.includes("preference") || q.includes("prefer") || q.includes("which office")))
    || q.includes("preferred office")
    || q.includes("preferred location")
  ) {
    const pref = String(candidate.office_preference || prefs.office_preference || "any");
    if (/^any$/i.test(pref)) {
      return (
        pickApiOption(options, "Any")
        || pickApiOption(options, "No preference")
        || pickApiOption(options, "Remote")
        || options.find((o) => /any|no preference|flexible|remote/i.test(String(o)))
        || "Any"
      );
    }
    return pickApiOption(options, pref) || pref;
  }
  if (q.includes("using ai today") || (q.includes("how are you using ai") && q.includes("role"))) {
    return (
      (prefs.claims?.general || "").trim()
      || "I use LLMs/RAG and agentic workflows in production (search, ranking, data quality). Recent work: LangChain/LLM extraction pipelines and embedding retrieval for product search."
    );
  }
  if (
    (q.includes("live") || q.includes("willing to relocate"))
    && q.includes("job")
    && q.includes("location")
  ) {
    return pickApiOption(options, "Yes") || "Yes";
  }
  if (q.includes("candidate privacy") || (q.includes("privacy policy") && q.includes("acknowledge"))) {
    return pickApiOption(options, "Yes") || pickApiOption(options, "Acknowledge") || "Yes";
  }
  if (
    q.includes("government agency") || q.includes("commercial partners")
    || (q.includes("immediate family") && q.includes("government"))
  ) {
    return pickApiOption(options, "No") || "No";
  }
  if (q.includes("linkedin profile") || (q.includes("linkedin") && !q.includes("hear"))) {
    return candidate.linkedin || "";
  }
  if (q.includes("preferred first name")) return candidate.first_name || "";
  if (
    q.includes("current or most recent employer")
    || q.includes("most recent employer")
    || (q.includes("who is your current") && q.includes("employer"))
  ) {
    return candidate.current_company || "";
  }
  if (
    q.includes("current or more recent job title")
    || q.includes("current or most recent job title")
    || (q.includes("most recent") && q.includes("job title"))
  ) {
    return candidate.current_title || candidate.resume_current_title || "Applied AI Engineer";
  }
  if (q.includes("security clearance") && !q.includes("eligible")) {
    return pickApiOption(options, "No") || "No";
  }
  if (q.includes("authorized to work in china") || (q.includes("work in china") && q.includes("authorized"))) {
    return pickApiOption(options, "No") || "No";
  }
  if (q.includes("bound by any agreements") || q.includes("restrict your ability to work")) {
    return pickApiOption(options, "No") || "No";
  }
  if (q.includes("why anthropic") || (q.includes("why") && q.includes(String(job.company || "").toLowerCase()) && String(job.company || "").length > 2)) {
    const bank = qaBankAnswer(question) || qaBankAnswer(`why ${job.company || ""}`);
    if (bank) return bank;
  }
  if (q.includes("worked for") || q.includes("ever been employed") || (q.includes("previously") && q.includes("employ"))) {
    return pickApiOption(options, "No") || "No";
  }
  if (q.includes("current") && q.includes("company")) {
    return candidate.current_company || "";
  }
  if (q.includes("where") && q.includes("work") && !q.includes("authorized")) {
    return candidate.work_location_intent || candidate.location || "United States";
  }
  if ((q.includes("country") && q.includes("reside")) || q.includes("currently reside")) {
    return pickApiOption(options, candidate.country_of_residence) || candidate.country_of_residence || "";
  }
  if ((q.includes("city") && q.includes("state")) || (q.includes("city") && q.includes("reside"))) {
    return candidate.greenhouse_location || candidate.location || "";
  }
  if (q.includes("countries you anticipate") || (q.includes("anticipate") && q.includes("working"))) {
    return pickApiOption(options, candidate.country_of_residence || "United States")
      || candidate.country_of_residence
      || "United States";
  }
  if (q.includes("whatsapp") || q.includes("text message") || q.includes("sms")) {
    return pickApiOption(options, "No") || "No";
  }
  if (q.includes("job title")) return candidate.current_title || "";
  if ((q.includes("current") || q.includes("previous")) && q.includes("employer")) {
    return candidate.current_company || "";
  }
  if (q.includes("work remotely") || q.includes("plan to work remote") || q.includes("intend to work remotely")) {
    return pickApiOption(options, "Yes") || "Yes";
  }
  if (q.includes("years") && q.includes("experience") && !q.includes("frontend")) {
    return pickApiOption(options, candidate.years_experience) || candidate.years_experience || "3–4 years";
  }
  if (claim && ["describe", "proficiency", "react", "javascript", "frontend", "highlight", "exceptional"].some((k) => q.includes(k))) {
    return claim;
  }
  if (["describe", "experience", "why", "tell us", "achievement", "decide to apply", "personal story"].some((k) => q.includes(k))) {
    return (
      prefs.claims?.why_company ||
      prefs.claims?.general ||
      `I am an AI/ML engineer applying for ${job.title || "this role"} at ${job.company || "this company"}. Please see my resume for metrics and projects.`
    );
  }
  if (options.length) {
    const aligned = pickApiOption(options, prefs.how_heard || "");
    if (aligned) return aligned;
  }
  // Never dump the placeholder into identity fields (Ashby legal/preferred names, email, phone).
  if (/name|email|phone/.test(q)) {
    return profileLockedAnswer(question, candidate) || "";
  }
  return options.length ? "" : "Please see resume for details.";
}

export function needsLlmAnswer(answer, question = "") {
  const a = String(answer || "").trim();
  if (!a) return true;
  if (/please see resume/i.test(a)) return true;
  if (/^i am an ai\/ml engineer applying for/i.test(a)) return true;
  const q = String(question || "").toLowerCase();
  if (FREE_TEXT_MARKERS.some((k) => q.includes(k)) && a.length < 40 && !/yes|no/i.test(a)) return true;
  return false;
}

function resumeFactsBlock(candidate = {}) {
  const edu = (candidate.education || [])
    .map((e) => `- ${e.school || ""}; ${e.degree || ""}; ${e.location || ""}; ${e.dates || ""}`.replace(/; +/g, "; ").trim())
    .filter((line) => line !== "-")
    .join("\n");
  const exp = (candidate.experience || [])
    .slice(0, 5)
    .map((e) => {
      const bullets = (e.bullets || []).slice(0, 3).join("; ");
      return `- ${e.title || ""} @ ${e.company || ""} (${e.dates || ""})${bullets ? `: ${bullets}` : ""}`;
    })
    .join("\n");
  return (
    `Education:\n${edu || "(none)"}\n\n` +
    `Experience:\n${exp || "(none)"}`
  );
}

export function applyProfileLocks(answers, candidate, optionsByQuestion = {}) {
  const out = { ...answers };
  for (const q of Object.keys(out)) {
    const locked = profileLockedAnswer(q, candidate);
    if (locked) {
      const opts = optionsByQuestion[q] || [];
      // Stripe etc. list "US" while profile says "United States"
      out[q] = pickApiOption(opts, locked) || locked;
    }
    if (isEeoLabel(q)) {
      const eeo = eeoAnswer(q, candidate, {}, optionsByQuestion[q] || []);
      if (eeo && (candidate.gender || candidate.hispanic || candidate.veteran)) out[q] = eeo;
    }
  }
  return out;
}

export function applyPreferenceLocks(answers, prefs, optionsByQuestion = {}) {
  const out = { ...answers };
  for (const q of Object.keys(out)) {
    const opts = optionsByQuestion[q] || [];
    const isYesNo = opts.length > 0 && opts.every((o) => ["yes", "no"].includes(o.toLowerCase()));
    const forced = preferenceForcedYesNo(q, prefs, { allowFreeText: false, options: opts });
    if (forced && isYesNo) {
      out[q] = forced;
      continue;
    }
    if (forced && opts.length === 0 && /^(are|do|have|is|will|can)\b/.test(q.toLowerCase()) && !q.toLowerCase().includes("describe")) {
      out[q] = forced;
      continue;
    }
    if ((prefs.tone || "").toLowerCase() === "optimistic") {
      const claim = claimForQuestion(q, prefs);
      if (
        claim &&
        ["proficiency", "react", "javascript", "typescript", "frontend", "describe your"].some((k) =>
          q.toLowerCase().includes(k)
        )
      ) {
        if (q.toLowerCase().includes("exceptional") && (out[q] || "").length > 40) continue;
        out[q] = claim;
      }
    }
    if (["hear about", "where did you hear", "vacancy"].some((k) => q.toLowerCase().includes(k))) {
      out[q] = prefs.how_heard || out[q];
    }
    if (q.toLowerCase().includes("whatsapp") || q.toLowerCase().includes("text message") || /\bsms\b/.test(q.toLowerCase())) {
      out[q] = pickApiOption(opts, "No") || "No";
    }
  }
  return out;
}

export function alignOptions(answers, optionsByQuestion = {}) {
  const out = { ...answers };
  for (const [q, ans] of Object.entries(answers)) {
    const opts = optionsByQuestion[q] || [];
    if (!opts.length || !ans) continue;
    let picked = null;
    if (/\bgender\b|\bsex\b/.test(q.toLowerCase()) && !q.toLowerCase().includes("orientation")) {
      picked = pickGenderOption(opts, ans);
    } else if (/veteran/.test(q.toLowerCase())) {
      picked = pickVeteranOption(opts, ans);
    }
    if (!picked) picked = pickApiOption(opts, ans);
    if (picked) out[q] = picked;
  }
  return out;
}

export function extractJsonObject(text) {
  let body = String(text || "").trim();
  if (body.startsWith("```")) {
    body = body.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  }
  try {
    const data = JSON.parse(body);
    if (data && typeof data === "object" && !Array.isArray(data)) return data;
  } catch {
    // fall through to brace scan
  }
  const m = body.match(/\{[\s\S]*\}/);
  if (m) {
    const data = JSON.parse(m[0]);
    if (data && typeof data === "object" && !Array.isArray(data)) return data;
  }
  return {};
}

/**
 * Layered answers: profile locks → force-lists → claims → optional LLM → option align.
 * `llmChat` if provided is async (system, user) => string JSON.
 */
export async function answerQuestions({
  questions,
  candidate,
  job = {},
  optionsByQuestion = {},
  prefs = {},
  llmChat = null,
} = {}) {
  const unique = [];
  const seen = new Set();
  for (const q of questions || []) {
    const qn = String(typeof q === "object" && q ? q.label || q.question || q.text || "" : q || "").trim();
    if (!qn || seen.has(qn.toLowerCase()) || qn === "[object Object]") continue;
    seen.add(qn.toLowerCase());
    unique.push(qn);
  }
  if (!unique.length) return {};

  let answers = Object.fromEntries(
    unique.map((q) => [q, heuristicAnswer(q, candidate, job, prefs, optionsByQuestion[q] || [])])
  );

  const unanswered = unique.filter((q) => needsLlmAnswer(answers[q], q));
  if (typeof llmChat === "function" && unanswered.length) {
    console.log(`  NIM ${unanswered.length}/${unique.length} questions with no profile/resume fact`);
    const tone = (prefs.tone || "optimistic").toLowerCase();
    const claimsBlock = Object.entries(prefs.claims || {})
      .filter(([, v]) => v)
      .map(([k, v]) => `- ${k}: ${String(v).trim()}`)
      .join("\n");
    const system =
      "You fill job-application form answers for a real candidate. " +
      "Return ONLY valid JSON object mapping each question string to an answer string. " +
      "Use ONLY the candidate facts and resume excerpt provided. Never invent employers, schools, dates, or degrees. " +
      "If options are provided pick exactly one option verbatim. " +
      `how-heard source must be ${prefs.how_heard || "Linkedin"}. ` +
      `EEO: gender=${candidate.gender || prefs.eeo_default || "Prefer not to say"}; ` +
      `hispanic=${candidate.hispanic || "decline"}; veteran=${candidate.veteran || "decline"}. ` +
      "passport_country / country_of_residence / github / linkedin / school MUST match config exactly. " +
      `ALWAYS answer Yes if the question text matches any of: [${(prefs.always_yes || []).join(", ")}]. ` +
      `ALWAYS answer No if the question text matches any of: [${(prefs.always_no || []).join(", ")}]. ` +
      `Tone=${tone}.`;
    const facts =
      `Config fields (authoritative):\n` +
      `- passport_country: ${candidate.passport_country}\n` +
      `- country_of_residence: ${candidate.country_of_residence}\n` +
      `- github: ${candidate.github}\n` +
      `- linkedin: ${candidate.linkedin}\n` +
      `- requires_sponsorship: ${candidate.requires_sponsorship}\n` +
      `- location: ${candidate.greenhouse_location || candidate.location || ""}\n` +
      `- work_location_intent: ${candidate.work_location_intent || ""}\n` +
      `- current_company: ${candidate.current_company || ""}\n` +
      `- current_title: ${candidate.current_title || ""}\n` +
      `- years_experience: ${candidate.years_experience || ""}\n` +
      `- school: ${candidate.school || ""}\n` +
      `- degree: ${candidate.degree || ""}\n` +
      `- gender: ${candidate.gender || ""}\n` +
      `- hispanic: ${candidate.hispanic || ""}\n` +
      `- veteran: ${candidate.veteran || ""}\n\n` +
      `${resumeFactsBlock(candidate)}\n\n` +
      `CLAIMS:\n${claimsBlock || "(none)"}\n\n` +
      `Job: ${job.title || ""} at ${job.company || ""}\n` +
      `Candidate: ${candidate.full_name || `${candidate.first_name} ${candidate.last_name}`}; ` +
      `email: ${candidate.email}; phone: ${candidate.phone}\n\n`;

    // Small batches — Nemotron thinking+JSON for 11 questions often hits max_tokens.
    const BATCH = 4;
    for (let i = 0; i < unanswered.length; i += BATCH) {
      const chunk = unanswered.slice(i, i + BATCH);
      const payload = chunk.map((q) => ({ question: q, options: optionsByQuestion[q] || [] }));
      const user = `${facts}Unanswered questions JSON:\n${JSON.stringify(payload, null, 2)}\n`;
      try {
        const raw = await llmChat(system, user);
        const parsed = extractJsonObject(raw);
        for (const q of chunk) {
          if (parsed[q] && String(parsed[q]).trim()) {
            answers[q] = String(parsed[q]).trim();
            continue;
          }
          for (const [k, v] of Object.entries(parsed)) {
            if (k.trim().toLowerCase() === q.toLowerCase() && String(v).trim()) {
              answers[q] = String(v).trim();
              break;
            }
          }
        }
      } catch (err) {
        console.warn("LLM question answering failed, using heuristics:", err.message);
      }
    }
  }

  answers = applyProfileLocks(answers, candidate, optionsByQuestion);
  answers = applyPreferenceLocks(answers, prefs, optionsByQuestion);
  return alignOptions(answers, optionsByQuestion);
}

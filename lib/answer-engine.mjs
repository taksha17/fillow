import { eeoAnswer, isAgreeLabel, isEducationLabel, isEeoLabel, pickApiOption, pickGenderOption, pickVeteranOption } from "./form-controls.mjs";

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
  if (q === "github" || q === "github profile" || (q.startsWith("github") && !q.includes("hear"))) {
    return (candidate.github || "").trim() || null;
  }
  if (q === "linkedin" || (q.startsWith("linkedin") && !q.includes("hear") && !q.includes("vacancy"))) {
    return (candidate.linkedin || "").trim() || null;
  }
  return null;
}

export function preferenceForcedYesNo(question, prefs, { allowFreeText = false } = {}) {
  if (!prefs) return null;
  const q = (question || "").toLowerCase();
  if (!allowFreeText && FREE_TEXT_MARKERS.some((k) => q.includes(k))) return null;
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
  const forced = preferenceForcedYesNo(question, prefs);
  if (forced) return pickApiOption(options, forced) || forced;
  const claim = claimForQuestion(question, prefs);
  const q = (question || "").toLowerCase();

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
  if (q.includes("hear about") || q.includes("where did you hear") || q.includes("vacancy")) {
    return pickApiOption(options, prefs.how_heard || "Linkedin") || prefs.how_heard || "Linkedin";
  }
  if (q.includes("sponsor") || q.includes("immigration")) {
    const yn = candidate.requires_sponsorship ? "Yes" : "No";
    return pickApiOption(options, yn) || yn;
  }
  if (q.includes("authorized to work") || q.includes("legally authorized")) {
    return pickApiOption(options, "Yes") || "Yes";
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
  if (["describe", "experience", "why", "tell us", "achievement"].some((k) => q.includes(k))) {
    return (
      prefs.claims?.general ||
      `I am an AI/ML engineer applying for ${job.title || "this role"} at ${job.company || "this company"}. Please see my resume for metrics and projects.`
    );
  }
  if (options.length) {
    const aligned = pickApiOption(options, prefs.how_heard || "");
    if (aligned) return aligned;
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
    const forced = preferenceForcedYesNo(q, prefs, { allowFreeText: false });
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
    const qn = String(q || "").trim();
    if (!qn || seen.has(qn.toLowerCase())) continue;
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
    const payload = unanswered.map((q) => ({ question: q, options: optionsByQuestion[q] || [] }));
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
    const user =
      `Config fields (authoritative):\n` +
      `- passport_country: ${candidate.passport_country}\n` +
      `- country_of_residence: ${candidate.country_of_residence}\n` +
      `- github: ${candidate.github}\n` +
      `- linkedin: ${candidate.linkedin}\n` +
      `- requires_sponsorship: ${candidate.requires_sponsorship}\n` +
      `- location: ${candidate.greenhouse_location || candidate.location || ""}\n` +
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
      `email: ${candidate.email}; phone: ${candidate.phone}\n\n` +
      `Unanswered questions JSON:\n${JSON.stringify(payload, null, 2)}\n`;
    try {
      const raw = await llmChat(system, user);
      const parsed = extractJsonObject(raw);
      for (const q of unanswered) {
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

  answers = applyProfileLocks(answers, candidate, optionsByQuestion);
  answers = applyPreferenceLocks(answers, prefs, optionsByQuestion);
  return alignOptions(answers, optionsByQuestion);
}

/** Pure helpers for ATS form filling. Playwright stays in form-fill.mjs. */

export const IDENTITY_FIELD_IDS = new Set([
  "first_name",
  "last_name",
  "email",
  "phone",
  "resume",
  "cover_letter",
  "country",
  "candidate-location",
  "_systemfield_name",
  "_systemfield_email",
  "_systemfield_resume",
]);

export function idSel(fieldId) {
  const fid = String(fieldId || "").replace(/"/g, "").replace(/\[\]$/, "");
  if (!fid) return "";
  return `[id="${fid}"]`;
}

export function greenhouseFieldName(field = {}) {
  return String(field.name || field.id || "").replace(/\[\]$/, "");
}

export function greenhouseFieldOptions(field = {}) {
  const raw = field.values || field.options || field.answer_options || [];
  return raw.map((o) => (typeof o === "string" ? o : o.label || o.value || "")).filter(Boolean);
}

export function greenhouseQuestionsFromJob(jobData = {}) {
  return (jobData.questions || []).map((q) => {
    const field = (q.fields || [])[0] || {};
    return {
      label: String(q.label || q.description || "").replace(/\s+/g, " ").trim(),
      required: Boolean(q.required),
      fieldId: greenhouseFieldName(field),
      type: field.type || "",
      options: greenhouseFieldOptions(field),
    };
  }).filter((q) => q.label && q.fieldId && !IDENTITY_FIELD_IDS.has(q.fieldId));
}

export function demographicQuestionsFromJob(jobData = {}) {
  const demo = jobData.demographic_questions || {};
  return (demo.questions || []).map((q) => ({
    id: String(q.id || ""),
    label: String(q.label || "").replace(/\s+/g, " ").trim(),
    required: Boolean(q.required),
    options: (q.answer_options || []).map((o) => ({
      label: String(o.label || ""),
      decline: Boolean(o.decline_to_answer),
    })),
  })).filter((q) => q.id);
}

export function isEeoLabel(text) {
  const q = String(text || "").toLowerCase();
  return (
    /\b(gender|race|ethnicity|veteran|disability|pronoun|transgender|sexual orientation|hispanic|latino)\b/.test(q) &&
    !q.includes("authorized")
  );
}

export function isEducationLabel(text) {
  const q = String(text || "").toLowerCase();
  return /\b(school|university|college|degree|discipline|field of study|graduation|gpa)\b/.test(q);
}

export function isAgreeLabel(text) {
  const q = String(text || "").toLowerCase();
  return /\bi agree\b/.test(q) || (q.includes("by selecting") && q.includes("agree")) || /\bterms and conditions\b/.test(q);
}

export function pickDecline(options = [], fallback = "Prefer not to say") {
  const labels = options.map((o) => (typeof o === "string" ? o : o.label || "")).filter(Boolean);
  const hit = labels.find((lab) =>
    /don't wish|do not wish|prefer not|decline to|i don't wish|i do not want/i.test(lab)
  );
  return hit || fallback;
}

export function scoreOption(text, want) {
  const low = String(text || "").trim().toLowerCase();
  const w = String(want || "").trim().toLowerCase();
  if (!low || !w) return -1;
  if (low === w) return 100;
  if (/don't wish|decline|prefer not/.test(w) && /don't wish|decline|prefer not/.test(low)) return 96;
  if (w === "yes" || w === "no") {
    if (w === "no") {
      if (low === "no" || low.startsWith("no,") || low.startsWith("no ") || low.includes("will not") || low.includes("do not") || low.includes("does not")) {
        return 90;
      }
      return -1;
    }
    if (low === "yes" || low.startsWith("yes,") || low.startsWith("yes ")) {
      return low.includes("future") ? 95 : low.includes(" now") ? 85 : 90;
    }
    return -1;
  }
  if (low.startsWith(w)) return 80;
  if (w.length >= 3 && low.includes(w)) return 40;
  const a = normSchool(low);
  const b = normSchool(w);
  if (a && b && a.length >= 8 && b.length >= 8 && (a === b || a.includes(b) || b.includes(a))) return 75;
  return -1;
}

export function pickApiOption(values, want) {
  const labels = (values || []).map((v) => (typeof v === "string" ? v : v?.label || "")).filter(Boolean);
  if (!labels.length || !want) return null;
  const w = String(want).trim().toLowerCase();
  const exact = labels.find((lab) => lab.toLowerCase() === w);
  if (exact) return exact;
  if (w === "yes") {
    const future = labels.find((lab) => lab.toLowerCase().startsWith("yes") && lab.toLowerCase().includes("future"));
    if (future) return future;
    const yes = labels.find((lab) => lab.toLowerCase() === "yes" || lab.toLowerCase().startsWith("yes"));
    if (yes) return yes;
  }
  if (w === "no") {
    const no = labels.find((lab) => {
      const l = lab.toLowerCase();
      return l === "no" || l.startsWith("no,") || l.startsWith("no ") || l.includes("will not") || l.includes("do not");
    });
    if (no) return no;
  }
  if (w === "i agree") {
    const agree = labels.find((lab) => lab.toLowerCase().includes("agree"));
    if (agree) return agree;
  }
  const wNorm = w.replace(/[–—]/g, "-").replace(/\s+/g, "");
  for (const lab of labels) {
    const n = lab.toLowerCase().replace(/[–—]/g, "-").replace(/\s+/g, "");
    if (n === wNorm) return lab;
    if (w.length >= 3 && (lab.toLowerCase().includes(w) || w.includes(lab.toLowerCase()))) {
      if ((w === "male" || w === "man" || w === "men") && /female|woman|women/.test(lab.toLowerCase())) continue;
      return lab;
    }
  }
  let best = null;
  let bestScore = 39;
  for (const lab of labels) {
    const s = scoreOption(lab, want);
    if (s > bestScore) {
      bestScore = s;
      best = lab;
    }
  }
  return best;
}

export function stripDialCode(text) {
  return String(text || "").replace(/\s*\+\d+\s*$/, "").trim();
}

export function controlLooksEmpty(text) {
  const t = String(text || "").trim().toLowerCase();
  return !t || t.startsWith("select") || t === "choose" || t.includes("please select");
}

function uniqPush(list, seen, value) {
  const t = String(value || "").trim();
  if (!t) return;
  const key = t.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  list.push(t);
}

export function schoolNameTries(candidate = {}) {
  const tries = [];
  const seen = new Set();
  const push = (name, { addThe = false } = {}) => {
    const t = String(name || "").trim();
    if (!t) return;
    uniqPush(tries, seen, t);
    const stripped = t.replace(/^the\s+/i, "").trim();
    uniqPush(tries, seen, stripped);
    if (addThe && !/^the\s+/i.test(t)) uniqPush(tries, seen, `The ${t}`);
  };
  push(candidate.school, { addThe: true });
  for (const alias of candidate.school_aliases || []) push(alias, { addThe: true });
  for (const row of candidate.education || []) {
    if (row?.school && row.school !== candidate.school) push(row.school, { addThe: false });
  }
  // Greenhouse school typeaheads often only accept catalog names; Other is the last resort.
  uniqPush(tries, seen, "Other");
  return tries;
}

export function degreeNameTries(candidate = {}) {
  const tries = [];
  const seen = new Set();
  const d = candidate.degree || candidate.education?.[0]?.degree || "";
  uniqPush(tries, seen, d);
  if (/master/i.test(d)) {
    for (const x of ["Master of Science", "Master's", "Masters", "M.S.", "MS", "MA", "M.A."]) uniqPush(tries, seen, x);
  }
  if (/bachelor/i.test(d)) {
    for (const x of ["Bachelor of Science", "Bachelor's", "Bachelors", "B.S.", "BS", "BA", "B.A."]) uniqPush(tries, seen, x);
  }
  for (const row of (candidate.education || []).slice(1)) uniqPush(tries, seen, row.degree);
  return tries;
}

export function pickGenderOption(options = [], want = "Male") {
  const labels = options.map((o) => (typeof o === "string" ? o : o.label || "")).filter(Boolean);
  const w = String(want || "male").toLowerCase().trim();
  const male = w === "male" || w === "man" || w === "men";
  const female = w === "female" || w === "woman" || w === "women";
  for (const lab of labels) {
    const l = lab.toLowerCase().trim();
    if (male) {
      if (/female|woman|women/.test(l)) continue;
      if (l === "male" || l === "man" || l === "men" || /^male\b/.test(l) || /^man\b/.test(l) || /^men\b/.test(l)) return lab;
    }
    if (female) {
      if (l === "female" || l === "woman" || l === "women" || /^female\b/.test(l) || /^woman\b/.test(l) || /^women\b/.test(l)) return lab;
    }
  }
  return null;
}

export function pickVeteranOption(options = [], want = "No") {
  const labels = options.map((o) => (typeof o === "string" ? o : o.label || "")).filter(Boolean);
  const w = String(want || "no").toLowerCase().trim();
  const no = w === "no" || w === "false" || /not a veteran|i am not/.test(w);
  if (no) {
    const hit = labels.find((lab) => {
      const l = lab.toLowerCase();
      return /not a veteran|i am not a|not a protected veteran/.test(l) || l === "no";
    });
    if (hit) return hit;
  } else {
    const hit = labels.find((lab) => {
      const l = lab.toLowerCase();
      return (l === "yes" || /i am a veteran|identify as a veteran|protected veteran/.test(l)) && !/not a veteran/.test(l);
    });
    if (hit) return hit;
  }
  return pickApiOption(labels, want);
}

export function eeoAnswer(label, candidate = {}, prefs = {}, options = []) {
  const q = String(label || "").toLowerCase();
  const labels = options.map((o) => (typeof o === "string" ? o : o.label || "")).filter(Boolean);
  if (/\bgender\b|\bsex\b/.test(q) && !q.includes("orientation")) {
    if (candidate.gender) return pickGenderOption(labels, candidate.gender) || candidate.gender;
  }
  if (/hispanic|latino|latina|latinx/.test(q)) {
    if (candidate.hispanic !== undefined && candidate.hispanic !== "") {
      return pickApiOption(labels, candidate.hispanic) || String(candidate.hispanic);
    }
  }
  if (/veteran/.test(q)) {
    if (candidate.veteran !== undefined && candidate.veteran !== "") {
      return pickVeteranOption(labels, candidate.veteran) || String(candidate.veteran);
    }
  }
  return pickDecline(labels, prefs.eeo_default || "Prefer not to say");
}

export function normSchool(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/^the\s+/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

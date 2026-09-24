/**
 * Pure Ashby field helpers for Agent 3.
 * DOM scrape stays in form-fill; classification / wants / retries live here so
 * regressions (Cerebras relocation, OpenAI Yes/No, export "assessment") stay tested.
 */

const IDENTITY_LABELS = new Set([
  "Name", "Email", "Resume", "Upload File",
  "Preferred First Name", "Preferred Last Name",
  "Legal First Name", "Legal Last Name",
  "Email Address", "Phone Number", "Phone",
]);

export function isAshbyIdentityLabel(text) {
  const q = String(text || "").toLowerCase().replace(/\*+$/, "").trim();
  const raw = String(text || "").replace(/\*+$/, "").trim();
  if (IDENTITY_LABELS.has(text) || IDENTITY_LABELS.has(raw)) return true;
  return /^(preferred|legal)\s+(first|last)\s+name\b/.test(q)
    || /^preferred first\s*&\s*last name\b/.test(q)
    || /^(email address|email|phone number|phone)\b/.test(q)
    || q === "name";
}

/** Location typeahead — never match "work from our US office" Yes/No. */
export function isAshbyLocationLabel(text) {
  const q = String(text || "").toLowerCase();
  if (/office|sponsor|polygraph|clearance|maryland|relocat/.test(q) && !/intend|currently located|what location|_systemfield_location/.test(q)) {
    if (/work from our|three days|on-site|visa/.test(q)) return false;
  }
  if (/^location$/.test(q.trim())) return true;
  if (/currently located|where are you currently located/.test(q)) return true;
  if (/location do you intend|what location|work location|_systemfield_location/.test(q)) return true;
  if (/\bintend to work from\b|\bwork from\b/.test(q) && /location/.test(q)) return true;
  return false;
}

export function isAshbyHowHeardLabel(text) {
  const q = String(text || "").toLowerCase();
  return /how did you hear|hear about|where did you hear|vacancy/.test(q);
}

export function isAshbyYesNoQuestion(text) {
  const q = String(text || "").toLowerCase();
  return /sponsor|immigration|visa status|authorized to work|legally authorized|polygraph|clearance|maryland|on-site at our client|office three days|work from our .+ office|relocation|open to reloc|previously employed|worked for/.test(q);
}

/**
 * Classify one Ashby question from DOM facts (no Playwright).
 * @param {{ text: string, forId: string, required?: boolean, target?: object|null, entry?: object|null }} fact
 */
export function classifyAshbyField(fact = {}) {
  const text = String(fact.text || "").trim().replace(/\s+/g, " ");
  const forId = String(fact.forId || "");
  const required = Boolean(fact.required);
  if (!text || !forId || isAshbyIdentityLabel(text)) {
    return null;
  }

  const target = fact.target || null;
  const entry = fact.entry || {};
  let kind = "unknown";
  let options = [];

  if (target) {
    const tag = String(target.tag || "").toLowerCase();
    const typ = String(target.type || "").toLowerCase();
    const role = String(target.role || "").toLowerCase();
    const cls = String(target.className || "");
    if (typ === "file") kind = "file";
    else if (tag === "textarea") kind = "textarea";
    else if (role === "combobox" || /autocomplete/i.test(cls)) kind = "autocomplete";
    else if (tag === "select") {
      kind = "select";
      options = [...(target.options || [])];
    } else kind = "text";
  } else {
    const radios = entry.radios || [];
    if (radios.length) {
      kind = "radio";
      options = radios.map((r) => String(r || "").trim()).filter(Boolean);
    } else if (entry.hasCombo) {
      kind = "autocomplete";
    } else if (entry.hasDatepicker) {
      kind = "date";
    } else {
      const yesNo = (entry.yesNoLabels || []).map((t) => String(t || "").trim()).filter(Boolean);
      const boxes = entry.checkboxNames || [];
      const hasYesNoCheckbox = Boolean(entry.hasYesNoCheckbox);
      if (yesNo.length >= 2 && yesNo.length <= 4 && yesNo.every((t) => /^(yes|no)$/i.test(t))) {
        kind = "boolean";
        options = yesNo;
      } else if (boxes.length && !hasYesNoCheckbox) {
        kind = "checkbox";
        options = boxes.map((b) => String(b || "").trim()).filter(Boolean);
      } else if (yesNo.length >= 2 || hasYesNoCheckbox) {
        kind = "boolean";
        options = yesNo.length ? yesNo : ["Yes", "No"];
      }
    }
  }

  return { text, forId, required, kind, options };
}

/** Short typeahead seeds — long profile phrases never match Ashby listboxes. */
export function ashbyAutocompleteTries(label, answer) {
  const q = String(label || "").toLowerCase();
  const ans = String(answer || "").trim();
  const tries = [];
  const push = (v) => {
    const t = String(v || "").trim();
    if (t && !tries.includes(t)) tries.push(t);
  };
  if (isAshbyLocationLabel(label) || (/location|intend|based/.test(q) && !isAshbyYesNoQuestion(label))) {
    push("United States");
    if (/\bunited states\b/i.test(ans)) push("United States");
    const cityState = ans.match(/\b([A-Za-z][A-Za-z .]+),\s*([A-Z]{2})\b/);
    if (cityState) push(`${cityState[1]}, ${cityState[2]}`);
    push(ans.split(/[/,|(]/)[0]?.trim());
    push("Remote");
  } else if (isAshbyHowHeardLabel(label)) {
    push("Job Board");
    push("LinkedIn");
    push("Indeed");
    push(ans);
    push("Company Website");
    push("Referral");
  } else {
    push(ans);
    push(ans.split(/[/,|(]/)[0]?.trim());
  }
  return tries.filter(Boolean);
}

export function ashbyStartDateDefault(now = new Date()) {
  const d = new Date(now);
  d.setDate(d.getDate() + 21);
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
}

/** Default Yes/No for Ashby button groups from profile. */
export function ashbyYesNoWant(question, candidate = {}) {
  const q = String(question || "").toLowerCase();
  const needsSponsor = Boolean(candidate.requires_sponsorship);
  if (/sponsor|immigration|visa status|require visa/.test(q)) return needsSponsor ? "Yes" : "No";
  if (/authorized to work|legally authorized/.test(q)) return "Yes";
  if (/worked for|previously employed|employee or contractor/.test(q)) return "No";
  if (/polygraph|security clearance|full scope/.test(q)) return "No";
  if (/maryland|on-site at our client|5 days a week/.test(q)) return "No";
  if (/office three days|work from our .+ office/.test(q)) return "Yes";
  if (/relocation|open to reloc/.test(q)) return "Yes";
  return null;
}

export const ASHBY_YESNO_RULES = [
  { re: /sponsor|immigration|visa status/i, wantFrom: (c) => (c?.requires_sponsorship ? "Yes" : "No") },
  { re: /authorized to work|legally authorized/i, wantFrom: () => "Yes" },
  { re: /worked for|previously employed|employee or contractor/i, wantFrom: () => "No" },
  { re: /polygraph|security clearance|full scope/i, wantFrom: () => "No" },
  { re: /maryland|on-site at our client|5 days a week/i, wantFrom: () => "No" },
  { re: /office three days|work from our .+ office/i, wantFrom: () => "Yes" },
  { re: /relocation|open to reloc/i, wantFrom: () => "Yes" },
];

/**
 * Whether a missing-required retry should treat this label as location autocomplete.
 * Guards against "work from our US office" Yes/No false positives.
 */
export function ashbyRetryIsLocation(label) {
  return isAshbyLocationLabel(label) && !isAshbyYesNoQuestion(label);
}

/**
 * Status of one required field from a snapshot (for unit tests + missing audit).
 * @returns {'ok'|'missing'|'skip'}
 */
export function ashbyRequiredStatus(snap = {}) {
  const text = String(snap.text || "");
  if (["Name", "Email", "Resume", "Upload File"].includes(text)) return "skip";
  if (snap.targetType === "file") return "skip";

  if (snap.targetValue != null) {
    return String(snap.targetValue || "").trim() ? "ok" : "missing";
  }

  const yesNo = (snap.yesNoLabels || []).map((t) => String(t || "").trim());
  if (yesNo.length >= 2 && yesNo.every((t) => /^(yes|no)$/i.test(t))) {
    return snap.yesNoActive ? "ok" : "missing";
  }

  if (snap.hasCombo) {
    return String(snap.comboValue || "").trim() ? "ok" : "missing";
  }

  if (snap.hasDatepicker) {
    return String(snap.dateValue || "").trim() ? "ok" : "missing";
  }

  if ((snap.radioCount || 0) > 0) {
    return snap.radioChecked ? "ok" : "missing";
  }

  const boxes = snap.checkboxStates || [];
  if (boxes.length && !snap.hasYesNoCheckbox) {
    return boxes.some(Boolean) ? "ok" : "missing";
  }

  if (snap.hasYesNoCheckbox || (snap.optionButtonCount || 0) > 0) {
    return snap.yesNoActive ? "ok" : "missing";
  }

  return "ok";
}

/** Ashby success copy variants (also mirrored in confirmationText). */
export function ashbyLooksSubmitted(visible) {
  const v = String(visible || "").toLowerCase();
  return /successfully submitted|application was successfully submitted|thank you for applying|application submitted|we received your application/.test(v);
}

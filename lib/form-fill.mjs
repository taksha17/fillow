import { existsSync } from "node:fs";
import { answerQuestions, needsLlmAnswer } from "./answer-engine.mjs";
import { recordStuck } from "./stuck-questions.mjs";
import {
  ASHBY_YESNO_RULES,
  ashbyAutocompleteTries,
  ashbyLooksSubmitted,
  ashbyRequiredStatus,
  ashbyRetryIsLocation,
  ashbyStartDateDefault,
  ashbyYesNoWant,
  classifyAshbyField,
  isAshbyIdentityLabel,
} from "./ashby-fields.mjs";
import { detectAts, fetchGreenhouseJob, greenhouseEmbedUrl, parseGreenhouseIds } from "./ats.mjs";
import {
  clickSubmit,
  confirmationText,
  dismissCookies,
  fillIfPresent,
  humanFill,
  inputHasValue,
  phoneDigits,
  sleep,
  spamFlagged,
} from "./browser.mjs";
import {
  IDENTITY_FIELD_IDS,
  controlLooksEmpty,
  countryAliases,
  demographicQuestionsFromJob,
  greenhouseQuestionsFromJob,
  idSel,
  isEducationLabel,
  isEeoLabel,
  pickApiOption,
  schoolNameTries,
  degreeNameTries,
  eeoAnswer,
  scoreOption,
  stripDialCode,
} from "./form-controls.mjs";
import { classifyField, valueTries, answerFromProfile } from "./field-kinds.mjs";
import { pollOtp, fetchRecentMail } from "./gmail.mjs";
import { PATHS } from "./paths.mjs";

/** In-page scrape only — classification is pure (lib/ashby-fields.mjs). */
function scrapeAshbyQuestionFacts() {
  const titles = [...document.querySelectorAll(
    "label.ashby-application-form-question-title, label[class*=\"_heading_\"]"
  )];
  return titles.map((lab) => {
    const text = (lab.innerText || "").trim().replace(/\s+/g, " ");
    const forId = lab.getAttribute("for") || "";
    const required = /_required_/.test(lab.className || "");
    // Field entry only — never walk to an outer fieldset (steals Location combobox).
    const entryEl = lab.closest(
      "[class*='_fieldEntry_'], .ashby-application-form-field-entry"
    ) || lab.parentElement;
    const targetEl = forId ? document.getElementById(forId) : null;
    let target = null;
    if (targetEl) {
      target = {
        tag: targetEl.tagName,
        type: targetEl.type || "",
        role: targetEl.getAttribute("role") || "",
        className: String(targetEl.className || ""),
        options: targetEl.tagName === "SELECT"
          ? [...targetEl.options].map((o) => (o.text || "").trim()).filter(Boolean)
          : [],
      };
    }
    const radios = forId
      ? [...document.querySelectorAll("input[type=radio]")].filter((r) =>
        (r.id || "").includes(forId) || (r.name || "").includes(forId)
      )
      : [];
    const radioLabels = radios.map((r) => {
      const l = (r.labels && r.labels[0] && r.labels[0].innerText)
        || (document.querySelector(`label[for="${r.id}"]`) || {}).innerText
        || r.value || "";
      return String(l).trim();
    }).filter(Boolean);
    const yesNoBtns = [...(entryEl?.querySelectorAll('button[class*="_option_"]') || [])];
    const yesNoLabels = yesNoBtns.map((b) => (b.innerText || "").trim()).filter(Boolean);
    const boxes = [...(entryEl?.querySelectorAll("input[type=checkbox]") || [])];
    const hasYesNoCheckbox = Boolean(forId && document.querySelector(`input[type=checkbox][name="${forId}"]`));
    return {
      text,
      forId,
      required,
      target,
      entry: {
        hasCombo: Boolean(entryEl?.querySelector(
          "input[role='combobox'], input.ashby-application-form-input-autocomplete"
        )),
        hasDatepicker: Boolean(entryEl?.querySelector(
          ".react-datepicker-wrapper input, input[placeholder*='date' i]"
        )),
        radios: radioLabels,
        yesNoLabels,
        checkboxNames: boxes
          .filter((b) => (b.name || "") !== forId)
          .map((b) => (b.name || b.value || b.labels?.[0]?.innerText || "").trim())
          .filter(Boolean),
        hasYesNoCheckbox,
      },
    };
  });
}

function discoverAshbyFromFacts(facts) {
  return (facts || [])
    .map((f) => classifyAshbyField(f))
    .filter(Boolean)
    .filter((x) => !isAshbyIdentityLabel(x.text));
}

function discoverVisibleFields() {
  const skipIds = new Set([
    "first_name", "last_name", "email", "phone", "resume", "cover_letter",
    "_systemfield_name", "_systemfield_email", "_systemfield_resume",
  ]);
  const out = [];
  const seen = new Set();
  for (const lab of document.querySelectorAll("label[for]")) {
    const forId = lab.getAttribute("for") || "";
    if (!forId || skipIds.has(forId) || seen.has(forId)) continue;
    const el = document.getElementById(forId);
    const text = (lab.innerText || "").replace(/\s+/g, " ").trim();
    if (!text || text.length < 2) continue;
    seen.add(forId);
    const required = Boolean(
      lab.querySelector(".required, abbr")
      || /required/.test(lab.className || "")
      || el?.getAttribute("aria-required") === "true"
      || el?.required
    );
    let kind = "text";
    let options = [];
    if (!el) {
      const boxes = [...document.querySelectorAll(`input[type=checkbox][name="${CSS.escape(forId)}"], input[type=checkbox][name="${CSS.escape(forId)}[]"]`)];
      const radios = [...document.querySelectorAll(`input[type=radio][name="${CSS.escape(forId)}"]`)];
      if (boxes.length) {
        kind = "checkbox";
        options = boxes.map((b) => {
          const l = b.labels?.[0]?.innerText || document.querySelector(`label[for="${b.id}"]`)?.innerText || b.value || "";
          return String(l).replace(/\s+/g, " ").trim();
        }).filter(Boolean);
      } else if (radios.length) {
        kind = "radio";
        options = radios.map((r) => {
          const l = r.labels?.[0]?.innerText || document.querySelector(`label[for="${r.id}"]`)?.innerText || r.value || "";
          return String(l).replace(/\s+/g, " ").trim();
        }).filter(Boolean);
      } else continue;
    } else {
      const tag = el.tagName.toLowerCase();
      const typ = (el.type || "").toLowerCase();
      const role = (el.getAttribute("role") || "").toLowerCase();
      if (typ === "file" || typ === "hidden") continue;
      if (typ === "checkbox") kind = "checkbox";
      else if (typ === "radio") kind = "radio";
      else if (tag === "select" || role === "combobox" || el.closest(".select__control")) kind = "select";
      else if (tag === "textarea") kind = "textarea";
      if (tag === "select") {
        options = [...el.options].map((o) => (o.text || "").trim()).filter((t) => t && !/^select/i.test(t));
      }
    }
    out.push({ text, forId, required, kind, options });
  }
  return out;
}

/** Lever posts questions in .application-question blocks; labels often lack for=. */
function discoverLeverQuestions() {
  const skipNames = new Set(["resume", "name", "email", "phone", "org", "location", "selectedLocation"]);
  const out = [];
  const seen = new Set();
  for (const block of document.querySelectorAll(".application-question, li.application-question")) {
    const labelEl = block.querySelector(".application-label, .question-label, label");
    const text = (labelEl?.innerText || "").replace(/\s+/g, " ").replace(/✱/g, "").trim();
    if (!text || text.length < 2) continue;
    const required = Boolean(
      block.querySelector(".required, abbr, [aria-required='true']")
      || /\*/.test(labelEl?.innerText || "")
      || [...block.querySelectorAll("input,select,textarea")].some((el) => el.required)
    );
    const inputs = [...block.querySelectorAll("input, select, textarea")].filter((el) => {
      const typ = (el.type || "").toLowerCase();
      return typ !== "hidden" && typ !== "file";
    });
    if (!inputs.length) continue;
    const first = inputs[0];
    const name = first.name || first.id || "";
    if (!name || skipNames.has(name) || /^urls\[/i.test(name) || seen.has(name)) continue;
    seen.add(name);
    const typ = (first.type || "").toLowerCase();
    const tag = first.tagName.toLowerCase();
    let kind = "text";
    let options = [];
    if (typ === "checkbox" || inputs.every((i) => (i.type || "").toLowerCase() === "checkbox")) {
      kind = "checkbox";
      options = inputs.map((b) => {
        const l = b.labels?.[0]?.innerText || b.value || "";
        return String(l).replace(/\s+/g, " ").trim();
      }).filter(Boolean);
    } else if (typ === "radio" || inputs.every((i) => (i.type || "").toLowerCase() === "radio")) {
      kind = "radio";
      options = inputs.map((r) => {
        const l = r.labels?.[0]?.innerText || r.value || "";
        return String(l).replace(/\s+/g, " ").trim();
      }).filter(Boolean);
    } else if (tag === "select") {
      kind = "select";
      options = [...first.options].map((o) => (o.text || "").trim()).filter((t) => t && !/^select/i.test(t));
    } else if (tag === "textarea") {
      kind = "textarea";
    }
    out.push({ text, forId: name, required, kind, options });
  }
  return out;
}

function nameAttrSel(name) {
  return `[name=${JSON.stringify(String(name || ""))}]`;
}

function result(job, status, message, extra = {}) {
  return {
    company: job.company,
    role: job.title,
    title: job.title,
    score: job.match_score,
    status,
    url: job.apply_url || job.url,
    apply_url: job.apply_url || job.url,
    notes: message,
    report: job.report,
    pdf: extra.pdf || (existsSync(job.resume_path || "") ? "✅" : "❌"),
    ats: job.ats,
    ...extra,
  };
}

async function visibleBody(page) {
  try {
    return (await page.innerText("body")).toLowerCase();
  } catch {
    return "";
  }
}

async function uploadResume(root, resumePath, selectors) {
  if (!resumePath || !existsSync(resumePath)) return false;
  for (const selector of selectors) {
    const loc = root.locator(selector).first();
    try {
      if ((await loc.count()) === 0) continue;
      await loc.setInputFiles(resumePath, { timeout: 8000 });
      await sleep(800);
      return true;
    } catch {
      // next
    }
  }
  return false;
}

function jitterWait() {
  return 350 + Math.floor(Math.random() * 450);
}

async function controlText(root, fieldId) {
  try {
    return (await root.evaluate((id) => {
      const el = document.querySelector(`[id="${id}"]`);
      if (!el) return "";
      const control = el.closest(".select__control");
      return control ? control.innerText.trim() : (el.value || "");
    }, fieldId)) || "";
  } catch {
    return "";
  }
}

/** True when Greenhouse remix has accepted the select (requiredInput removed or valued). */
async function reactSelectCommitted(root, fieldId) {
  if (!fieldId) return false;
  try {
    return Boolean(
      await root.evaluate((id) => {
        const el = document.querySelector(`[id="${id}"]`);
        if (!el) return false;
        const shell = el.closest("[class*='select-shell']") || el.closest(".select__control")?.parentElement?.parentElement;
        const req = shell?.querySelector("input[class*='requiredInput']");
        const single = shell?.querySelector("[class*='singleValue'], [class*='single-value']");
        const singleText = (single?.textContent || "").replace(/\s+/g, " ").trim();
        if (singleText && !/^select/i.test(singleText)) {
          // Real commit removes the required input; typed filter text alone does not.
          if (!req) return true;
          if (req.value && req.value.trim()) return true;
          return false;
        }
        return false;
      }, fieldId)
    );
  } catch {
    return false;
  }
}

async function pickBestOption(root, value, fieldId = "") {
  // Prefer the open react-select menu — never the phone dial-code list (role=option too).
  let options = root.locator(".select__menu [role='option'], .select__menu .select__option");
  if ((await options.count()) === 0) {
    options = root.locator(".select__option, [class*='select__option']");
  }
  if ((await options.count()) === 0) options = root.locator("[role='option']:not(.iti__country)");
  const n = Math.min(await options.count(), 300);
  if (!n) return false;
  const allowDial = fieldId === "country" || fieldId === "candidate-location";
  let bestIdx = -1;
  let bestScore = -1;
  for (let i = 0; i < n; i += 1) {
    let text = "";
    try {
      text = (await options.nth(i).innerText({ timeout: 800 })) || "";
    } catch {
      continue;
    }
    const cleaned = text.trim();
    if (!allowDial && /\+\d+\s*$/.test(cleaned)) continue;
    let score = scoreOption(cleaned, value);
    const base = stripDialCode(cleaned).toLowerCase();
    const want = String(value || "").trim().toLowerCase();
    if (base === want) score = Math.max(score, 98);
    else if (fieldId === "country" && want && base.includes(want)) score = Math.max(score, 85);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  if (bestIdx < 0 || bestScore < 40) return false;
  // Prefer exact label equality when available (avoids Other → brOthers).
  const wantExact = String(value || "").trim().toLowerCase();
  for (let i = 0; i < n; i += 1) {
    try {
      const text = ((await options.nth(i).innerText({ timeout: 500 })) || "").trim().toLowerCase();
      if (text === wantExact) {
        await options.nth(i).click({ timeout: 2000 });
        await sleep(300);
        return true;
      }
    } catch {
      // continue
    }
  }
  try {
    await options.nth(bestIdx).click({ timeout: 2000 });
    await sleep(300);
    return true;
  } catch {
    return false;
  }
}

async function reactSelect(root, fieldId, value, { humanize = true } = {}) {
  const text = String(value || "").trim();
  if (!fieldId || !text) return false;
  const sel = idSel(fieldId);
  if (!sel) return false;
  const loc = root.locator(sel).first();
  const open = async () => {
    await loc.scrollIntoViewIfNeeded({ timeout: 2000 });
    const control = root.locator(`${sel} >> xpath=ancestor::div[contains(@class,'select__control')]`).first();
    if (await control.count()) await control.click({ timeout: 2000 });
    else await loc.click({ timeout: 2000 });
    await sleep(400);
  };
  const escape = async () => {
    try {
      await loc.press("Escape");
    } catch {
      // ignore
    }
  };
  try {
    if ((await loc.count()) === 0) return false;

    // Strategy 1: open + scan visible options (OFCCP / long lists often need this).
    await open();
    if (await pickBestOption(root, text, fieldId)) {
      await sleep(200);
      if (await reactSelectCommitted(root, fieldId)) return true;
    }

    // Strategy 2: type-to-filter then pick.
    try {
      await loc.fill("");
    } catch {
      // ignore
    }
    const want = text.toLowerCase();
    if (want !== "yes" && want !== "no") {
      if (humanize) await loc.pressSequentially(text, { delay: 18 });
      else await loc.fill(text);
      await sleep(650);
    } else {
      await sleep(200);
    }
    const menuCount = await root.locator(".select__menu [role='option']").count();
    if (menuCount === 0 && want !== "yes" && want !== "no") {
      // Typeahead found nothing (common for school catalogs) — bail for next try.
      await escape();
      return false;
    }
    if (await pickBestOption(root, text, fieldId)) {
      await sleep(200);
      if (await reactSelectCommitted(root, fieldId)) return true;
    }

    // Strategy 3: keyboard commit after filter.
    try {
      await loc.press("ArrowDown");
      await sleep(120);
      await loc.press("Enter");
      await sleep(250);
      if (await reactSelectCommitted(root, fieldId)) return true;
    } catch {
      // ignore
    }

    // Strategy 4: clear filter, reopen, scan full list again.
    await escape();
    await sleep(200);
    await open();
    if (await pickBestOption(root, text, fieldId)) {
      await sleep(200);
      if (await reactSelectCommitted(root, fieldId)) return true;
    }
    await escape();
    return false;
  } catch {
    return false;
  }
}

async function fillSelectWithTries(root, fieldId, tries, humanize) {
  for (const value of tries) {
    if (!value) continue;
    if (await reactSelect(root, fieldId, value, { humanize })) {
      if (await reactSelectCommitted(root, fieldId)) return true;
      if (!controlLooksEmpty(await controlText(root, fieldId)) && (await reactSelectCommitted(root, fieldId))) return true;
    }
  }
  return false;
}

async function fillCombobox(root, selectorOrLocator, value, { humanize = true } = {}) {
  if (typeof selectorOrLocator === "string") {
    const m = selectorOrLocator.match(/^#([^\s[]+)$/);
    if (m) return reactSelect(root, m[1], value, { humanize });
  }
  const text = String(value || "").trim();
  if (!text) return false;
  const loc = typeof selectorOrLocator === "string" ? root.locator(selectorOrLocator).first() : selectorOrLocator;
  try {
    if ((await loc.count()) === 0) return false;
    const fid = (await loc.getAttribute("id")) || "";
    if (fid) return reactSelect(root, fid, text, { humanize });
    await loc.scrollIntoViewIfNeeded({ timeout: 1500 });
    await loc.click({ timeout: 2500 });
    await loc.fill("");
    if (humanize) await loc.pressSequentially(text, { delay: 35 });
    else await loc.fill(text);
    await sleep(450);
    if (await pickBestOption(root, text, fid)) return true;
    await loc.press("Enter");
    return true;
  } catch {
    return false;
  }
}

async function checkLabeledOption(root, namePrefix, answer, { exclusive = false } = {}) {
  const want = String(answer || "").trim();
  if (!want) return false;
  const aliases = new Set(
    [want, ...countryAliases(want)].map((a) => String(a || "").trim().toLowerCase()).filter(Boolean)
  );
  const boxes = root.locator(
    `input[type=checkbox][name="${namePrefix}"], input[type=checkbox][name="${namePrefix}[]"], input[type=checkbox][name*="${namePrefix}"]`
  );
  const n = Math.min(await boxes.count(), 80);
  let best = { i: -1, score: -1, label: "" };
  for (let i = 0; i < n; i += 1) {
    const box = boxes.nth(i);
    let label = "";
    try {
      label = await box.evaluate((el) => {
        const l = el.labels?.[0] || document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        return (l && l.innerText.trim()) || "";
      });
    } catch {
      // next
    }
    const low = label.toLowerCase();
    // Exact / alias only for short codes — "US" must never match Australia via substring.
    let score = -1;
    if (aliases.has(low)) score = 100;
    else if (want.length > 5) score = scoreOption(label, want);
    if (score > best.score) best = { i, score, label };
  }
  if (best.i < 0 || best.score < 40) {
    // Never use Playwright string hasText("US") — it matches Australia first.
    for (const exact of [want, ...countryAliases(want).map((a) => (a.length <= 3 ? a.toUpperCase() : a))]) {
      try {
        const lab = root.getByText(exact, { exact: true }).first();
        if ((await lab.count()) && (await lab.isVisible({ timeout: 400 }))) {
          await lab.scrollIntoViewIfNeeded().catch(() => {});
          await lab.click({ timeout: 2000 });
          return true;
        }
      } catch {
        // next alias
      }
    }
    return false;
  }
  if (exclusive) {
    for (let i = 0; i < n; i += 1) {
      if (i === best.i) continue;
      try {
        const other = boxes.nth(i);
        if (await other.isChecked()) await other.uncheck({ timeout: 800, force: true });
      } catch {
        // next
      }
    }
  }
  const box = boxes.nth(best.i);
  try {
    await box.scrollIntoViewIfNeeded().catch(() => {});
    if (!(await box.isChecked())) await box.check({ timeout: 2000, force: true });
    return true;
  } catch {
    try {
      await root.getByText(best.label, { exact: true }).first().click({ timeout: 2000 });
      return true;
    } catch {
      return false;
    }
  }
}

async function clickMatchingChoice(root, selector, answer) {
  const want = String(answer || "").toLowerCase();
  if (!want) return false;
  const loc = root.locator(selector);
  const n = Math.min(await loc.count(), 16);
  let best = { i: -1, score: -1 };
  const needSponsor = /require sponsorship|will require sponsorship|visa|immigration/i.test(want);
  const noSponsor = /will not require sponsorship|no sponsorship|not require sponsorship/i.test(want);
  for (let i = 0; i < n; i += 1) {
    const r = loc.nth(i);
    let opt = "";
    try {
      opt = await r.evaluate((el) => {
        if (el.labels && el.labels[0]) return el.labels[0].innerText.trim();
        const l = document.querySelector(`label[for="${el.id}"]`);
        return (l && l.innerText.trim()) || el.value || "";
      });
    } catch {
      // ignore
    }
    let score = scoreOption(opt, want);
    const ol = String(opt || "").toLowerCase();
    // Ashby work-auth radios: two "Yes, …" lines — pick the sponsorship-accurate one.
    if (needSponsor && /yes/i.test(ol) && /sponsor|visa|immigration/i.test(ol) && !/will not require/i.test(ol)) {
      score = Math.max(score, 98);
    }
    if (noSponsor && /yes/i.test(ol) && /will not require sponsorship/i.test(ol)) {
      score = Math.max(score, 98);
    }
    if (score > best.score) best = { i, score };
  }
  if (best.i >= 0 && best.score >= 40) {
    try {
      await loc.nth(best.i).click({ timeout: 2000 });
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

async function fillGreenhouseField(root, fieldId, answer, humanize) {
  if (!fieldId || !answer) return false;
  const sel = idSel(fieldId);
  if (!sel) return false;
  const combo = root.locator(`${sel}[role=combobox], input${sel}[role=combobox]`).first();
  if (await combo.count()) return reactSelect(root, fieldId, answer, { humanize });
  const native = root.locator(`select${sel}, select[name="${fieldId}"]`).first();
  if (await native.count()) {
    try {
      await native.selectOption({ label: String(answer) });
      return true;
    } catch {
      try {
        await native.selectOption({ value: String(answer) });
        return true;
      } catch {
        return reactSelect(root, fieldId, answer, { humanize });
      }
    }
  }
  const text = root.locator(`input${sel}, textarea${sel}, input[name="${fieldId}"]`).first();
  if (await text.count()) {
    const typ = ((await text.getAttribute("type")) || "").toLowerCase();
    if (typ === "radio") return clickMatchingChoice(root, `input[type=radio][name="${fieldId}"], input[type=radio][id^="${fieldId}"]`, answer);
    if (typ === "checkbox") return checkLabeledOption(root, fieldId, answer);
    if (typ !== "hidden" && typ !== "file") {
      const role = ((await text.getAttribute("role")) || "").toLowerCase();
      if (role === "combobox") return reactSelect(root, fieldId, answer, { humanize });
      await humanFill(text, answer, { humanize });
      return true;
    }
  }
  if (await root.locator(`input[type=checkbox][name="${fieldId}"], input[type=checkbox][name="${fieldId}[]"]`).count()) {
    return checkLabeledOption(root, fieldId, answer);
  }
  return clickMatchingChoice(root, `input[type=radio][name="${fieldId}"], input[type=radio][id*="${fieldId}"]`, answer);
}

async function fillIdentity(root, candidate, humanize) {
  const opts = { humanize };
  if (!(await inputHasValue(root, "#first_name, input[name='first_name']"))) {
    await fillIfPresent(root, "#first_name, input[name='first_name']", candidate.first_name, opts);
  }
  if (!(await inputHasValue(root, "#last_name, input[name='last_name']"))) {
    await fillIfPresent(root, "#last_name, input[name='last_name']", candidate.last_name, opts);
  }
  await fillIfPresent(
    root,
    "#preferred_name, input[name='preferred_name'], input[id*='preferred' i][name*='name' i]",
    candidate.first_name,
    opts
  );
  await fillIfPresent(root, "#_systemfield_name, input[name='_systemfield_name'], input[name='name']", candidate.full_name, opts);
  if (!(await inputHasValue(root, "#email, input[name='email'], input[type='email'], #_systemfield_email"))) {
    await fillIfPresent(root, "#email, input[name='email'], input[type='email'], #_systemfield_email", candidate.email, opts);
  }
  const phone = phoneDigits(candidate.phone) || candidate.phone;
  if (!(await inputHasValue(root, "#phone, input[name='phone'], input[type='tel']"))) {
    await fillIfPresent(root, "#phone, input[name='phone'], input[type='tel']", phone, opts);
  }
  await fillIfPresent(root, "input[name*='linkedin' i], input[id*='linkedin' i], input[name='urls[LinkedIn]']", candidate.linkedin, opts);
  await fillIfPresent(root, "input[name*='github' i], input[id*='github' i], input[name='urls[GitHub]']", candidate.github, opts);
  await fillIfPresent(root, "input[name='org'], input[name*='company' i]", candidate.current_company, opts);
  if (controlLooksEmpty(await controlText(root, "country"))) {
    await reactSelect(root, "country", candidate.country_of_residence || "United States", opts);
  }
  if (controlLooksEmpty(await controlText(root, "candidate-location"))) {
    for (const locTry of [
      candidate.greenhouse_location,
      candidate.location,
      candidate.location ? `${candidate.location}, United States` : null,
    ]) {
      if (locTry && (await reactSelect(root, "candidate-location", locTry, opts))) break;
    }
  }
}

async function fillLeverLocation(root, candidate, humanize) {
  const loc = root.locator("#location-input, input[name='location']").first();
  if (!(await loc.count())) return false;
  const tries = [
    candidate.location,
    candidate.greenhouse_location,
    candidate.location ? `${candidate.location}, United States` : null,
  ].filter(Boolean);
  for (const tryLoc of tries) {
    try {
      await loc.click({ timeout: 2000 });
      await loc.fill("");
      await humanFill(loc, tryLoc, { humanize });
      await sleep(900);
      const opt = root.locator(
        "[role='option'], .dropdown-location, .pac-item, .location-list li, ul[class*='location'] li, div[class*='dropdown'] li"
      ).first();
      if ((await opt.count()) && (await opt.isVisible({ timeout: 1500 }).catch(() => false))) {
        await opt.click({ timeout: 2000 });
        await sleep(400);
      } else {
        await loc.press("ArrowDown").catch(() => {});
        await sleep(200);
        await loc.press("Enter").catch(() => {});
        await sleep(400);
      }
      const hidden = root.locator("#selected-location, input[name='selectedLocation']").first();
      const hv = (await hidden.inputValue().catch(() => "")) || "";
      const shown = (await loc.inputValue().catch(() => "")) || "";
      if (hv || shown.length > 3) return true;
    } catch {
      // next try
    }
  }
  return false;
}

async function fillLeverField(root, spec, answer, humanize) {
  const name = spec.forId;
  const ans = String(answer || "").trim();
  if (!name || !ans) return false;
  const sel = nameAttrSel(name);
  if (spec.kind === "select") {
    const native = root.locator(`select${sel}`).first();
    if (await native.count()) {
      const opts = spec.options?.length ? spec.options : [];
      const tries = opts.length ? valueTries(classifyField(spec.text), ans, opts) : [ans];
      for (const t of tries) {
        try {
          await native.selectOption({ label: t });
          return true;
        } catch {
          try {
            const partial = (await native.locator("option").allTextContents()).find((o) =>
              o.toLowerCase().includes(String(t).toLowerCase())
            );
            if (partial) {
              await native.selectOption({ label: partial });
              return true;
            }
          } catch {
            // next
          }
        }
      }
    }
    return false;
  }
  if (spec.kind === "radio") {
    return clickMatchingChoice(root, `input[type=radio]${sel}`, ans);
  }
  if (spec.kind === "checkbox") {
    const tokens = ans.split(/[,;/]| and /i).map((s) => s.trim()).filter(Boolean);
    const want = tokens.length ? tokens : [ans];
    const boxes = root.locator(`input[type=checkbox]${sel}`);
    const n = Math.min(await boxes.count(), 80);
    let any = false;
    for (const w of want) {
      let best = { i: -1, score: -1 };
      for (let i = 0; i < n; i += 1) {
        let label = "";
        try {
          label = await boxes.nth(i).evaluate((el) => {
            const l = el.labels?.[0] || document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
            return (l && l.innerText.trim()) || el.value || "";
          });
        } catch {
          continue;
        }
        const score = scoreOption(label, w);
        if (score > best.score) best = { i, score };
      }
      if (best.i >= 0 && best.score >= 40) {
        try {
          const box = boxes.nth(best.i);
          if (!(await box.isChecked())) await box.check({ timeout: 2000, force: true });
          any = true;
        } catch {
          // next token
        }
      }
    }
    return any;
  }
  const text = root.locator(`input${sel}, textarea${sel}`).first();
  if (await text.count()) {
    await humanFill(text, ans, { humanize });
    return true;
  }
  return false;
}

async function maybeFillOtp(page, cfg, { seenIds = new Set(), notBeforeMs = 0 } = {}) {
  const security = page.locator("input[id^='security-input-']");
  const single = page.locator(
    "input[autocomplete='one-time-code']:not([maxlength='1']), input[inputmode='numeric']:not([maxlength='1']), input[name*='code' i]:not([id^='security-input-']), input[id*='verification' i], input[name*='otp' i]"
  );
  const boxes = page.locator(
    "input[id^='security-input-'], input[maxlength='1'][inputmode='numeric'], input[maxlength='1'][autocomplete='one-time-code'], input[aria-label*='digit' i], input[data-testid*='otp' i]"
  );
  let mode = null;
  try {
    await security.first().waitFor({ state: "visible", timeout: 5000 });
    mode = "security";
  } catch {
    try {
      await single.first().waitFor({ state: "visible", timeout: 3000 });
      mode = "single";
    } catch {
      try {
        await boxes.first().waitFor({ state: "visible", timeout: 8000 });
        mode = "boxes";
      } catch {
        const body = await visibleBody(page);
        if (!/verification code|security code|confirm you're a human|one-time/i.test(body)) return false;
        try {
          await security.first().waitFor({ state: "visible", timeout: 10000 });
          mode = "security";
        } catch {
          try {
            await boxes.first().waitFor({ state: "visible", timeout: 8000 });
            mode = "boxes";
          } catch {
            return false;
          }
        }
      }
    }
  }
  if (!cfg.gmail.imap_user || !cfg.gmail.app_password) {
    console.warn("OTP field present but Gmail IMAP is not configured (GMAIL_APP_PASSWORD)");
    return false;
  }
  console.log(`  OTP field detected (${mode}) — polling Gmail IMAP for fresh code`);
  const hit = await pollOtp({
    user: cfg.gmail.imap_user,
    password: cfg.gmail.app_password,
    otpRegex: cfg.gmail.otp_regex,
    timeoutMs: 120000,
    seenIds,
    notBeforeMs,
    maxAgeMs: 8 * 60 * 1000,
  });
  if (!hit?.code) {
    console.warn("  OTP poll timed out — no matching code in Gmail");
    return false;
  }
  console.log(`  OTP code fetched (${hit.code.length} chars)`);
  if (mode === "security" || mode === "boxes") {
    // Greenhouse 8-box OTP: trusted keypresses into the first box auto-advance; JS value sets often fail.
    const first = page.locator("input[id^='security-input-']").first();
    try {
      await first.click({ timeout: 2000 });
      await first.fill("");
      await first.pressSequentially(hit.code, { delay: 40 });
    } catch {
      await page.evaluate((code) => {
        const chars = String(code || "");
        for (let i = 0; i < chars.length; i += 1) {
          const el = document.getElementById(`security-input-${i}`);
          if (!el) break;
          el.focus();
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
          if (setter) setter.call(el, chars[i]);
          else el.value = chars[i];
          el.dispatchEvent(new InputEvent("input", { bubbles: true, data: chars[i], inputType: "insertText" }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }, hit.code);
    }
  } else {
    await single.first().fill(hit.code);
  }
  for (const sel of [
    "button:has-text('Verify')",
    "button:has-text('Continue')",
    "button:has-text('Submit code')",
    "button:has-text('Submit application')",
  ]) {
    const btn = page.locator(sel).first();
    try {
      if ((await btn.count()) && (await btn.isVisible({ timeout: 600 }))) {
        await btn.click();
        break;
      }
    } catch {
      // next
    }
  }
  return true;
}

async function applyAnswers(root, discovered, answers, cover, humanize, candidate = {}) {
  for (const spec of discovered) {
    if (spec.kind === "file") continue;
    const ans = answers[spec.text];
    if (!ans && !["boolean", "radio", "checkbox", "autocomplete", "date"].includes(spec.kind)) continue;
    const fid = spec.forId;
    try {
      if (spec.kind === "select") {
        await reactSelect(root, fid, ans, { humanize });
      } else if (spec.kind === "date") {
        const value = ans || ashbyStartDateDefault();
        const lab = root.locator(`label[for="${fid}"]`).first();
        const input = lab.locator(
          "xpath=ancestor::*[contains(@class,'_fieldEntry_') or contains(@class,'ashby-application-form-field-entry')][1]//input"
        ).first();
        if (await input.count()) {
          await input.click({ timeout: 2000 }).catch(() => {});
          await input.fill("");
          await humanFill(input, value, { humanize });
          await input.press("Enter").catch(() => {});
          await sleep(300);
        }
      } else if (spec.kind === "autocomplete") {
        const tries = ashbyAutocompleteTries(spec.text, ans);
        const ok = await fillAshbyAutocomplete(root, new RegExp(escapeRe(spec.text.slice(0, 48)), "i"), tries, humanize);
        if (!ok) console.warn(`  Ashby autocomplete missed: ${spec.text.slice(0, 80)}`);
      } else if (spec.kind === "text" || spec.kind === "textarea") {
        const loc = root.locator(idSel(fid) || `[id="${fid}"]`).first();
        if ((await loc.count()) === 0) {
          // Date-like / sibling inputs when for= id is missing
          const lab = root.locator(`label[for="${fid}"]`).first();
          const sibling = lab.locator("xpath=..").locator("input:not([type=hidden]):not([type=file]), textarea").first();
          if (await sibling.count()) {
            const value = ans || (spec.required ? "Please see resume for details." : "");
            if (value) await humanFill(sibling, value, { humanize });
          }
          continue;
        }
        const value = /cover/i.test(spec.text)
          ? (cover || ans || "").slice(0, 4500)
          : ans || (spec.required ? "Please see resume for details." : "");
        if (value) await humanFill(loc, value, { humanize });
        await sleep(180 + Math.floor(Math.random() * 120));
      } else if (spec.kind === "radio") {
        await clickMatchingChoice(root, `input[type="radio"][id*="${fid}"], input[type="radio"][name*="${fid}"]`, ans);
      } else if (spec.kind === "checkbox") {
        await fillAshbyCheckboxGroup(root, fid, ans || spec.options?.[0] || "");
      } else if (spec.kind === "boolean") {
        const fromAns = String(ans || "").trim();
        let want = "Yes";
        if (/^n/i.test(fromAns)) want = "No";
        else if (/^y/i.test(fromAns)) want = "Yes";
        else want = ashbyYesNoWant(spec.text, candidate) || "Yes";
        // Prefer Playwright click — Ashby Yes/No buttons are type=submit.
        const lab = root.locator(`label[for="${fid}"]`).first();
        const scope = lab.locator(
          "xpath=ancestor::*[contains(@class,'_fieldEntry_') or contains(@class,'ashby-application-form-field-entry') or contains(@class,'_yesno_')][1]"
        );
        const btn = scope.locator("button[class*='_option_']").filter({ hasText: new RegExp(`^\\s*${want}\\s*$`, "i") }).first();
        try {
          if (await btn.count()) {
            await btn.scrollIntoViewIfNeeded().catch(() => {});
            await btn.click({ timeout: 2500, force: true });
            await sleep(200);
          }
        } catch (err) {
          console.warn(`  Ashby Yes/No miss (${want}): ${spec.text?.slice(0, 50)} — ${err.message?.split("\n")[0] || err}`);
        }
      }
    } catch (err) {
      console.warn(`  Ashby fill skipped (${spec.text?.slice(0, 60)}): ${err.message?.split("\n")[0] || err}`);
    }
  }
}

function escapeRe(s) {
  return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function fillAshbyCheckboxGroup(root, forId, answer) {
  const lab = root.locator(`label[for="${forId}"]`).first();
  if (!(await lab.count())) return false;
  const entry = lab.locator(
    "xpath=ancestor::*[contains(@class,'_fieldEntry_') or contains(@class,'ashby-application-form-field-entry') or self::fieldset][1]"
  );
  const boxes = entry.locator("input[type=checkbox]");
  const n = Math.min(await boxes.count(), 20);
  if (!n) return false;
  const wants = String(answer || "")
    .split(/[,;/|]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const preferRemote = wants.some((w) => /remote/.test(w)) || wants.length === 0;
  const preferAck = wants.some((w) => /acknowledge|confirm|agree|read/.test(w));
  let clicked = 0;
  for (let i = 0; i < n; i += 1) {
    const box = boxes.nth(i);
    let name = "";
    try {
      name = ((await box.getAttribute("name")) || (await box.evaluate((el) => el.labels?.[0]?.innerText || el.value || "")) || "").trim();
    } catch {
      continue;
    }
    const low = name.toLowerCase();
    let pick = false;
    if (preferAck && /acknowledge|confirm|agree|read the above|understood/.test(low)) pick = true;
    else if (wants.some((w) => low === w || low.includes(w) || w.includes(low))) pick = true;
    else if (preferRemote && /^remote$/i.test(name.trim())) pick = true;
    else if (!wants.length && n === 1) pick = true;
    if (!pick) continue;
    try {
      if (!(await box.isChecked().catch(() => false))) {
        await box.check({ force: true, timeout: 2000 }).catch(async () => {
          await box.click({ force: true, timeout: 2000 });
        });
        clicked += 1;
      }
    } catch {
      // next
    }
  }
  return clicked > 0;
}

async function fillAshbyAutocomplete(page, labelPattern, tries, humanize) {
  const lab = page.locator("label.ashby-application-form-question-title, label[class*=\"_heading_\"]")
    .filter({ hasText: labelPattern })
    .first();
  if (!(await lab.count())) return false;
  // Stay inside this question's field entry — never ancestor-walk to Location's combobox.
  let input = lab.locator(
    "xpath=ancestor::*[contains(@class,'_fieldEntry_') or contains(@class,'ashby-application-form-field-entry')][1]//input[@role='combobox' or contains(@class,'autocomplete')]"
  ).first();
  if (!(await input.count())) {
    input = lab.locator("xpath=..").locator(
      "input[role='combobox'], input.ashby-application-form-input-autocomplete"
    ).first();
  }
  if (!(await input.count())) return false;
  for (const tryText of tries.filter(Boolean)) {
    try {
      await lab.scrollIntoViewIfNeeded().catch(() => {});
      await input.click({ timeout: 2000 });
      await sleep(250);
      await input.fill("");
      const seed = String(tryText).slice(0, 48);
      if (humanize && seed.length < 28) {
        await input.pressSequentially(seed, { delay: 30 });
      } else {
        await input.fill(seed);
      }
      await sleep(900);
      const opts = page.locator("[role='listbox'] [role='option'], [role='option']");
      const n = Math.min(await opts.count(), 40);
      let best = { i: -1, score: -1 };
      const want = String(tryText).toLowerCase();
      for (let i = 0; i < n; i += 1) {
        let text = "";
        try {
          text = ((await opts.nth(i).innerText({ timeout: 400 })) || "").trim();
        } catch {
          continue;
        }
        const low = text.toLowerCase();
        // Skip unrelated radio/EEO options that leak into [role=option]
        if (/sponsor|consent|veteran|hispanic|decline to self|male|female|opt out/i.test(low) && !/linkedin|job board|hear/i.test(want)) {
          if (!/united states|remote|tier|linkedin|job board|indeed|glassdoor|referral|company website/i.test(low)) continue;
        }
        let score = scoreOption(text, tryText);
        if (low === want) score = 100;
        else if (want.length >= 4 && low.includes(want)) score = Math.max(score, 85);
        else if (want.length >= 4 && want.includes(low) && low.length >= 4) score = Math.max(score, 80);
        // Prefer Job Board over Social Media when seeding LinkedIn/how-heard
        if (/linkedin|job board|indeed/i.test(want) && /job board/i.test(low)) score = Math.max(score, 92);
        if (/united states/i.test(want) && low === "united states") score = 100;
        if (score > best.score) best = { i, score };
      }
      if (best.i >= 0 && best.score >= 40) {
        await opts.nth(best.i).click({ timeout: 2000 });
        await sleep(400);
        const val = (await input.inputValue().catch(() => "")) || "";
        if (val.trim()) {
          console.log(`  Ashby autocomplete: ${String(labelPattern).slice(0, 40)} → ${val.slice(0, 60)}`);
          return true;
        }
      }
      await input.press("Enter").catch(() => {});
      await sleep(300);
      if (((await input.inputValue().catch(() => "")) || "").trim()) return true;
    } catch {
      // next try
    }
  }
  return false;
}

/** Fillow v1 required-field audit — scrape facts, classify with ashbyRequiredStatus. */
async function ashbyMissingRequired(page) {
  try {
    const snaps = await page.evaluate(() => {
      const titles = [...document.querySelectorAll(
        'label.ashby-application-form-question-title[class*="_required_"], label[class*="_heading_"][class*="_required_"]'
      )];
      return titles.map((lab) => {
        const text = (lab.innerText || "").trim();
        const forId = lab.getAttribute("for") || "";
        const target = forId ? document.getElementById(forId) : null;
        const entry = lab.closest(
          "[class*='_fieldEntry_'], .ashby-application-form-field-entry"
        ) || lab.parentElement;
        const combo = entry?.querySelector(
          "input[role='combobox'], input.ashby-application-form-input-autocomplete"
        ) || null;
        const optionBtns = [...(entry?.querySelectorAll('button[class*="_option_"]') || [])];
        const yesNoLabels = optionBtns.map((b) => (b.innerText || "").trim()).filter(Boolean);
        const dateInput = entry?.querySelector(".react-datepicker-wrapper input, input[placeholder*='date' i]");
        const radios = forId
          ? [...document.querySelectorAll("input[type=radio]")].filter((r) =>
            (r.id || "").includes(forId) || (r.name || "").includes(forId)
          )
          : [];
        const boxes = [...(entry?.querySelectorAll("input[type=checkbox]") || [])].filter((b) => (b.name || "") !== forId);
        return {
          text,
          targetType: target?.type || null,
          targetValue: target && target.type !== "file" ? (target.value || "") : null,
          hasCombo: Boolean(combo),
          comboValue: combo?.value || "",
          hasDatepicker: Boolean(dateInput),
          dateValue: dateInput?.value || "",
          yesNoLabels,
          yesNoActive: optionBtns.some((b) => /_active_/.test(b.className || "")),
          optionButtonCount: optionBtns.length,
          radioCount: radios.length,
          radioChecked: radios.some((r) => r.checked),
          checkboxStates: boxes.map((b) => Boolean(b.checked)),
          hasYesNoCheckbox: Boolean(forId && document.querySelector(`input[type=checkbox][name="${forId}"]`)),
        };
      });
    });
    return (snaps || [])
      .filter((s) => ashbyRequiredStatus(s) === "missing")
      .map((s) => s.text);
  } catch {
    return [];
  }
}

async function ashbyClickYesNo(page, candidate) {
  // Label-scoped Playwright clicks — Ashby Yes/No buttons are type=submit.
  for (const rule of ASHBY_YESNO_RULES) {
    const want = rule.wantFrom(candidate);
    const lab = page.locator("label.ashby-application-form-question-title, label[class*=\"_heading_\"]")
      .filter({ hasText: rule.re })
      .first();
    if (!(await lab.count())) continue;
    await lab.scrollIntoViewIfNeeded().catch(() => {});
    const scope = lab.locator(
      "xpath=ancestor::*[contains(@class,'_fieldEntry_') or contains(@class,'ashby-application-form-field-entry') or contains(@class,'_yesno_')][1]"
    );
    const btn = scope.locator("button[class*='_option_']").filter({ hasText: new RegExp(`^\\s*${want}\\s*$`, "i") }).first();
    try {
      if ((await btn.count()) && (await btn.isVisible({ timeout: 400 }))) {
        await btn.click({ timeout: 2000, force: true });
        await sleep(180);
      }
    } catch {
      // next
    }
  }
  for (const label of ["2-4", "5-7", "3–4", "2–4", "3-5"]) {
    const loc = page.locator(`label:has-text('${label}'), button:has-text('${label}')`).first();
    try {
      if ((await loc.count()) && (await loc.isVisible({ timeout: 300 }))) {
        await loc.click();
        break;
      }
    } catch {
      // next
    }
  }
  for (const text of ["Decline to self-identify", "Prefer not to say", "I don't wish to answer"]) {
    const loc = page.locator(`label:has-text("${text}"), button:has-text("${text}")`).first();
    try {
      if ((await loc.count()) && (await loc.isVisible({ timeout: 200 }))) await loc.click();
    } catch {
      // ignore
    }
  }
}

async function ashbyUploadResume(page, resumePath) {
  if (!resumePath || !existsSync(resumePath)) return false;
  const name = String(resumePath).split(/[/\\]/).pop() || "";
  for (const sel of ["#_systemfield_resume", "input[type='file'][id='_systemfield_resume']"]) {
    const loc = page.locator(sel).first();
    try {
      if ((await loc.count()) === 0) continue;
      await loc.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
      await loc.setInputFiles(resumePath, { timeout: 8000 });
      await sleep(2500);
      const body = await visibleBody(page);
      if (name && body.includes(name.toLowerCase())) return true;
      if (body.includes(".pdf")) return true;
      const files = await loc.evaluate((el) => el.files && el.files.length).catch(() => 0);
      if (files) return true;
      return true;
    } catch {
      // next
    }
  }
  // Fallback: file inputs whose parent mentions Resume (not Autofill)
  const files = page.locator("input[type='file']");
  const n = Math.min(await files.count(), 8);
  for (let i = 0; i < n; i += 1) {
    const loc = files.nth(i);
    try {
      const parentText = await loc.evaluate((el) => (el.parentElement?.innerText || "").toLowerCase());
      const id = ((await loc.getAttribute("id")) || "").toLowerCase();
      if (id.includes("cover") || parentText.includes("cover")) continue;
      if (parentText.includes("autofill") && !parentText.includes("resume")) continue;
      if (parentText.includes("resume") || id === "_systemfield_resume" || id.includes("resume")) {
        await loc.setInputFiles(resumePath, { timeout: 8000 });
        await sleep(1500);
        return true;
      }
    } catch {
      // next
    }
  }
  return false;
}

async function checkConsentBoxes(root) {
  const loc = root.locator(
    "#gdpr_demographic_data_consent_given_1, input[name='gdpr_demographic_data_consent_given'], input[type=checkbox][id*='consent' i], input[type=checkbox][name*='consent' i], input[type=checkbox][id*='terms' i], input[type=checkbox][aria-required='true']"
  );
  const n = Math.min(await loc.count(), 20);
  for (let i = 0; i < n; i += 1) {
    const box = loc.nth(i);
    try {
      if (!(await box.isVisible({ timeout: 300 }))) continue;
      const blob = `${(await box.getAttribute("name")) || ""} ${(await box.getAttribute("id")) || ""}`.toLowerCase();
      if (/source|hear|linkedin|gender|race|veteran/.test(blob) && !/consent|terms|privacy|agree/.test(blob)) continue;
      if (!(await box.isChecked())) await box.check({ timeout: 2000, force: true });
    } catch {
      // next
    }
  }
  for (const text of ["I consent", "By checking this box", "accept the terms", "Candidate Privacy"]) {
    try {
      const lab = root.locator("label").filter({ hasText: text }).first();
      if (!(await lab.count())) continue;
      const fid = await lab.getAttribute("for");
      if (fid) {
        const box = root.locator(idSel(fid)).first();
        if ((await box.count()) && !(await box.isChecked())) await box.check({ force: true });
      } else if (await lab.isVisible({ timeout: 300 })) {
        await lab.click();
      }
    } catch {
      // next
    }
  }
}

async function ashbyCheckRequiredBoxes(page) {
  const loc = page.locator("input[type=checkbox]");
  const n = Math.min(await loc.count(), 30);
  for (let i = 0; i < n; i += 1) {
    const box = loc.nth(i);
    try {
      if (!(await box.isVisible({ timeout: 200 })) || (await box.isChecked())) continue;
      let label = "";
      try {
        label = await box.evaluate((el) => {
          if (el.labels && el.labels[0]) return el.labels[0].innerText;
          return el.parentElement ? el.parentElement.innerText : "";
        });
      } catch {
        label = "";
      }
      const blob = `${(await box.getAttribute("name")) || ""} ${(await box.getAttribute("id")) || ""} ${label}`.toLowerCase();
      if (["acknowledge", "confirm i have read", "i agree", "consent", "arbitration", "privacy", "terms"].some((x) => blob.includes(x))) {
        await box.check({ force: true });
      } else if (label.trim().toLowerCase() === "linkedin" || blob.trim() === "linkedin") {
        await box.check({ force: true });
      } else if (/^remote$/i.test(((await box.getAttribute("name")) || "").trim())) {
        await box.check({ force: true });
      }
    } catch {
      // next
    }
  }
  for (const text of ["Decline to self-identify", "Prefer not to say", "I don't wish to answer"]) {
    const decline = page.locator("label, button").filter({ hasText: text }).first();
    try {
      if ((await decline.count()) && (await decline.isVisible({ timeout: 200 }))) await decline.click();
    } catch {
      // ignore
    }
  }
}

async function answerByLabelFallbacks(root, candidate, prefs, humanize) {
  const sponsor = candidate.requires_sponsorship ? "Yes" : "No";
  const pairs = [
    ["How did you hear", prefs.how_heard || "LinkedIn"],
    ["legally authorized", "Yes"],
    ["authorized to work", "Yes"],
    ["sponsorship", sponsor],
    ["immigration sponsorship", sponsor],
    ["non-compete", "No"],
    ["worked for", "No"],
    ["ever worked", "No"],
    ["ever been employed", "No"],
    ["I agree", "I agree"],
    ["privacy policy", "I acknowledge"],
    ["Candidate Privacy", "I acknowledge"],
  ];
  for (const [needle, value] of pairs) {
    const lab = root.locator("label").filter({ hasText: needle }).first();
    try {
      if (!(await lab.count())) continue;
      const fid = await lab.getAttribute("for");
      if (!fid || IDENTITY_FIELD_IDS.has(fid)) continue;
      const current = await controlText(root, fid);
      if (!controlLooksEmpty(current) && (await reactSelectCommitted(root, fid))) continue;
      if (await root.locator(`${idSel(fid)}[role=combobox]`).count()) {
        const tries = value === "I acknowledge"
          ? ["I acknowledge", "I agree", "Yes"]
          : [value];
        let ok = false;
        for (const t of tries) {
          if (await reactSelect(root, fid, t, { humanize })) {
            ok = true;
            break;
          }
        }
        if (!ok) {
          await sleep(300);
          await reactSelect(root, fid, value, { humanize });
        }
      } else {
        await fillGreenhouseField(root, fid, value, humanize);
      }
    } catch {
      // next
    }
  }
}

async function fillFieldWithTries(root, fieldId, tries, humanize) {
  for (const value of tries) {
    if (!value) continue;
    const ok = await fillGreenhouseField(root, fieldId, value, humanize);
    if (!ok) continue;
    const cur = await controlText(root, fieldId);
    if (!controlLooksEmpty(cur)) return true;
  }
  return false;
}

async function fillEducationOrEeo(root, spec, ctx, answers) {
  const humanize = ctx.humanize;
  const candidate = ctx.cfg.candidate;
  const q = spec.text || "";
  const kind = classifyField(q);
  const opts = spec.options || [];

  if (kind === "school") {
    return fillSelectWithTries(root, spec.forId, schoolNameTries(candidate, { greenhouse: true }), humanize)
      || fillFieldWithTries(root, spec.forId, schoolNameTries(candidate, { greenhouse: true }), humanize);
  }
  if (kind === "degree") {
    return fillSelectWithTries(root, spec.forId, degreeNameTries(candidate), humanize)
      || fillFieldWithTries(root, spec.forId, degreeNameTries(candidate), humanize);
  }
  if (kind === "gender" || kind === "hispanic" || kind === "veteran" || kind === "race" || kind === "disability" || isEeoLabel(q)) {
    const base = answers[q] || eeoAnswer(q, candidate, ctx.cfg.answer_preferences, opts)
      || answerFromProfile(kind, candidate, ctx.cfg.answer_preferences);
    const tries = valueTries(kind || "veteran", base, opts);
    if (await fillSelectWithTries(root, spec.forId, tries, humanize)) return true;
    return fillFieldWithTries(root, spec.forId, tries, humanize);
  }
  if (kind === "work_country") {
    const base = answers[q] || answerFromProfile(kind, candidate, ctx.cfg.answer_preferences);
    return fillSelectWithTries(root, spec.forId, valueTries(kind, base, opts), humanize);
  }
  const ans = answers[spec.text];
  if (!ans) return false;
  if (spec.kind === "select") {
    const tries = valueTries(kind, ans, opts);
    return fillSelectWithTries(root, spec.forId, tries.length ? tries : [ans], humanize);
  }
  return fillGreenhouseField(root, spec.forId, ans, humanize);
}

function answeringCandidate(cfg) {
  return {
    ...cfg.candidate,
    experience: cfg.resume?.experience || cfg.candidate.experience || [],
  };
}

async function fillApiQuestions(root, apiQuestions, answers, humanize) {
  for (const q of apiQuestions) {
    const ans = answers[q.label];
    if (!ans) continue;
    const kind = classifyField(q.label);
    const tries = valueTries(kind, pickApiOption(q.options, ans) || ans, q.options || []);
    const multi = /multi_value_multi_select/i.test(q.type);
    const selectType = /multi_value|select/i.test(q.type);
    let filled = false;
    if (multi) {
      // Prefer exact option only — Playwright hasText("US") matches Australia.
      const exclusive = kind === "work_country" || kind === "passport";
      for (const option of tries) {
        filled = await checkLabeledOption(root, q.fieldId.replace(/\[\]$/, ""), option, { exclusive });
        if (filled) break;
        try {
          const lab = root.getByText(option, { exact: true }).first();
          if ((await lab.count()) && (await lab.isVisible({ timeout: 400 }))) {
            await lab.scrollIntoViewIfNeeded().catch(() => {});
            await lab.click({ timeout: 1500 });
            filled = true;
            break;
          }
        } catch {
          // next
        }
      }
    }
    if (!filled && selectType) filled = await fillSelectWithTries(root, q.fieldId, tries, humanize);
    if (!filled) {
      for (const option of tries) {
        filled = await fillGreenhouseField(root, q.fieldId, option, humanize);
        if (filled) {
          const cur = await controlText(root, q.fieldId);
          if (!controlLooksEmpty(cur) || multi) break;
        }
        filled = false;
      }
    }
  }
}

function educationMonthYear(candidate) {
  const raw = String(candidate?.graduation || candidate?.education?.[0]?.dates || candidate?.education?.[0]?.graduation || "");
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  let month = "May";
  let year = "";
  const m = raw.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{4})/i);
  if (m) {
    const idx = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(m[1].slice(0, 3).toLowerCase());
    if (idx >= 0) month = months[idx];
    year = m[2];
  } else {
    const y = raw.match(/(20\d{2}|19\d{2})/);
    if (y) year = y[1];
  }
  const startYear = year && Number(year) >= 2004 ? String(Number(year) - 2) : year;
  return { month, year, startMonth: "August", startYear };
}

async function commitEducationDates(root, candidate, humanize) {
  const { month, year, startMonth, startYear } = educationMonthYear(candidate);
  const pairs = [
    [/start date month|^start month|from month/i, startMonth],
    [/end date month|^end month|to month|graduation month/i, month],
    [/start date year|^start year|from year/i, startYear],
    [/end date year|^end year|to year|graduation year/i, year],
  ];
  for (const [re, value] of pairs) {
    if (!value) continue;
    const lab = root.locator("label").filter({ hasText: re }).first();
    try {
      if (!(await lab.count())) continue;
      const fid = await lab.getAttribute("for");
      if (fid) {
        await fillSelectWithTries(root, fid, [value, value.slice(0, 3)], humanize);
        continue;
      }
      const box = lab.locator("xpath=following::input[@role='combobox' or contains(@class,'select')][1]").first();
      if (await box.count()) {
        await box.click({ timeout: 1500 }).catch(() => {});
        await box.fill(String(value)).catch(() => {});
        await sleep(400);
        const opt = root.locator("[role='option']").filter({ hasText: new RegExp(`^${value}$`, "i") }).first();
        if (await opt.count()) await opt.click({ timeout: 1500 }).catch(() => {});
      }
    } catch {
      // next
    }
  }
}

async function commitEducationFields(root, candidate, humanize) {
  const schoolLab = root.locator("label").filter({ hasText: /^School/i }).first();
  const degreeLab = root.locator("label").filter({ hasText: /^Degree/i }).first();
  for (const lab of [schoolLab, degreeLab]) {
    try {
      if (!(await lab.count())) continue;
      const fid = await lab.getAttribute("for");
      if (!fid) continue;
      const kind = /degree/i.test((await lab.innerText()) || "") ? "degree" : "school";
      const tries = kind === "school"
        ? schoolNameTries(candidate, { greenhouse: true })
        : degreeNameTries(candidate);
      if (await reactSelectCommitted(root, fid)) continue;
      // School: one fast primary attempt then Other — do not loop every alias.
      if (kind === "school") {
        let ok = false;
        for (const value of tries) {
          if (!value) continue;
          ok = await reactSelect(root, fid, value, { humanize });
          if (ok && (await reactSelectCommitted(root, fid))) break;
          // Empty catalog hit — jump straight to Other.
          if (value !== "Other" && tries.includes("Other")) {
            ok = await reactSelect(root, fid, "Other", { humanize });
            if (ok && (await reactSelectCommitted(root, fid))) break;
            break;
          }
        }
      } else {
        await fillSelectWithTries(root, fid, tries, humanize);
      }
      if (!(await reactSelectCommitted(root, fid))) {
        await fillFieldWithTries(root, fid, tries, humanize);
      }
      try {
        await root.locator(idSel(fid)).first().press("Tab");
      } catch {
        // ignore
      }
      await sleep(300);
      if (!(await reactSelectCommitted(root, fid))) {
        console.warn(`  education ${kind} still uncommitted after fill (${fid})`);
      }
    } catch {
      // next
    }
  }
  await commitEducationDates(root, candidate, humanize);
}

async function fillDiscoveredFields(root, fields, ctx, answers) {
  const hasEducation = Boolean((ctx.cfg.candidate.education || []).length || ctx.cfg.candidate.school);
  let skippedEdu = 0;
  for (const spec of fields) {
    if (isEducationLabel(spec.text) && !hasEducation) {
      skippedEdu += 1;
      continue;
    }
    const committed = spec.forId ? await reactSelectCommitted(root, spec.forId) : false;
    const current = await controlText(root, spec.forId);
    // Typed filter text can look filled while Greenhouse remix still requires a real option.
    if (committed) continue;
    if (!controlLooksEmpty(current) && spec.kind !== "checkbox" && !isEducationLabel(spec.text)) continue;
    await fillEducationOrEeo(root, spec, ctx, answers);
  }
  if (skippedEdu) console.log(`  skipped ${skippedEdu} education field(s) — candidate.school is empty`);
}

async function emptyRequiredNotes(root, fields) {
  const empty = [];
  for (const spec of fields) {
    if (!spec.required) continue;
    if (isEducationLabel(spec.text)) continue;
    const current = await controlText(root, spec.forId);
    if (controlLooksEmpty(current)) empty.push(spec.text.slice(0, 80));
  }
  return empty;
}

async function greenhouseRoot(page) {
  try {
    await page.waitForSelector(
      "#first_name, #resume, button:has-text('Submit application'), button:has-text('Quick Apply')",
      { timeout: 15000 }
    );
    return page;
  } catch {
    for (const frame of page.frames()) {
      const url = frame.url() || "";
      if (url.includes("greenhouse") || url.includes("job-boards")) return frame;
    }
    return page;
  }
}

async function applyGreenhouse(page, job, ctx) {
  const { board, jobId } = parseGreenhouseIds(job);
  const jobData = board && jobId ? await fetchGreenhouseJob(board, jobId) : {};
  if (board && jobId) {
    await page.goto(greenhouseEmbedUrl(board, jobId), { waitUntil: "domcontentloaded", timeout: 60000 });
  } else {
    await page.goto(job.apply_url || job.url, { waitUntil: "domcontentloaded", timeout: 60000 });
  }
  await sleep(1200);
  await dismissCookies(page);
  const root = await greenhouseRoot(page);
  await fillIdentity(root, ctx.cfg.candidate, ctx.humanize);
  await uploadResume(root, ctx.resumePath, ["#resume", "input[type='file'][id*='resume' i]", "input[type='file']"]);
  if (ctx.coverPath) {
    await uploadResume(root, ctx.coverPath, ["#cover_letter", "input[type='file'][id*='cover' i]"]);
  }
  await fillIfPresent(root, "textarea[id*='cover' i], textarea[name*='cover' i]", ctx.coverText.slice(0, 4500), {
    humanize: ctx.humanize,
  });

  const apiQuestions = greenhouseQuestionsFromJob(jobData);
  const demo = demographicQuestionsFromJob(jobData);
  let discovered = [];
  try {
    discovered = (await root.evaluate(discoverVisibleFields)) || [];
  } catch {
    discovered = [];
  }

  const optionsByQuestion = Object.fromEntries(
    apiQuestions.filter((q) => q.options.length).map((q) => [q.label, q.options])
  );
  for (const q of demo) {
    if (q.options?.length) optionsByQuestion[q.label] = q.options.map((o) => o.label);
  }
  for (const item of discovered) {
    if (item.options?.length) optionsByQuestion[item.text] = item.options;
  }
  const scraped = [...new Set([
    ...apiQuestions.map((q) => q.label),
    ...demo.map((q) => q.label),
    ...discovered.map((d) => d.text),
  ].filter(Boolean))];
  console.log(`  scraped ${scraped.length} form questions; filling from profile/resume first`);

  const candidate = answeringCandidate(ctx.cfg);
  let answers = await answerQuestions({
    questions: scraped,
    candidate,
    job,
    optionsByQuestion,
    prefs: ctx.cfg.answer_preferences,
    llmChat: null,
  });

  await fillApiQuestions(root, apiQuestions, answers, ctx.humanize);
  if (demo.length) {
    console.log(`  Greenhouse EEO: ${demo.length}`);
    for (const q of demo) {
      const pick = eeoAnswer(
        q.label,
        candidate,
        ctx.cfg.answer_preferences,
        q.options.map((o) => o.label)
      );
      await reactSelect(root, q.id, pick, { humanize: ctx.humanize });
    }
  }
  await answerByLabelFallbacks(root, candidate, ctx.cfg.answer_preferences, ctx.humanize);
  await fillDiscoveredFields(
    root,
    discovered.filter((d) => !IDENTITY_FIELD_IDS.has(d.forId)),
    ctx,
    answers
  );

  const stillEmpty = [];
  for (const spec of [...discovered.map((d) => ({ ...d, fieldId: d.forId })), ...apiQuestions.map((q) => ({
    text: q.label,
    forId: q.fieldId,
    fieldId: q.fieldId,
    options: q.options,
    kind: /multi_value|select/i.test(q.type) ? "select" : "text",
  }))]) {
    if (!spec.forId || IDENTITY_FIELD_IDS.has(spec.forId)) continue;
    if (stillEmpty.some((s) => s.forId === spec.forId)) continue;
    const current = await controlText(root, spec.forId);
    if (controlLooksEmpty(current)) stillEmpty.push(spec);
  }
  const retryKnown = stillEmpty.filter((s) => !needsLlmAnswer(answers[s.text], s.text));
  const needLlm = stillEmpty.filter((s) => needsLlmAnswer(answers[s.text], s.text));
  if (retryKnown.length) await fillDiscoveredFields(root, retryKnown, ctx, answers);
  if (needLlm.length && ctx.llmChat) {
    const extra = await answerQuestions({
      questions: needLlm.map((d) => d.text),
      candidate,
      job,
      optionsByQuestion,
      prefs: ctx.cfg.answer_preferences,
      llmChat: ctx.llmChat,
    });
    answers = { ...answers, ...extra };
    await fillApiQuestions(root, apiQuestions.filter((q) => extra[q.label]), answers, ctx.humanize);
    await fillDiscoveredFields(root, needLlm, ctx, answers);
  }

  // Verify readback + one retry for anything still Select... (auto-apply / ChamPro pattern).
  const verifyEmpty = [];
  for (const spec of discovered.filter((d) => !IDENTITY_FIELD_IDS.has(d.forId))) {
    const current = await controlText(root, spec.forId);
    if (controlLooksEmpty(current)) verifyEmpty.push(spec);
  }
  for (const q of apiQuestions) {
    if (IDENTITY_FIELD_IDS.has(q.fieldId)) continue;
    if (verifyEmpty.some((s) => s.forId === q.fieldId)) continue;
    const current = await controlText(root, q.fieldId);
    if (controlLooksEmpty(current)) {
      verifyEmpty.push({
        text: q.label,
        forId: q.fieldId,
        options: q.options,
        kind: /multi_value|select/i.test(q.type) ? "select" : "text",
      });
    }
  }
  if (verifyEmpty.length) {
    console.log(`  verify retry ${verifyEmpty.length} empty field(s)`);
    await fillDiscoveredFields(root, verifyEmpty, ctx, answers);
    await fillApiQuestions(
      root,
      apiQuestions.filter((q) => verifyEmpty.some((s) => s.forId === q.fieldId)),
      answers,
      ctx.humanize
    );
  }

  await commitEducationFields(root, candidate, ctx.humanize);
  await checkConsentBoxes(root);
  await maybeFillOtp(page, ctx.cfg);

  const emptyRequired = await emptyRequiredNotes(root, discovered.length ? discovered : apiQuestions.map((q) => ({
    text: q.label,
    forId: q.fieldId,
    required: q.required,
  })));
  const bits = [];
  if (emptyRequired.length) bits.push(`empty required: ${emptyRequired.slice(0, 4).join("; ")}`);
  if (discovered.some((d) => isEducationLabel(d.text)) && !(ctx.cfg.candidate.education || []).length) {
    bits.push("education skipped (candidate.school empty)");
  }
  const extraNote = bits.length ? ` — ${bits.join("; ")}` : "";
  return finish(page, root, job, ctx, "Greenhouse", extraNote);
}

async function applyAshby(page, job, ctx) {
  // Port of Fillow v1: job_auto_apply.apply._apply_ashby + extension/content/ashby.js
  const url = (job.apply_url || job.url || "").replace(/\/$/, "");
  const candidates = url.endsWith("/application")
    ? [url, url.replace(/\/application$/, "")]
    : [`${url}/application`, url];
  let opened = false;
  for (const target of candidates) {
    try {
      await page.goto(target, { waitUntil: "domcontentloaded", timeout: 60000 });
      await sleep(1500);
      const title = String((await page.title()) || "").toLowerCase();
      if (title.includes("not found")) continue;
      let bodyHead = "";
      try {
        bodyHead = (await page.innerText("body")).slice(0, 400).toLowerCase();
      } catch {
        bodyHead = "";
      }
      if (bodyHead.includes("page not found")) continue;
      opened = true;
      break;
    } catch {
      // next
    }
  }
  if (!opened) return result(job, "failed", "Could not open Ashby application page");

  await dismissCookies(page);
  for (const sel of [
    "[role='tab']:has-text('Application')",
    "a:has-text('Application')",
    "button:has-text('Application')",
    "button:has-text('Apply for this Job')",
    "button:has-text('Apply for this job')",
    "a:has-text('Apply for this job')",
    "a:has-text('Apply')",
    "button:has-text('Apply')",
  ]) {
    const btn = page.locator(sel).first();
    try {
      if ((await btn.count()) && (await btn.isVisible({ timeout: 800 }))) {
        await btn.click();
        await sleep(1200);
        break;
      }
    } catch {
      // next
    }
  }

  try {
    await page.waitForSelector(
      "#_systemfield_name, input[name='_systemfield_name'], input[type='email'], #_systemfield_resume",
      { timeout: 12000 }
    );
  } catch {
    // continue
  }

  const c = ctx.cfg.candidate;
  for (const [sel, val] of [
    ["#_systemfield_name, input[name='_systemfield_name']", c.full_name],
    ["#_systemfield_email, input[name='_systemfield_email'], input[type='email']", c.email],
  ]) {
    const loc = page.locator(sel).first();
    try {
      if (await loc.count()) {
        await humanFill(loc, val, { humanize: ctx.humanize });
        await sleep(250);
      }
    } catch {
      await fillIfPresent(page, sel, val, { humanize: ctx.humanize });
    }
  }
  let digits = phoneDigits(c.phone) || String(c.phone || "").replace(/\D/g, "");
  if (digits.startsWith("1") && digits.length === 11) digits = digits.slice(1);
  const phoneLoc = page.locator("#phone, input[name='phone'], input[type='tel']").first();
  try {
    if (await phoneLoc.count()) {
      await humanFill(phoneLoc, digits || c.phone, { humanize: ctx.humanize });
      await sleep(250);
    }
  } catch {
    await fillIfPresent(page, "#phone, input[name='phone'], input[type='tel']", digits || c.phone, {
      humanize: ctx.humanize,
    });
  }

  // Resume: Ashby requires #_systemfield_resume (NOT the autofill uploader) — Fillow v1
  const uploaded = await ashbyUploadResume(page, ctx.resumePath);
  if (ctx.coverPath) {
    await uploadResume(page, ctx.coverPath, ["#cover_letter", "input[type='file'][id*='cover' i]"]);
  }

  let discovered = [];
  try {
    const facts = (await page.evaluate(scrapeAshbyQuestionFacts)) || [];
    discovered = discoverAshbyFromFacts(facts);
  } catch {
    discovered = [];
  }
  const questions = [...new Set(discovered.map((d) => d.text))];
  const optionsByQuestion = {};
  for (const item of discovered) {
    if (item.options?.length) optionsByQuestion[item.text] = item.options;
  }
  if (questions.length) {
    console.log(`  scraped ${questions.length} Ashby questions; filling from profile/resume first`);
    const candidate = answeringCandidate(ctx.cfg);
    let answers = await answerQuestions({
      questions,
      candidate,
      job,
      optionsByQuestion,
      prefs: ctx.cfg.answer_preferences,
      llmChat: null,
    });
    // Hard profile overrides (Fillow v1 config wins)
    for (const q of Object.keys(answers)) {
      const ql = q.toLowerCase();
      if (ql.includes("passport")) answers[q] = c.passport_country || answers[q];
      else if (ql.includes("country of residence") || (ql.includes("residence") && ql.includes("country"))) {
        answers[q] = c.country_of_residence || answers[q];
      } else if (ql.startsWith("github")) answers[q] = c.github || answers[q];
      else if ((ql === "linkedin" || ql.startsWith("linkedin")) && !ql.includes("hear")) {
        answers[q] = c.linkedin || answers[q];
      }
    }
    await applyAnswers(page, discovered, answers, ctx.coverText, ctx.humanize, c);
    const needLlm = discovered.filter((d) => needsLlmAnswer(answers[d.text], d.text));
    if (needLlm.length && ctx.llmChat) {
      console.log(`  NIM ${needLlm.length}/${needLlm.length} Ashby questions with no profile/resume fact`);
      const extra = await answerQuestions({
        questions: needLlm.map((d) => d.text),
        candidate,
        job,
        optionsByQuestion,
        prefs: ctx.cfg.answer_preferences,
        llmChat: ctx.llmChat,
      });
      answers = { ...answers, ...extra };
      await applyAnswers(page, needLlm, answers, ctx.coverText, ctx.humanize, c);
    }
  }

  // Direct profile fills (Fillow v1 belt-and-suspenders) — never leave "Please see resume" on identity.
  for (const [labelText, value] of [
    ["Legal First Name", c.first_name],
    ["Preferred First Name", c.first_name],
    ["Legal Last Name", c.last_name],
    ["Preferred Last Name", c.last_name],
    ["Email Address", c.email],
    ["Phone Number", digits || c.phone],
    ["LinkedIn Profile", c.linkedin],
    ["Github Profile", c.github],
    ["GitHub Profile", c.github],
  ]) {
    if (!value) continue;
    try {
      const lab = page.locator(
        `label.ashby-application-form-question-title:text-is("${labelText}"), label[class*="_heading_"]:text-is("${labelText}")`
      ).first();
      if (!(await lab.count())) continue;
      const fid = await lab.getAttribute("for");
      if (!fid) continue;
      const loc = page.locator(`[id="${fid}"]`).first();
      if (await loc.count()) {
        await humanFill(loc, value, { humanize: ctx.humanize });
        await sleep(200);
      }
    } catch {
      // next
    }
  }

  // Belt-and-suspenders: short seeds only (Fillow extension never typed long phrases).
  // Do NOT match bare "work from" — that hits "work from our US office" Yes/No questions.
  await fillAshbyAutocomplete(
    page,
    /location do you intend|what location|work location|_systemfield_location|^location$/i,
    ashbyAutocompleteTries("What location do you intend to work from?", c.work_location_intent || c.location),
    ctx.humanize
  );
  await fillAshbyAutocomplete(
    page,
    /how did you hear|hear about/i,
    ashbyAutocompleteTries("How did you hear about this?", ctx.cfg.answer_preferences?.how_heard || "LinkedIn"),
    ctx.humanize
  );

  await ashbyClickYesNo(page, c);
  await ashbyCheckRequiredBoxes(page);
  // Domain / expertise radios that answers may have missed
  for (const [re, want] of [
    [/technical domain|prefer to work in and have most expertise/i, "Full Stack"],
    [/years of industry experience/i, c.years_experience || "3"],
  ]) {
    const lab = page.locator("label.ashby-application-form-question-title, label[class*=\"_heading_\"]")
      .filter({ hasText: re })
      .first();
    if (!(await lab.count())) continue;
    const fid = await lab.getAttribute("for");
    if (!fid) continue;
    if (/years of industry|how many years/i.test(String(re))) {
      const loc = page.locator(`[id="${fid}"]`).first();
      if (await loc.count()) await humanFill(loc, want, { humanize: ctx.humanize }).catch(() => {});
    } else {
      await clickMatchingChoice(page, `input[type="radio"][id*="${fid}"], input[type="radio"][name*="${fid}"]`, want);
    }
  }
  if (!uploaded) return result(job, "failed", "Could not upload resume on Ashby form");

  const missing = await ashbyMissingRequired(page);
  if (missing.length) {
    console.warn(`  Ashby still empty required: ${missing.slice(0, 6).join(" | ")}`);
    await ashbyClickYesNo(page, c);
    for (const label of missing) {
      const ql = label.toLowerCase();
      if (/sponsor|polygraph|clearance|maryland|relocation|office three days|work from our/.test(ql)) {
        continue; // handled by ashbyClickYesNo
      }
      if (ashbyRetryIsLocation(label)) {
        await fillAshbyAutocomplete(page, new RegExp(escapeRe(label.slice(0, 40)), "i"), ["United States", "Remote"], ctx.humanize);
      } else if (/hear about|how did you hear/.test(ql)) {
        await fillAshbyAutocomplete(page, new RegExp(escapeRe(label.slice(0, 40)), "i"), ["Job Board", "LinkedIn", "Indeed"], ctx.humanize);
      } else if (/technical domain|expertise with/.test(ql)) {
        const lab = page.locator("label").filter({ hasText: label.slice(0, 40) }).first();
        const fid = await lab.getAttribute("for").catch(() => null);
        if (fid) await clickMatchingChoice(page, `input[type="radio"][id*="${fid}"], input[type="radio"][name*="${fid}"]`, "Full Stack");
      } else if (/when can you start|start a new role/.test(ql)) {
        const lab = page.locator("label").filter({ hasText: /when can you start|start a new role/i }).first();
        const input = lab.locator("xpath=ancestor::*[contains(@class,'_fieldEntry_')][1]//input").first();
        if (await input.count()) {
          await input.fill(ashbyStartDateDefault());
          await input.press("Enter").catch(() => {});
        }
      }
    }
    await ashbyCheckRequiredBoxes(page);
  }
  const stillMissing = await ashbyMissingRequired(page);
  if (stillMissing.length) {
    console.warn(`  Ashby blocking submit — empty: ${stillMissing.slice(0, 5).join("; ")}`);
    return result(job, "review", `Ashby form incomplete — empty: ${stillMissing.slice(0, 4).join("; ")}`, {
      pdf: existsSync(ctx.resumePath) ? "✅" : "❌",
    });
  }

  await maybeFillOtp(page, ctx.cfg);
  return finish(page, page, job, ctx, "Ashby", "");
}

async function applyLever(page, job, ctx) {
  let url = job.apply_url || job.url;
  if (!url.includes("/apply")) url = `${url.replace(/\/$/, "")}/apply`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(1200);
  await dismissCookies(page);
  for (const label of [/accept/i, /agree/i, /deny/i]) {
    const btn = page.getByRole("button", { name: label }).first();
    try {
      if ((await btn.count()) && (await btn.isVisible({ timeout: 600 }))) {
        await btn.click({ timeout: 1500 });
        await sleep(400);
      }
    } catch {
      // next
    }
  }
  await fillIdentity(page, ctx.cfg.candidate, ctx.humanize);
  await fillLeverLocation(page, ctx.cfg.candidate, ctx.humanize);
  await uploadResume(page, ctx.resumePath, ["#resume-upload-input", "input[name='resume']", "input[type='file']"]);
  await fillIfPresent(page, "textarea[name='comments'], textarea[name='coverLetter']", ctx.coverText.slice(0, 4500), {
    humanize: ctx.humanize,
  });
  let discovered = [];
  try {
    discovered = (await page.evaluate(discoverLeverQuestions)) || [];
  } catch {
    discovered = [];
  }
  if (!discovered.length) {
    try {
      discovered = (await page.evaluate(discoverVisibleFields)) || [];
    } catch {
      discovered = [];
    }
  }
  if (discovered.length) {
    const optionsByQuestion = {};
    for (const item of discovered) {
      if (item.options?.length) optionsByQuestion[item.text] = item.options;
    }
    console.log(`  scraped ${discovered.length} Lever questions; filling from profile/resume first`);
    const candidate = answeringCandidate(ctx.cfg);
    let answers = await answerQuestions({
      questions: discovered.map((d) => d.text),
      candidate,
      job,
      optionsByQuestion,
      prefs: ctx.cfg.answer_preferences,
      llmChat: null,
    });
    for (const d of discovered) {
      const q = d.text.toLowerCase();
      if (answers[d.text]) continue;
      if (/language skill/.test(q)) answers[d.text] = "English (ENG)";
      else if (/how you heard|heard about/.test(q)) answers[d.text] = ctx.cfg.answer_preferences?.how_heard || "LinkedIn";
      else if (/years of relevant|years of experience|post college/.test(q)) {
        answers[d.text] = candidate.years_experience || "3";
      } else if (/security clearance/.test(q) && /hold|currently/.test(q)) answers[d.text] = "No";
      else if (/eligible to obtain.*clearance|security clearance specified/.test(q)) answers[d.text] = "No";
      else if (/share my resume|external.*partners/.test(q)) answers[d.text] = "No";
      else if (/resident of california/.test(q)) answers[d.text] = "No";
      else if (/ai notetaker|consent/.test(q)) {
        answers[d.text] = d.options?.find((o) => /yes.*consent/i.test(o)) || "Yes, I consent";
      } else if (/university|school/.test(q)) {
        answers[d.text] = "Other (School Not Listed)";
      }
    }
    for (const d of discovered) {
      const ans = answers[d.text];
      if (!ans) continue;
      if (isEducationLabel(d.text) && /university|school/.test(d.text.toLowerCase())) {
        const tries = [
          ...schoolNameTries(candidate, { greenhouse: false }),
          "Other (School Not Listed)",
          "Other",
        ];
        let ok = false;
        for (const t of tries) {
          if (await fillLeverField(page, d, t, ctx.humanize)) {
            ok = true;
            break;
          }
        }
        if (!ok) await fillLeverField(page, d, ans, ctx.humanize);
        continue;
      }
      await fillLeverField(page, d, ans, ctx.humanize);
    }
    const needLlm = discovered.filter((d) => needsLlmAnswer(answers[d.text], d.text));
    if (needLlm.length && ctx.llmChat) {
      console.log(`  NIM ${needLlm.length}/${needLlm.length} Lever questions with no profile/resume fact`);
      const extra = await answerQuestions({
        questions: needLlm.map((d) => d.text),
        candidate,
        job,
        optionsByQuestion,
        prefs: ctx.cfg.answer_preferences,
        llmChat: ctx.llmChat,
      });
      answers = { ...answers, ...extra };
      for (const d of needLlm) {
        if (answers[d.text]) await fillLeverField(page, d, answers[d.text], ctx.humanize);
      }
    }
  }
  await checkConsentBoxes(page);
  await maybeFillOtp(page, ctx.cfg);
  return finish(page, page, job, ctx, "Lever");
}

async function applyWorkday(page, job, ctx) {
  await page.goto(job.apply_url || job.url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(1500);
  await dismissCookies(page);
  for (const sel of ["button:has-text('Apply')", "a:has-text('Apply')", "button:has-text('Apply Manually')"]) {
    const btn = page.locator(sel).first();
    try {
      if ((await btn.count()) && (await btn.isVisible({ timeout: 1000 }))) {
        await btn.click();
        await sleep(1200);
      }
    } catch {
      // next
    }
  }
  const signin = await visibleBody(page);
  if (signin.includes("sign in") || signin.includes("create account")) {
    return result(job, "review", "Workday auth gate — complete login in the browser");
  }
  await fillIdentity(page, ctx.cfg.candidate, ctx.humanize);
  await uploadResume(page, ctx.resumePath, ["input[type='file']"]);
  return finish(page, page, job, ctx, "Workday");
}

async function finish(page, root, job, ctx, boardName, extraNote = "") {
  if (ctx.reviewMode || !ctx.autoSubmit) {
    await sleep(2500);
    try {
      await page.screenshot({ path: `${PATHS.data}/${boardName.toLowerCase()}_filled_preview.png`, fullPage: true });
    } catch {
      // ignore
    }
    return result(job, "review", `Form filled (${boardName}); left for review — Submit not clicked${extraNote}`, {
      pdf: existsSync(ctx.resumePath) ? "✅" : "❌",
    });
  }

  // Commit education before the first submit so we do not burn an OTP on a dead form.
  await commitEducationFields(root, ctx.cfg.candidate, ctx.humanize);

  const otpSeen = new Set();
  if (ctx.cfg.gmail?.imap_user && ctx.cfg.gmail?.app_password) {
    try {
      const prior = await fetchRecentMail({
        user: ctx.cfg.gmail.imap_user,
        password: ctx.cfg.gmail.app_password,
        query: 'X-GM-RAW "newer_than:30m (verification OR otp OR \\"security code\\" OR greenhouse)"',
        limit: 20,
      });
      for (const msg of prior) otpSeen.add(msg.id);
      console.log(`  OTP baseline: ignoring ${otpSeen.size} recent verification mail(s)`);
    } catch {
      // poll will still use notBeforeMs
    }
  }
  const submitAt = Date.now();
  const clicked = await clickSubmit(root, page, { pauseSeconds: ctx.pauseSeconds });
  if (!clicked) return result(job, "failed", `Submit button not found (${boardName})${extraNote}`);
  await sleep(3500);

  // If Greenhouse bounced on education, re-commit and submit once more before OTP.
  let visible = await visibleBody(page);
  if (/degree is required|school is required/i.test(visible)) {
    console.log("  education validation failed — recommitting school/degree");
    // Any OTP from the failed submit is stale once we re-submit.
    if (ctx.cfg.gmail?.imap_user && ctx.cfg.gmail?.app_password) {
      try {
        const mid = await fetchRecentMail({
          user: ctx.cfg.gmail.imap_user,
          password: ctx.cfg.gmail.app_password,
          query: 'X-GM-RAW "newer_than:30m (verification OR otp OR \\"security code\\" OR greenhouse)"',
          limit: 20,
        });
        for (const msg of mid) otpSeen.add(msg.id);
      } catch {
        // ignore
      }
    }
    await commitEducationFields(root, ctx.cfg.candidate, ctx.humanize);
    await sleep(500);
    await clickSubmit(root, page, { pauseSeconds: 1 });
    await sleep(2500);
    visible = await visibleBody(page);
  }

  // Stripe/Greenhouse often send the human-check OTP only AFTER the first Submit click.
  const otpFilled = await maybeFillOtp(page, ctx.cfg, {
    seenIds: otpSeen,
    notBeforeMs: submitAt - 15_000,
  });
  if (otpFilled) {
    await sleep(2500);
    try {
      await clickSubmit(root, page, { pauseSeconds: 1 });
      await sleep(2500);
    } catch {
      // ignore
    }
  }
  visible = await visibleBody(page);
  if (spamFlagged(visible)) {
    return result(job, "review", `${boardName} flagged possible spam — fell back to review mode`, {
      pdf: existsSync(ctx.resumePath) ? "✅" : "❌",
    });
  }
  if (confirmationText(visible) || (boardName === "Ashby" && ashbyLooksSubmitted(visible))) {
    return result(job, "applied", `Submitted via ${boardName}`, { pdf: "✅" });
  }
  let stillOnForm = false;
  try {
    const still = await root.locator(
      "button:has-text('Submit Application'), button:has-text('Submit application'), button[type='submit']"
    ).filter({ hasText: /submit/i }).count();
    stillOnForm = still > 0;
  } catch {
    stillOnForm = false;
  }
  // Ashby confirmation often stays on /application — never treat bare submit as applied.
  try {
    const u = page.url();
    if (boardName === "Ashby" && /\/application\/?(\?|$)/i.test(u)) stillOnForm = true;
  } catch {
    // ignore
  }
  if (stillOnForm) {
    const errs = [];
    const stuckLabels = [];
    try {
      const errLoc = root.locator(".error, [class*='error--'], [id$='-error'], [class*='_error_'], [class*='fieldError'], [aria-invalid='true']");
      const n = Math.min(await errLoc.count(), 12);
      for (let i = 0; i < n; i += 1) {
        try {
          const el = errLoc.nth(i);
          const t = ((await el.innerText({ timeout: 400 })) || "").trim();
          if (t) errs.push(t.slice(0, 120));
          // Climb to a nearby question label when Greenhouse only says "This field is required."
          try {
            const label = await el.evaluate((node) => {
              const block = node.closest("[class*='field'], [class*='question'], .field, fieldset, li") || node.parentElement;
              const lab = block?.querySelector("label, [class*='label'], legend, p");
              return (lab?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 160);
            });
            if (label && label.length > 3 && !/^this field is required/i.test(label)) stuckLabels.push(label);
          } catch {
            // ignore
          }
        } catch {
          // ignore
        }
      }
      if (/missing entry|invalid value|required/i.test(visible)) {
        const m = visible.match(/missing entry[^\n.]{0,80}|invalid value[^\n.]{0,80}/gi) || [];
        for (const x of m.slice(0, 4)) errs.push(x.trim());
      }
    } catch {
      // ignore
    }
    const fromNote = String(extraNote || "").match(/empty required:\s*([^—]+)/i);
    if (fromNote) {
      for (const part of fromNote[1].split(";")) {
        const t = part.trim();
        if (t) stuckLabels.push(t);
      }
    }
    const msg = errs.length
      ? `${boardName} still open after submit — ${errs.slice(0, 4).join("; ")}`
      : `Submit clicked via ${boardName} (form still open)${extraNote}`;
    try {
      recordStuck({
        company: job.company,
        title: job.title,
        ats: boardName,
        url: job.apply_url || job.url,
        labels: stuckLabels.length ? stuckLabels : errs,
        notes: msg,
      });
    } catch {
      // never block apply on logging
    }
    return result(job, "review", msg, { pdf: "✅", stuck_labels: stuckLabels });
  }
  if (boardName === "Ashby") {
    return result(job, "review", `Submit clicked via Ashby (confirmation unclear)${extraNote}`, {
      pdf: existsSync(ctx.resumePath) ? "✅" : "❌",
    });
  }
  return result(job, "applied", `Submitted via ${boardName}${extraNote}`, {
    pdf: existsSync(ctx.resumePath) ? "✅" : "❌",
  });
}

export async function applyOnPage(page, job, ctx) {
  const ats = detectAts(job);
  job.ats = ats;
  if (ats === "greenhouse") return applyGreenhouse(page, job, ctx);
  if (ats === "ashby") return applyAshby(page, job, ctx);
  if (ats === "lever") return applyLever(page, job, ctx);
  if (ats === "workday") return applyWorkday(page, job, ctx);
  return result(job, "review", `No automated ATS path for ${ats}`);
}

export { result, discoverAshbyFromFacts, scrapeAshbyQuestionFacts };

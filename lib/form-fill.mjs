import { existsSync } from "node:fs";
import { answerQuestions, needsLlmAnswer } from "./answer-engine.mjs";
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
import { pollOtp } from "./gmail.mjs";
import { PATHS } from "./paths.mjs";

function discoverAshbyQuestions() {
  const titles = [...document.querySelectorAll(
    "label.ashby-application-form-question-title, label[class*=\"_heading_\"]"
  )];
  return titles.map((lab) => {
    const text = (lab.innerText || "").trim().replace(/\s+/g, " ");
    const forId = lab.getAttribute("for") || "";
    const required = /_required_/.test(lab.className || "");
    const target = forId ? document.getElementById(forId) : null;
    let kind = "unknown";
    let options = [];
    if (target) {
      const tag = target.tagName.toLowerCase();
      const typ = (target.type || "").toLowerCase();
      const role = (target.getAttribute("role") || "").toLowerCase();
      if (typ === "file") kind = "file";
      else if (tag === "textarea") kind = "textarea";
      else if (tag === "select" || role === "combobox") kind = "select";
      else kind = "text";
      if (tag === "select") options = [...target.options].map((o) => (o.text || "").trim()).filter(Boolean);
    } else if (forId) {
      const radios = [...document.querySelectorAll("input[type=radio]")].filter((r) =>
        (r.id || "").includes(forId) || (r.name || "").includes(forId)
      );
      if (radios.length) {
        kind = "radio";
        options = radios.map((r) => {
          const l = (r.labels && r.labels[0] && r.labels[0].innerText)
            || (document.querySelector(`label[for="${r.id}"]`) || {}).innerText
            || r.value || "";
          return String(l).trim();
        }).filter(Boolean);
      } else {
        let root = lab.parentElement;
        let yesNo = [];
        for (let i = 0; i < 6 && root; i += 1) {
          const btns = [...root.querySelectorAll('button[class*="_option_"]')];
          const labels = btns.map((b) => (b.innerText || "").trim()).filter(Boolean);
          if (labels.length >= 2) {
            yesNo = labels;
            break;
          }
          root = root.parentElement;
        }
        const hasCheckbox = !!document.querySelector(`input[type=checkbox][name="${forId}"]`);
        if (yesNo.length >= 2 || hasCheckbox) {
          kind = "boolean";
          options = yesNo.length ? yesNo : ["Yes", "No"];
        }
      }
    }
    return { text, forId, required, kind, options };
  }).filter((x) => x.text && x.forId && !["Name", "Email", "Resume", "Upload File"].includes(x.text));
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

async function pickBestOption(root, value, fieldId = "") {
  let options = root.locator(".select__menu [role='option'], .select__option, [class*='select__option']");
  if ((await options.count()) === 0) options = root.locator("[role='option']");
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
  try {
    await options.nth(bestIdx).click({ timeout: 2000 });
    await sleep(250);
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
  try {
    if ((await loc.count()) === 0) return false;
    await loc.scrollIntoViewIfNeeded({ timeout: 2000 });
    const control = root.locator(`${sel} >> xpath=ancestor::div[contains(@class,'select__control')]`).first();
    if (await control.count()) await control.click({ timeout: 2000 });
    else await loc.click({ timeout: 2000 });
    const want = text.toLowerCase();
    if (want === "yes" || want === "no") {
      await sleep(350);
      if (await pickBestOption(root, text, fieldId)) return true;
      try {
        await loc.press("Escape");
      } catch {
        // ignore
      }
      return false;
    }
    try {
      await loc.fill("");
    } catch {
      // ignore
    }
    if (humanize) await loc.pressSequentially(text, { delay: 20 });
    else await loc.fill(text);
    await sleep(700);
    if (await pickBestOption(root, text, fieldId)) return true;
    try {
      await loc.press("ArrowDown");
      await sleep(150);
      await loc.press("Enter");
      await sleep(200);
      if (!controlLooksEmpty(await controlText(root, fieldId))) return true;
    } catch {
      // ignore
    }
    try {
      await loc.press("Enter");
      await sleep(200);
      if (!controlLooksEmpty(await controlText(root, fieldId))) return true;
    } catch {
      // ignore
    }
    try {
      await loc.press("Escape");
    } catch {
      // ignore
    }
    return false;
  } catch {
    return false;
  }
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

async function checkLabeledOption(root, namePrefix, answer) {
  const want = String(answer || "").toLowerCase();
  if (!want) return false;
  const boxes = root.locator(`input[type=checkbox][name="${namePrefix}"], input[type=checkbox][name="${namePrefix}[]"]`);
  const n = Math.min(await boxes.count(), 40);
  for (let i = 0; i < n; i += 1) {
    const box = boxes.nth(i);
    let label = "";
    try {
      label = await box.evaluate((el) => {
        const l = el.labels?.[0] || document.querySelector(`label[for="${el.id}"]`);
        return (l && l.innerText.trim()) || el.value || "";
      });
    } catch {
      // next
    }
    if (label.toLowerCase() === want || label.toLowerCase().includes(want)) {
      try {
        if (!(await box.isChecked())) await box.check({ timeout: 2000, force: true });
        return true;
      } catch {
        try {
          await root.locator(`label[for="${await box.getAttribute("id")}"]`).first().click({ timeout: 2000 });
          return true;
        } catch {
          return false;
        }
      }
    }
  }
  return false;
}

async function clickMatchingChoice(root, selector, answer) {
  const want = String(answer || "").toLowerCase();
  if (!want) return false;
  const loc = root.locator(selector);
  const n = Math.min(await loc.count(), 16);
  let best = { i: -1, score: -1 };
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
    const score = scoreOption(opt, want);
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
  await fillIfPresent(root, "#_systemfield_name, input[name='_systemfield_name'], input[name='name']", candidate.full_name, opts);
  if (!(await inputHasValue(root, "#email, input[name='email'], input[type='email'], #_systemfield_email"))) {
    await fillIfPresent(root, "#email, input[name='email'], input[type='email'], #_systemfield_email", candidate.email, opts);
  }
  const phone = phoneDigits(candidate.phone) || candidate.phone;
  if (!(await inputHasValue(root, "#phone, input[name='phone'], input[type='tel']"))) {
    await fillIfPresent(root, "#phone, input[name='phone'], input[type='tel']", phone, opts);
  }
  await fillIfPresent(root, "input[name*='linkedin' i], input[id*='linkedin' i]", candidate.linkedin, opts);
  await fillIfPresent(root, "input[name*='github' i], input[id*='github' i]", candidate.github, opts);
  if (controlLooksEmpty(await controlText(root, "country"))) {
    await reactSelect(root, "country", candidate.country_of_residence || "United States", opts);
  }
  if (controlLooksEmpty(await controlText(root, "candidate-location"))) {
    for (const locTry of [
      candidate.greenhouse_location,
      candidate.location,
      "Plano, Texas, United States",
    ]) {
      if (locTry && (await reactSelect(root, "candidate-location", locTry, opts))) break;
    }
  }
}

async function maybeFillOtp(page, cfg) {
  const loc = page.locator(
    "input[autocomplete='one-time-code'], input[inputmode='numeric'], input[name*='code' i], input[id*='verification' i], input[name*='otp' i], input[aria-label*='code' i]"
  ).first();
  try {
    await loc.waitFor({ state: "visible", timeout: 12000 });
  } catch {
    return false;
  }
  if (!cfg.gmail.imap_user || !cfg.gmail.app_password) {
    console.warn("OTP field present but Gmail IMAP is not configured (GMAIL_APP_PASSWORD)");
    return false;
  }
  console.log("  OTP field detected — polling Gmail IMAP");
  const hit = await pollOtp({
    user: cfg.gmail.imap_user,
    password: cfg.gmail.app_password,
    otpRegex: cfg.gmail.otp_regex,
  });
  if (!hit?.code) return false;
  await loc.fill(hit.code);
  for (const sel of ["button:has-text('Verify')", "button:has-text('Continue')", "button:has-text('Submit code')"]) {
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

async function applyAnswers(root, discovered, answers, cover, humanize) {
  for (const spec of discovered) {
    const ans = answers[spec.text];
    if (!ans && spec.kind !== "boolean" && spec.kind !== "radio" && spec.kind !== "checkbox") continue;
    const fid = spec.forId;
    if (spec.kind === "select") {
      await reactSelect(root, fid, ans, { humanize });
    } else if (spec.kind === "text" || spec.kind === "textarea") {
      const loc = root.locator(idSel(fid) || `[id="${fid}"]`).first();
      if ((await loc.count()) === 0) continue;
      const value = ans || (spec.required ? "Please see resume for details." : "");
      if (value) await humanFill(loc, /cover/i.test(spec.text) ? cover.slice(0, 4500) : value, { humanize });
      await sleep(jitterWait());
    } else if (spec.kind === "radio") {
      await clickMatchingChoice(root, `input[type="radio"][id*="${fid}"], input[type="radio"][name*="${fid}"]`, ans);
    } else if (spec.kind === "checkbox") {
      await checkLabeledOption(root, fid, ans);
    } else if (spec.kind === "boolean") {
      const want = String(ans || "Yes").toLowerCase().startsWith("n") ? "No" : "Yes";
      const btn = root.locator(`button[class*="_option_"]:has-text("${want}")`).first();
      try {
        if (await btn.count()) await btn.click({ timeout: 2000 });
      } catch {
        // ignore
      }
    }
  }
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
  ];
  for (const [needle, value] of pairs) {
    const lab = root.locator("label").filter({ hasText: needle }).first();
    try {
      if (!(await lab.count())) continue;
      const fid = await lab.getAttribute("for");
      if (!fid || IDENTITY_FIELD_IDS.has(fid)) continue;
      const current = await controlText(root, fid);
      if (!controlLooksEmpty(current)) continue;
      if (await root.locator(`${idSel(fid)}[role=combobox]`).count()) {
        if (!(await reactSelect(root, fid, value, { humanize }))) {
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
  if (isEducationLabel(q) && /\b(school|university|college)\b/i.test(q) && !/\bdegree\b/i.test(q)) {
    return fillFieldWithTries(root, spec.forId, schoolNameTries(candidate), humanize);
  }
  if (isEducationLabel(q) && /\b(degree|discipline|field of study)\b/i.test(q)) {
    return fillFieldWithTries(root, spec.forId, degreeNameTries(candidate), humanize);
  }
  if (isEeoLabel(q)) {
    const ans = eeoAnswer(q, candidate, ctx.cfg.answer_preferences, spec.options || []);
    if (!ans) return false;
    if (spec.kind === "select") return reactSelect(root, spec.forId, ans, { humanize });
    return fillGreenhouseField(root, spec.forId, ans, humanize);
  }
  const ans = answers[spec.text];
  if (!ans) return false;
  if (spec.kind === "select") return reactSelect(root, spec.forId, ans, { humanize });
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
    const option = pickApiOption(q.options, ans) || ans;
    const selectType = /multi_value|select/i.test(q.type);
    let filled = false;
    if (selectType) filled = await reactSelect(root, q.fieldId, option, { humanize });
    if (!filled) filled = await fillGreenhouseField(root, q.fieldId, option, humanize);
    if (!filled && (option === "Yes" || option === "No")) {
      await reactSelect(root, q.fieldId, option, { humanize });
    }
  }
}

async function fillDiscoveredFields(root, fields, ctx, answers) {
  const hasEducation = Boolean((ctx.cfg.candidate.education || []).length || ctx.cfg.candidate.school);
  let skippedEdu = 0;
  for (const spec of fields) {
    if (isEducationLabel(spec.text) && !hasEducation) {
      skippedEdu += 1;
      continue;
    }
    const current = await controlText(root, spec.forId);
    if (!controlLooksEmpty(current) && spec.kind !== "checkbox") continue;
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
  const url = (job.apply_url || job.url || "").replace(/\/$/, "");
  const candidates = url.endsWith("/application") ? [url] : [`${url}/application`, url];
  let opened = false;
  for (const target of candidates) {
    try {
      await page.goto(target, { waitUntil: "domcontentloaded", timeout: 60000 });
      await sleep(1500);
      const body = await visibleBody(page);
      if ((page.title() || "").toLowerCase().includes("not found") || body.includes("page not found")) continue;
      opened = true;
      break;
    } catch {
      // next
    }
  }
  if (!opened) return result(job, "failed", "Could not open Ashby application page");
  await dismissCookies(page);
  for (const sel of ["button:has-text('Apply for this job')", "button:has-text('Apply')", "a:has-text('Apply for this job')"]) {
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
    await page.waitForSelector("#_systemfield_name, input[type='email'], #_systemfield_resume", { timeout: 12000 });
  } catch {
    // continue
  }
  await fillIdentity(page, ctx.cfg.candidate, ctx.humanize);
  const uploaded = await uploadResume(page, ctx.resumePath, [
    "#_systemfield_resume",
    "input[type='file'][id='_systemfield_resume']",
  ]);
  if (ctx.coverPath) {
    await uploadResume(page, ctx.coverPath, ["#cover_letter", "input[type='file'][id*='cover' i]"]);
  }
  let discovered = [];
  try {
    discovered = (await page.evaluate(discoverAshbyQuestions)) || [];
  } catch {
    discovered = [];
  }
  const questions = [...new Set(discovered.map((d) => d.text))];
  const optionsByQuestion = {};
  for (const item of discovered) {
    if (item.options?.length) optionsByQuestion[item.text] = item.options;
  }
  if (questions.length) {
    console.log(`  Ashby questions: ${questions.length}`);
    const answers = await answerQuestions({
      questions,
      candidate: ctx.cfg.candidate,
      job,
      optionsByQuestion,
      prefs: ctx.cfg.answer_preferences,
      llmChat: ctx.llmChat,
    });
    await applyAnswers(page, discovered, answers, ctx.coverText, ctx.humanize);
  }
  await ashbyCheckRequiredBoxes(page);
  if (!uploaded) return result(job, "failed", "Could not upload resume on Ashby form");
  await maybeFillOtp(page, ctx.cfg);
  const emptyRequired = discovered.filter((d) => d.required && !isEducationLabel(d.text)).map((d) => d.text.slice(0, 80));
  const extraNote = emptyRequired.length ? ` — ${emptyRequired.length} required fields were marked` : "";
  return finish(page, page, job, ctx, "Ashby", extraNote);
}

async function applyLever(page, job, ctx) {
  let url = job.apply_url || job.url;
  if (!url.includes("/apply")) url = `${url.replace(/\/$/, "")}/apply`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(1200);
  await dismissCookies(page);
  await fillIdentity(page, ctx.cfg.candidate, ctx.humanize);
  await uploadResume(page, ctx.resumePath, ["input[type='file']"]);
  await fillIfPresent(page, "textarea[name='comments'], textarea[name='coverLetter'], textarea", ctx.coverText.slice(0, 4500), {
    humanize: ctx.humanize,
  });
  let discovered = [];
  try {
    discovered = (await page.evaluate(discoverVisibleFields)) || [];
  } catch {
    discovered = [];
  }
  if (discovered.length) {
    const optionsByQuestion = {};
    for (const item of discovered) {
      if (item.options?.length) optionsByQuestion[item.text] = item.options;
    }
    const answers = await answerQuestions({
      questions: discovered.map((d) => d.text),
      candidate: ctx.cfg.candidate,
      job,
      optionsByQuestion,
      prefs: ctx.cfg.answer_preferences,
      llmChat: ctx.llmChat,
    });
    await fillDiscoveredFields(page, discovered, ctx, answers);
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
  const clicked = await clickSubmit(root, page, { pauseSeconds: ctx.pauseSeconds });
  if (!clicked) return result(job, "failed", `Submit button not found (${boardName})${extraNote}`);
  await sleep(3500);
  const visible = await visibleBody(page);
  if (spamFlagged(visible)) {
    return result(job, "review", `${boardName} flagged possible spam — fell back to review mode`);
  }
  if (confirmationText(visible)) return result(job, "applied", `Submitted via ${boardName}`, { pdf: "✅" });
  try {
    const still = await root.locator("button:has-text('Submit application')").count();
    if (still > 0) {
      const errs = [];
      const errLoc = root.locator(".error, [class*='error--'], [id$='-error']");
      const n = Math.min(await errLoc.count(), 8);
      for (let i = 0; i < n; i += 1) {
        try {
          const t = ((await errLoc.nth(i).innerText({ timeout: 400 })) || "").trim();
          if (t) errs.push(t.slice(0, 120));
        } catch {
          // ignore
        }
      }
      const msg = errs.length ? `${boardName} still open after submit — ${errs.slice(0, 4).join("; ")}` : `Submit clicked via ${boardName} (form still open)${extraNote}`;
      return result(job, "review", msg, { pdf: "✅" });
    }
  } catch {
    // ignore
  }
  return result(job, "applied", `Submit clicked via ${boardName} (confirmation unclear)${extraNote}`, { pdf: "✅" });
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

export { result };

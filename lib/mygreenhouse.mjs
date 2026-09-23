import { existsSync } from "node:fs";
import { evaluate, fill, select, click, navigate, pause, upload } from "./bsk.mjs";
import { answerQuestions } from "./answer-engine.mjs";
import { resolveResumePath } from "./resume-pdf.mjs";
import { makeLlmChat } from "./llm.mjs";
import { recordStuck, upsertQaBankEntry } from "./stuck-questions.mjs";

const SEARCH_URL = "https://my.greenhouse.io/jobs/search";

/** Canonical apply URL / identity for a MyGreenhouse job (never the search page). */
export function mghCanonicalUrl(job = {}) {
  const fromId = String(job.external_id || "");
  const m = fromId.match(/^mgh:([^:]+):(\d+)$/i);
  if (m) return `https://my.greenhouse.io/jobs/${m[1]}/${m[2]}`;
  const href = String(job.apply_url || job.url || "");
  const hm = href.match(/my\.greenhouse\.io\/jobs\/([^/?#]+)\/(\d+)/i);
  if (hm) return `https://my.greenhouse.io/jobs/${hm[1]}/${hm[2]}`;
  if (job.board_token && job.external_id) {
    const id = String(job.external_id).split(":").pop();
    if (/^\d+$/.test(id)) return `https://my.greenhouse.io/jobs/${job.board_token}/${id}`;
  }
  return href && !/\/jobs\/search/i.test(href) ? href : "";
}

/** Parse a MyGreenhouse result card blob into structured fields. */
export function parseMgJobCard(text, board, id, href) {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  const posted = (raw.match(/Posted\s*·\s*([^·]+?)(?:\s*$)/i) || [])[1]?.trim() || "";
  let body = raw.replace(/\s*Posted\s*·\s*.*$/i, "").trim();
  body = body.replace(/^\s*[A-Z]\s+/, ""); // leading avatar initial
  const work = (body.match(/\b(Remote|Hybrid|In person|On[- ]?site)\b/i) || [])[1] || "";
  const salary = (body.match(/\$[\d,]+\s*-\s*\$[\d,]+/) || [])[0] || "";
  let title = body;
  // Prefer board token as company — card text often glues title+company and mis-parses.
  const company = board || "unknown";
  let location = "";
  if (work) {
    const parts = body.split(new RegExp(`\\b${work}\\b`, "i"));
    title = (parts[0] || "").trim() || body;
    location = (parts.slice(1).join(work) || "").replace(salary, "").trim();
    // Strip trailing company echo of the board name from the title when present.
    const boardWords = String(board || "").replace(/[^a-z0-9]+/gi, " ").trim();
    if (boardWords && new RegExp(`\\b${boardWords}\\b`, "i").test(title) === false) {
      // leave title
    }
    title = title.replace(new RegExp(`\\s+${board}\\s*$`, "i"), "").trim() || title;
  }
  const apply = href && /\/jobs\/[^/]+\/\d+/i.test(href)
    ? href.split("?")[0]
    : `https://my.greenhouse.io/jobs/${board}/${id}`;
  return {
    source: "mygreenhouse",
    external_id: `mgh:${board}:${id}`,
    title: title || `Job ${id}`,
    company,
    location: [work, location].filter(Boolean).join(" — "),
    url: apply,
    apply_url: apply,
    ats: "greenhouse",
    board_token: board || "",
    match_score: "",
    status: "discovered",
    posted,
    salary,
  };
}

export { SEARCH_URL };

/** MyGreenhouse search URL scoped to United States (logged-in job search filters). */
export function mghSearchUrl(query) {
  const u = new URL(SEARCH_URL);
  u.searchParams.set("query", String(query || ""));
  u.searchParams.set("country_short_name", "US");
  u.searchParams.set("location", "United States");
  u.searchParams.set("location_type", "country");
  u.searchParams.set("lat", "39.71614");
  u.searchParams.set("lon", "-96.999246");
  return u.toString();
}

/**
 * Scrape MyGreenhouse search for one or more queries inside an active bsk session.
 * Always scopes the search to United States.
 */
export async function scrapeMyGreenhouseQueries(sessionId, queries, { limitPerQuery = 30 } = {}) {
  const byId = new Map();
  for (const q of queries) {
    const search = mghSearchUrl(q);
    await navigate(sessionId, search);
    await pause(2200);
    const batch = await evaluate(
      sessionId,
      `(function(){
        const out=[];
        const cards=[...document.querySelectorAll('a[href*="/jobs/"]')];
        for (const a of cards) {
          const href=a.href||'';
          const m=href.match(/my\\.greenhouse\\.io\\/jobs\\/([^/]+)\\/(\\d+)/i);
          if (!m) continue;
          const board=m[1], id=m[2];
          const text=(a.innerText||a.textContent||'').replace(/\\s+/g,' ').trim();
          if (text.length<8) continue;
          out.push({ board, id, href, text });
        }
        return out.slice(0, ${Number(limitPerQuery) || 30});
      })()`
    );
    const rows = Array.isArray(batch) ? batch : [];
    for (const row of rows) {
      const job = parseMgJobCard(row.text, row.board, row.id, row.href);
      byId.set(job.external_id, job);
    }
  }
  return [...byId.values()];
}

const SNAPSHOT_JS = `(function(){
  function labelFor(el){
    const id=el.id||'';
    if (id) {
      const lab=document.querySelector('label[for="'+CSS.escape(id)+'"]');
      if (lab) return (lab.innerText||'').replace(/\\s+/g,' ').trim();
    }
    const wrap=el.closest('fieldset,[class*="field"],[data-qa],[role="group"],li,div');
    if (wrap) {
      const lab=wrap.querySelector('label,legend,[class*="label"]');
      if (lab) return (lab.innerText||'').replace(/\\s+/g,' ').trim();
    }
    return (el.getAttribute('aria-label')||el.name||el.id||'').replace(/\\s+/g,' ').trim();
  }
  const fields=[];
  const seen=new Set();
  for (const el of document.querySelectorAll('input,textarea,select')) {
    if (el.type==='hidden' || el.type==='file' || el.type==='submit' || el.type==='button') continue;
    if (el.disabled) continue;
    const label=(labelFor(el)||'').slice(0,180);
    const key=(el.name||el.id||label)+':'+el.type;
    if (seen.has(key)) continue;
    seen.add(key);
    let options=[];
    if (el.tagName==='SELECT') {
      options=[...el.options].map(o=>(o.textContent||o.value||'').trim()).filter(Boolean).slice(0,40);
    }
    if (el.type==='radio' || el.type==='checkbox') {
      const name=el.name;
      if (name) {
        options=[...document.querySelectorAll('input[type="'+el.type+'"][name="'+CSS.escape(name)+'"]')]
          .map(r=>{
            const id=r.id;
            if (id) {
              const lab=document.querySelector('label[for="'+CSS.escape(id)+'"]');
              if (lab) return (lab.innerText||'').trim();
            }
            return (r.value||'').trim();
          }).filter(Boolean);
      }
    }
    const value = el.type==='checkbox' || el.type==='radio'
      ? (el.checked ? (el.value||'on') : '')
      : (el.value||'');
    fields.push({
      id: el.id||'',
      name: el.name||'',
      type: el.type || el.tagName.toLowerCase(),
      value: String(value).slice(0,120),
      required: !!el.required || /\\*$/.test(label),
      label,
      options
    });
  }
  const errs=[...document.querySelectorAll('[class*="error"],[class*="Error"],[role="alert"],.field-error')]
    .map(e=>(e.innerText||'').replace(/\\s+/g,' ').trim())
    .filter(t=>t && t.length<200)
    .slice(0,12);
  const requiredEmpty=fields.filter(f=>f.required && (!f.value || f.value.length<1)).map(f=>f.label||f.id||f.name);
  return {
    fields,
    errs,
    requiredEmpty,
    title: document.title,
    url: location.href,
    body: (document.body.innerText||'').slice(0,1200)
  };
})()`;

async function fillField(sessionId, field, answer) {
  const ans = String(answer ?? "").trim();
  if (!ans) return false;
  const idSel = field.id ? `#${String(field.id).replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^\`{|}~])/g, "\\$1")}` : null;
  const nameSel = field.name ? `[name="${String(field.name).replace(/"/g, '\\"')}"]` : null;
  const target = idSel || nameSel;
  if (!target) return false;

  try {
    if (field.type === "select" || field.type === "select-one") {
      // Prefer option text match via evaluate, then select by value
      const picked = await evaluate(
        sessionId,
        `(function(){
          const el=document.querySelector(${JSON.stringify(target)});
          if (!el || el.tagName!=='SELECT') return null;
          const want=${JSON.stringify(ans.toLowerCase())};
          let opt=[...el.options].find(o=>(o.textContent||'').trim().toLowerCase()===want);
          if (!opt) opt=[...el.options].find(o=>(o.textContent||'').toLowerCase().includes(want) || want.includes((o.textContent||'').trim().toLowerCase()));
          if (!opt) opt=[...el.options].find(o=>(o.value||'').toLowerCase()===want);
          if (!opt) return null;
          el.value=opt.value;
          el.dispatchEvent(new Event('input',{bubbles:true}));
          el.dispatchEvent(new Event('change',{bubbles:true}));
          return opt.value;
        })()`
      );
      if (picked != null) return true;
      try {
        await select(sessionId, target, ans);
        return true;
      } catch {
        return false;
      }
    }
    if (field.type === "radio" || field.type === "checkbox") {
      const ok = await evaluate(
        sessionId,
        `(function(){
          const want=${JSON.stringify(ans.toLowerCase())};
          const name=${JSON.stringify(field.name || "")};
          const nodes=name
            ? [...document.querySelectorAll('input[type="${field.type}"][name="'+CSS.escape(name)+'"]')]
            : [...document.querySelectorAll(${JSON.stringify(target)})];
          for (const r of nodes) {
            let lab='';
            if (r.id) {
              const l=document.querySelector('label[for="'+CSS.escape(r.id)+'"]');
              if (l) lab=(l.innerText||'').trim();
            }
            const blob=((lab||'')+' '+(r.value||'')).toLowerCase();
            if (blob===want || blob.includes(want) || want.includes(blob.trim())) {
              r.click();
              return true;
            }
          }
          return false;
        })()`
      );
      return Boolean(ok);
    }
    await fill(sessionId, target, ans);
    return true;
  } catch {
    return false;
  }
}

async function answerAndFill(sessionId, fields, job, cfg, llmChat) {
  const empty = (fields || []).filter((f) => {
    if (!f.label && !f.id && !f.name) return false;
    if (["first_name", "last_name", "email", "phone"].includes(f.id)) return false;
    if (f.type === "checkbox" || f.type === "radio") return !f.value;
    return !f.value || String(f.value).length < 2;
  });

  const labels = empty.map((f) => f.label || f.id || f.name).filter(Boolean);
  const optionsByQuestion = {};
  for (const f of empty) {
    const lab = f.label || f.id || f.name;
    if (lab && f.options?.length) optionsByQuestion[lab] = f.options;
  }

  console.log(`  MGH empty fields: ${empty.length}; answering via profile/bank/NIM`);
  const answers = await answerQuestions({
    questions: labels,
    candidate: cfg.candidate,
    job,
    optionsByQuestion,
    prefs: cfg.answer_preferences || {},
    llmChat,
  });

  let filled = 0;
  for (const f of empty) {
    const lab = f.label || f.id || f.name;
    const ans = answers[lab];
    if (ans == null || ans === "") continue;
    if (await fillField(sessionId, f, ans)) filled += 1;
  }
  console.log(`  MGH filled ${filled}/${empty.length}`);
  return { filled, empty, answers };
}

/**
 * Open a MyGreenhouse job application page, fill residual fields via answer engine
 * (profile → prefs → qa-bank → NIM), optionally submit. Never clicks Submit when dryRun=true.
 */
export async function applyMyGreenhouseJob(sessionId, job, cfg, { dryRun = true, resumePath = null, llmChat = null } = {}) {
  const url = mghCanonicalUrl(job) || job.apply_url || job.url;
  if (!url || /\/jobs\/search/i.test(url)) throw new Error("job missing canonical MyGreenhouse apply_url");
  job.apply_url = url;
  job.url = url;
  const chat = llmChat || makeLlmChat(cfg);

  await navigate(sessionId, url);
  await pause(2500);

  let snapshot = await evaluate(sessionId, SNAPSHOT_JS);
  await answerAndFill(sessionId, snapshot?.fields || [], job, cfg, chat);

  const resume = resumePath || resolveResumePath(job, cfg);
  if (resume && existsSync(resume)) {
    try {
      await upload(sessionId, "input[type=file]", resume);
    } catch {
      // optional — MyGreenhouse often already has a resume on the profile
    }
  }

  if (dryRun) {
    return {
      status: "dry_run",
      notes: `MyGreenhouse form opened (dry_run); submit not clicked. fields=${(snapshot?.fields || []).length}`,
      url: url,
    };
  }

  async function clickSubmit() {
    try {
      await click(sessionId, "button:has-text(\"Submit application\")");
    } catch {
      await evaluate(
        sessionId,
        `(function(){
          const btn=[...document.querySelectorAll('button')].find(b=>/submit application/i.test(b.innerText||''));
          if (btn) { btn.click(); return true; }
          return false;
        })()`
      );
    }
    await pause(2800);
  }

  await clickSubmit();
  snapshot = await evaluate(sessionId, SNAPSHOT_JS);
  const thanks = /thank you|application (has been )?submitted|we received|successfully submitted/i.test(
    snapshot?.body || ""
  );
  const still = /submit application/i.test(snapshot?.body || "");

  if (thanks && !still) {
    return { status: "applied", notes: "Submitted via MyGreenhouse (BrowserSkill)", url: url };
  }

  // Second pass: validation errors / still-empty required → answer again, then resubmit
  if (still) {
    const stuckLabels = [
      ...(snapshot?.requiredEmpty || []),
      ...(snapshot?.errs || []).filter((e) => !/^this field is required/i.test(e)),
    ].filter(Boolean);
    console.log(`  MGH still open — retrying ${stuckLabels.length || "unknown"} stuck field(s)`);
    recordStuck({
      company: job.company,
      title: job.title,
      ats: "mygreenhouse",
      url: url,
      labels: stuckLabels,
      notes: (snapshot?.errs || []).join("; ") || "still open after submit",
    });

    await answerAndFill(sessionId, snapshot?.fields || [], job, cfg, chat);
    await clickSubmit();
    snapshot = await evaluate(sessionId, SNAPSHOT_JS);
    const thanks2 = /thank you|application (has been )?submitted|we received|successfully submitted/i.test(
      snapshot?.body || ""
    );
    const still2 = /submit application/i.test(snapshot?.body || "");
    if (thanks2 && !still2) {
      return { status: "applied", notes: "Submitted via MyGreenhouse (BrowserSkill, retry)", url: url };
    }
    if (still2) {
      const labels2 = snapshot?.requiredEmpty || stuckLabels;
      // Persist lasting answers when we did produce them for common labels
      for (const lab of labels2.slice(0, 8)) {
        // no-op bank upsert without inventing — bank grows from curated entries below
        void lab;
      }
      return {
        status: "review",
        notes: `MyGreenhouse still open after submit — ${(labels2.join("; ") || snapshot?.errs?.join("; ") || "").slice(0, 220)}`,
        url: url,
      };
    }
  }

  return { status: "applied", notes: "Submitted via MyGreenhouse (BrowserSkill)", url: url };
}

/** Seed common stuck patterns into the Q&A bank (idempotent). */
export function seedCommonQaBank(candidate = {}) {
  const years = candidate.years_experience || "3–4 years";
  const seeds = [
    { match: "how did you hear about us", answer: "LinkedIn", notes: "common GH" },
    { match: "how did you hear about this", answer: "LinkedIn", notes: "common GH" },
    { match: "years of industry experience", answer: years, notes: "from profile years_experience" },
    { match: "how many years of experience", answer: years, notes: "from profile years_experience" },
    { match: "years of experience", answer: years, notes: "from profile years_experience" },
    { match: "preference on which team", answer: "Open to any relevant team listed in the posting", notes: "Airtable-style" },
    { match: "which team to join", answer: "Open to any relevant team listed in the posting", notes: "Airtable-style" },
    { match: "salary expectation", answer: "Negotiable based on total compensation and role scope", notes: "generic" },
    { match: "desired salary", answer: "Negotiable based on total compensation and role scope", notes: "generic" },
    { match: "expected compensation", answer: "Negotiable based on total compensation and role scope", notes: "generic" },
    { match: "start date", answer: "2–4 weeks", notes: "common" },
    { match: "earliest start", answer: "2–4 weeks", notes: "common" },
    { match: "willing to relocate", answer: "Yes", notes: "office_preference any" },
  ];
  // Sponsorship: only seed when profile is explicit
  if (candidate.requires_sponsorship === false || String(candidate.requires_sponsorship).toLowerCase() === "false") {
    seeds.push({ match: "require sponsorship", answer: "No", notes: "profile requires_sponsorship=false" });
    seeds.push({ match: "need sponsorship", answer: "No", notes: "profile requires_sponsorship=false" });
  }
  for (const s of seeds) upsertQaBankEntry(s);
  return seeds.length;
}

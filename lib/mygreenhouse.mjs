import { existsSync } from "node:fs";
import {
  evaluate,
  fill,
  select,
  click,
  navigate,
  pause,
  upload,
  press,
  isWatchMode,
  watchPause,
} from "./bsk.mjs";
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
  function cleanLabel(t){
    return String(t||'')
      .replace(/\\s+/g,' ')
      .replace(/\\bSelect\\.\\.\\.\\b/g,'')
      .trim();
  }
  function labelFor(el){
    const id=el.id||'';
    if (id && !/^react-select-\\d+-input$/i.test(id)) {
      const lab=document.querySelector('label[for="'+CSS.escape(id)+'"]');
      if (lab) {
        const t=cleanLabel(lab.innerText||'');
        if (t && !/^react-select/i.test(t)) return t.slice(0,180);
      }
    }
    const wrap=el.closest('.field-wrapper, [class*="field-wrapper"], fieldset, [class*="application--question"]');
    if (wrap) {
      const lab=wrap.querySelector(':scope > label, :scope > legend, label, legend');
      if (lab) {
        const t=cleanLabel(lab.innerText||'');
        if (t && t.length>=2 && t.length<180) return t.slice(0,180);
      }
      // React-select: question text is usually the first line of the field wrapper
      const raw=cleanLabel(wrap.innerText||'');
      if (raw) {
        let t=raw.split(/\\n|Select\\.\\.\\./)[0].trim();
        // Strip a trailing selected value when present (e.g. "Gender Male" → "Gender")
        const single=wrap.querySelector('[class*="singleValue"],[class*="single-value"]');
        if (single) {
          const sv=cleanLabel(single.textContent||'');
          if (sv && t.endsWith(sv)) t=t.slice(0, -sv.length).trim();
        }
        if (t && t.length>=2 && t.length<180) return t.slice(0,180);
      }
    }
    const aria=el.getAttribute('aria-label');
    if (aria && !/^react-select/i.test(aria)) return cleanLabel(aria).slice(0,180);
    return '';
  }
  function isNoise(el, label){
    if (el.closest('.search-bar, [class*="search-bar"], nav, header')) return true;
    // Phone country dial-code combobox (United States +1 / Afghanistan +93) — never treat as a job question
    if (el.closest('.iti, [class*="phone-input"], [class*="PhoneInput"], .phone-input__phone')) return true;
    if (/^country$/i.test(label) && el.closest('[class*="phone"], .iti')) return true;
    const cls=String(el.className||'');
    if (/iti__search-input/.test(cls)) return true;
    if (/^react-select-\\d+-input$/i.test(el.id||'') && !label) return true;
    if (/select__input/.test(cls) && !label) return true;
    return false;
  }
  const fields=[];
  const seen=new Set();
  const checkboxGroups=new Map();
  for (const el of document.querySelectorAll('input,textarea,select')) {
    if (el.type==='hidden' || el.type==='file' || el.type==='submit' || el.type==='button') continue;
    if (el.disabled) continue;
    if (el.closest('.search-bar, [class*="search-bar"], nav, header')) continue;
    const cls=String(el.className||'');
    const isReactSelect=/select__input|react-select/i.test(cls) || /^react-select-\\d+-input$/i.test(el.id||'');

    if (el.type==='checkbox' || el.type==='radio') {
      const name=el.name||el.id||'';
      let optLab='';
      if (el.id) {
        const l=document.querySelector('label[for="'+CSS.escape(el.id)+'"]');
        if (l) optLab=cleanLabel(l.innerText||'');
      }
      if (!optLab) optLab=cleanLabel(el.value||'');
      // Question text from field wrapper — never the option's own <label for=…>
      const wrap=el.closest('.field-wrapper, [class*="field-wrapper"], fieldset');
      let qLab='';
      if (wrap) {
        const qLabels=[...wrap.querySelectorAll('label,legend')].filter(lab=>{
          const f=lab.getAttribute('for');
          if (!f) return (lab.tagName||'').toLowerCase()==='legend' || lab.closest('.checkbox__wrapper, .checkbox')==null;
          const t=document.getElementById(f);
          return !(t && (t.type==='checkbox'||t.type==='radio'));
        });
        if (qLabels[0]) qLab=cleanLabel(qLabels[0].innerText||'');
        if (!qLab) {
          let raw=cleanLabel(wrap.innerText||'');
          for (const opt of (wrap.querySelectorAll('label')||[])) {
            const ot=cleanLabel(opt.innerText||'');
            if (ot && raw.includes(ot)) raw=raw.replace(ot,'').trim();
          }
          qLab=raw.slice(0,180);
        }
      }
      if (!qLab) qLab=cleanLabel((wrap||{}).innerText||'').slice(0,180);
      if (!checkboxGroups.has(name)) {
        checkboxGroups.set(name, {el, label:qLab, type:el.type, options:[], required:/\\*$/.test(qLab), name, id:el.id||''});
      }
      const g=checkboxGroups.get(name);
      if (optLab && !g.options.includes(optLab)) g.options.push(optLab);
      if (el.checked) g.value = optLab;
      if (qLab && qLab.length>g.label.length) g.label=qLab;
      continue;
    }

    const label=(labelFor(el)||'').slice(0,240);
    if (isNoise(el, label)) continue;
    if (!label && !el.id && !el.name) continue;
    const key=(label||el.name||el.id)+':'+(isReactSelect?'react_select':(el.type||el.tagName.toLowerCase()));
    if (seen.has(key)) continue;
    seen.add(key);
    let options=[];
    if (el.tagName==='SELECT') {
      options=[...el.options].map(o=>(o.textContent||o.value||'').trim()).filter(Boolean).slice(0,40);
    }
    if (isReactSelect) {
      const wrap=el.closest('.field-wrapper,[class*="field-wrapper"],[class*="select"]')||el.parentElement;
      const native=wrap && wrap.querySelector('select');
      if (native) {
        options=[...native.options].map(o=>(o.textContent||o.value||'').trim()).filter(o=>o && !/^select/i.test(o)).slice(0,40);
      }
      if (!options.length && /\\b(yes|no|authorized|sponsor|relocat|citizen|hispanic|veteran|gender|disability|agree|relative)/i.test(label)) {
        options=['Yes','No'];
      }
    }
    let value = el.value||'';
    if (isReactSelect) {
      // Walk up until we have singleValue/placeholder, but stop before a node that
      // contains another react-select input (avoids sibling Yes leaking into sponsorship).
      let node = el.parentElement;
      let valueRoot = null;
      while (node) {
        const inputs = node.querySelectorAll('input[id*="react-select"]');
        if (inputs.length > 1) break;
        if (node.querySelector('[class*="singleValue"],[class*="single-value"],[class*="placeholder"]')) {
          valueRoot = node;
          break;
        }
        if (node.matches && (node.matches('.field-wrapper') || /field-wrapper/i.test(node.className||''))) break;
        node = node.parentElement;
      }
      const single = valueRoot && valueRoot.querySelector('[class*="singleValue"],[class*="single-value"]');
      const placeholder = valueRoot && valueRoot.querySelector('[class*="placeholder"]');
      value = single ? (single.textContent||'').trim() : '';
      if (!value || /^select/i.test(value)) value='';
      if (placeholder && /^select/i.test((placeholder.textContent||'').trim()) && !single) value='';
    }
    fields.push({
      id: el.id||'',
      name: el.name||'',
      type: isReactSelect ? 'react_select' : (el.type || el.tagName.toLowerCase()),
      value: String(value).slice(0,120),
      required: !!el.required || /\\*$/.test(label),
      label,
      options,
      className: cls.slice(0,80)
    });
  }
  for (const g of checkboxGroups.values()) {
    if (!g.label || g.label.length<4) continue;
    // Prefer None/Not applicable style groups; keep multi-option export-control questions
    fields.push({
      id: g.id,
      name: g.name,
      type: g.type,
      value: g.value||'',
      required: g.required,
      label: g.label.slice(0,240),
      options: g.options,
      className: ''
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

async function scrollFieldIntoView(sessionId, target) {
  try {
    await evaluate(
      sessionId,
      `(function(){
        const el=${targetJs(target)};
        if (!el) return false;
        el.scrollIntoView({block:'center', inline:'nearest'});
        return true;
      })()`
    );
  } catch {
    // ignore
  }
  await watchPause(350);
}

function targetJs(target) {
  // Prefer getElementById for #id selectors — more reliable than querySelector on odd ids.
  const m = String(target || "").match(/^#(.+)$/);
  if (m) {
    const id = m[1].replace(/\\([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, "$1");
    return `document.getElementById(${JSON.stringify(id)})`;
  }
  return `document.querySelector(${JSON.stringify(target)})`;
}

async function fillReactSelect(sessionId, target, ans, label) {
  const isSalary = /salary|compensation|base/i.test(label);
  const isYesNo = /^yes$|^no$/i.test(ans);
  const isHowHeard = /hear about|how did you hear/i.test(label);
  const wantNorm = String(ans).replace(/[–—]/g, "-").toLowerCase().replace(/\s+/g, " ").trim();

  // Real browser click opens react-select reliably; synthetic mousedown often leaves aria-expanded=false.
  try {
    await click(sessionId, target);
  } catch {
    await evaluate(
      sessionId,
      `(function(){
        const el=${targetJs(target)};
        if (!el) return false;
        el.scrollIntoView({block:'center'});
        const control = el.closest('[class*="control"]') || el;
        control.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));
        control.click();
        el.focus();
        return true;
      })()`
    );
  }
  await pause(550);

  // Salary: never type-filter (surfaces "Less than $120,000"). Yes/No: type exact token.
  // How-heard: type exact label so "LinkedIn" is in the filtered set (still pick exact, not Ad).
  if (isYesNo || isHowHeard) {
    await evaluate(
      sessionId,
      `(function(){
        const el=${targetJs(target)};
        if (!el) return false;
        const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
        setter.call(el, ${JSON.stringify(ans)});
        el.dispatchEvent(new Event('input',{bubbles:true}));
        return true;
      })()`
    );
    await pause(400);
  } else if (!isSalary) {
    const frag = String(ans).replace(/[–—]/g, "-").slice(0, 16);
    await evaluate(
      sessionId,
      `(function(){
        const el=${targetJs(target)};
        if (!el) return false;
        const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
        setter.call(el, ${JSON.stringify(frag)});
        el.dispatchEvent(new Event('input',{bubbles:true}));
        return true;
      })()`
    );
    await pause(350);
  }

  const pickResult = await evaluate(
    sessionId,
    `(function(){
      const el=${targetJs(target)};
      if (!el) return {ok:false, reason:'no el'};
      const want=${JSON.stringify(wantNorm)};
      const salary=${isSalary};
      const yesNo=${isYesNo};
      const howHeard=${isHowHeard};
      const inputId = el.id || '';
      const prefix = inputId.replace(/-input$/,'');
      // Prefer options owned by this control: react-select-N-option-M
      let nodes = prefix
        ? [...document.querySelectorAll('[id^="'+prefix+'-option-"]')]
        : [];
      if (!nodes.length) {
        const controls = el.getAttribute('aria-controls');
        const box = controls && document.getElementById(controls);
        if (box) nodes = [...box.querySelectorAll('[role="option"]')];
      }
      if (!nodes.length) {
        const menus=[...document.querySelectorAll('[class*="menu"],[role="listbox"],[id*="listbox"]')].filter(m=>{
          const text=m.textContent||'';
          if (/afghanistan\\+\\d/i.test(text) && (text.match(/\\+\\d{1,4}/g)||[]).length > 3) return false;
          if (/iti-\\d/i.test(m.id||'')) return false;
          const r=m.getBoundingClientRect();
          return r.height >= 8;
        });
        nodes=menus.flatMap(m => [...m.querySelectorAll('[role="option"],[id*="-option-"]')]);
      }
      const scored=[];
      const texts=[];
      for (const o of nodes) {
        const t=(o.textContent||'').replace(/\\s+/g,' ').trim();
        if (!t || t.length > 160 || /^select/i.test(t) || /\\+[0-9]{1,4}\\s*$/.test(t)) continue;
        if (salary && /^less than/i.test(t)) continue;
        texts.push(t + (o.id ? ' #'+o.id : ''));
        const tl=t.replace(/[–—]/g,'-').toLowerCase();
        let score=0;
        if (yesNo) {
          if (tl === want) score = 100;
        } else if (salary) {
          if (/\\$120,000\\s*[-–—]\\s*\\$?149,?999/.test(t)) score = 100;
          else if (tl === want) score = 100;
        } else if (tl === want) {
          score = 100;
        } else if (howHeard && tl.startsWith(want)) {
          // Never prefer "LinkedIn Ad (India)" over exact "LinkedIn".
          score = 40;
        } else if (tl.startsWith(want + ' ') || tl.startsWith(want + ',') || tl.startsWith(want + '/')) {
          score = 70;
        } else if (tl.includes(want) || want.includes(tl)) {
          score = 50;
        }
        if (score > 0) scored.push({ t, score, o, len: tl.length });
      }
      scored.sort((a,b)=> b.score - a.score || a.len - b.len);
      const hit=scored[0];
      if (!hit) {
        return {ok:false, reason:'no option', texts:texts.slice(0,15), inputId, nodeCount:nodes.length};
      }
      // How-heard: refuse non-exact when an exact option exists in the menu.
      if (howHeard && hit.score < 100) {
        const exact = scored.find(s => s.score === 100);
        if (exact) {
          exact.o.scrollIntoView({block:'nearest'});
          exact.o.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));
          exact.o.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
          exact.o.click();
          return {ok:true, picked:exact.t, via:exact.o.id||'exact'};
        }
      }
      hit.o.scrollIntoView({block:'nearest'});
      hit.o.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));
      hit.o.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
      hit.o.click();
      return {ok:true, picked:hit.t, via:hit.o.id||'text'};
    })()`
  );

  if (!pickResult?.ok) {
    // Keyboard fallback once the menu is open.
    // react-select: 1st ArrowDown → option 0, 2nd → option 1.
    try {
      if (isSalary) {
        await press(sessionId, "ArrowDown"); // Less than $120,000
        await pause(80);
        await press(sessionId, "ArrowDown"); // $120,000–$149,999
        await pause(80);
        await press(sessionId, "Enter");
      } else if (isYesNo && /^no$/i.test(ans)) {
        await press(sessionId, "ArrowDown"); // Yes
        await pause(80);
        await press(sessionId, "ArrowDown"); // No
        await pause(80);
        await press(sessionId, "Enter");
      } else if (isYesNo && /^yes$/i.test(ans)) {
        await press(sessionId, "ArrowDown"); // Yes
        await pause(80);
        await press(sessionId, "Enter");
      } else if (isHowHeard) {
        // Walk until focused option equals want (skip "LinkedIn Ad …").
        let picked = false;
        for (let i = 0; i < 12; i++) {
          await press(sessionId, "ArrowDown");
          await pause(100);
          const focused = await evaluate(
            sessionId,
            `(function(){
              const el=${targetJs(target)};
              const prefix=(el?.id||'').replace(/-input$/,'');
              const hit=[...document.querySelectorAll('[id^="'+prefix+'-option-"]')].find(o =>
                o.getAttribute('aria-selected')==='true' || /focused|focus/i.test(o.className||'')
              );
              return (hit?.textContent||'').replace(/\\s+/g,' ').trim().toLowerCase();
            })()`
          );
          if (String(focused || "") === wantNorm) {
            await press(sessionId, "Enter");
            picked = true;
            break;
          }
        }
        if (!picked) {
          console.warn(`  react-select miss ${String(label).slice(0, 60)}: no exact how-heard option`);
          return false;
        }
      } else {
        await press(sessionId, "ArrowDown");
        await pause(80);
        await press(sessionId, "Enter");
      }
    } catch {
      console.warn(
        `  react-select miss ${String(label).slice(0, 60)}: ${pickResult?.reason || "no option"} nodes=${pickResult?.nodeCount} ${(pickResult?.texts || []).slice(0, 5)}`
      );
      return false;
    }
  } else if (isWatchMode()) {
    console.log(`  → clicked option: ${String(pickResult.picked).slice(0, 60)}`);
  }

  await pause(500);
  const stuck = await evaluate(
    sessionId,
    `(function(){
      const el=${targetJs(target)};
      if (!el) return '';
      let node = el.parentElement;
      let valueRoot = null;
      while (node) {
        const inputs = node.querySelectorAll('input[id*="react-select"]');
        if (inputs.length > 1) break;
        if (node.querySelector('[class*="singleValue"],[class*="single-value"],[class*="placeholder"]')) {
          valueRoot = node;
          break;
        }
        if (node.matches && (node.matches('.field-wrapper') || /field-wrapper/i.test(node.className||''))) break;
        node = node.parentElement;
      }
      const single = valueRoot && valueRoot.querySelector('[class*="singleValue"],[class*="single-value"]');
      const t=(single?.textContent||'').replace(/\\s+/g,' ').trim();
      return (t && !/^select/i.test(t)) ? t : '';
    })()`
  );

  const stuckNorm = String(stuck || "").replace(/[–—]/g, "-").toLowerCase().replace(/\s+/g, " ").trim();
  const okStuck =
    stuckNorm
    && (
      (isYesNo && stuckNorm === wantNorm)
      || (isSalary && /120,000/.test(stuckNorm) && /149/.test(stuckNorm) && !/^less than/.test(stuckNorm))
      || (isHowHeard && stuckNorm === wantNorm)
      || (!isYesNo && !isSalary && !isHowHeard && (stuckNorm === wantNorm || stuckNorm.includes(wantNorm) || wantNorm.includes(stuckNorm)))
    );

  if (!okStuck) {
    console.warn(
      `  react-select did not stick ${String(label).slice(0, 50)}: want=${String(ans).slice(0, 40)} got=${String(stuck || "").slice(0, 40)}`
    );
    return false;
  }
  if (isWatchMode()) console.log(`  ✓ select stuck: ${String(stuck).slice(0, 60)}`);
  await watchPause(450);
  return true;
}

async function fillField(sessionId, field, answer) {
  let ans = String(answer ?? "").trim();
  if (!ans) return false;
  // Align long free-text to short react-select options (Yes/No etc.)
  if ((field.type === "react_select" || field.type === "checkbox" || field.type === "radio") && Array.isArray(field.options) && field.options.length) {
    const lower = ans.toLowerCase();
    const exact = field.options.find((o) => String(o).trim().toLowerCase() === lower);
    // Prefer shortest substring hit so "LinkedIn" beats "LinkedIn Ad (India)".
    let includes = null;
    let includesLen = Infinity;
    for (const o of field.options) {
      const ol = String(o).trim().toLowerCase();
      if (ol.length < 2) continue;
      if (lower === ol || lower.startsWith(ol + " ") || ol.includes(lower) || lower.includes(ol)) {
        if (ol.length < includesLen) {
          includes = o;
          includesLen = ol.length;
        }
      }
    }
    const none = field.options.find((o) => /none|not applicable|n\/a/i.test(String(o)));
    const yesNo = field.options.filter((o) => /^(yes|no)$/i.test(String(o).trim()));
    if (exact) ans = String(exact).trim();
    else if (includes && String(includes).trim().length <= 80) ans = String(includes).trim();
    else if (none && /none|n\/a|not applicable|\bno\b/i.test(lower)) ans = String(none).trim();
    else if (yesNo.length && ans.length > 20) {
      if (/\bno\b|not |n't|never/i.test(lower) && yesNo.some((o) => /^no$/i.test(o))) ans = "No";
      else if (yesNo.some((o) => /^yes$/i.test(o))) ans = "Yes";
    } else if (none && /export control|countries\/regions|citizen, national, or resident/i.test(field.label || "")) {
      ans = String(none).trim();
    }
  }
  const idSel = field.id ? `#${String(field.id).replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^\`{|}~])/g, "\\$1")}` : null;
  const nameSel = field.name ? `[name="${String(field.name).replace(/"/g, '\\"')}"]` : null;
  const target = idSel || nameSel;
  if (!target) return false;
  const label = field.label || field.id || field.name || target;
  if (isWatchMode()) {
    console.log(`  → fill: ${String(label).slice(0, 80)} = ${ans.slice(0, 100)}`);
  }

  try {
    await scrollFieldIntoView(sessionId, target);
    if (field.type === "react_select" || /react-select|select__input/i.test(String(field.id || "") + String(field.className || ""))) {
      return fillReactSelect(sessionId, target, ans, label);
    }
    if (field.type === "select" || field.type === "select-one") {
      const picked = await evaluate(
        sessionId,
        `(function(){
          const el=${targetJs(target)};
          if (!el || el.tagName!=='SELECT') return null;
          el.scrollIntoView({block:'center'});
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
      if (picked != null) {
        await watchPause(450);
        return true;
      }
      try {
        await select(sessionId, target, ans);
        await watchPause(450);
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
            : [${targetJs(target)}].filter(Boolean);
          for (const r of nodes) {
            let lab='';
            if (r.id) {
              const l=document.querySelector('label[for="'+CSS.escape(r.id)+'"]');
              if (l) lab=(l.innerText||'').trim();
            }
            const blob=((lab||'')+' '+(r.value||'')).toLowerCase();
            if (blob===want || blob.includes(want) || want.includes(blob.trim()) || (want.length>8 && blob.includes(want.slice(0,20)))) {
              r.scrollIntoView({block:'center'});
              if (!r.checked) r.click();
              return true;
            }
          }
          // Prefer None/Not applicable when answer unclear
          for (const r of nodes) {
            let lab='';
            if (r.id) {
              const l=document.querySelector('label[for="'+CSS.escape(r.id)+'"]');
              if (l) lab=(l.innerText||'').trim();
            }
            if (/none|not applicable/i.test(lab)) {
              r.scrollIntoView({block:'center'});
              if (!r.checked) r.click();
              return true;
            }
          }
          return false;
        })()`
      );
      if (ok) await watchPause(450);
      return Boolean(ok);
    }
    // Prefer DOM fill — bsk CSS fill often misses Greenhouse dynamic inputs.
    const typed = await evaluate(
      sessionId,
      `(function(){
        const el=${targetJs(target)};
        if (!el) return false;
        el.scrollIntoView({block:'center'});
        el.focus();
        const proto = el.tagName === 'TEXTAREA'
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
        const setter=Object.getOwnPropertyDescriptor(proto,'value')?.set;
        if (setter) setter.call(el, ${JSON.stringify(ans)});
        else el.value=${JSON.stringify(ans)};
        el.dispatchEvent(new Event('input',{bubbles:true}));
        el.dispatchEvent(new Event('change',{bubbles:true}));
        return (el.value||'').length > 0;
      })()`
    );
    if (typed) {
      await watchPause(450);
      return true;
    }
    await fill(sessionId, target, ans);
    await watchPause(450);
    return true;
  } catch (err) {
    console.warn(`  fill miss ${field.label || field.id}: ${String(err.message || err).slice(0, 120)}`);
    return false;
  }
}

function normalizeQuestionKey(s) {
  return String(s || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Map answer-engine output onto a field label even when SNAPSHOT truncates the string. */
function resolveAnswer(answers, field, prefs = {}, candidate = {}) {
  const lab = normalizeQuestionKey(field.label || field.id || field.name || "");
  if (!lab && !field.id) return "";
  if (answers[lab] != null && String(answers[lab]).trim() !== "") return String(answers[lab]).trim();
  // Exact key may differ by trailing cut / nbsp — fuzzy match
  const lower = lab.toLowerCase();
  for (const [k, v] of Object.entries(answers || {})) {
    if (v == null || String(v).trim() === "") continue;
    const nk = normalizeQuestionKey(k).toLowerCase();
    if (nk === lower) return String(v).trim();
    if (lower.length >= 48 && nk.startsWith(lower.slice(0, 48))) return String(v).trim();
    if (nk.length >= 48 && lower.startsWith(nk.slice(0, 48))) return String(v).trim();
  }
  // Torc export-control "applicable country" text box
  if (
    /question_38081666002/i.test(String(field.id || ""))
    || /checked either.*different country|indicate the applicable country|please indicate the/i.test(lab)
  ) {
    return String(prefs.export_control_country_detail || candidate.passport_country || "").trim();
  }
  // Torc restrictive-agreement dropdown
  if (/restrict your ability|agreement between you and your current or former employer|restrict any work that you may do for torc/i.test(lab)) {
    return "No";
  }
  return "";
}

async function answerAndFill(sessionId, fields, job, cfg, llmChat) {
  const empty = (fields || []).filter((f) => {
    if (!f.label && !f.id && !f.name) return false;
    const val = String(f.value || "").trim();
    const looksEmpty = !val || /^select/i.test(val) || val === "…";
    if (f.type === "checkbox" || f.type === "radio") return looksEmpty;
    return looksEmpty || val.length < 2;
  });

  const labels = empty.map((f) => normalizeQuestionKey(f.label || f.id || f.name)).filter(Boolean);
  const optionsByQuestion = {};
  for (const f of empty) {
    const lab = normalizeQuestionKey(f.label || f.id || f.name);
    if (lab && f.options?.length) optionsByQuestion[lab] = f.options;
  }

  // Profile → prefs → qa-bank → heuristics first; LLM only for still-unanswered fields.
  // Watch mode used to skip LLM (NIM timeouts stalled the Agent Window). With Groq
  // as primary that is safe again — keep a shorter timeout when watching.
  const allowLlm = cfg.runtime?.llm_fill_missing !== false;
  const useLlm = allowLlm && typeof llmChat === "function";
  console.log(
    `  MGH empty fields: ${empty.length}; answering via profile/bank${useLlm ? "/LLM" : " (heuristics only)"}`
  );
  const answers = await answerQuestions({
    questions: labels,
    candidate: cfg.candidate,
    job,
    optionsByQuestion,
    prefs: cfg.answer_preferences || {},
    llmChat: useLlm ? llmChat : null,
  });

  let filled = 0;
  for (const f of empty) {
    const ans = resolveAnswer(answers, f, cfg.answer_preferences || {}, cfg.candidate || {});
    if (!ans) continue;
    if (await fillField(sessionId, f, ans)) filled += 1;
  }
  console.log(`  MGH filled ${filled}/${empty.length}`);
  return { filled, empty, answers };
}

/**
 * Open a MyGreenhouse job application page, fill residual fields via answer engine
 * (profile → prefs → qa-bank → NIM), optionally submit. Never clicks Submit when dryRun=true.
 */
async function forceFillRestrictiveAgreement(sessionId) {
  const found = await evaluate(
    sessionId,
    `(function(){
      for (const wrap of document.querySelectorAll('.field-wrapper,[class*="field-wrapper"]')) {
        const t=(wrap.innerText||'').replace(/\\s+/g,' ');
        if (!/restrict your ability|agreement between you and your current or former employer/i.test(t)) continue;
        const single=wrap.querySelector('[class*="singleValue"],[class*="single-value"]');
        const val=(single?.textContent||'').trim();
        if (val && !/^select/i.test(val) && /^(yes|no)$/i.test(val)) {
          return {ok:true, already:val, id:''};
        }
        const el=wrap.querySelector('input.select__input,input[id^="react-select"]');
        if (!el) return {ok:false, reason:'no input'};
        return {ok:true, id:el.id, needFill:true};
      }
      return {ok:false, reason:'not found'};
    })()`
  );
  if (!found?.ok) {
    console.warn(`  restrictive-agreement field: ${found?.reason || "missing"}`);
    return false;
  }
  if (found.already) {
    console.log(`  restrictive-agreement already=${found.already}`);
    return true;
  }
  if (!found.id) return false;
  console.log(`  → force fill restrictive-agreement #${found.id} = No`);
  return fillReactSelect(sessionId, `#${found.id}`, "No", "restrictive agreement");
}

/**
 * Replace MyGreenhouse profile resume with the per-job PDF.
 * MGH often pre-attaches the account resume — upload alone may leave that in place
 * unless we clear / retarget the resume file input.
 */
async function uploadResumeReplace(sessionId, resumePath) {
  if (!resumePath || !existsSync(resumePath)) return false;
  const base = String(resumePath).split(/[/\\]/).pop() || "";

  // Try remove/replace controls near the Resume field
  try {
    await evaluate(
      sessionId,
      `(function(){
        const labels=[...document.querySelectorAll('label,div,span,p,h2,h3')];
        const hit=labels.find(e => /^resume\\b/i.test((e.textContent||'').replace(/\\s+/g,' ').trim()) && (e.textContent||'').length < 40);
        const root = hit?.closest('.field-wrapper,[class*="field-wrapper"],fieldset,form') || document.body;
        const btns=[...root.querySelectorAll('button,a,[role="button"]')];
        for (const b of btns) {
          const t=(b.textContent||'').replace(/\\s+/g,' ').trim();
          if (/^(remove|delete|replace|change|upload new)/i.test(t) || /remove.*resume|delete.*file/i.test(t)) {
            b.click();
            return t;
          }
        }
        // X / clear icons
        const clear=[...root.querySelectorAll('button,[aria-label]')].find(el => /remove|delete|clear/i.test(el.getAttribute('aria-label')||''));
        if (clear) { clear.click(); return clear.getAttribute('aria-label')||'clear'; }
        return null;
      })()`
    );
    await pause(600);
  } catch {
    // ignore
  }

  // Prefer resume-named file input over the first file input on the page
  const targets = [
    "input[type=file][id*='resume' i]",
    "input[type=file][name*='resume' i]",
    "input[type=file]",
  ];
  let uploaded = false;
  for (const sel of targets) {
    try {
      await upload(sessionId, sel, resumePath);
      uploaded = true;
      break;
    } catch {
      // try next selector
    }
  }
  if (!uploaded) return false;
  await pause(800);

  // Confirm UI shows our filename (best-effort)
  const shown = await evaluate(
    sessionId,
    `(function(){
      const want=${JSON.stringify(base.toLowerCase())};
      const text=(document.body.innerText||'').toLowerCase();
      if (want && text.includes(want)) return want;
      // any .pdf mention near Resume
      const m=text.match(/resume[^\\n]{0,80}?([a-z0-9._-]+\\.pdf)/i);
      return m ? m[1] : '';
    })()`
  );
  if (shown && base && String(shown).toLowerCase() === base.toLowerCase()) {
    console.log(`  ✓ resume UI shows ${base}`);
    return true;
  }
  if (shown) {
    console.warn(`  resume UI shows "${shown}" (wanted ${base}) — upload may have been ignored`);
  }
  return true; // upload call succeeded even if UI text is ambiguous
}

export async function applyMyGreenhouseJob(sessionId, job, cfg, { dryRun = true, resumePath = null, llmChat = null, oneShot = false, uploadResume = false } = {}) {
  let url = mghCanonicalUrl(job) || job.apply_url || job.url;
  if (!url || /\/jobs\/search/i.test(url)) throw new Error("job missing canonical MyGreenhouse apply_url");
  // Strip search-filter query noise so the apply form does not sit under the jobs search chrome.
  try {
    const u = new URL(url);
    u.search = "";
    u.hash = "";
    url = u.toString();
  } catch {
    // keep raw
  }
  job.apply_url = url;
  job.url = url;
  const chat = llmChat || makeLlmChat(cfg);

  await navigate(sessionId, url);
  await pause(2500);

  let snapshot = await evaluate(sessionId, SNAPSHOT_JS);
  let fillPass = await answerAndFill(sessionId, snapshot?.fields || [], job, cfg, chat);
  // Torc: this dropdown is often missed by snapshot — force it before submit.
  await forceFillRestrictiveAgreement(sessionId);

  // Second pass: required selects that were shadowed by sibling singleValue (e.g. Roku sponsorship).
  await pause(400);
  snapshot = await evaluate(sessionId, SNAPSHOT_JS);
  const stillRequired = (snapshot?.fields || []).filter(
    (f) => f.required && (!f.value || /^select/i.test(String(f.value || "")))
  );
  if (stillRequired.length) {
    console.log(`  MGH second pass: ${stillRequired.length} required still empty`);
    const pass2 = await answerAndFill(sessionId, stillRequired, job, cfg, chat);
    fillPass = {
      filled: (fillPass.filled || 0) + (pass2.filled || 0),
      empty: [...(fillPass.empty || []), ...(pass2.empty || [])],
      answers: { ...(fillPass.answers || {}), ...(pass2.answers || {}) },
    };
  }

  const resume = resumePath || resolveResumePath(job, cfg);
  // MyGreenhouse already has the profile resume attached — bsk file-picker upload
  // is unreliable and not worth per-job Jake PDFs. Opt in with uploadResume: true.
  if (uploadResume) {
    if (resume && existsSync(resume)) {
      const uploaded = await uploadResumeReplace(sessionId, resume);
      if (!uploaded) {
        console.warn(`  MGH resume upload FAILED — form may keep profile resume; path=${resume}`);
      } else {
        console.log(`  MGH resume uploaded: ${resume}`);
      }
    } else {
      console.warn("  MGH no resume file to upload");
    }
  } else {
    console.log("  MGH skipping resume upload (profile resume on MyGreenhouse)");
  }

  if (dryRun) {
    return {
      status: "dry_run",
      notes: `MyGreenhouse form opened (dry_run); submit not clicked. fields=${(snapshot?.fields || []).length}`,
      url: url,
    };
  }

  // Re-snapshot after fills settle. Trust verified fills when the snapshot
  // still mis-reads react-select singleValue.
  await pause(800);
  snapshot = await evaluate(sessionId, SNAPSHOT_JS);
  const requiredLeft = (snapshot?.requiredEmpty || []).length;
  const onSearch = /my\.greenhouse\.io\/jobs\/search/i.test(String(snapshot?.url || ""));
  const emptyN = fillPass.empty?.length || 0;
  const filledN = fillPass.filled || 0;
  if (onSearch) {
    return {
      status: "review",
      notes: `MyGreenhouse navigated to search before submit — fill aborted; filled=${filledN}/${emptyN}`,
      url: url,
    };
  }
  const fillComplete = emptyN === 0 || filledN >= emptyN;
  if (!fillComplete && (requiredLeft > 0 || (emptyN >= 3 && filledN < Math.max(2, Math.ceil(emptyN * 0.35))))) {
    return {
      status: "review",
      notes: `MyGreenhouse fill incomplete — requiredLeft=${requiredLeft} filled=${filledN}/${emptyN}; submit not clicked; left=${(snapshot?.requiredEmpty || []).slice(0, 5).join(" | ")}`,
      url: url,
    };
  }
  if (requiredLeft > 0 && fillComplete) {
    console.log(
      `  MGH snapshot still lists requiredEmpty=${requiredLeft} but fills verified ${filledN}/${emptyN} — submitting`
    );
  }
  console.log(`  MGH pre-submit ok: requiredLeft=${requiredLeft} filled=${filledN}/${emptyN}`);

  async function clickSubmit() {
    try {
      await evaluate(
        sessionId,
        `(function(){
          const btn=[...document.querySelectorAll('button')].find(b=>/submit application/i.test(b.innerText||''));
          if (btn) { btn.scrollIntoView({block:'center'}); return true; }
          return false;
        })()`
      );
    } catch {
      // ignore
    }
    await watchPause(1200);
    if (isWatchMode()) {
      console.log("  → clicking Submit application (strict thanks/required check after)");
      await pause(1500);
    }
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
    await pause(isWatchMode() ? 5000 : 3500);
  }

  function verdictFromSnapshot(snap) {
    const body = String(snap?.body || "");
    const pageUrl = String(snap?.url || "");
    const thanks =
      /thank you for (your )?appl/i.test(body)
      || /application (has been )?submitted/i.test(body)
      || /we received your application/i.test(body)
      || /successfully submitted/i.test(body);
    const onSearch = /my\.greenhouse\.io\/jobs\/search/i.test(pageUrl);
    const stillSubmit = /submit application/i.test(body);
    const requiredLeft = (snap?.requiredEmpty || []).length > 0 || (snap?.errs || []).some((e) => /required/i.test(String(e)));
    const onApps = /my\.greenhouse\.io\/applications/i.test(pageUrl);
    return { thanks: thanks && !onSearch, stillSubmit, requiredLeft, onApps, onSearch, body, pageUrl };
  }

  await clickSubmit();
  snapshot = await evaluate(sessionId, SNAPSHOT_JS);
  let v = verdictFromSnapshot(snapshot);
  console.log(
    `  MGH post-submit: thanks=${v.thanks} stillSubmit=${v.stillSubmit} requiredLeft=${v.requiredLeft} url=${(v.pageUrl || "").slice(0, 80)}`
  );

  if (v.thanks && !v.stillSubmit && !v.requiredLeft) {
    return { status: "applied", notes: "Submitted via MyGreenhouse (BrowserSkill)", url: url };
  }

  // oneShot: never re-fill / re-submit — verify Applications list once, then stop.
  if (oneShot) {
    try {
      await navigate(sessionId, "https://my.greenhouse.io/applications");
      await pause(3000);
      const apps = await evaluate(
        sessionId,
        `(function(){
          const company=${JSON.stringify(String(job.company || "").toLowerCase())};
          const title=${JSON.stringify(String(job.title || "").toLowerCase().slice(0, 40))};
          const coToken=${JSON.stringify(String(job.company || "").toLowerCase().replace(/[^a-z0-9]+/g, ""))};
          const lines=(document.body.innerText||'').split(/\\n/).map(s=>s.trim()).filter(Boolean);
          const norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'');
          // Require company match — never confirm on bare title ("Software Engineer" false-positives).
          let idx=-1;
          for (let i=0;i<lines.length;i++) {
            const low=lines[i].toLowerCase();
            const n=norm(lines[i]);
            if (!coToken) break;
            if (low.includes(company) || n.includes(coToken)) { idx=i; break; }
          }
          const ctx=idx>=0 ? lines.slice(Math.max(0,idx-2), idx+6) : [];
          const blob=ctx.join(' | ');
          const recent=/just now|minutes? ago|seconds? ago|1 minute ago/i.test(blob);
          // Title helps when company is a board token (e.g. roku) next to the role line.
          const titleHit=!title || title.length<8 || blob.toLowerCase().includes(title.slice(0,20));
          return {
            found: idx>=0,
            applied: idx>=0 && /applied/i.test(blob) && titleHit,
            justNow: recent,
            ctx,
          };
        })()`
      );
      console.log(`  MGH oneShot apps check: ${JSON.stringify(apps)}`);
      // Prefer a fresh "just now" hit; still accept company+Applied if title aligns.
      if (apps?.found && apps?.applied && (apps?.justNow || apps?.ctx?.length)) {
        if (!apps.justNow) {
          console.warn("  MGH apps check: company found but not 'just now' — may be a prior application");
        }
        if (apps.justNow) {
          return {
            status: "applied",
            notes: `CONFIRMED on MyGreenhouse Applications — ${(apps.ctx || []).join(" · ")}`,
            url: url,
          };
        }
      }
    } catch (err) {
      console.warn(`  MGH oneShot apps check failed: ${String(err.message || err).slice(0, 120)}`);
    }
    const hint = (v.body || "").replace(/\s+/g, " ").slice(0, 180);
    return {
      status: "review",
      notes: `MyGreenhouse oneShot submit unconfirmed — thanks=${v.thanks} stillSubmit=${v.stillSubmit} required=${v.requiredLeft}; ${hint}`,
      url: url,
    };
  }

  // Second pass: validation errors / still-empty required → answer again, then resubmit
  if (v.stillSubmit || v.requiredLeft) {
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
    v = verdictFromSnapshot(snapshot);
    console.log(
      `  MGH post-retry: thanks=${v.thanks} stillSubmit=${v.stillSubmit} requiredLeft=${v.requiredLeft}`
    );
    if (v.thanks && !v.stillSubmit && !v.requiredLeft) {
      return { status: "applied", notes: "Submitted via MyGreenhouse (BrowserSkill, retry)", url: url };
    }
  }

  // Never claim applied without an explicit confirmation signal.
  const hint = (v.body || "").replace(/\s+/g, " ").slice(0, 180);
  return {
    status: "review",
    notes: `MyGreenhouse submit unconfirmed — thanks=${v.thanks} stillSubmit=${v.stillSubmit} required=${v.requiredLeft}; ${hint}`,
    url: url,
  };
}

/** Seed common stuck patterns into the Q&A bank (idempotent). */
export function seedCommonQaBank(candidate = {}, prefs = {}) {
  const years = candidate.years_experience || "3–4 years";
  const salary = prefs.salary_range || "$120,000 - $150,000";
  const addl = String(prefs.claims?.additional_info || "").trim();
  const seeds = [
    { match: "how did you hear about us", answer: "LinkedIn", notes: "common GH" },
    { match: "how did you hear about this", answer: "LinkedIn", notes: "common GH" },
    { match: "how did you first hear about this job", answer: "LinkedIn", notes: "Torc-style" },
    { match: "years of industry experience", answer: years, notes: "from profile years_experience" },
    { match: "how many years of experience", answer: years, notes: "from profile years_experience" },
    { match: "years of experience", answer: years, notes: "from profile years_experience" },
    { match: "preference on which team", answer: "Open to any relevant team listed in the posting", notes: "Airtable-style" },
    { match: "which team to join", answer: "Open to any relevant team listed in the posting", notes: "Airtable-style" },
    { match: "base salary range", answer: salary, notes: "from profile salary_range" },
    { match: "salary range are you targeting", answer: salary, notes: "from profile salary_range" },
    { match: "start date", answer: "2–4 weeks", notes: "common" },
    { match: "earliest start", answer: "2–4 weeks", notes: "common" },
    { match: "availability or desired start", answer: "2–4 weeks", notes: "Torc-style" },
    { match: "willing to relocate", answer: "Yes", notes: "office_preference any" },
    { match: "export control", answer: prefs.export_control_countries || "None/Not applicable", notes: "from profile" },
    { match: "citizen, national, or resident of any of the following", answer: prefs.export_control_countries || "None/Not applicable", notes: "from profile" },
    { match: "if you checked any of the boxes above", answer: prefs.export_control_immigration || "", notes: "from profile" },
    { match: "additional information regarding your immigration", answer: prefs.export_control_immigration || "", notes: "from profile" },
    { match: "indicate the applicable country", answer: prefs.export_control_country_detail || candidate.passport_country || "", notes: "from profile" },
    { match: "restrict your ability to accept this offer", answer: "No", notes: "always_no" },
    { match: "agreement between you and your current or former employer", answer: "No", notes: "always_no" },
    { match: "legally authorized to work", answer: "Yes", notes: "common" },
    { match: "authorized to lawfully work", answer: "Yes", notes: "Roku-style" },
    { match: "lawfully work for", answer: "Yes", notes: "Roku-style" },
    { match: "relatives or family members currently employed", answer: "No", notes: "Torc-style" },
    { match: "website / portfolio", answer: candidate.github || "", notes: "profile github" },
  ];
  if (addl) {
    seeds.push({ match: "additional information you would like us to consider", answer: addl, notes: "from profile claims.additional_info" });
    seeds.push({ match: "evaluating your application, please provide it below", answer: addl, notes: "from profile claims.additional_info" });
  }
  if (candidate.requires_sponsorship === false || String(candidate.requires_sponsorship).toLowerCase() === "false") {
    seeds.push({ match: "require sponsorship", answer: "No", notes: "profile requires_sponsorship=false" });
    seeds.push({ match: "need sponsorship", answer: "No", notes: "profile requires_sponsorship=false" });
  } else if (candidate.requires_sponsorship === true || String(candidate.requires_sponsorship).toLowerCase() === "true") {
    seeds.push({ match: "require sponsorship", answer: "Yes", notes: "profile requires_sponsorship=true" });
    seeds.push({ match: "need sponsorship", answer: "Yes", notes: "profile requires_sponsorship=true" });
    seeds.push({ match: "sponsorship for employment visa", answer: "Yes", notes: "profile requires_sponsorship=true" });
  }
  for (const s of seeds) {
    if (s.answer) upsertQaBankEntry(s);
  }
  return seeds.length;
}

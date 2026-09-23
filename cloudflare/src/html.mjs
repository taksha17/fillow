function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function prettyCompany(name) {
  const raw = String(name || "").trim();
  const map = {
    openai: "OpenAI",
    anthropic: "Anthropic",
    stripe: "Stripe",
    scaleai: "Scale AI",
    mongodb: "MongoDB",
    datadog: "Datadog",
    gitlab: "GitLab",
    cloudflare: "Cloudflare",
    elevenlabs: "ElevenLabs",
    snowflake: "Snowflake",
    databricks: "Databricks",
    perplexity: "Perplexity",
    discord: "Discord",
    figma: "Figma",
    plaid: "Plaid",
    harvey: "Harvey",
  };
  const key = raw.toLowerCase().replace(/[\s_-]/g, "");
  if (map[key]) return map[key];
  return raw.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function fmtNum(n) {
  return Number(n || 0).toLocaleString("en-US");
}

function fmtDate(iso) {
  const raw = String(iso || "");
  const d = new Date(/^\d{4}-\d{2}-\d{2}/.test(raw) ? `${raw.slice(0, 10)}T00:00:00` : raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function statusTone(status) {
  const s = String(status || "").toLowerCase();
  if (/offer/.test(s)) return "offer";
  if (/interview/.test(s)) return "live";
  if (/applied|submitted|under_review/.test(s)) return "sent";
  if (/reject|closed|withdraw/.test(s)) return "no";
  if (/ready/.test(s)) return "ready";
  if (/dry_run/.test(s)) return "dry";
  if (/review/.test(s)) return "hold";
  return "wait";
}

function csv(v) {
  return esc(Array.isArray(v) ? v.join(", ") : String(v || ""));
}

function discoverPanel(settings, lastRun) {
  const b = settings?.boards || {};
  const f = settings?.filters || {};
  const last = lastRun
    ? `<p class="runlast">Last run ${esc(fmtDate(lastRun.ranAt))}: fetched ${fmtNum(lastRun.fetched)} · kept ${fmtNum(lastRun.kept)} · +${fmtNum(lastRun.upserted)} new</p>`
    : `<p class="runlast">Runs the public ATS boards here in the Worker; results land straight in D1.</p>`;
  return `<div class="runpanel">
    <div class="runbar">
      <button type="button" class="btn-gold" data-discover-run>Discover now</button>
      <button type="button" class="btn-ghost" data-discover-toggle>Boards & filters</button>
      ${last}
    </div>
    <form class="runform" data-discover-form hidden>
      <label>Greenhouse boards<input name="greenhouse" value="${csv(b.greenhouse)}" placeholder="stripe, datadog"/></label>
      <label>Ashby boards<input name="ashby" value="${csv(b.ashby)}" placeholder="anthropic, ramp"/></label>
      <label>Lever companies<input name="lever" value="${csv(b.lever)}" placeholder="mistral"/></label>
      <label>Workday portals<input name="workday" value="${csv(b.workday)}" placeholder="toyota.wd503.myworkdayjobs.com/TMNA"/></label>
      <label>Keywords<input name="keywords" value="${csv(f.keywords)}" placeholder="ML Engineer, Backend"/></label>
      <label>Exclude<input name="exclude_keywords" value="${csv(f.exclude_keywords)}" placeholder="internship"/></label>
      <label>Locations<input name="locations" value="${csv(f.locations)}" placeholder="United States, Remote"/></label>
      <label class="mini">Remote OK<input name="remote_ok" type="checkbox" ${f.remote_ok !== false ? "checked" : ""}/></label>
      <label class="mini">Posted within days<input name="posted_within_days" type="number" min="0" value="${esc(f.posted_within_days ?? 30)}"/></label>
    </form>
    <p class="runout" data-discover-out aria-live="polite"></p>
  </div>`;
}

function jobRows(jobs) {
  if (!jobs.length) return `<p class="blank">No jobs in D1 yet — run Agent 1 (Discover) to fill the pool.</p>`;
  return `<div class="list"><div class="job-table" role="table" aria-label="Discovered jobs">
    <div class="job-heads" role="row">
      <span role="columnheader">Company / Role</span>
      <span role="columnheader">Location</span>
      <span role="columnheader">ATS</span>
      <span role="columnheader">Match Score</span>
      <span role="columnheader">Pipeline Status</span>
    </div>
    ${jobs.map((j) => {
      const href = j.url || j.apply_url || "";
      const title = href
        ? `<a href="${esc(href)}" rel="noopener">${esc(j.title || "Untitled")}</a>`
        : esc(j.title || "Untitled");
      return `<article class="row job tone-${statusTone(j.status)}" role="row">
        <div class="job-identity">
          <h3>${esc(prettyCompany(j.company))}</h3>
          <p>${title}</p>
        </div>
        <span class="job-field">${esc(j.location || "—")}</span>
        <span class="job-field">${esc(j.ats || "")}</span>
        <span class="job-field score">${esc(j.match_score || "—")}</span>
        <span class="job-field stamp">${esc(j.status || "discovered")}</span>
      </article>`;
    }).join("")}
  </div></div>`;
}

function filingRows(rows, resumeHref) {
  if (!rows.length) return `<p class="blank">Nothing filed yet. Agent 3 writes here after apply; Agent 4 keeps the ledger.</p>`;
  return `<div class="list"><div class="filing-table" role="table" aria-label="Application tracker">
    <div class="filing-heads" role="row">
      <span role="columnheader">Company / Role</span>
      <span role="columnheader">Applied Date</span>
      <span role="columnheader">Match Score</span>
      <span role="columnheader">Current Status</span>
      <span role="columnheader">Tailored Resume</span>
      <span role="columnheader">Application Notes</span>
    </div>
    ${[...rows]
    .reverse()
    .map((r) => {
      const href = r.url || "";
      const company = href
        ? `<a href="${esc(href)}" rel="noopener">${esc(prettyCompany(r.company))}</a>`
        : esc(prettyCompany(r.company));
      const resume = resumeHref ? resumeHref(r) : r.id ? `/api/resume/${Number(r.id)}` : "";
      return `<article class="row filing tone-${statusTone(r.status)}" data-filing role="row">
        <div class="filing-identity">
          <h3>${company}</h3>
          <p>${esc(r.role)}</p>
        </div>
        <time class="filing-field">${esc(fmtDate(r.date))}</time>
        <span class="filing-field score">${esc(r.score || "—")}</span>
        <span class="filing-field stamp">${esc(r.status)}</span>
        <div class="filing-field resume-cell">${resume ? `<a class="resume" href="${esc(resume)}" download rel="noopener">↓ resume</a>` : `<span class="empty">—</span>`}</div>
        <p class="notes filing-notes">${esc(r.notes)}</p>
      </article>`;
    })
    .join("")}
  </div></div>`;
}

export function dashboardHtml(rows, title = "fillow", extras = {}) {
  const submitted = rows.filter((r) => /applied|submitted|under_review|interview|offer/i.test(r.status || "")).length;
  const live = rows.filter((r) => /interview|offer/i.test(r.status || "")).length;
  const jobs = Number(extras.jobs ?? 0);
  const scored = Number(extras.scored ?? 0);
  const jobStatuses = extras.jobStatuses || {};
  const ready = Number(jobStatuses.ready || 0);
  const companies = extras.companies || [];
  const recentJobs = extras.recentJobs || [];
  const hosted = extras.source !== "local";
  const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const initial = extras.stage || (rows.length ? "track" : "discover");
  const evaluatedJobs = recentJobs.filter((j) => j.match_score || j.status === "ready");
  const authArea = extras.user
    ? `<span class="who">${esc(extras.user.name || extras.user.email || "signed in")}</span><a class="authlink" href="/auth/logout">Sign out</a>`
    : extras.authConfigured
      ? `<a class="authlink" href="/auth/login">Sign in</a>`
      : "";
  // JWT-authenticated users see the generic product view; the default/local
  // user keeps the CLI-era copy ("npm start", "local files win").
  const product = Boolean(extras.user);
  const tagline = product ? "Cloudflare + D1 workspace" : hosted ? "Cloudflare + D1 · local files win" : "local files";

  const companyLine = companies.length
    ? companies
        .map((c) => `<span class="co">${esc(prettyCompany(c.company))} <em>${fmtNum(c.n)}</em></span>`)
        .join("")
    : "";

  const stages = [
    { id: "discover", num: "01", name: "Discover", count: jobs, hint: "Agent 1 · ATS APIs", done: jobs > 0 },
    { id: "evaluate", num: "02", name: "Evaluate", count: ready || scored, hint: "Agent 2 · score + tailor", done: ready + scored > 0 },
    { id: "apply", num: "03", name: "Apply", count: submitted || rows.filter((r) => /dry_run|review/i.test(r.status || "")).length, hint: "Agent 3 · Playwright", done: rows.length > 0 },
    { id: "track", num: "04", name: "Track", count: rows.length, hint: "Agent 4 · ledger + mail", done: rows.length > 0 },
  ];

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${esc(title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@1,9..144,560&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet"/>
  <style>
    :root {
      --bg: #100f0c;
      --panel: #181612;
      --ink: #f4efe6;
      --mute: #9c9488;
      --line: #2a261f;
      --gold: #e0a14a;
      --moss: #7dba7a;
      --rose: #d46a5c;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; background: var(--bg); color: var(--ink); }
    body { min-height: 100vh; font: 15px/1.45 "IBM Plex Sans", ui-sans-serif, sans-serif; }
    a { color: inherit; }
    code { font-size: .92em; }
    .wrap { max-width: 1120px; margin: 0 auto; padding: 28px 28px 64px; }
    header.top {
      display: flex; justify-content: space-between; align-items: baseline; gap: 16px;
      padding-bottom: 22px;
    }
    .mark { margin: 0; font-family: Fraunces, Georgia, serif; font-style: italic; font-size: 2rem; font-weight: 560; letter-spacing: -.03em; }
    .logo { width: 48px; height: 48px; object-fit: contain; vertical-align: middle; margin-right: 12px; border-radius: 8px; filter: brightness(0) invert(87%) sepia(0.42) saturate(3.5) hue-rotate(-8deg) opacity(0.92); }
    .brand { display: flex; align-items: center; gap: 4px; }
    .sub { margin: 4px 0 0; color: var(--mute); font-size: .92rem; }
    .when { text-align: right; color: var(--mute); font-size: .85rem; }
    .when strong { display: block; color: var(--ink); font-weight: 500; }
    .pipe {
      display: grid; grid-template-columns: repeat(4, 1fr); gap: 0;
      border: 1px solid var(--line); background: var(--panel);
    }
    .pipe a {
      position: relative; padding: 16px 18px 18px; text-decoration: none;
      border-right: 1px solid var(--line); color: var(--mute);
    }
    .pipe a:last-child { border-right: 0; }
    .pipe a.on { color: var(--ink); background: #1f1c16; }
    .pipe a.on::after {
      content: ""; position: absolute; left: 18px; right: 18px; bottom: 0; height: 2px; background: var(--gold);
    }
    .pipe i { display: block; font-style: normal; font-size: .68rem; letter-spacing: .16em; color: var(--gold); }
    .pipe strong { display: block; margin: 6px 0 2px; font-weight: 600; color: inherit; }
    .pipe b { display: block; font-size: 1.55rem; font-weight: 500; letter-spacing: -.03em; color: var(--ink); }
    .pipe small { display: block; margin-top: 4px; font-size: .75rem; color: var(--mute); }
    .pipe a.done b { color: var(--moss); }
    section.stage { display: none; padding: 28px 0 0; }
    section.stage.on { display: block; }
    .lede { max-width: 62ch; margin: 0 0 20px; color: var(--mute); }
    .lede strong { color: var(--ink); font-weight: 500; }
    .chips { display: flex; flex-wrap: wrap; gap: 8px 10px; margin: 0 0 22px; }
    .co {
      border: 1px solid var(--line); padding: 5px 10px; font-size: .85rem; color: var(--ink);
    }
    .co em { font-style: normal; color: var(--mute); margin-left: .35em; }
    .toolbar { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; margin: 8px 0 12px; }
    .toolbar h2 { margin: 0; font-size: 1rem; font-weight: 600; }
    .toolbar input {
      width: min(280px, 100%); border: 0; border-bottom: 1px solid var(--line);
      background: transparent; color: var(--ink); padding: 6px 0; font: inherit;
    }
    .toolbar input:focus { outline: none; border-bottom-color: var(--gold); }
    .list { border-top: 1px solid var(--line); }
    .row {
      display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(180px, .9fr); gap: 10px 24px;
      padding: 13px 0 13px 12px; border-bottom: 1px solid var(--line); border-left: 2px solid var(--line);
    }
    .job-heads, .filing-heads {
      display: grid; gap: 10px 24px; padding: 0 0 7px 12px;
      color: var(--mute); font-size: .68rem; font-weight: 600;
      letter-spacing: .12em; text-transform: uppercase;
      border-bottom: 1px solid var(--line);
    }
    .job-heads { grid-template-columns: minmax(0, 1.4fr) minmax(120px, .7fr) minmax(70px, .4fr) minmax(70px, .4fr) minmax(110px, .6fr); }
    .row.job { grid-template-columns: minmax(0, 1.4fr) minmax(120px, .7fr) minmax(70px, .4fr) minmax(70px, .4fr) minmax(110px, .6fr); }
    .filing-heads { grid-template-columns: minmax(0, 1.3fr) minmax(90px, .45fr) minmax(70px, .35fr) minmax(120px, .6fr) minmax(110px, .55fr) minmax(0, 1fr); }
    .row.filing { grid-template-columns: minmax(0, 1.3fr) minmax(90px, .45fr) minmax(70px, .35fr) minmax(120px, .6fr) minmax(110px, .55fr) minmax(0, 1fr); }
    .job-identity, .filing-identity, .job-field, .filing-field { min-width: 0; }
    .job-field, .filing-field { display: flex; align-items: center; color: var(--mute); font-size: .82rem; }
    .filing-notes { align-self: start; }
    .empty { color: var(--mute); }
    .tone-sent { border-left-color: var(--gold); }
    .tone-live, .tone-offer, .tone-ready { border-left-color: var(--moss); }
    .tone-no { border-left-color: var(--rose); }
    .row h3 { margin: 0; font-size: .98rem; font-weight: 600; }
    .row p { margin: 3px 0 0; color: var(--mute); }
    .meta { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; color: var(--mute); font-size: .82rem; }
    .stamp { letter-spacing: .08em; text-transform: uppercase; font-size: .68rem; color: var(--ink); }
    .score { font-variant-numeric: tabular-nums; }
    .notes { margin: 0; color: var(--mute); font-size: .85rem; overflow-wrap: anywhere; }
    a.resume { color: var(--gold); text-decoration: underline; text-underline-offset: 3px; white-space: nowrap; }
    .blank { color: var(--mute); }
    .runpanel { border: 1px solid var(--line); background: var(--panel); padding: 14px 16px; margin: 0 0 18px; }
    .runbar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .btn-gold { background: linear-gradient(180deg, #edbb6a, var(--gold)); color: #20180a; border: 0; padding: 9px 18px; font: 600 .9rem/1 "IBM Plex Sans", sans-serif; cursor: pointer; }
    .btn-gold:disabled { opacity: .55; cursor: wait; }
    .btn-ghost { background: transparent; color: var(--mute); border: 1px solid var(--line); padding: 8px 14px; font: inherit; cursor: pointer; }
    .btn-ghost:hover { color: var(--ink); border-color: var(--gold); }
    .runlast { margin: 0; color: var(--mute); font-size: .8rem; }
    .runform { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; padding: 16px 2px 2px; }
    .runform label { display: grid; gap: 4px; color: var(--mute); font-size: .72rem; letter-spacing: .06em; text-transform: uppercase; }
    .runform label.mini { grid-template-columns: auto auto; align-items: center; justify-content: start; gap: 8px; text-transform: none; letter-spacing: 0; }
    .runform input { border: 1px solid var(--line); background: #100f0c; color: var(--ink); padding: 7px 9px; font: inherit; }
    .runform input:focus { outline: none; border-color: var(--gold); }
    .runout { margin: 10px 0 0; color: var(--ink); font-size: .85rem; min-height: 1em; }
    .when .who { color: var(--ink); font-weight: 500; margin-right: 10px; }
    .authlink { color: var(--gold); text-decoration: underline; text-underline-offset: 3px; margin-right: 10px; font-size: .85rem; }
    .empty { padding: 26px 12px; color: var(--mute); border-bottom: 1px solid var(--line); }
    footer {
      display: flex; justify-content: space-between; gap: 16px;
      margin-top: 36px; padding-top: 14px; border-top: 1px solid var(--line);
      color: var(--mute); font-size: .78rem;
    }
    footer a { text-decoration: underline; text-underline-offset: 3px; }
    @media (max-width: 800px) {
      .wrap { padding: 20px 16px 48px; }
      .pipe, .row, .row.job, .row.filing { grid-template-columns: 1fr; }
      .job-heads, .filing-heads { display: none; }
      .pipe a { border-right: 0; border-bottom: 1px solid var(--line); }
      .when { text-align: left; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <header class="top">
      <div>
        <div class="brand">
          <img src="/fillow_logo.png" alt="fillow logo" class="logo" onerror="this.style.display='none'" />
          <h1 class="mark">fillow</h1>
        </div>
        <p class="sub">One workflow. Four agents. Same run.</p>
      </div>
      <p class="when">${authArea ? `${authArea}<br/>` : ""}<strong>${esc(today)}</strong>${tagline}</p>
    </header>
    <nav class="pipe" role="tablist">
      ${stages
        .map(
          (s) => `<a href="#${s.id}" data-tab="${s.id}" class="${s.id === initial ? "on" : ""} ${s.done ? "done" : ""}" role="tab">
        <i>${s.num}</i><strong>${s.name}</strong><b>${fmtNum(s.count)}</b><small>${s.hint}</small>
      </a>`
        )
        .join("")}
    </nav>

    <section class="stage ${initial === "discover" ? "on" : ""}" data-stage="discover">
      <p class="lede"><strong>Agent 1</strong> pulls public Greenhouse, Ashby, and Lever boards into ${product ? "your pipeline. Set your boards and filters below, then hit Discover now." : "one pool. This is not a second product — it is the first step of <code>npm start</code>."}</p>
      ${companyLine ? `<div class="chips">${companyLine}</div>` : ""}
      ${discoverPanel(extras.discover, extras.lastRun)}
      <div class="toolbar"><h2>Latest in the pool</h2></div>
      ${recentJobs.length ? jobRows(recentJobs) : `<div class="empty">${product ? "Your pool is empty — set your boards above and click Discover now." : "No jobs synced yet."}</div>`}
    </section>

    <section class="stage ${initial === "evaluate" ? "on" : ""}" data-stage="evaluate">
      <p class="lede"><strong>Agent 2</strong> scores each posting, gates on match + legitimacy, and tailors a resume. <strong>${fmtNum(scored)}</strong> scored · <strong>${fmtNum(ready)}</strong> ready to apply.</p>
      ${jobRows(evaluatedJobs.length ? evaluatedJobs : recentJobs.filter((j) => j.status === "ready"))}
    </section>

    <section class="stage ${initial === "apply" ? "on" : ""}" data-stage="apply">
      <p class="lede"><strong>Agent 3</strong> ${product ? "pre-fills each ATS application with your profile and resume, then reports the outcome here." : "fills the form in a real browser on your machine. Playwright cannot run on Workers Free, so apply stays local and this page only shows the results."}</p>
      ${filingRows((() => {
        const applyRows = rows.filter((r) => /applied|submitted|dry_run|review|failed/i.test(r.status || ""));
        return applyRows.length ? applyRows : rows;
      })(), extras.resumeHref)}
    </section>

    <section class="stage ${initial === "track" ? "on" : ""}" data-stage="track">
      <p class="lede"><strong>Agent 4</strong> ${product ? "records every application outcome, watches for employer replies, and keeps this ledger current." : `writes every outcome to <code>data/applications.md</code>, watches Gmail, and syncs this index.`} ${fmtNum(live)} live · ${fmtNum(submitted)} sent · ${fmtNum(rows.length)} applications on the ledger.</p>
      <div class="toolbar">
        <h2>Filings</h2>
        <input data-filter type="search" placeholder="Find a company or role" aria-label="Filter filings"/>
      </div>
      ${rows.length ? filingRows(rows, extras.resumeHref) : `<div class="empty">${product ? "No applications yet. Once your pool fills up, everything you apply to lands here." : "No applications synced yet."}</div>`}
    </section>

    <footer>
      <span>${product ? "Your isolated workspace — only your pipeline, only your data." : hosted ? "Single URL. Agents run locally via npm start, then sync here." : "Canonical tracker: data/applications.md"}</span>
      <span><a href="/api/dashboard">JSON</a> · <a href="/api/applications">applications</a> · <a href="/api/jobs">jobs</a></span>
    </footer>
  </div>
  <script>
    const tabs = [...document.querySelectorAll("[data-tab]")];
    const stages = [...document.querySelectorAll("[data-stage]")];
    function show(id) {
      tabs.forEach((t) => t.classList.toggle("on", t.dataset.tab === id));
      stages.forEach((s) => s.classList.toggle("on", s.dataset.stage === id));
    }
    tabs.forEach((t) => t.addEventListener("click", (e) => {
      e.preventDefault();
      history.replaceState(null, "", "#" + t.dataset.tab);
      show(t.dataset.tab);
    }));
    const fromHash = location.hash.replace("#", "");
    if (fromHash) show(fromHash);
    const box = document.querySelector("[data-filter]");
    if (box) box.addEventListener("input", () => {
      const q = box.value.trim().toLowerCase();
      document.querySelectorAll("[data-filing]").forEach((row) => {
        row.hidden = Boolean(q) && !row.textContent.toLowerCase().includes(q);
      });
    });
    const runBtn = document.querySelector("[data-discover-run]");
    if (runBtn) {
      const out = document.querySelector("[data-discover-out]");
      const form = document.querySelector("[data-discover-form]");
      const toggle = document.querySelector("[data-discover-toggle]");
      if (toggle) toggle.addEventListener("click", () => { form.hidden = !form.hidden; });
      const listOf = (name) => (form.elements[name].value || "").split(",").map((s) => s.trim()).filter(Boolean);
      runBtn.addEventListener("click", async () => {
        let token = localStorage.getItem("fillow_sync_token");
        if (!token) {
          token = prompt("FILLLOW_SYNC_TOKEN (from your .env):") || "";
          if (token) localStorage.setItem("fillow_sync_token", token);
        }
        if (!token) { out.textContent = "Token required — it is FILLLOW_SYNC_TOKEN in your .env."; return; }
        runBtn.disabled = true;
        out.textContent = "Running Agent 1 discovery in the Worker…";
        try {
          const res = await fetch("/api/discover", {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer " + token },
            body: JSON.stringify({
              boards: { greenhouse: listOf("greenhouse"), ashby: listOf("ashby"), lever: listOf("lever"), workday: listOf("workday") },
              filters: {
                keywords: listOf("keywords"),
                exclude_keywords: listOf("exclude_keywords"),
                locations: listOf("locations"),
                remote_ok: form.elements.remote_ok.checked,
                posted_within_days: Number(form.elements.posted_within_days.value || 0),
              },
            }),
          });
          const body = await res.json();
          if (!res.ok) throw new Error(body.error || ("HTTP " + res.status));
          out.textContent = "Fetched " + body.fetched + " · kept " + body.kept + " · " + body.upserted + " new into D1";
          setTimeout(() => location.reload(), 1400);
        } catch (err) {
          out.textContent = "Failed: " + err.message;
          runBtn.disabled = false;
        }
      });
    }
  </script>
</body>
</html>`;
}

export function metricsFrom(rows) {
  const byStatus = {};
  const byDay = {};
  for (const row of rows) {
    byStatus[row.status || "unknown"] = (byStatus[row.status || "unknown"] || 0) + 1;
    byDay[row.date] = (byDay[row.date] || 0) + 1;
  }
  const submitted = rows.filter((r) => /applied|submitted|under_review|interview|offer/i.test(r.status || "")).length;
  const offers = rows.filter((r) => /offer/i.test(r.status || "")).length;
  return {
    total: rows.length,
    byStatus,
    byDay,
    conversion_rate: submitted ? offers / submitted : 0,
  };
}

const LOGIN_CSS = `
  :root { --bg:#100f0c; --panel:#181612; --ink:#f4efe6; --mute:#9c9488; --line:#2a261f; --gold:#e0a14a; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: var(--bg); color: var(--ink); }
  body { min-height: 100vh; display: grid; place-items: center; font: 15px/1.5 "IBM Plex Sans", ui-sans-serif, sans-serif; padding: 24px; }
  .card { width: min(420px, 100%); border: 1px solid var(--line); background: var(--panel); padding: 30px 28px; }
  .brand { display: flex; align-items: baseline; gap: 10px; margin-bottom: 6px; }
  .mark { margin: 0; font-family: Fraunces, Georgia, serif; font-style: italic; font-size: 1.7rem; font-weight: 560; letter-spacing: -.03em; }
  .brand small { color: var(--mute); }
  h2 { margin: 18px 0 6px; font-size: 1.05rem; font-weight: 600; }
  p.note { margin: 0 0 18px; color: var(--mute); font-size: .88rem; }
  label { display: block; margin: 12px 0 4px; color: var(--mute); font-size: .72rem; letter-spacing: .08em; text-transform: uppercase; }
  input { width: 100%; border: 1px solid var(--line); background: #0d0c0a; color: var(--ink); padding: 10px 11px; font: inherit; }
  input:focus { outline: none; border-color: var(--gold); }
  .btn { width: 100%; margin-top: 16px; border: 0; padding: 11px; font: 600 .92rem/1 "IBM Plex Sans", sans-serif; cursor: pointer; background: linear-gradient(180deg, #edbb6a, var(--gold)); color: #20180a; }
  .btn:disabled { opacity: .55; cursor: wait; }
  .ghost { width: 100%; margin-top: 10px; padding: 10px; background: transparent; border: 1px solid var(--line); color: var(--ink); font: inherit; cursor: pointer; }
  .ghost:hover { border-color: var(--gold); color: var(--gold); }
  .sep { display: grid; grid-template-columns: 1fr auto 1fr; gap: 10px; align-items: center; color: var(--mute); font-size: .75rem; margin: 18px 0 0; }
  .sep::before, .sep::after { content: ""; height: 1px; background: var(--line); }
  .msg { margin-top: 12px; color: var(--mute); font-size: .85rem; min-height: 1em; }
  .msg.err { color: #d46a5c; }
  footer { margin-top: 18px; color: var(--mute); font-size: .75rem; }
  footer a { color: var(--gold); text-decoration: underline; text-underline-offset: 3px; }
`;

/**
 * Supabase Auth page: sign in / sign up (email+password) and OAuth (GitHub, Google).
 * supabase-js runs client-side; on session it POSTs the access token to
 * /auth/session which verifies the JWT (JWKS) and sets the HttpOnly cookie.
 */
export function loginHtml(supabaseUrl = "", anonKey = "", { mode = "/auth/login", note = "" } = {}) {
  const configured = Boolean(supabaseUrl && anonKey);
  const body = configured
    ? `
  <div class="card">
    <div class="brand"><h1 class="mark">fillow</h1><small>multi-user sign in</small></div>
    <h2 id="heading">Sign in</h2>
    <p class="note">Your applications, jobs, and dashboard stay isolated per account.</p>
    <form id="form">
      <label for="email">Email</label>
      <input id="email" type="email" autocomplete="email" required/>
      <label for="password">Password</label>
      <input id="password" type="password" autocomplete="current-password" required/>
      <button class="btn" id="submit" type="submit">Sign in</button>
      <button class="ghost" id="toggle" type="button">New here? Create an account</button>
    </form>
    <div class="sep">or continue with</div>
    <button class="ghost" id="github" type="button">GitHub</button>
    <button class="ghost" id="google" type="button">Google</button>
    <p class="msg" id="msg"></p>
    <footer><a href="/">back to dashboard</a></footer>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  <script>
    const sb = window.supabase.createClient(${JSON.stringify(supabaseUrl)}, ${JSON.stringify(anonKey)});
    const msg = document.getElementById("msg");
    const heading = document.getElementById("heading");
    const submit = document.getElementById("submit");
    const toggle = document.getElementById("toggle");
    let signingUp = false;

    function say(text, err) { msg.textContent = text || ""; msg.className = "msg" + (err ? " err" : ""); }

    async function exchange(session) {
      say("Signing in…");
      const res = await fetch("/auth/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ access_token: session.access_token }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "session exchange failed");
      location.href = "/";
    }

    toggle.addEventListener("click", () => {
      signingUp = !signingUp;
      heading.textContent = signingUp ? "Create account" : "Sign in";
      submit.textContent = signingUp ? "Sign up" : "Sign in";
      toggle.textContent = signingUp ? "Have an account? Sign in" : "New here? Create an account";
    });

    document.getElementById("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      submit.disabled = true;
      try {
        const email = document.getElementById("email").value.trim();
        const password = document.getElementById("password").value;
        const { data, error } = signingUp
          ? await sb.auth.signUp({ email, password })
          : await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        if (data.session) return exchange(data.session);
        say("Check your inbox to confirm your email, then sign in.");
      } catch (err) {
        say(String(err.message || err), true);
      } finally {
        submit.disabled = false;
      }
    });

    for (const [id, provider] of [["github", "github"], ["google", "google"]]) {
      document.getElementById(id).addEventListener("click", async () => {
        say("Redirecting to " + provider + "…");
        await sb.auth.signInWithOAuth({ provider, options: { redirectTo: location.origin + "/auth/callback" } });
      });
    }

    // Render OAuth buttons only for providers enabled in this Supabase project —
    // disabled ones would redirect users to a raw "provider is not enabled" error.
    fetch(${JSON.stringify(supabaseUrl)} + "/auth/v1/settings", { headers: { apikey: ${JSON.stringify(anonKey)} } })
      .then(function (res) { return res.json(); })
      .then(function (settings) {
        const ext = settings.external || {};
        if (!ext.github) { var g = document.getElementById("github"); if (g) g.remove(); }
        if (!ext.google) { var o = document.getElementById("google"); if (o) o.remove(); }
        if (!ext.github && !ext.google) { var sep = document.querySelector(".sep"); if (sep) sep.remove(); }
      })
      .catch(function () {});

    // OAuth callback: supabase-js completes the PKCE exchange on load.
    if (location.pathname.startsWith("/auth/callback")) {
      (async () => {
        say("Completing sign-in…");
        const { data, error } = await sb.auth.getSession();
        if (error) say(String(error.message || error), true);
        else if (data.session) exchange(data.session);
        else say("No session on this callback — sign in again.", true);
      })();
    }
  </script>`
    : `
  <div class="card">
    <div class="brand"><h1 class="mark">fillow</h1><small>multi-user auth</small></div>
    <h2>Auth not configured</h2>
    <p class="note">${esc(note || "Set SUPABASE_URL and SUPABASE_ANON_KEY on this Worker to enable sign-up and sign-in.")}</p>
    <p class="note">Until then the dashboard runs in single-user mode — everything keeps working with your sync token.</p>
    <footer><a href="/">back to dashboard</a></footer>
  </div>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>fillow — sign in</title>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@1,9..144,560&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet"/>
  <style>${LOGIN_CSS}</style>
</head>
<body>${body}
</body>
</html>`;
}

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

function jobRows(jobs) {
  if (!jobs.length) return `<p class="blank">No jobs in D1 yet. Run <code>npm start</code>.</p>`;
  return `<div class="list">${jobs
    .map((j) => {
      const href = j.url || j.apply_url || "";
      const title = href
        ? `<a href="${esc(href)}" rel="noopener">${esc(j.title || "Untitled")}</a>`
        : esc(j.title || "Untitled");
      return `<article class="row tone-${statusTone(j.status)}">
        <div>
          <h3>${esc(prettyCompany(j.company))}</h3>
          <p>${title}</p>
        </div>
        <div class="meta">
          <span>${esc(j.location || "—")}</span>
          <span>${esc(j.ats || "")}</span>
          <span class="score">${esc(j.match_score || "—")}</span>
          <span class="stamp">${esc(j.status || "discovered")}</span>
        </div>
      </article>`;
    })
    .join("")}</div>`;
}

function filingRows(rows) {
  if (!rows.length) return `<p class="blank">Nothing filed yet. Agent 3 writes here after apply; Agent 4 keeps the ledger.</p>`;
  return `<div class="list">${[...rows]
    .reverse()
    .map((r) => {
      const href = r.url || "";
      const company = href
        ? `<a href="${esc(href)}" rel="noopener">${esc(prettyCompany(r.company))}</a>`
        : esc(prettyCompany(r.company));
      return `<article class="row filing tone-${statusTone(r.status)}" data-filing>
        <div>
          <h3>${company}</h3>
          <p>${esc(r.role)}</p>
        </div>
        <div class="meta">
          <time>${esc(fmtDate(r.date))}</time>
          <span class="score">${esc(r.score || "—")}</span>
          <span class="stamp">${esc(r.status)}</span>
        </div>
        <p class="notes">${esc(r.notes)}</p>
      </article>`;
    })
    .join("")}</div>`;
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
    .row.filing { grid-template-columns: minmax(0, 1.3fr) minmax(160px, .7fr) minmax(0, 1fr); }
    .tone-sent { border-left-color: var(--gold); }
    .tone-live, .tone-offer, .tone-ready { border-left-color: var(--moss); }
    .tone-no { border-left-color: var(--rose); }
    .row h3 { margin: 0; font-size: .98rem; font-weight: 600; }
    .row p { margin: 3px 0 0; color: var(--mute); }
    .meta { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; color: var(--mute); font-size: .82rem; }
    .stamp { letter-spacing: .08em; text-transform: uppercase; font-size: .68rem; color: var(--ink); }
    .score { font-variant-numeric: tabular-nums; }
    .notes { margin: 0; color: var(--mute); font-size: .85rem; overflow-wrap: anywhere; }
    .blank { color: var(--mute); }
    footer {
      display: flex; justify-content: space-between; gap: 16px;
      margin-top: 36px; padding-top: 14px; border-top: 1px solid var(--line);
      color: var(--mute); font-size: .78rem;
    }
    footer a { text-decoration: underline; text-underline-offset: 3px; }
    @media (max-width: 800px) {
      .wrap { padding: 20px 16px 48px; }
      .pipe, .row, .row.filing { grid-template-columns: 1fr; }
      .pipe a { border-right: 0; border-bottom: 1px solid var(--line); }
      .when { text-align: left; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <header class="top">
      <div>
        <h1 class="mark">fillow</h1>
        <p class="sub">One workflow. Four agents. Same run.</p>
      </div>
      <p class="when"><strong>${esc(today)}</strong>${hosted ? "Cloudflare + D1 · local files win" : "local files"}</p>
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
      <p class="lede"><strong>Agent 1</strong> pulls public Greenhouse, Ashby, and Lever boards into one pool. This is not a second product — it is the first step of <code>npm start</code>.</p>
      ${companyLine ? `<div class="chips">${companyLine}</div>` : ""}
      <div class="toolbar"><h2>Latest in the pool</h2></div>
      ${jobRows(recentJobs)}
    </section>

    <section class="stage ${initial === "evaluate" ? "on" : ""}" data-stage="evaluate">
      <p class="lede"><strong>Agent 2</strong> scores each posting, gates on match + legitimacy, and tailors a resume. <strong>${fmtNum(scored)}</strong> scored · <strong>${fmtNum(ready)}</strong> ready to apply.</p>
      ${jobRows(evaluatedJobs.length ? evaluatedJobs : recentJobs.filter((j) => j.status === "ready"))}
    </section>

    <section class="stage ${initial === "apply" ? "on" : ""}" data-stage="apply">
      <p class="lede"><strong>Agent 3</strong> fills the form in a real browser on your machine. Playwright cannot run on Workers Free, so apply stays local and this page only shows the results.</p>
      ${filingRows((() => {
        const applyRows = rows.filter((r) => /applied|submitted|dry_run|review|failed/i.test(r.status || ""));
        return applyRows.length ? applyRows : rows;
      })())}
    </section>

    <section class="stage ${initial === "track" ? "on" : ""}" data-stage="track">
      <p class="lede"><strong>Agent 4</strong> writes every outcome to <code>data/applications.md</code>, watches Gmail, and syncs this index. ${fmtNum(live)} live · ${fmtNum(submitted)} sent · ${fmtNum(rows.length)} applications on the ledger.</p>
      <div class="toolbar">
        <h2>Filings</h2>
        <input data-filter type="search" placeholder="Find a company or role" aria-label="Filter filings"/>
      </div>
      ${filingRows(rows)}
    </section>

    <footer>
      <span>${hosted ? "Single URL. Agents run locally via npm start, then sync here." : "Canonical tracker: data/applications.md"}</span>
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

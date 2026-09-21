export function detectAts(job) {
  if (job.ats) return String(job.ats).toLowerCase();
  const url = `${job.apply_url || ""} ${job.url || ""}`.toLowerCase();
  if (url.includes("greenhouse") || url.includes("my.greenhouse")) return "greenhouse";
  if (url.includes("ashbyhq") || url.includes("jobs.ashby")) return "ashby";
  if (url.includes("lever.co")) return "lever";
  if (url.includes("myworkdayjobs") || url.includes("workday.com")) return "workday";
  return "unknown";
}

export function parseGreenhouseIds(job) {
  let board = job.board_token || null;
  let jobId = null;
  if (job.external_id && String(job.external_id).includes(":")) {
    const [b, j] = String(job.external_id).split(":", 2);
    board = board || b;
    jobId = j;
  }
  if (!jobId) {
    const m = String(job.url || job.apply_url || "").match(/(?:jobs?\/|token=|gh_jid=)(\d+)/);
    if (m) jobId = m[1];
  }
  return { board, jobId };
}

export function greenhouseEmbedUrl(board, jobId) {
  return `https://job-boards.greenhouse.io/embed/job_app?for=${board}&token=${jobId}`;
}

export async function fetchGreenhouseJob(board, jobId) {
  try {
    const url = new URL(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${jobId}`);
    url.searchParams.set("questions", "true");
    const res = await fetch(url, { headers: { "User-Agent": "fillow/0.1" } });
    if (res.ok) return res.json();
  } catch {
    // ignore
  }
  return {};
}

export function parseAshbyIds(job) {
  let board = job.board_token || null;
  let jobId = null;
  if (job.external_id && String(job.external_id).includes(":")) {
    const [b, j] = String(job.external_id).split(":", 2);
    board = board || b;
    jobId = j;
  }
  if (!board || !jobId) {
    const m = String(job.url || job.apply_url || "").match(
      /(?:jobs\.ashbyhq\.com|ashbyhq\.com)\/([^/]+)\/([0-9a-f-]{36})/i
    );
    if (m) {
      board = board || m[1];
      jobId = jobId || m[2];
    }
  }
  return { board, jobId };
}

export async function fetchAshbyJob(board, jobId) {
  try {
    const res = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${board}`, {
      headers: { "User-Agent": "fillow/0.1" },
    });
    if (!res.ok) return {};
    const data = await res.json();
    const jobs = data.jobs || data || [];
    return (Array.isArray(jobs) ? jobs : []).find((j) => String(j.id) === String(jobId)) || {};
  } catch {
    return {};
  }
}

export function parseLeverIds(job) {
  let company = job.board_token || job.company || null;
  let jobId = null;
  if (job.external_id && String(job.external_id).includes(":")) {
    const [c, j] = String(job.external_id).split(":", 2);
    company = company || c;
    jobId = j;
  }
  if (!jobId) {
    const m = String(job.url || job.apply_url || "").match(
      /jobs\.lever\.co\/([^/]+)\/([0-9a-f-]{36})/i
    );
    if (m) {
      company = company || m[1];
      jobId = m[2];
    }
  }
  return { company, jobId };
}

export async function fetchLeverJob(company, jobId) {
  try {
    const res = await fetch(`https://api.lever.co/v0/postings/${company}/${jobId}?mode=json`, {
      headers: { "User-Agent": "fillow/0.1" },
    });
    if (res.ok) return res.json();
  } catch {
    // ignore
  }
  return {};
}

/** Strip Greenhouse HTML (often entity-escaped) into plain text for LLM/scoring. */
export function htmlToPlainText(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * jobs.tsv currently has no description column — Agent 2 needs the JD to
 * reorder skills / rewrite bullets. Fill `job.description` from the ATS
 * when missing (mutates and returns the same job object).
 */
export async function ensureJobDescription(job) {
  if (!job || String(job.description || "").trim().length > 80) return job;
  const ats = detectAts(job);
  if (ats === "greenhouse") {
    const { board, jobId } = parseGreenhouseIds(job);
    if (board && jobId) {
      const data = await fetchGreenhouseJob(board, jobId);
      const text = htmlToPlainText(data.content || data.description || "");
      if (text) job.description = text;
      if (!job.title && data.title) job.title = data.title;
    }
  } else if (ats === "ashby") {
    const { board, jobId } = parseAshbyIds(job);
    if (board && jobId) {
      const data = await fetchAshbyJob(board, jobId);
      const text = htmlToPlainText(data.descriptionPlain || data.descriptionHtml || "");
      if (text) job.description = text;
      if (!job.title && data.title) job.title = data.title;
    }
  } else if (ats === "lever") {
    const { company, jobId } = parseLeverIds(job);
    if (company && jobId) {
      const data = await fetchLeverJob(company, jobId);
      const text = htmlToPlainText(data.descriptionPlain || data.description || "");
      if (text) job.description = text;
      if (!job.title && data.text) job.title = data.text;
    }
  }
  return job;
}

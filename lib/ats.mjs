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

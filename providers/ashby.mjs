import { fetchJson } from "./http.mjs";

export async function fetchAshbyBoard(board) {
  const res = await fetchJson(`https://api.ashbyhq.com/posting-api/job-board/${board}`);
  if (res.status === 404 || res.status === 400) return [];
  if (!res.ok) throw new Error(`ashby/${board} HTTP ${res.status}`);
  const data = await res.json();
  return (data.jobs || []).map((item) => {
    const jobId = item.id || item.jobUrl || "";
    const jobUrl = item.jobUrl || `https://jobs.ashbyhq.com/${board}/${jobId}`;
    let applyUrl = jobUrl;
    if (!applyUrl.includes("/application")) applyUrl = `${jobUrl.replace(/\/$/, "")}/application`;
    return {
      source: "ashby",
      external_id: `${board}:${jobId}`,
      title: item.title || "",
      company: board,
      location: item.location || String(item.address || ""),
      description: item.descriptionPlain || item.descriptionHtml || "",
      url: jobUrl,
      apply_url: applyUrl,
      board_token: board,
      ats: "ashby",
      published_at: String(item.publishedAt || ""),
    };
  });
}

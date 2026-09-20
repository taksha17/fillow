import { fetchJson } from "./http.mjs";

export async function fetchWorkdayBoard(careerHost) {
  const host = String(careerHost || "").replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (!host) return [];
  const res = await fetchJson(`https://${host}/ccx/api/jobboard/v1/jobs`, {
    params: { limit: 200 },
  });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`workday/${host} HTTP ${res.status}`);
  const data = await res.json();
  const items = data.jobPostings || data.jobs;
  if (!Array.isArray(items)) return [];
  const base = `https://${host}`;
  return items
    .map((item) => {
      const jobId = String(item.id || item.jobId || item.postingId || "");
      if (!jobId) return null;
      const url = item.jobUrl || item.url || `${base}/en-US/job/${jobId}`;
      const company = item.companyName
        || item.hiringOrganization?.name
        || `${host.split(".")[0]}`.replace(/^./, (c) => c.toUpperCase());
      return {
        source: "workday",
        external_id: `workday:${jobId}`,
        title: item.title || item.name || "",
        company,
        location: item.location || item.locationsText || "",
        description: item.description || "",
        url,
        apply_url: url,
        board_token: host,
        ats: "workday",
        published_at: String(item.postedDate || item.datePosted || ""),
      };
    })
    .filter(Boolean);
}

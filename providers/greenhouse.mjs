import { fetchJson } from "./http.mjs";

export async function fetchGreenhouseBoard(boardToken) {
  const res = await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${boardToken}/jobs`, {
    params: { content: "true" },
  });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`greenhouse/${boardToken} HTTP ${res.status}`);
  const data = await res.json();
  return (data.jobs || []).map((item) => {
    const jobId = String(item.id);
    const url = item.absolute_url || `https://boards.greenhouse.io/${boardToken}/jobs/${jobId}`;
    return {
      source: "greenhouse",
      external_id: `${boardToken}:${jobId}`,
      title: item.title || "",
      company: boardToken,
      location: item.location?.name || "",
      description: item.content || "",
      url,
      apply_url: url,
      board_token: boardToken,
      ats: "greenhouse",
    };
  });
}

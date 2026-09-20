import { fetchJson } from "./http.mjs";

export async function fetchLeverCompany(company) {
  const res = await fetchJson(`https://api.lever.co/v0/postings/${company}`, {
    params: { mode: "json" },
  });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`lever/${company} HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) return [];
  return data.map((item) => {
    const cats = item.categories || {};
    const loc = [cats.location, cats.commitment].filter(Boolean).join(", ");
    const applyUrl = item.applyUrl || item.hostedUrl || "";
    return {
      source: "lever",
      external_id: `${company}:${item.id || ""}`,
      title: item.text || "",
      company,
      location: loc,
      description: item.descriptionPlain || item.description || "",
      url: item.hostedUrl || applyUrl,
      apply_url: applyUrl,
      board_token: company,
      ats: "lever",
    };
  });
}

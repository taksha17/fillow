const UA = "fillow/0.1 (personal job search)";

export async function checkLiveness(url, { timeoutMs = 12000 } = {}) {
  if (!url) return { live: false, reason: "missing_url" };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "User-Agent": UA, Accept: "text/html" },
      redirect: "follow",
      signal: ctrl.signal,
    });
    if (res.status === 404 || res.status === 410) return { live: false, reason: `http_${res.status}` };
    const text = (await res.text()).slice(0, 8000).toLowerCase();
    if (/(no longer available|job is closed|position has been filled|this job has expired)/.test(text)) {
      return { live: false, reason: "expired_copy" };
    }
    return { live: res.ok, reason: `http_${res.status}` };
  } catch (err) {
    return { live: false, reason: err.name === "AbortError" ? "timeout" : err.message };
  } finally {
    clearTimeout(timer);
  }
}

const UA = "fillow/0.1 (personal job search)";

export async function fetchJson(url, { params, timeoutMs = 20000 } = {}) {
  const target = new URL(url);
  if (params) {
    for (const [k, v] of Object.entries(params)) target.searchParams.set(k, String(v));
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(target, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: ctrl.signal,
      redirect: "follow",
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

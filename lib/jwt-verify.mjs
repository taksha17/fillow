/**
 * Supabase JWT (RS256) verification via JWKS — WebCrypto only, no dependencies.
 * Portable: runs in Cloudflare Workers and Node >= 18 (global crypto + atob).
 */

const JWKS_TTL_MS = 10 * 60 * 1000;
const jwksCache = new Map(); // supabaseUrl → { keys, fetchedAt }
const SUPPORTED_ALGS = new Set(["RS256", "ES256"]);

function b64uToBytes(input) {
  const b64 = String(input).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function decodeJwt(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || parts.some((p) => !p)) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(b64uToBytes(parts[0])));
    const payload = JSON.parse(new TextDecoder().decode(b64uToBytes(parts[1])));
    if (!header || typeof header !== "object" || !payload || typeof payload !== "object") return null;
    return { header, payload, signature: parts[2], signed: `${parts[0]}.${parts[1]}` };
  } catch {
    return null;
  }
}

function normalizedUrl(url) {
  return String(url || "").replace(/\/+$/, "");
}

export async function fetchJwks(supabaseUrl, { fetchImpl = fetch, now = Date.now() } = {}) {
  const key = normalizedUrl(supabaseUrl);
  const cached = jwksCache.get(key);
  if (cached && now - cached.fetchedAt < JWKS_TTL_MS) return cached.keys;
  const res = await fetchImpl(`${key}/auth/v1/.well-known/jwks.json`);
  if (!res.ok) throw new Error(`JWKS fetch failed: HTTP ${res.status}`);
  const data = await res.json();
  const keys = Array.isArray(data.keys) ? data.keys : [];
  if (!keys.length) throw new Error("JWKS response contains no keys");
  jwksCache.set(key, { keys, fetchedAt: now });
  return keys;
}

/** Test seam: drop cached JWKS. */
export function clearJwksCache() {
  jwksCache.clear();
}

/**
 * Verify a Supabase access token.
 * Checks: shape → alg (RS256 or ES256 — GoTrue's current default) → issuer →
 * audience → expiry → signature (JWKS).
 * Returns { ok: true, payload } or { ok: false, error }.
 */
export async function verifySupabaseJwt(token, { supabaseUrl, fetchImpl = fetch, now = Date.now() } = {}) {
  if (!token) return { ok: false, error: "missing token" };
  if (!supabaseUrl) return { ok: false, error: "SUPABASE_URL not configured" };
  const decoded = decodeJwt(token);
  if (!decoded) return { ok: false, error: "not a JWT" };
  const { header, payload, signature, signed } = decoded;
  if (!SUPPORTED_ALGS.has(header.alg)) return { ok: false, error: `unsupported alg: ${header.alg}` };
  const expectedIss = `${normalizedUrl(supabaseUrl)}/auth/v1`;
  if (payload.iss !== expectedIss) return { ok: false, error: "issuer mismatch" };
  const aud = payload.aud;
  const audOk = !aud
    || aud === "authenticated"
    || (Array.isArray(aud) && aud.includes("authenticated"));
  if (!audOk) return { ok: false, error: "audience mismatch" };
  if (!payload.sub) return { ok: false, error: "token has no subject" };
  const exp = Number(payload.exp || 0);
  if (!exp || exp * 1000 <= now) return { ok: false, error: "token expired" };

  let keys;
  try {
    keys = await fetchJwks(supabaseUrl, { fetchImpl, now });
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
  const jwk = keys.find((k) => k.kid && k.kid === header.kid) || (keys.length === 1 ? keys[0] : null);
  if (!jwk) return { ok: false, error: "no matching JWKS key" };
  let cryptoKey;
  try {
    if (header.alg === "ES256") {
      cryptoKey = await crypto.subtle.importKey(
        "jwk",
        jwk,
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["verify"]
      );
    } else {
      cryptoKey = await crypto.subtle.importKey(
        "jwk",
        jwk,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"]
      );
    }
  } catch {
    return { ok: false, error: "JWK import failed" };
  }
  let valid = false;
  try {
    valid = await crypto.subtle.verify(
      header.alg === "ES256" ? { name: "ECDSA", hash: "SHA-256" } : "RSASSA-PKCS1-v1_5",
      cryptoKey,
      b64uToBytes(signature),
      new TextEncoder().encode(signed)
    );
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, error: "bad signature" };
  return { ok: true, payload };
}

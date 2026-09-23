import { test } from "node:test";
import assert from "node:assert/strict";
import { verifySupabaseJwt, decodeJwt, clearJwksCache } from "../lib/jwt-verify.mjs";

const SUPABASE_URL = "https://test-project.supabase.co";

function b64u(bytes) {
  let bin = "";
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function makeKeys() {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ["sign", "verify"]
  );
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return { pair, jwk };
}

async function signJwt(pair, header, payload) {
  const h = b64u(new TextEncoder().encode(JSON.stringify(header)));
  const p = b64u(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    pair.privateKey,
    new TextEncoder().encode(`${h}.${p}`)
  );
  return `${h}.${p}.${b64u(sig)}`;
}

function jwksFetch(jwk) {
  return async () => new Response(JSON.stringify({ keys: [{ ...jwk, kid: "kid-1", use: "sig", kty: "RSA" }] }), { status: 200 });
}

const NOW = Date.parse("2026-09-23T20:00:00Z");
const CLAIMS = {
  iss: `${SUPABASE_URL}/auth/v1`,
  sub: "11111111-2222-3333-4444-555555555555",
  aud: "authenticated",
  email: "user@example.com",
  exp: Math.floor((NOW + 3600_000) / 1000),
};

test("jwt: verifies a properly signed Supabase token", async () => {
  clearJwksCache();
  const { pair, jwk } = await makeKeys();
  const token = await signJwt(pair, { alg: "RS256", typ: "JWT", kid: "kid-1" }, CLAIMS);
  const res = await verifySupabaseJwt(token, { supabaseUrl: SUPABASE_URL, fetchImpl: jwksFetch(jwk), now: NOW });
  assert.equal(res.ok, true);
  assert.equal(res.payload.sub, CLAIMS.sub);
  assert.equal(res.payload.email, "user@example.com");
});

test("jwt: rejects tampered payloads, bad issuers, wrong audience, expired tokens", async () => {
  clearJwksCache();
  const { pair, jwk } = await makeKeys();
  const fetchImpl = jwksFetch(jwk);
  const header = { alg: "RS256", typ: "JWT", kid: "kid-1" };

  const tampered = await signJwt(pair, header, { ...CLAIMS, email: "attacker@example.com" });
  const [h, , s] = tampered.split(".");
  const swapped = `${h}.${b64u(new TextEncoder().encode(JSON.stringify(CLAIMS)))}.${s}`;
  const tamperedRes = await verifySupabaseJwt(swapped, { supabaseUrl: SUPABASE_URL, fetchImpl, now: NOW });
  assert.equal(tamperedRes.ok, false);

  const wrongIss = await verifySupabaseJwt(
    await signJwt(pair, header, { ...CLAIMS, iss: "https://evil.example/auth/v1" }),
    { supabaseUrl: SUPABASE_URL, fetchImpl, now: NOW }
  );
  assert.equal(wrongIss.ok, false);

  const wrongAud = await verifySupabaseJwt(
    await signJwt(pair, header, { ...CLAIMS, aud: "someone-else" }),
    { supabaseUrl: SUPABASE_URL, fetchImpl, now: NOW }
  );
  assert.equal(wrongAud.ok, false);

  const expired = await verifySupabaseJwt(
    await signJwt(pair, header, { ...CLAIMS, exp: Math.floor((NOW - 1000) / 1000) }),
    { supabaseUrl: SUPABASE_URL, fetchImpl, now: NOW }
  );
  assert.equal(expired.ok, false);
});

test("jwt: rejects garbage and non-JWT tokens without touching JWKS", async () => {
  clearJwksCache();
  let fetched = 0;
  const fetchImpl = async () => {
    fetched += 1;
    return new Response("{}", { status: 200 });
  };
  assert.equal((await verifySupabaseJwt("legacy-sync-token", { supabaseUrl: SUPABASE_URL, fetchImpl, now: NOW })).ok, false);
  assert.equal((await verifySupabaseJwt("", { supabaseUrl: SUPABASE_URL, fetchImpl, now: NOW })).ok, false);
  assert.equal((await verifySupabaseJwt("a.b", { supabaseUrl: SUPABASE_URL, fetchImpl, now: NOW })).ok, false);
  assert.equal((await verifySupabaseJwt(null, { supabaseUrl: SUPABASE_URL, fetchImpl, now: NOW })).ok, false);
  assert.equal((await verifySupabaseJwt("token", { supabaseUrl: "", fetchImpl, now: NOW })).ok, false);
  assert.equal(fetched, 0);
});

async function makeEcKeys() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return { pair, jwk };
}

async function signEcJwt(pair, header, payload) {
  const h = b64u(new TextEncoder().encode(JSON.stringify(header)));
  const p = b64u(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64u(sig)}`;
}

test("jwt: verifies ES256 tokens (Supabase GoTrue's current default)", async () => {
  clearJwksCache();
  const { pair, jwk } = await makeEcKeys();
  const token = await signEcJwt(pair, { alg: "ES256", typ: "JWT", kid: "kid-ec" }, CLAIMS);
  const res = await verifySupabaseJwt(token, {
    supabaseUrl: SUPABASE_URL,
    fetchImpl: async () => new Response(JSON.stringify({ keys: [{ ...jwk, kid: "kid-ec", use: "sig" }] }), { status: 200 }),
    now: NOW,
  });
  assert.equal(res.ok, true);
  assert.equal(res.payload.sub, CLAIMS.sub);

  const tamperedRes = await verifySupabaseJwt(await signEcJwt(pair, { alg: "ES256", typ: "JWT", kid: "kid-ec" }, { ...CLAIMS, sub: "someone-else" })
    .then(async (t) => {
      const [h, , s] = t.split(".");
      return `${h}.${b64u(new TextEncoder().encode(JSON.stringify(CLAIMS)))}.${s}`;
    }), {
    supabaseUrl: SUPABASE_URL,
    fetchImpl: async () => new Response(JSON.stringify({ keys: [{ ...jwk, kid: "kid-ec", use: "sig" }] }), { status: 200 }),
    now: NOW,
  });
  assert.equal(tamperedRes.ok, false);
});

test("jwt: decodeJwt parses and rejects malformed input", () => {
  const header = b64u(new TextEncoder().encode(JSON.stringify({ alg: "RS256" })));
  const payload = b64u(new TextEncoder().encode(JSON.stringify({ sub: "u1" })));
  const decoded = decodeJwt(`${header}.${payload}.sig`);
  assert.equal(decoded.header.alg, "RS256");
  assert.equal(decoded.payload.sub, "u1");
  assert.equal(decodeJwt("not-a-jwt"), null);
  assert.equal(decodeJwt("a.b.c"), null);
});

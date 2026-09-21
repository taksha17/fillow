import test from "node:test";
import assert from "node:assert/strict";
import { decodeMime, extractOtp } from "../lib/gmail.mjs";

test("extractOtp reads Greenhouse paste-this-code line", () => {
  const body =
    "Copy and paste this code into the security code field on your application: ZDRmYDxD After you enter the code, resubmit your application.";
  assert.equal(extractOtp(body), "ZDRmYDxD");
});

test("extractOtp ignores Security from subject", () => {
  const text = "Security code for your application to Stripe\n\n";
  assert.equal(extractOtp(text), null);
});

test("decodeMime extracts Greenhouse quoted-printable HTML code", () => {
  const raw = `Content-Type: multipart/related; boundary="abc123"
Subject: Security code for your application to Stripe

--abc123
Content-Transfer-Encoding: quoted-printable
Content-Type: text/html; charset="utf-8"
<html><body>Copy and paste this code into the security code field on your application: ZDRmYDxD</body></html>
--abc123--
`;
  const decoded = decodeMime(raw);
  assert.match(decoded, /ZDRmYDxD/);
  assert.equal(extractOtp(`Security code for your application to Stripe\n${decoded}`), "ZDRmYDxD");
});

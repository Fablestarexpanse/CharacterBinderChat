// The local access rules. Each case is a way the open API was reachable: another
// device, a rebinding page, a cross-site form post. And the way back in that
// must keep working: the app itself, scripts with no Origin, and the password.

import { test } from "node:test";
import assert from "node:assert/strict";

const { checkAccess, hostnameOf, isLoopbackHost, basicPassword, safeEqual } =
  await import("../../lib/security/access.ts");

const req = (o = {}) => ({
  method: "GET", host: "localhost:3000", origin: null, secFetchSite: null, authorization: null, password: undefined, ...o,
});
const basic = (pw, user = "me") => `Basic ${Buffer.from(`${user}:${pw}`).toString("base64")}`;

test("hostnames are read with or without a port, and IPv6 brackets", () => {
  assert.equal(hostnameOf("localhost:3000"), "localhost");
  assert.equal(hostnameOf("127.0.0.1"), "127.0.0.1");
  assert.equal(hostnameOf("[::1]:3000"), "[::1]");
  assert.equal(hostnameOf("Example.COM:80"), "example.com");
});

test("only loopback hosts count as local", () => {
  for (const h of ["localhost", "localhost:3000", "127.0.0.1:3000", "[::1]:3000"]) assert.equal(isLoopbackHost(h), true, h);
  for (const h of ["192.168.1.20:3000", "evil.com", "localhost.evil.com", "127.0.0.1.evil.com", "", null]) {
    assert.equal(isLoopbackHost(h), false, String(h));
  }
});

test("no password: the app on localhost works, and reads and API calls pass", () => {
  assert.equal(checkAccess(req()).allow, true);
  assert.equal(checkAccess(req({ host: "127.0.0.1:3000", method: "POST" })).allow, true);
});

test("no password: any other Host is refused, which also stops DNS rebinding", () => {
  for (const host of ["192.168.1.20:3000", "attacker.example", "localhost.attacker.example"]) {
    const d = checkAccess(req({ host }));
    assert.equal(d.allow, false, host);
    assert.equal(d.status, 403);
    assert.match(d.message, /FABLE_PASSWORD/, "the refusal says how to fix it");
  }
});

test("a cross-origin write is refused even from a loopback page", () => {
  const d = checkAccess(req({ method: "PUT", origin: "https://evil.example" }));
  assert.equal(d.allow, false);
  assert.equal(d.status, 403);
});

test("a same-origin write passes, and so does one with no Origin (scripts, curl, tests)", () => {
  assert.equal(checkAccess(req({ method: "POST", origin: "http://localhost:3000" })).allow, true);
  assert.equal(checkAccess(req({ method: "POST", origin: null })).allow, true);
});

test("Origin: null and unparseable origins are refused", () => {
  assert.equal(checkAccess(req({ method: "POST", origin: "null" })).allow, false);
  assert.equal(checkAccess(req({ method: "POST", origin: "not a url" })).allow, false);
});

test("Sec-Fetch-Site: cross-site is refused for writes but a read is not blocked here", () => {
  assert.equal(checkAccess(req({ method: "DELETE", secFetchSite: "cross-site" })).allow, false);
  assert.equal(checkAccess(req({ method: "GET", secFetchSite: "cross-site" })).allow, true);
});

test("a same-port origin check does not accept a different port", () => {
  assert.equal(checkAccess(req({ method: "POST", origin: "http://localhost:4000" })).allow, false);
});

test("with a password, everything needs it, including from localhost", () => {
  const d = checkAccess(req({ password: "hunter2" }));
  assert.equal(d.allow, false);
  assert.equal(d.status, 401);
  assert.equal(d.challenge, true, "the browser is asked to prompt");
});

test("with a password: right one passes, any username, wrong one does not", () => {
  assert.equal(checkAccess(req({ password: "hunter2", authorization: basic("hunter2") })).allow, true);
  assert.equal(checkAccess(req({ password: "hunter2", authorization: basic("hunter2", "anyone") })).allow, true);
  assert.equal(checkAccess(req({ password: "hunter2", authorization: basic("hunter3") })).allow, false);
  assert.equal(checkAccess(req({ password: "hunter2", authorization: "Bearer hunter2" })).allow, false);
  assert.equal(checkAccess(req({ password: "hunter2", authorization: "Basic !!!notbase64" })).allow, false);
});

test("with a password, other devices are allowed in but cross-origin writes are still refused", () => {
  const ok = { password: "pw", authorization: basic("pw"), host: "192.168.1.20:3000" };
  assert.equal(checkAccess(req(ok)).allow, true);
  assert.equal(checkAccess(req({ ...ok, method: "POST", origin: "http://192.168.1.20:3000" })).allow, true);
  assert.equal(checkAccess(req({ ...ok, method: "POST", origin: "https://evil.example" })).allow, false);
});

test("a password containing a colon survives Basic parsing", () => {
  assert.equal(basicPassword(basic("a:b:c")), "a:b:c");
  assert.equal(basicPassword(null), null);
});

test("safeEqual compares whole strings, including different lengths", () => {
  assert.equal(safeEqual("abc", "abc"), true);
  assert.equal(safeEqual("abc", "abd"), false);
  assert.equal(safeEqual("abc", "abcd"), false);
  assert.equal(safeEqual("", ""), true);
});

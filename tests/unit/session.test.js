import { test } from "node:test";
import assert from "node:assert/strict";
import { signSession, verifySession, parseCookies } from "../../src/session.js";
import { resolveSessionSecret } from "../../src/config.js";

const secret = "x".repeat(40);

test("un token firmado se verifica y conserva sus datos", () => {
  const token = signSession({ id: 1, email: "a@b.co", exp: Date.now() + 1000 }, secret);
  const payload = verifySession(token, secret);
  assert.equal(payload.id, 1);
  assert.equal(payload.email, "a@b.co");
});
test("un token con otro secreto se rechaza", () => {
  const token = signSession({ id: 1, exp: Date.now() + 1000 }, secret);
  assert.equal(verifySession(token, "y".repeat(40)), null);
});
test("un token manipulado se rechaza", () => {
  const token = signSession({ id: 1, role: "lab", exp: Date.now() + 1000 }, secret);
  const [body, sig] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ id: 1, role: "admin", exp: Date.now() + 1000 })).toString("base64url");
  assert.equal(verifySession(`${forged}.${sig}`, secret), null);
  assert.equal(verifySession(`${body}.`, secret), null);
  assert.equal(verifySession("basura", secret), null);
  assert.equal(verifySession(undefined, secret), null);
});
test("un token vencido se rechaza", () => {
  const token = signSession({ id: 1, exp: Date.now() - 1 }, secret);
  assert.equal(verifySession(token, secret), null);
});
test("el mismo token es válido en otra 'instancia' que comparta el secreto", () => {
  const token = signSession({ id: 7, exp: Date.now() + 5000 }, secret);
  assert.equal(verifySession(token, secret).id, 7);
});
test("parseCookies lee varias cookies", () => {
  const c = parseCookies("a=1; biotest.sid=abc.def; b=%20x");
  assert.equal(c["biotest.sid"], "abc.def");
  assert.equal(c.a, "1");
  assert.equal(c.b, " x");
  assert.deepEqual(parseCookies(undefined), {});
});

test("SESSION_SECRET válido se usa tal cual", () => {
  const r = resolveSessionSecret({ env: { SESSION_SECRET: "k".repeat(40) } });
  assert.equal(r.source, "env");
  assert.equal(r.strong, true);
});
test("el valor de ejemplo del .env.example no se acepta como secreto", () => {
  const r = resolveSessionSecret({ env: { SESSION_SECRET: "replace-with-a-random-secret-at-least-32-characters-long", VERCEL: "1", VERCEL_PROJECT_ID: "prj_1" } });
  assert.notEqual(r.source, "env");
});
test("en Vercel sin variables el secreto es el mismo en todas las instancias del mismo despliegue", () => {
  const env = { VERCEL: "1", VERCEL_PROJECT_ID: "prj_1", VERCEL_DEPLOYMENT_ID: "dpl_1" };
  const a = resolveSessionSecret({ env });
  const b = resolveSessionSecret({ env: { ...env } });
  assert.equal(a.source, "vercel-derived");
  assert.equal(a.secret, b.secret);
  assert.equal(a.strong, false);
  const other = resolveSessionSecret({ env: { ...env, VERCEL_DEPLOYMENT_ID: "dpl_2" } });
  assert.notEqual(a.secret, other.secret);
});
test("con PostgreSQL y sin SESSION_SECRET se informa el error en lugar de lanzar una excepción", () => {
  const r = resolveSessionSecret({ env: {}, requireStrong: true });
  assert.equal(r.secret, null);
  assert.match(r.error, /SESSION_SECRET/);
});
test("sin ninguna configuración se obtiene un secreto aleatorio y no se lanza excepción", () => {
  const r = resolveSessionSecret({ env: {} });
  assert.ok(r.secret.length >= 32);
});

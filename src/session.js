// Sesiones sin estado: la cookie contiene un token firmado con HMAC-SHA256.
// No necesitan almacenamiento en el servidor, por lo que sobreviven a reinicios
// y al cambio de instancia de las funciones de Vercel (mientras el secreto sea el mismo).
import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "biotest.sid";

const sign = (body, secret) => createHmac("sha256", secret).update(body).digest("base64url");

export function signSession(payload, secret) {
  if (!secret) throw new Error("Falta el secreto de sesión.");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

export function verifySession(token, secret, now = Date.now()) {
  if (!secret || typeof token !== "string" || token.length < 3 || token.length > 2048) return null;
  const dot = token.indexOf(".");
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  const signature = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(sign(body, secret));
  if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch { return null; }
  if (!payload || typeof payload !== "object" || typeof payload.exp !== "number" || payload.exp <= now) return null;
  return payload;
}

export function parseCookies(header = "") {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i < 1) continue;
    const key = part.slice(0, i).trim();
    let value = part.slice(i + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    try { out[key] = decodeURIComponent(value); } catch { out[key] = value; }
  }
  return out;
}

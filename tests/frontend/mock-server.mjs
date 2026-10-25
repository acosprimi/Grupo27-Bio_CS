// Servidor SIMULADO (sin dependencias) para probar la interfaz real en un navegador.
// Reutiliza src/session.js (cookies firmadas) y reproduce el contrato de la API de BioTest.
// No sustituye las pruebas contra el backend real (tests/biotest.spec.js).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { signSession, verifySession, parseCookies, SESSION_COOKIE } from "../../src/session.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../public");
const SECRET = "mock-secret-for-tests-only-0123456789abcdef";
const admin = { id: 1, full_name: "Administrador BioTest", email: "admin@biotest.local", role: "admin" };
const seed = () => ([
  { id: 1, documentType: "CC", documentNumber: "1000000001", firstName: "Ana María", lastName: "Demostración Uno", email: "ana.demo@example.com", phone: "3000000001", birthDate: "1990-05-12", sex: "Femenino", address: "Calle 1", createdAt: new Date().toISOString() },
  { id: 2, documentType: "CC", documentNumber: "1000000002", firstName: "Carlos", lastName: "Demostración Dos", email: "carlos.demo@example.com", phone: "3000000002", birthDate: "1985-11-03", sex: "Masculino", address: "", createdAt: new Date().toISOString() }
]);
let patients = seed(), nextId = 3, revoked = false, log = [];

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers });
  res.end(body === null ? "" : JSON.stringify(body));
};
const err = (res, status, error, code, details) => send(res, status, { error, ...(code ? { code } : {}), ...(details ? { details } : {}) });
const cookie = token => `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=28800`;
const issue = res => ({ "Set-Cookie": cookie(signSession({ id: 1, email: admin.email, exp: Date.now() + 8 * 3600e3 }, SECRET)) });
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" };

function validatePatient(b) {
  const d = [];
  if (!b.firstName || b.firstName.trim().length < 2) d.push({ field: "firstName", message: "Debe tener al menos 2 caracteres." });
  if (!/^\S+@\S+\.\S+$/.test(b.email || "")) d.push({ field: "email", message: "Escribe un correo electrónico válido." });
  if (!b.documentNumber || b.documentNumber.length < 4) d.push({ field: "documentNumber", message: "Debe tener al menos 4 caracteres." });
  if (!b.lastName || b.lastName.trim().length < 2) d.push({ field: "lastName", message: "Debe tener al menos 2 caracteres." });
  return d;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  let body = {};
  if (["POST", "PATCH", "PUT"].includes(req.method)) {
    const chunks = []; for await (const c of req) chunks.push(c);
    try { body = JSON.parse(Buffer.concat(chunks).toString() || "{}"); } catch { return err(res, 400, "El cuerpo de la solicitud no es un JSON válido."); }
  }
  if (p.startsWith("/__test/")) {
    if (p === "/__test/reset") { patients = seed(); nextId = 3; revoked = false; log = []; }
    if (p === "/__test/revoke") revoked = true;
    if (p === "/__test/forget-patient") patients = patients.filter(x => String(x.id) !== url.searchParams.get("id"));
    if (p === "/__test/log") return send(res, 200, { log });
    return send(res, 200, { ok: true });
  }
  if (!p.startsWith("/api/")) {
    const file = p === "/" ? "index.html" : p.slice(1);
    const full = path.join(root, file);
    if (full.startsWith(root) && fs.existsSync(full) && fs.statSync(full).isFile()) {
      res.writeHead(200, { "Content-Type": mime[path.extname(full)] || "application/octet-stream" });
      return fs.createReadStream(full).pipe(res);
    }
    res.writeHead(200, { "Content-Type": mime[".html"] });
    return fs.createReadStream(path.join(root, "index.html")).pipe(res);
  }
  log.push(`${req.method} ${p}`);

  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  const claims = token ? verifySession(token, SECRET) : null;
  const authed = Boolean(claims) && !revoked;
  const unauth = () => err(res, 401, token ? "Tu sesión ya no es válida: el servidor de demostración se reinició o la cuenta cambió. Inicia sesión de nuevo." : "Debes iniciar sesión.", token ? "SESSION_RESET" : "LOGIN_REQUIRED");
  const user = { id: 1, fullName: admin.full_name, email: admin.email, role: "admin" };

  if (p === "/api/health") return send(res, 200, { status: "ok", database: "demo-memory-temporal", demo: true, ephemeral: true, session: "vercel-derived" });
  if (p === "/api/auth/local-access" && req.method === "GET") return send(res, 200, { available: true, mode: "demo-memory-temporal", ephemeral: true, email: admin.email });
  if (p === "/api/auth/local-access" && req.method === "POST") { revoked = false; return send(res, 200, { user }, issue(res)); }
  if (p === "/api/auth/login") {
    if (body.password === "BioTest-Local-2026!" && body.email === admin.email) { revoked = false; return send(res, 200, { user }, issue(res)); }
    return err(res, 401, "Credenciales incorrectas.", "BAD_CREDENTIALS");
  }
  if (p === "/api/auth/logout") return send(res, 204, null, { "Set-Cookie": `${SESSION_COOKIE}=; Path=/; Max-Age=0` });
  if (p === "/api/auth/me") return send(res, 200, authed ? { user, reason: null } : { user: null, reason: token ? "reset" : null });
  if (!authed) return unauth();
  const h = issue(res);

  if (p === "/api/dashboard") return send(res, 200, { patients: patients.length, todayAppointments: 0, samples: 0, pendingSamples: 0, todayOrders: 0, pendingResults: 0, publishedResults: 0, recentAppointments: [], recentSamples: [] }, h);
  if (p === "/api/notifications") return send(res, 200, { pendingSamples: 0, pendingResults: 0, todayAppointments: 0 }, h);
  if (p === "/api/patients" && req.method === "GET") {
    const q = (url.searchParams.get("search") || "").toLowerCase();
    return send(res, 200, { patients: patients.filter(x => !q || `${x.firstName} ${x.lastName} ${x.documentNumber} ${x.email}`.toLowerCase().includes(q)) }, h);
  }
  if (p === "/api/patients" && req.method === "POST") {
    const d = validatePatient(body);
    if (d.length) return err(res, 400, "Revisa los campos del paciente.", undefined, d);
    if (patients.some(x => x.documentNumber === body.documentNumber.toUpperCase())) return err(res, 409, "Ya existe un paciente con ese tipo y número de documento.");
    const created = { id: nextId++, ...body, documentNumber: body.documentNumber.toUpperCase(), createdAt: new Date().toISOString() };
    patients.unshift(created);
    return send(res, 201, { patient: created }, h);
  }
  const m = p.match(/^\/api\/patients\/(\d+)$/);
  if (m) {
    const found = patients.find(x => String(x.id) === m[1]);
    if (!found) return err(res, 404, "No se encontró el paciente.");
    if (req.method === "GET") return send(res, 200, { patient: found, history: { appointments: [], orders: [], samples: [], publishedResults: 0 } }, h);
    if (req.method === "PATCH") {
      const d = validatePatient(body);
      if (d.length) return err(res, 400, "Revisa los campos del paciente.", undefined, d);
      Object.assign(found, body, { documentNumber: body.documentNumber.toUpperCase() });
      return send(res, 200, { patient: found }, h);
    }
  }
  const empty = {
    "/api/appointments": { appointments: [] }, "/api/professionals": { professionals: [] }, "/api/exams": { exams: [], categories: [] },
    "/api/orders": { orders: [] }, "/api/samples": { samples: [] }, "/api/results": { results: [] }, "/api/documents": { documents: [] },
    "/api/invoices": { invoices: [] }, "/api/users": { users: [{ id: 1, fullName: admin.full_name, email: admin.email, role: "admin", active: true, createdAt: new Date().toISOString() }] },
    "/api/audit": { entries: [] },
    "/api/reports/summary": { from: "2026-10-01", to: "2026-10-25", patients: patients.length, appointments: 0, samples: 0, orders: 0, sampleStatuses: [], resultStatuses: [], invoices: { count: 0, total: 0 }, topExams: [], averageProcessingMinutes: null }
  };
  if (empty[p]) return send(res, 200, empty[p], h);
  return err(res, 404, "La ruta de la API solicitada no existe.", "ROUTE_NOT_FOUND");
});
const port = Number(process.env.MOCK_PORT || 3100);
server.listen(port, "127.0.0.1", () => console.log(`mock en http://127.0.0.1:${port}`));

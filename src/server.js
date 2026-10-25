import "dotenv/config";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import { z } from "zod";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { pool, query, audit, transaction, ensureReady, persistenceMode, localDataDir, seedAdminEmail } from "./db.js";
import { resolveSessionSecret } from "./config.js";
import { SESSION_COOKIE, signSession, verifySession, parseCookies } from "./session.js";

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
const production = process.env.NODE_ENV === "production";
const onVercel = Boolean(process.env.VERCEL);
const usingPostgres = persistenceMode === "postgresql";
const SESSION_TTL_MS = 1000 * 60 * 60 * 8;

// El secreto de sesión NUNCA debe tumbar el proceso. Si falta en un despliegue real (PostgreSQL),
// las rutas de la API responden 503 con una explicación y /api/health la muestra.
const sessionConfig = resolveSessionSecret({ dataDir: localDataDir, requireStrong: usingPostgres });
const sessionSecret = sessionConfig.secret;
if (sessionConfig.error) console.error(`BioTest: ${sessionConfig.error}`);
else if (!sessionConfig.strong) console.warn(`BioTest: modo demostración (secreto de sesión: ${sessionConfig.source}). No usar con datos reales.`);
if (onVercel && !usingPostgres) {
  console.warn("BioTest en Vercel: base de datos temporal de demostración; los datos pueden reiniciarse y no se comparten entre instancias.");
}

// Mensajes de validación en español.
z.setErrorMap((issue, ctx) => {
  switch (issue.code) {
    case "invalid_type": return { message: issue.received === "undefined" ? "Este campo es obligatorio." : "El valor tiene un formato no válido." };
    case "invalid_string":
      if (issue.validation === "email") return { message: "Escribe un correo electrónico válido." };
      return { message: "El formato del valor no es válido." };
    case "too_small":
      if (issue.type === "string") return { message: `Debe tener al menos ${issue.minimum} caracteres.` };
      if (issue.type === "array") return { message: `Selecciona al menos ${issue.minimum} elemento(s).` };
      return { message: `El valor debe ser como mínimo ${issue.minimum}.` };
    case "too_big":
      if (issue.type === "string") return { message: `Debe tener como máximo ${issue.maximum} caracteres.` };
      if (issue.type === "array") return { message: `Selecciona como máximo ${issue.maximum} elemento(s).` };
      return { message: `El valor debe ser como máximo ${issue.maximum}.` };
    case "invalid_enum_value": return { message: "Selecciona una opción válida." };
    default: return { message: ctx.defaultError };
  }
});

app.disable("x-powered-by");
app.set("trust proxy", 1);
const cspDirectives = {
  defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
  imgSrc: ["'self'", "data:"], connectSrc: ["'self'"], objectSrc: ["'none'"],
  baseUri: ["'self'"], frameAncestors: ["'none'"]
};
// En http://localhost no debe forzarse https (rompería la carga en algunos navegadores).
if (!production && !onVercel) cspDirectives.upgradeInsecureRequests = null;
app.use(helmet({ contentSecurityPolicy: { directives: cspDirectives } }));
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false, limit: "100kb" }));

// Los archivos estáticos se sirven primero: la interfaz carga aunque la base de datos falle.
app.use(express.static(path.join(__dirname, "../public"), { index: "index.html", maxAge: production ? "1h" : 0 }));

// Protección básica contra solicitudes de otro origen.
app.use((req, res, next) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method) && req.path.startsWith("/api/")) {
    const origin = req.get("origin");
    if (origin) {
      try {
        if (new URL(origin).host !== req.get("host")) return res.status(403).json({ error: "Origen de solicitud no permitido." });
      } catch { return res.status(403).json({ error: "Origen de solicitud no válido." }); }
    }
  }
  next();
});
app.use("/api", (_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });

// ---- Sesión sin estado (cookie firmada) --------------------------------------------------
const cookieSecure = req => {
  if (process.env.COOKIE_SECURE === "true") return true;
  if (process.env.COOKIE_SECURE === "false") return false;
  return onVercel || req.secure;
};
const cookieOptions = req => ({ httpOnly: true, sameSite: "lax", secure: cookieSecure(req), path: "/" });
function issueSession(req, res, user) {
  const token = signSession({ id: Number(user.id), email: user.email, exp: Date.now() + SESSION_TTL_MS }, sessionSecret);
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions(req), maxAge: SESSION_TTL_MS });
}
function clearSession(req, res) { res.clearCookie(SESSION_COOKIE, cookieOptions(req)); }
app.use((req, _res, next) => {
  const token = sessionSecret ? parseCookies(req.headers.cookie)[SESSION_COOKIE] : undefined;
  req.session = { user: null, claims: token ? verifySession(token, sessionSecret) : null, problem: token ? "expired" : null };
  next();
});

const message = (res, status, error, details, code) => res.status(status).json({ error, ...(code ? { code } : {}), ...(details ? { details } : {}) });
const userView = u => ({ id: u.id, fullName: u.full_name, email: u.email, role: u.role });
const handle = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const demoMode = !usingPostgres;
const baseStatus = () => ({ database: persistenceMode, demo: demoMode, ephemeral: persistenceMode === "demo-memory-temporal", session: sessionConfig.source });

app.get("/api/health", async (_req, res) => {
  if (sessionConfig.error) return res.status(503).json({ status: "error", ...baseStatus(), error: sessionConfig.error });
  try {
    await ensureReady();
    await query("SELECT 1");
    res.json({ status: "ok", ...baseStatus() });
  } catch (error) {
    console.error("Health: la base de datos no está disponible:", error);
    res.status(503).json({ status: "error", ...baseStatus(), error: "La base de datos no pudo iniciarse. Se reintentará en la siguiente solicitud." });
  }
});

// Puerta común de la API: configuración válida + base de datos lista.
app.use("/api", handle(async (_req, res, next) => {
  if (sessionConfig.error) return message(res, 503, sessionConfig.error, undefined, "CONFIG_ERROR");
  try { await ensureReady(); } catch (error) {
    console.error("La base de datos no pudo iniciarse:", error);
    return message(res, 503, "La base de datos no pudo iniciarse. Espera unos segundos y vuelve a intentarlo.", undefined, "DB_UNAVAILABLE");
  }
  next();
}));

// Valida la sesión contra la base (cuenta existente y activa) y renueva la cookie (sesión deslizante).
app.use("/api", handle(async (req, res, next) => {
  const claims = req.session.claims;
  if (!claims || req.path === "/auth/login") return next();
  const result = await query("SELECT id,full_name,email,role,active FROM users WHERE id=$1", [Number(claims.id)]);
  const user = result.rows[0];
  if (!user || String(user.email).toLowerCase() !== String(claims.email).toLowerCase()) {
    req.session.problem = "reset";
    clearSession(req, res);
    return next();
  }
  if (!user.active) {
    req.session.problem = "inactive";
    clearSession(req, res);
    return next();
  }
  req.session.user = userView(user);
  req.session.problem = null;
  if (req.path !== "/auth/logout") issueSession(req, res, user);
  next();
}));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, skipSuccessfulRequests: true, skip: req => req.method !== "POST", message: { error: "Demasiados intentos de acceso. Espera unos minutos." } });
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/local-access", authLimiter);

const roleNames = { admin: "Administrador", reception: "Recepción", lab: "Laboratorista", health: "Profesional de salud" };
const validId = v => Number.isSafeInteger(Number(v)) && Number(v) > 0;
const today = () => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};
const isValidDate = value => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year && candidate.getUTCMonth() === month - 1 && candidate.getUTCDate() === day;
};
const makeCode = prefix => `${prefix}-${today().replaceAll("-", "")}-${randomUUID().slice(0, 6).toUpperCase()}`;

function authFailure(req, res) {
  const problem = req.session.problem;
  if (problem === "reset") return message(res, 401, "Tu sesión ya no es válida: el servidor de demostración se reinició o la cuenta cambió. Inicia sesión de nuevo.", undefined, "SESSION_RESET");
  if (problem === "inactive") return message(res, 401, "La cuenta no está activa. Inicia sesión con una cuenta autorizada.", undefined, "ACCOUNT_INACTIVE");
  if (problem === "expired") return message(res, 401, "Tu sesión expiró. Inicia sesión de nuevo.", undefined, "SESSION_EXPIRED");
  return message(res, 401, "Debes iniciar sesión.", undefined, "LOGIN_REQUIRED");
}
function requireAuth(req, res, next) {
  if (!req.session.user) return authFailure(req, res);
  next();
}
function requireRole(...allowed) {
  return (req, res, next) => {
    if (!req.session.user) return authFailure(req, res);
    if (!allowed.includes(req.session.user.role)) {
      audit({ actorId: req.session.user.id, action: "ACCESS_DENIED", entityType: "route", details: { method: req.method, path: req.path, role: req.session.user.role }, ip: req.ip }).catch(() => {});
      return message(res, 403, "No tienes permisos para esta operación.");
    }
    next();
  };
}
async function canAccessClinicalOrder(user, orderId) {
  if (user.role !== "health") return true;
  const scoped = await query(`SELECT 1 FROM lab_orders o WHERE o.id=$1 AND (o.ordered_by=$2 OR EXISTS (SELECT 1 FROM appointments ap WHERE ap.patient_id=o.patient_id AND ap.professional_id=$2))`, [Number(orderId), user.id]);
  return scoped.rows.length > 0;
}
const emailSchema = z.string().trim().email().max(254).transform(v => v.toLowerCase());
const patientSchema = z.object({
  documentType: z.enum(["CC", "TI", "CE", "PA", "NIT"]),
  documentNumber: z.string().trim().min(4).max(40).regex(/^[A-Za-z0-9.-]+$/),
  firstName: z.string().trim().min(2).max(80),
  lastName: z.string().trim().min(2).max(100),
  email: emailSchema,
  phone: z.string().trim().max(40).optional().default(""),
  birthDate: z.string().optional().default(""),
  sex: z.enum(["Femenino", "Masculino", "Intersexual", "No especifica"]).optional().default("No especifica"),
  address: z.string().trim().max(240).optional().default("")
});
const appointmentSchema = z.object({
  patientId: z.coerce.number().int().positive(), service: z.string().trim().min(2).max(120),
  appointmentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), appointmentTime: z.string().regex(/^\d{2}:\d{2}$/),
  professionalId: z.union([z.coerce.number().int().positive(), z.literal("")]).optional().default(""),
  notes: z.string().trim().max(500).optional().default("")
});
const appointmentStatusSchema = z.object({ status: z.enum(["Programada", "Confirmada", "Atendida", "Cancelada", "No asistió"]) });
const userSchema = z.object({ fullName: z.string().trim().min(3).max(140), email: emailSchema, password: z.string().min(12).max(128), role: z.enum(["admin", "reception", "lab", "health"]) });
const examSchema = z.object({
  code: z.string().trim().min(3).max(20).regex(/^[A-Za-z0-9-]+$/), name: z.string().trim().min(3).max(140),
  category: z.string().trim().min(2).max(80), sampleType: z.string().trim().min(2).max(100),
  preparation: z.string().trim().max(1000).optional().default(""), turnaroundMinutes: z.coerce.number().int().min(1).max(100800),
  price: z.coerce.number().min(0).max(100000000).default(0), unit: z.string().trim().max(50).optional().default(""),
  referenceRange: z.string().trim().max(120).optional().default("")
});
const orderSchema = z.object({ patientId: z.coerce.number().int().positive(), examIds: z.array(z.coerce.number().int().positive()).min(1).max(30), reason: z.string().trim().max(300).optional().default("") });
const sampleStatusSchema = z.object({ status: z.enum(["Pendiente de toma", "Recolectada", "Recibida", "En procesamiento", "Procesada", "Rechazada", "Cancelada", "Finalizada"]), reason: z.string().trim().max(500).optional().default("") });
const resultSchema = z.object({ resultValue: z.string().trim().min(1).max(180) });
const reviewSchema = z.object({ status: z.enum(["Validado", "Publicado"]), reason: z.string().trim().max(500).optional().default("") });
const correctionSchema = z.object({ resultValue: z.string().trim().min(1).max(180), reason: z.string().trim().min(8).max(500) });
const documentSchema = z.object({ title: z.string().trim().min(3).max(180), documentType: z.string().trim().min(2).max(60), description: z.string().trim().max(500).optional().default(""), patientId: z.union([z.coerce.number().int().positive(), z.literal("")]).optional().default(""), orderId: z.union([z.coerce.number().int().positive(), z.literal("")]).optional().default("") });
const invoiceStatusSchema = z.object({ status: z.enum(["Pagado", "Anulado", "Parcial", "Pendiente"]), amountPaid: z.coerce.number().min(0).max(1000000000).optional() });

app.post("/api/auth/login", handle(async (req, res) => {
  const parsed = z.object({ email: emailSchema, password: z.string().min(1).max(128) }).safeParse(req.body);
  if (!parsed.success) return message(res, 400, "Ingresa correo y contraseña.");
  const result = await query("SELECT * FROM users WHERE email=$1 AND active=TRUE", [parsed.data.email]);
  const user = result.rows[0];
  if (!user || !(await bcrypt.compare(parsed.data.password, user.password_hash))) {
    await audit({ action: "LOGIN_FAILED", entityType: "session", details: { email: parsed.data.email }, ip: req.ip });
    return message(res, 401, "Credenciales incorrectas.", undefined, "BAD_CREDENTIALS");
  }
  issueSession(req, res, user);
  await audit({ actorId: user.id, action: "LOGIN_SUCCESS", entityType: "session", ip: req.ip });
  res.json({ user: userView(user) });
}));
app.post("/api/auth/logout", handle(async (req, res) => {
  if (req.session.user) await audit({ actorId: req.session.user.id, action: "LOGOUT", entityType: "session", ip: req.ip });
  clearSession(req, res);
  res.status(204).end();
}));
app.get("/api/auth/me", (req, res) => res.json({ user: req.session.user || null, reason: req.session.user ? null : req.session.problem }));

// Acceso de demostración. Solo existe en modo demostración (sin PostgreSQL): en Vercel sin base externa,
// o desde localhost en local. Con DATABASE_URL (despliegue real) responde available:false y no inicia sesión.
// BIOTEST_DEMO_ACCESS=false lo desactiva siempre. NO es un mecanismo de seguridad: usar solo con datos ficticios.
const loopbackAddresses = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const demoAccessAllowed = req => demoMode && process.env.BIOTEST_DEMO_ACCESS !== "false" && (onVercel || loopbackAddresses.has(req.socket.remoteAddress));
app.get("/api/auth/local-access", (req, res) => {
  const available = demoAccessAllowed(req);
  res.set("Cache-Control", "no-store");
  res.json({
    available,
    mode: persistenceMode,
    ephemeral: persistenceMode === "demo-memory-temporal",
    ...(available ? { email: seedAdminEmail } : {})
  });
});
app.post("/api/auth/local-access", handle(async (req, res) => {
  if (!demoAccessAllowed(req)) return message(res, 404, "El acceso de demostración no está disponible en este entorno.", undefined, "DEMO_DISABLED");
  const result = await query("SELECT * FROM users WHERE email=$1 AND active=TRUE AND role='admin'", [seedAdminEmail]);
  const user = result.rows[0];
  if (!user) return message(res, 404, "No se encontró la cuenta administradora de demostración.", undefined, "DEMO_ADMIN_MISSING");
  issueSession(req, res, user);
  await audit({ actorId: user.id, action: "LOGIN_DEMO_ACCESS", entityType: "session", ip: req.ip });
  res.json({ user: userView(user) });
}));

app.get("/api/dashboard", requireAuth, handle(async (req, res) => {
  const [patients, appointments, samples, pendingSamples, orders, pendingResults, publishedResults] = await Promise.all([
    query("SELECT COUNT(*)::int AS count FROM patients"),
    query("SELECT COUNT(*)::int AS count FROM appointments WHERE appointment_date=$1::date AND status NOT IN ('Cancelada','No asistió')", [today()]),
    query("SELECT COUNT(*)::int AS count FROM samples"),
    query("SELECT COUNT(*)::int AS count FROM samples WHERE status IN ('Pendiente de toma','Recolectada','Recibida','En procesamiento')"),
    query("SELECT COUNT(*)::int AS count FROM lab_orders WHERE ((created_at AT TIME ZONE 'UTC') - interval '5 hours')::date=$1::date", [today()]),
    query("SELECT COUNT(*)::int AS count FROM order_items WHERE status IN ('Pendiente','En revisión')"),
    query("SELECT COUNT(*)::int AS count FROM order_items WHERE status='Publicado'")
  ]);
  const [recentAppointments, recentSamples] = await Promise.all([
    query(`SELECT a.id,p.first_name||' '||p.last_name AS "patientName",a.service,to_char(a.appointment_date,'YYYY-MM-DD') AS "appointmentDate",to_char(a.appointment_time,'HH24:MI') AS "appointmentTime",a.status FROM appointments a JOIN patients p ON p.id=a.patient_id WHERE ($1=TRUE OR a.professional_id=$2) ORDER BY a.appointment_date DESC,a.appointment_time DESC LIMIT 5`, [["admin", "reception"].includes(req.session.user.role), req.session.user.id]),
    query(`SELECT s.id,s.sample_code AS "sampleCode",p.first_name||' '||p.last_name AS "patientName",s.sample_type AS "sampleType",s.status,s.updated_at AS "updatedAt" FROM samples s JOIN patients p ON p.id=s.patient_id WHERE ($1=TRUE OR EXISTS (SELECT 1 FROM lab_orders lo WHERE lo.id=s.order_id AND lo.ordered_by=$2) OR EXISTS (SELECT 1 FROM appointments ap WHERE ap.patient_id=s.patient_id AND ap.professional_id=$2)) ORDER BY s.updated_at DESC LIMIT 5`, [["admin", "reception", "lab"].includes(req.session.user.role), req.session.user.id])
  ]);
  res.json({ patients: patients.rows[0].count, todayAppointments: appointments.rows[0].count, samples: samples.rows[0].count, pendingSamples: pendingSamples.rows[0].count, todayOrders: orders.rows[0].count, pendingResults: pendingResults.rows[0].count, publishedResults: publishedResults.rows[0].count, recentAppointments: recentAppointments.rows, recentSamples: recentSamples.rows });
}));

app.get("/api/notifications", requireAuth, handle(async (_req, res) => {
  const [samples, results, appointments] = await Promise.all([
    query("SELECT COUNT(*)::int AS count FROM samples WHERE status IN ('Pendiente de toma','Recolectada','Recibida','En procesamiento')"),
    query("SELECT COUNT(*)::int AS count FROM order_items WHERE status IN ('Pendiente','En revisión')"),
    query("SELECT COUNT(*)::int AS count FROM appointments WHERE appointment_date=$1::date AND status='Programada'", [today()])
  ]);
  res.json({ pendingSamples: samples.rows[0].count, pendingResults: results.rows[0].count, todayAppointments: appointments.rows[0].count });
}));

const patientSelect = `id,document_type AS "documentType",document_number AS "documentNumber",first_name AS "firstName",last_name AS "lastName",email,phone,to_char(birth_date,'YYYY-MM-DD') AS "birthDate",sex,address,created_at AS "createdAt"`;
app.get("/api/patients", requireRole("admin", "reception", "health"), handle(async (req, res) => {
  const search = String(req.query.search || "").trim().slice(0, 100);
  const restricted = req.session.user.role === "health";
  const result = await query(`SELECT ${patientSelect} FROM patients WHERE ($1='' OR first_name ILIKE $2 OR last_name ILIKE $2 OR document_number ILIKE $2 OR email ILIKE $2) AND ($3=FALSE OR EXISTS (SELECT 1 FROM appointments ap WHERE ap.patient_id=patients.id AND ap.professional_id=$4) OR EXISTS (SELECT 1 FROM lab_orders lo WHERE lo.patient_id=patients.id AND lo.ordered_by=$4)) ORDER BY created_at DESC LIMIT 500`, [search, `%${search}%`, restricted, req.session.user.id]);
  res.json({ patients: result.rows });
}));
app.get("/api/patients/:id", requireRole("admin", "reception", "health"), handle(async (req, res) => {
  if (!validId(req.params.id)) return message(res, 400, "Identificador no válido.");
  const id = Number(req.params.id);
  const restricted = req.session.user.role === "health";
  const patient = await query(`SELECT ${patientSelect} FROM patients WHERE id=$1 AND ($2=FALSE OR EXISTS (SELECT 1 FROM appointments ap WHERE ap.patient_id=patients.id AND ap.professional_id=$3) OR EXISTS (SELECT 1 FROM lab_orders lo WHERE lo.patient_id=patients.id AND lo.ordered_by=$3))`, [id, restricted, req.session.user.id]);
  if (!patient.rows.length) return message(res, 404, "No se encontró el paciente.");
  const [appointments, orders, samples, results] = await Promise.all([
    query(`SELECT id,service,to_char(appointment_date,'YYYY-MM-DD') AS "appointmentDate",to_char(appointment_time,'HH24:MI') AS "appointmentTime",status FROM appointments WHERE patient_id=$1 AND ($2=FALSE OR professional_id=$3) ORDER BY appointment_date DESC LIMIT 10`, [id, restricted, req.session.user.id]),
    query(`SELECT id,order_number AS "orderNumber",status,created_at AS "createdAt" FROM lab_orders WHERE patient_id=$1 AND ($2=FALSE OR ordered_by=$3 OR EXISTS (SELECT 1 FROM appointments ap WHERE ap.patient_id=lab_orders.patient_id AND ap.professional_id=$3)) ORDER BY created_at DESC LIMIT 10`, [id, restricted, req.session.user.id]),
    query(`SELECT s.id,s.sample_code AS "sampleCode",s.sample_type AS "sampleType",s.status,s.created_at AS "createdAt" FROM samples s WHERE s.patient_id=$1 AND ($2=FALSE OR EXISTS (SELECT 1 FROM lab_orders lo WHERE lo.id=s.order_id AND (lo.ordered_by=$3 OR EXISTS (SELECT 1 FROM appointments ap WHERE ap.patient_id=lo.patient_id AND ap.professional_id=$3)))) ORDER BY s.created_at DESC LIMIT 10`, [id, restricted, req.session.user.id]),
    query(`SELECT COUNT(*)::int AS count FROM order_items oi JOIN lab_orders o ON o.id=oi.order_id WHERE o.patient_id=$1 AND oi.status='Publicado' AND ($2=FALSE OR o.ordered_by=$3 OR EXISTS (SELECT 1 FROM appointments ap WHERE ap.patient_id=o.patient_id AND ap.professional_id=$3))`, [id, restricted, req.session.user.id])
  ]);
  res.json({ patient: patient.rows[0], history: { appointments: appointments.rows, orders: orders.rows, samples: samples.rows, publishedResults: results.rows[0].count } });
}));
app.post("/api/patients", requireRole("admin", "reception"), handle(async (req, res) => {
  const parsed = patientSchema.safeParse(req.body);
  if (!parsed.success) return message(res, 400, "Revisa los campos del paciente.", parsed.error.issues.map(i => ({ field: i.path.join("."), message: i.message })));
  const p = parsed.data;
  if (p.birthDate && (!isValidDate(p.birthDate) || p.birthDate > today())) return message(res, 400, "La fecha de nacimiento no es válida.");
  try {
    const result = await query(`INSERT INTO patients (document_type,document_number,first_name,last_name,email,phone,birth_date,sex,address,created_by) VALUES ($1,$2,$3,$4,$5,$6,NULLIF($7,'')::date,$8,$9,$10) RETURNING ${patientSelect}`,
      [p.documentType, p.documentNumber.toUpperCase(), p.firstName, p.lastName, p.email, p.phone, p.birthDate, p.sex, p.address, req.session.user.id]);
    await audit({ actorId: req.session.user.id, action: "PATIENT_CREATED", entityType: "patient", entityId: result.rows[0].id, ip: req.ip });
    res.status(201).json({ patient: result.rows[0] });
  } catch (err) {
    if (err.code === "23505") return message(res, 409, "Ya existe un paciente con ese tipo y número de documento.");
    if (err.code === "22007") return message(res, 400, "La fecha ingresada no es válida.");
    throw err;
  }
}));
app.patch("/api/patients/:id", requireRole("admin", "reception"), handle(async (req, res) => {
  if (!validId(req.params.id)) return message(res, 400, "Identificador no válido.");
  const parsed = patientSchema.safeParse(req.body);
  if (!parsed.success) return message(res, 400, "Revisa los campos del paciente.", parsed.error.issues.map(i => ({ field: i.path.join("."), message: i.message })));
  const p = parsed.data;
  if (p.birthDate && (!isValidDate(p.birthDate) || p.birthDate > today())) return message(res, 400, "La fecha de nacimiento no es válida.");
  try {
    const result = await query(`UPDATE patients SET document_type=$1,document_number=$2,first_name=$3,last_name=$4,email=$5,phone=$6,birth_date=NULLIF($7,'')::date,sex=$8,address=$9 WHERE id=$10 RETURNING ${patientSelect}`,
      [p.documentType, p.documentNumber.toUpperCase(), p.firstName, p.lastName, p.email, p.phone, p.birthDate, p.sex, p.address, Number(req.params.id)]);
    if (!result.rows.length) return message(res, 404, "No se encontró el paciente.");
    await audit({ actorId: req.session.user.id, action: "PATIENT_UPDATED", entityType: "patient", entityId: Number(req.params.id), ip: req.ip });
    res.json({ patient: result.rows[0] });
  } catch (err) {
    if (err.code === "23505") return message(res, 409, "Ya existe otro paciente con ese tipo y número de documento.");
    throw err;
  }
}));

app.get("/api/professionals", requireRole("admin", "reception"), handle(async (_req, res) => {
  const result = await query("SELECT id,full_name AS \"fullName\" FROM users WHERE active=TRUE AND role IN ('health','lab') ORDER BY full_name");
  res.json({ professionals: result.rows });
}));
app.get("/api/appointments", requireRole("admin", "reception", "health"), handle(async (req, res) => {
  const search = String(req.query.search || "").trim().slice(0, 100);
  const status = String(req.query.status || "").slice(0, 30);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from || "")) ? req.query.from : "2000-01-01";
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to || "")) ? req.query.to : "2999-12-31";
  const result = await query(`SELECT a.id,a.patient_id AS "patientId",p.first_name||' '||p.last_name AS "patientName",p.document_number AS "documentNumber",a.service,to_char(a.appointment_date,'YYYY-MM-DD') AS "appointmentDate",to_char(a.appointment_time,'HH24:MI') AS "appointmentTime",a.status,a.notes,a.professional_id AS "professionalId",u.full_name AS "professionalName",a.created_at AS "createdAt" FROM appointments a JOIN patients p ON p.id=a.patient_id LEFT JOIN users u ON u.id=a.professional_id WHERE ($1='' OR (p.first_name||' '||p.last_name) ILIKE $2 OR p.document_number ILIKE $2) AND ($3='' OR a.status=$3) AND a.appointment_date BETWEEN $4 AND $5 AND ($6=FALSE OR a.professional_id=$7) ORDER BY a.appointment_date DESC,a.appointment_time DESC LIMIT 500`, [search, `%${search}%`, status, from, to, req.session.user.role === "health", req.session.user.id]);
  res.json({ appointments: result.rows });
}));
app.post("/api/appointments", requireRole("admin", "reception"), handle(async (req, res) => {
  const parsed = appointmentSchema.safeParse(req.body);
  if (!parsed.success) return message(res, 400, "Completa los datos de la cita.", parsed.error.issues.map(i => ({ field: i.path.join("."), message: i.message })));
  const a = parsed.data;
  if (!isValidDate(a.appointmentDate)) return message(res, 400, "La fecha de la cita no es válida.");
  if (a.appointmentDate < today()) return message(res, 400, "No se pueden programar citas en fechas pasadas.");
  if (Number(a.appointmentTime.slice(0, 2)) > 23 || Number(a.appointmentTime.slice(3, 5)) > 59) return message(res, 400, "La hora ingresada no es válida.");
  if (a.professionalId && req.session.user.role === "reception") {
    const assigned = await query("SELECT id FROM users WHERE id=$1 AND active=TRUE AND role IN ('health','lab')", [a.professionalId]);
    if (!assigned.rows.length) return message(res, 400, "El profesional seleccionado no está disponible.");
  }
  try {
    if (a.professionalId) {
      const conflict = await query("SELECT id FROM appointments WHERE professional_id=$1 AND appointment_date=$2 AND appointment_time=$3 AND status NOT IN ('Cancelada','No asistió')", [a.professionalId, a.appointmentDate, a.appointmentTime]);
      if (conflict.rows.length) return message(res, 409, "El profesional ya tiene una cita asignada en ese horario.");
    }
    const result = await query(`INSERT INTO appointments (patient_id,service,appointment_date,appointment_time,notes,created_by,professional_id) VALUES ($1,$2,$3,$4,$5,$6,NULLIF($7,'')::bigint) RETURNING id,patient_id AS "patientId",service,to_char(appointment_date,'YYYY-MM-DD') AS "appointmentDate",to_char(appointment_time,'HH24:MI') AS "appointmentTime",status,notes,professional_id AS "professionalId"`,
      [a.patientId, a.service, a.appointmentDate, a.appointmentTime, a.notes, req.session.user.id, a.professionalId]);
    await audit({ actorId: req.session.user.id, action: "APPOINTMENT_CREATED", entityType: "appointment", entityId: result.rows[0].id, ip: req.ip });
    res.status(201).json({ appointment: result.rows[0] });
  } catch (err) {
    if (err.code === "23505") return message(res, 409, "El paciente o profesional ya tiene una cita activa en ese horario.");
    if (err.code === "23503") return message(res, 400, "El paciente o profesional seleccionado no existe.");
    throw err;
  }
}));
app.patch("/api/appointments/:id", requireRole("admin", "reception"), handle(async (req, res) => {
  if (!validId(req.params.id)) return message(res, 400, "Identificador no válido.");
  const parsed = appointmentSchema.safeParse(req.body);
  if (!parsed.success) return message(res, 400, "Completa los datos de la cita.", parsed.error.issues.map(i => ({ field: i.path.join("."), message: i.message })));
  const a = parsed.data, id = Number(req.params.id);
  if (!isValidDate(a.appointmentDate)) return message(res, 400, "La fecha de la cita no es válida.");
  const existingAppointment = await query("SELECT to_char(appointment_date,'YYYY-MM-DD') AS d FROM appointments WHERE id=$1", [id]);
  if (!existingAppointment.rows.length) return message(res, 404, "No se encontró la cita.");
  // Se permite conservar la fecha original (aunque ya haya pasado) para corregir otros datos de la cita.
  if (a.appointmentDate < today() && a.appointmentDate !== existingAppointment.rows[0].d) return message(res, 400, "No se pueden programar citas en fechas pasadas.");
  if (Number(a.appointmentTime.slice(0, 2)) > 23 || Number(a.appointmentTime.slice(3, 5)) > 59) return message(res, 400, "La hora ingresada no es válida.");
  if (a.professionalId) {
    const assigned = await query("SELECT id FROM users WHERE id=$1 AND active=TRUE AND role IN ('health','lab')", [a.professionalId]);
    if (!assigned.rows.length) return message(res, 400, "El profesional seleccionado no está disponible.");
    const conflict = await query("SELECT id FROM appointments WHERE professional_id=$1 AND appointment_date=$2 AND appointment_time=$3 AND status NOT IN ('Cancelada','No asistió') AND id<>$4", [a.professionalId, a.appointmentDate, a.appointmentTime, id]);
    if (conflict.rows.length) return message(res, 409, "El profesional ya tiene una cita asignada en ese horario.");
  }
  try {
    const result = await query(`UPDATE appointments SET patient_id=$1,service=$2,appointment_date=$3,appointment_time=$4,notes=$5,professional_id=NULLIF($6,'')::bigint WHERE id=$7 RETURNING id,patient_id AS "patientId",service,to_char(appointment_date,'YYYY-MM-DD') AS "appointmentDate",to_char(appointment_time,'HH24:MI') AS "appointmentTime",status,notes,professional_id AS "professionalId"`, [a.patientId, a.service, a.appointmentDate, a.appointmentTime, a.notes, a.professionalId, id]);
    if (!result.rows.length) return message(res, 404, "No se encontró la cita.");
    await audit({ actorId: req.session.user.id, action: "APPOINTMENT_UPDATED", entityType: "appointment", entityId: id, ip: req.ip });
    res.json({ appointment: result.rows[0] });
  } catch (err) {
    if (err.code === "23505") return message(res, 409, "El paciente o profesional ya tiene una cita activa en ese horario.");
    if (err.code === "23503") return message(res, 400, "El paciente o profesional seleccionado no existe.");
    throw err;
  }
}));
app.patch("/api/appointments/:id/status", requireRole("admin", "reception"), handle(async (req, res) => {
  if (!validId(req.params.id)) return message(res, 400, "Identificador no válido.");
  const parsed = appointmentStatusSchema.safeParse(req.body);
  if (!parsed.success) return message(res, 400, "Estado de cita no válido.");
  const result = await query("UPDATE appointments SET status=$1 WHERE id=$2 RETURNING id,status", [parsed.data.status, Number(req.params.id)]);
  if (!result.rows.length) return message(res, 404, "No se encontró la cita.");
  await audit({ actorId: req.session.user.id, action: "APPOINTMENT_STATUS_CHANGED", entityType: "appointment", entityId: Number(req.params.id), details: { status: parsed.data.status }, ip: req.ip });
  res.json({ appointment: result.rows[0] });
}));

app.get("/api/exams", requireAuth, handle(async (req, res) => {
  const search = String(req.query.search || "").trim().slice(0, 100);
  const category = String(req.query.category || "").trim().slice(0, 80);
  const all = req.session.user.role === "admin" && req.query.all === "true";
  const result = await query(`SELECT id,code,name,category,sample_type AS "sampleType",preparation,turnaround_minutes AS "turnaroundMinutes",price::float AS price,unit,reference_range AS "referenceRange",active,created_at AS "createdAt" FROM exam_catalog WHERE ($1='' OR name ILIKE $2 OR code ILIKE $2 OR category ILIKE $2) AND ($3='' OR category=$3) AND ($4=TRUE OR active=TRUE) ORDER BY category,name`, [search, `%${search}%`, category, all]);
  res.json({ exams: result.rows, categories: [...new Set(result.rows.map(x => x.category))] });
}));
app.post("/api/exams", requireRole("admin"), handle(async (req, res) => {
  const parsed = examSchema.safeParse(req.body);
  if (!parsed.success) return message(res, 400, "Revisa los datos del examen.", parsed.error.issues.map(i => ({ field: i.path.join("."), message: i.message })));
  const e = parsed.data;
  try {
    const result = await query(`INSERT INTO exam_catalog (code,name,category,sample_type,preparation,turnaround_minutes,price,unit,reference_range) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,code,name,category,sample_type AS "sampleType",preparation,turnaround_minutes AS "turnaroundMinutes",price::float AS price,unit,reference_range AS "referenceRange",active`, [e.code.toUpperCase(), e.name, e.category, e.sampleType, e.preparation, e.turnaroundMinutes, e.price, e.unit, e.referenceRange]);
    await audit({ actorId: req.session.user.id, action: "EXAM_CREATED", entityType: "exam", entityId: result.rows[0].id, ip: req.ip });
    res.status(201).json({ exam: result.rows[0] });
  } catch (err) {
    if (err.code === "23505") return message(res, 409, "Ya existe un examen con ese código o nombre.");
    throw err;
  }
}));
app.patch("/api/exams/:id/active", requireRole("admin"), handle(async (req, res) => {
  if (!validId(req.params.id) || typeof req.body.active !== "boolean") return message(res, 400, "Solicitud no válida.");
  const result = await query("UPDATE exam_catalog SET active=$1 WHERE id=$2 RETURNING id,code,name,active", [req.body.active, Number(req.params.id)]);
  if (!result.rows.length) return message(res, 404, "No se encontró el examen.");
  await audit({ actorId: req.session.user.id, action: "EXAM_ACTIVE_CHANGED", entityType: "exam", entityId: Number(req.params.id), details: { active: req.body.active }, ip: req.ip });
  res.json({ exam: result.rows[0] });
}));

app.get("/api/orders", requireRole("admin", "reception", "lab", "health"), handle(async (req, res) => {
  const search = String(req.query.search || "").trim().slice(0, 100);
  const result = await query(`SELECT o.id,o.order_number AS "orderNumber",o.patient_id AS "patientId",p.first_name||' '||p.last_name AS "patientName",p.document_number AS "documentNumber",o.status,o.reason,o.created_at AS "createdAt",u.full_name AS "orderedBy",(SELECT COUNT(*)::int FROM order_items oi WHERE oi.order_id=o.id) AS "examCount",(SELECT COALESCE(SUM(e.price),0)::float FROM order_items oi JOIN exam_catalog e ON e.id=oi.exam_id WHERE oi.order_id=o.id) AS total,COALESCE((SELECT STRING_AGG(DISTINCT s.status, ', ') FROM samples s WHERE s.order_id=o.id),'Sin muestra') AS "sampleStatuses",EXISTS(SELECT 1 FROM invoices i WHERE i.order_id=o.id) AS "hasInvoice" FROM lab_orders o JOIN patients p ON p.id=o.patient_id LEFT JOIN users u ON u.id=o.ordered_by WHERE ($1='' OR o.order_number ILIKE $2 OR p.document_number ILIKE $2 OR (p.first_name||' '||p.last_name) ILIKE $2) AND ($3=FALSE OR o.ordered_by=$4 OR EXISTS (SELECT 1 FROM appointments ap WHERE ap.patient_id=o.patient_id AND ap.professional_id=$4)) ORDER BY o.created_at DESC LIMIT 500`, [search, `%${search}%`, req.session.user.role === "health", req.session.user.id]);
  res.json({ orders: result.rows });
}));
app.post("/api/orders", requireRole("admin", "reception", "health"), handle(async (req, res) => {
  const parsed = orderSchema.safeParse(req.body);
  if (!parsed.success) return message(res, 400, "Selecciona el paciente y al menos un examen.", parsed.error.issues.map(i => ({ field: i.path.join("."), message: i.message })));
  const o = parsed.data;
  const examIds = [...new Set(o.examIds)];
  const exams = await query(`SELECT * FROM exam_catalog WHERE active=TRUE AND id IN (${examIds.map((_, i) => `$${i + 1}`).join(",")})`, examIds);
  if (exams.rows.length !== examIds.length) return message(res, 400, "Uno o más exámenes ya no están disponibles en el catálogo.");
  const patient = await query("SELECT id FROM patients WHERE id=$1", [o.patientId]);
  if (!patient.rows.length) return message(res, 400, "El paciente seleccionado no existe.");
  if (req.session.user.role === "health") {
    const scopedPatient = await query(`SELECT 1 FROM patients p WHERE p.id=$1 AND (EXISTS (SELECT 1 FROM appointments ap WHERE ap.patient_id=p.id AND ap.professional_id=$2) OR EXISTS (SELECT 1 FROM lab_orders lo WHERE lo.patient_id=p.id AND lo.ordered_by=$2))`, [o.patientId, req.session.user.id]);
    if (!scopedPatient.rows.length) return message(res, 404, "No se encontró el paciente.");
  }
  try {
    const created = await transaction(async tx => {
      const orderNo = makeCode("OT");
      const order = await tx.query("INSERT INTO lab_orders (order_number,patient_id,reason,ordered_by) VALUES ($1,$2,$3,$4) RETURNING id,order_number AS \"orderNumber\",patient_id AS \"patientId\",status,created_at AS \"createdAt\"", [orderNo, o.patientId, o.reason, req.session.user.id]);
      const sampleByType = new Map();
      for (const exam of exams.rows) {
        if (!sampleByType.has(exam.sample_type)) {
          const sampleCode = makeCode("M");
          const sample = await tx.query("INSERT INTO samples (patient_id,order_id,sample_code,sample_type,status,created_by) VALUES ($1,$2,$3,$4,'Pendiente de toma',$5) RETURNING id,sample_code AS \"sampleCode\",sample_type AS \"sampleType\",status", [o.patientId, order.rows[0].id, sampleCode, exam.sample_type, req.session.user.id]);
          sampleByType.set(exam.sample_type, sample.rows[0]);
        }
        await tx.query("INSERT INTO order_items (order_id,exam_id,sample_id,unit,reference_range) VALUES ($1,$2,$3,$4,$5)", [order.rows[0].id, exam.id, sampleByType.get(exam.sample_type).id, exam.unit, exam.reference_range]);
      }
      return { order: order.rows[0], samples: [...sampleByType.values()] };
    });
    await audit({ actorId: req.session.user.id, action: "ORDER_CREATED", entityType: "order", entityId: created.order.id, details: { examCount: examIds.length }, ip: req.ip });
    res.status(201).json(created);
  } catch (err) {
    if (err.code === "23503") return message(res, 400, "No se pudo relacionar el paciente o los exámenes de la orden.");
    throw err;
  }
}));
app.get("/api/orders/:id", requireRole("admin", "reception", "lab", "health"), handle(async (req, res) => {
  if (!validId(req.params.id)) return message(res, 400, "Identificador no válido.");
  const id = Number(req.params.id);
  const order = await query(`SELECT o.id,o.order_number AS "orderNumber",o.patient_id AS "patientId",p.first_name||' '||p.last_name AS "patientName",p.document_type AS "documentType",p.document_number AS "documentNumber",to_char(p.birth_date,'YYYY-MM-DD') AS "birthDate",p.sex,p.email,p.phone,o.reason,o.status,o.created_at AS "createdAt",u.full_name AS "orderedBy" FROM lab_orders o JOIN patients p ON p.id=o.patient_id LEFT JOIN users u ON u.id=o.ordered_by WHERE o.id=$1 AND ($2=FALSE OR o.ordered_by=$3 OR EXISTS (SELECT 1 FROM appointments ap WHERE ap.patient_id=o.patient_id AND ap.professional_id=$3))`, [id, req.session.user.role === "health", req.session.user.id]);
  if (!order.rows.length) return message(res, 404, "No se encontró la orden.");
  const [items, samples] = await Promise.all([
    query(`SELECT oi.id,oi.status,CASE WHEN $2 THEN oi.result_value ELSE '' END AS "resultValue",CASE WHEN $2 THEN oi.unit ELSE '' END AS unit,CASE WHEN $2 THEN oi.reference_range ELSE '' END AS "referenceRange",CASE WHEN $2 THEN oi.result_flag ELSE '' END AS "resultFlag",oi.published_at AS "publishedAt",e.code,e.name,e.category,e.price::float AS price,s.sample_code AS "sampleCode",s.status AS "sampleStatus" FROM order_items oi JOIN exam_catalog e ON e.id=oi.exam_id LEFT JOIN samples s ON s.id=oi.sample_id WHERE oi.order_id=$1 ORDER BY e.category,e.name`, [id, req.session.user.role !== "reception"]),
    query(`SELECT id,sample_code AS "sampleCode",sample_type AS "sampleType",status,collected_at AS "collectedAt",received_at AS "receivedAt",observations FROM samples WHERE order_id=$1 ORDER BY id`, [id])
  ]);
  res.json({ order: order.rows[0], items: items.rows, samples: samples.rows });
}));

app.get("/api/samples", requireRole("admin", "reception", "lab"), handle(async (req, res) => {
  const status = String(req.query.status || "").slice(0, 30);
  const search = String(req.query.search || "").trim().slice(0, 100);
  const result = await query(`SELECT s.id,s.patient_id AS "patientId",p.first_name||' '||p.last_name AS "patientName",p.document_number AS "documentNumber",s.sample_type AS "sampleType",s.sample_code AS "sampleCode",s.order_id AS "orderId",o.order_number AS "orderNumber",s.collected_at AS "collectedAt",s.received_at AS "receivedAt",s.status,s.observations,s.updated_at AS "updatedAt" FROM samples s JOIN patients p ON p.id=s.patient_id LEFT JOIN lab_orders o ON o.id=s.order_id WHERE ($1='' OR s.status=$1) AND ($2='' OR s.sample_code ILIKE $3 OR p.document_number ILIKE $3 OR (p.first_name||' '||p.last_name) ILIKE $3 OR o.order_number ILIKE $3) ORDER BY s.updated_at DESC LIMIT 500`, [status, search, `%${search}%`]);
  res.json({ samples: result.rows });
}));
app.post("/api/samples", requireRole("admin", "lab"), handle(async (req, res) => {
  const parsed = z.object({ patientId: z.coerce.number().int().positive(), sampleType: z.string().trim().min(2).max(100), observations: z.string().trim().max(500).optional().default("") }).safeParse(req.body);
  if (!parsed.success) return message(res, 400, "Completa los datos de la muestra.");
  const s = parsed.data;
  try {
    const result = await query(`INSERT INTO samples (patient_id,sample_type,sample_code,status,observations,created_by,collected_at,received_at) VALUES ($1,$2,$3,'Recibida',$4,$5,NOW(),NOW()) RETURNING id,patient_id AS "patientId",sample_code AS "sampleCode",sample_type AS "sampleType",collected_at AS "collectedAt",status`, [s.patientId, s.sampleType, makeCode("M"), s.observations, req.session.user.id]);
    await audit({ actorId: req.session.user.id, action: "SAMPLE_CREATED", entityType: "sample", entityId: result.rows[0].id, ip: req.ip });
    res.status(201).json({ sample: result.rows[0] });
  } catch (err) {
    if (err.code === "23503") return message(res, 400, "El paciente seleccionado no existe.");
    throw err;
  }
}));
app.patch("/api/samples/:id/status", requireRole("admin", "lab"), handle(async (req, res) => {
  if (!validId(req.params.id)) return message(res, 400, "Identificador no válido.");
  const parsed = sampleStatusSchema.safeParse(req.body);
  if (!parsed.success) return message(res, 400, "Estado de muestra no válido.");
  const id = Number(req.params.id);
  const found = await query("SELECT id,status,order_id FROM samples WHERE id=$1", [id]);
  if (!found.rows.length) return message(res, 404, "No se encontró la muestra.");
  const current = found.rows[0].status;
  const target = parsed.data.status;
  if (["Rechazada", "Cancelada"].includes(target) && parsed.data.reason.trim().length < 8) {
    return message(res, 400, "Escribe una justificación de al menos 8 caracteres para rechazar o cancelar la muestra.");
  }
  const allowed = {
    "Pendiente de toma": ["Recolectada", "Cancelada"], "Recolectada": ["Recibida", "Rechazada"],
    "Recibida": ["En procesamiento", "Rechazada"], "En procesamiento": ["Procesada", "Rechazada"],
    "Procesada": [], "Finalizada": [], "Rechazada": [], "Cancelada": []
  };
  if (current === target) return res.json({ sample: found.rows[0], unchanged: true });
  if (!(allowed[current] || []).includes(target)) return message(res, 409, `No se permite cambiar una muestra de «${current}» a «${target}».`);
  const result = await query(`UPDATE samples SET status=$1,updated_at=NOW(),collected_at=CASE WHEN $1='Recolectada' THEN COALESCE(collected_at,NOW()) ELSE collected_at END,received_at=CASE WHEN $1='Recibida' THEN NOW() ELSE received_at END,processed_at=CASE WHEN $1='Procesada' THEN NOW() ELSE processed_at END,observations=CASE WHEN $2<>'' THEN CONCAT_WS(CHR(10),NULLIF(observations,''),'Justificación: '||$2) ELSE observations END WHERE id=$3 RETURNING id,status,sample_code AS "sampleCode",order_id AS "orderId"`, [target, parsed.data.reason.trim(), id]);
  if (found.rows[0].order_id) {
    const allStatuses = await query("SELECT status FROM samples WHERE order_id=$1", [found.rows[0].order_id]);
    const states = allStatuses.rows.map(x => x.status);
    let orderStatus = "Pendiente de toma";
    if (states.some(x => x === "En procesamiento")) orderStatus = "En procesamiento";
    else if (states.some(x => x === "Recibida")) orderStatus = "Recibida";
    else if (states.some(x => x === "Recolectada")) orderStatus = "Recolectada";
    else if (states.length && states.every(x => ["Procesada", "Finalizada"].includes(x))) orderStatus = "Procesada";
    else if (states.some(x => x === "Rechazada")) orderStatus = "Rechazada";
    else if (states.every(x => x === "Cancelada")) orderStatus = "Cancelada";
    await query("UPDATE lab_orders SET status=$1,updated_at=NOW() WHERE id=$2", [orderStatus, found.rows[0].order_id]);
  }
  await audit({ actorId: req.session.user.id, action: "SAMPLE_STATUS_CHANGED", entityType: "sample", entityId: id, details: { from: current, to: target, reason: parsed.data.reason.trim() || undefined }, ip: req.ip });
  res.json({ sample: result.rows[0] });
}));

app.get("/api/results", requireRole("admin", "lab", "health"), handle(async (req, res) => {
  const status = String(req.query.status || "").slice(0, 24);
  const search = String(req.query.search || "").trim().slice(0, 100);
  const publishedOnly = req.query.published === "true";
  const result = await query(`SELECT oi.id,oi.status,oi.result_value AS "resultValue",oi.unit,oi.reference_range AS "referenceRange",oi.result_flag AS "resultFlag",oi.updated_at AS "updatedAt",oi.published_at AS "publishedAt",e.code,e.name AS "examName",e.category,o.id AS "orderId",o.order_number AS "orderNumber",p.id AS "patientId",p.first_name||' '||p.last_name AS "patientName",p.document_type AS "documentType",p.document_number AS "documentNumber",s.status AS "sampleStatus",s.sample_code AS "sampleCode",u.full_name AS "processorName",v.full_name AS "validatorName" FROM order_items oi JOIN lab_orders o ON o.id=oi.order_id JOIN patients p ON p.id=o.patient_id JOIN exam_catalog e ON e.id=oi.exam_id LEFT JOIN samples s ON s.id=oi.sample_id LEFT JOIN users u ON u.id=oi.processing_by LEFT JOIN users v ON v.id=oi.validated_by WHERE ($1='' OR oi.status=$1) AND ($2=FALSE OR oi.status='Publicado') AND ($3='' OR o.order_number ILIKE $4 OR p.document_number ILIKE $4 OR (p.first_name||' '||p.last_name) ILIKE $4 OR e.name ILIKE $4) AND ($5=FALSE OR o.ordered_by=$6 OR EXISTS (SELECT 1 FROM appointments ap WHERE ap.patient_id=o.patient_id AND ap.professional_id=$6)) ORDER BY oi.updated_at DESC LIMIT 500`, [status, publishedOnly, search, `%${search}%`, req.session.user.role === "health", req.session.user.id]);
  res.json({ results: result.rows });
}));
function evaluateRange(value, range) {
  const n = Number(String(value).replace(",", "."));
  if (!Number.isFinite(n) || !range || /configurable|según|depende/i.test(range)) return "";
  const match = range.match(/^\s*(-?\d+(?:[.,]\d+)?)\s*[-–]\s*(-?\d+(?:[.,]\d+)?)\s*$/);
  if (match) {
    const low = Number(match[1].replace(",", ".")), high = Number(match[2].replace(",", "."));
    return n < low ? "Bajo" : n > high ? "Alto" : "";
  }
  const highOnly = range.match(/^\s*(?:<|<=|≤)\s*(-?\d+(?:[.,]\d+)?)/);
  if (highOnly && n > Number(highOnly[1].replace(",", "."))) return "Alto";
  const lowOnly = range.match(/^\s*(?:>|>=|≥)\s*(-?\d+(?:[.,]\d+)?)/);
  if (lowOnly && n < Number(lowOnly[1].replace(",", "."))) return "Bajo";
  return "";
}
app.post("/api/results/:id", requireRole("admin", "lab"), handle(async (req, res) => {
  if (!validId(req.params.id)) return message(res, 400, "Identificador no válido.");
  const parsed = resultSchema.safeParse(req.body);
  if (!parsed.success) return message(res, 400, "Ingresa el resultado obtenido.");
  const id = Number(req.params.id);
  const found = await query("SELECT oi.id,oi.order_id AS order_id,oi.status,oi.reference_range,s.status AS sample_status FROM order_items oi LEFT JOIN samples s ON s.id=oi.sample_id WHERE oi.id=$1", [id]);
  if (!found.rows.length) return message(res, 404, "No se encontró el examen de la orden.");
  if (found.rows[0].status === "Publicado") return message(res, 409, "Un resultado publicado no se puede modificar directamente. Usa el proceso de corrección autorizado.");
  if (!["En procesamiento", "Procesada", "Finalizada"].includes(found.rows[0].sample_status)) return message(res, 409, "La muestra debe estar en procesamiento o procesada antes de registrar el resultado.");
  const flag = evaluateRange(parsed.data.resultValue, found.rows[0].reference_range);
  const result = await query("UPDATE order_items SET result_value=$1,result_flag=$2,status='En revisión',processing_by=$3,updated_at=NOW() WHERE id=$4 AND status<>'Publicado' RETURNING id,status,result_value AS \"resultValue\",result_flag AS \"resultFlag\"", [parsed.data.resultValue, flag, req.session.user.id, id]);
  if (!result.rows.length) return message(res, 409, "El resultado cambió de estado. Actualiza la lista antes de continuar.");
  await query("UPDATE lab_orders SET status='En revisión',updated_at=NOW() WHERE id=$1 AND status NOT IN ('Cancelada','Rechazada')", [found.rows[0].order_id]);
  await audit({ actorId: req.session.user.id, action: "RESULT_RECORDED", entityType: "result", entityId: id, details: { status: "En revisión", flagged: Boolean(flag) }, ip: req.ip });
  res.json({ result: result.rows[0] });
}));

app.patch("/api/results/:id/review", requireRole("admin", "health"), handle(async (req, res) => {
  if (!validId(req.params.id)) return message(res, 400, "Identificador no válido.");
  const parsed = reviewSchema.safeParse(req.body);
  if (!parsed.success) return message(res, 400, "Estado de revisión no válido.");
  const id = Number(req.params.id);
  const found = await query("SELECT id,status,order_id AS order_id FROM order_items WHERE id=$1", [id]);
  if (!found.rows.length || !(await canAccessClinicalOrder(req.session.user, found.rows[0].order_id))) return message(res, 404, "No se encontró el resultado.");
  if (parsed.data.status === "Validado" && found.rows[0].status !== "En revisión") return message(res, 409, "Solo se pueden validar resultados que estén en revisión.");
  if (parsed.data.status === "Publicado" && found.rows[0].status !== "Validado") return message(res, 409, "El resultado debe estar validado antes de publicarse.");
  const result = parsed.data.status === "Validado"
    ? await query("UPDATE order_items SET status='Validado',validated_by=$1,updated_at=NOW() WHERE id=$2 AND status='En revisión' RETURNING id,status", [req.session.user.id, id])
    : await query("UPDATE order_items SET status='Publicado',published_at=NOW(),updated_at=NOW() WHERE id=$1 AND status='Validado' RETURNING id,status,published_at AS \"publishedAt\"", [id]);
  if (!result.rows.length) return message(res, 409, "El resultado cambió de estado. Actualiza la lista antes de continuar.");
  if (parsed.data.status === "Publicado") {
    const pending = await query("SELECT COUNT(*)::int AS count FROM order_items WHERE order_id=$1 AND status<>'Publicado'", [found.rows[0].order_id]);
    await query("UPDATE lab_orders SET status=$1,updated_at=NOW() WHERE id=$2", [pending.rows[0].count === 0 ? "Finalizada" : "En revisión", found.rows[0].order_id]);
  }
  await audit({ actorId: req.session.user.id, action: parsed.data.status === "Validado" ? "RESULT_VALIDATED" : "RESULT_PUBLISHED", entityType: "result", entityId: id, details: { reason: parsed.data.reason }, ip: req.ip });
  res.json({ result: result.rows[0] });
}));

app.patch("/api/results/:id/correction", requireRole("admin", "health"), handle(async (req, res) => {
  if (!validId(req.params.id)) return message(res, 400, "Identificador no válido.");
  const parsed = correctionSchema.safeParse(req.body);
  if (!parsed.success) return message(res, 400, "Indica el nuevo resultado y una justificación de al menos 8 caracteres.");
  const id = Number(req.params.id);
  const found = await query("SELECT id,status,reference_range,order_id AS order_id FROM order_items WHERE id=$1", [id]);
  if (!found.rows.length || !(await canAccessClinicalOrder(req.session.user, found.rows[0].order_id))) return message(res, 404, "No se encontró el resultado.");
  if (found.rows[0].status !== "Publicado") return message(res, 409, "La corrección posterior solo aplica a resultados ya publicados.");
  const current = await query("SELECT result_value AS \"resultValue\",reference_range AS \"referenceRange\" FROM order_items WHERE id=$1", [id]);
  const flag = evaluateRange(parsed.data.resultValue, found.rows[0].reference_range);
  const result = await transaction(async tx => {
    await tx.query("INSERT INTO result_corrections (order_item_id,previous_value,corrected_value,reason,actor_id) VALUES ($1,$2,$3,$4,$5)", [id, current.rows[0].resultValue, parsed.data.resultValue, parsed.data.reason, req.session.user.id]);
    return tx.query("UPDATE order_items SET result_value=$1,result_flag=$2,status='En revisión',validated_by=NULL,published_at=NULL,processing_by=$3,updated_at=NOW() WHERE id=$4 RETURNING id,status", [parsed.data.resultValue, flag, req.session.user.id, id]);
  });
  await query("UPDATE lab_orders SET status='En revisión',updated_at=NOW() WHERE id=(SELECT order_id FROM order_items WHERE id=$1)", [id]);
  await audit({ actorId: req.session.user.id, action: "RESULT_CORRECTION_REQUESTED", entityType: "result", entityId: id, details: { reason: parsed.data.reason, priorStatus: "Publicado", previousValue: current.rows[0].resultValue, correctedValue: parsed.data.resultValue }, ip: req.ip });
  res.json({ result: result.rows[0], message: "La corrección quedó en revisión y requiere una nueva validación y publicación." });
}));
app.get("/api/results/:id/history", requireRole("admin", "health"), handle(async (req, res) => {
  if (!validId(req.params.id)) return message(res, 400, "Identificador no válido.");
  const item = await query("SELECT order_id AS order_id FROM order_items WHERE id=$1", [Number(req.params.id)]);
  if (!item.rows.length || !(await canAccessClinicalOrder(req.session.user, item.rows[0].order_id))) return message(res, 404, "No se encontró el resultado.");
  const result = await query(`SELECT c.id,c.previous_value AS \"previousValue\",c.corrected_value AS \"correctedValue\",c.reason,c.created_at AS \"createdAt\",u.full_name AS \"actorName\" FROM result_corrections c LEFT JOIN users u ON u.id=c.actor_id WHERE c.order_item_id=$1 ORDER BY c.created_at DESC`, [Number(req.params.id)]);
  res.json({ corrections: result.rows });
}));

app.get("/api/invoices", requireRole("admin", "reception"), handle(async (req, res) => {
  const status = String(req.query.status || "").slice(0, 24);
  const search = String(req.query.search || "").trim().slice(0, 100);
  const result = await query(`SELECT i.id,i.invoice_number AS "invoiceNumber",i.order_id AS "orderId",o.order_number AS "orderNumber",i.patient_id AS "patientId",p.first_name||' '||p.last_name AS "patientName",i.subtotal::float AS subtotal,i.amount_paid::float AS "amountPaid",i.status,i.created_at AS "createdAt",i.paid_at AS "paidAt" FROM invoices i JOIN lab_orders o ON o.id=i.order_id JOIN patients p ON p.id=i.patient_id WHERE ($1='' OR i.status=$1) AND ($2='' OR i.invoice_number ILIKE $3 OR o.order_number ILIKE $3 OR (p.first_name||' '||p.last_name) ILIKE $3) ORDER BY i.created_at DESC LIMIT 500`, [status, search, `%${search}%`]);
  res.json({ invoices: result.rows });
}));
app.post("/api/invoices", requireRole("admin", "reception"), handle(async (req, res) => {
  if (!validId(req.body.orderId)) return message(res, 400, "Selecciona una orden válida.");
  const orderId = Number(req.body.orderId);
  const existing = await query("SELECT id FROM invoices WHERE order_id=$1", [orderId]);
  if (existing.rows.length) return message(res, 409, "Esta orden ya tiene un documento de cobro.");
  const total = await query("SELECT o.patient_id AS patient_id,COALESCE(SUM(e.price),0)::float AS total FROM lab_orders o JOIN order_items oi ON oi.order_id=o.id JOIN exam_catalog e ON e.id=oi.exam_id WHERE o.id=$1 GROUP BY o.patient_id", [orderId]);
  if (!total.rows.length) return message(res, 404, "No se encontró la orden o no tiene exámenes asociados.");
  try {
    const inv = await query("INSERT INTO invoices (invoice_number,order_id,patient_id,subtotal,created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id,invoice_number AS \"invoiceNumber\",order_id AS \"orderId\",subtotal::float AS subtotal,amount_paid::float AS \"amountPaid\",status,created_at AS \"createdAt\"", [makeCode("FC"), orderId, total.rows[0].patient_id, total.rows[0].total, req.session.user.id]);
    await audit({ actorId: req.session.user.id, action: "INVOICE_CREATED", entityType: "invoice", entityId: inv.rows[0].id, ip: req.ip });
    res.status(201).json({ invoice: inv.rows[0] });
  } catch (err) {
    if (err.code === "23505") return message(res, 409, "Esta orden ya tiene un documento de cobro.");
    throw err;
  }
}));
app.patch("/api/invoices/:id/status", requireRole("admin", "reception"), handle(async (req, res) => {
  if (!validId(req.params.id)) return message(res, 400, "Identificador no válido.");
  const parsed = invoiceStatusSchema.safeParse(req.body);
  if (!parsed.success) return message(res, 400, "Estado administrativo no válido.");
  const id = Number(req.params.id);
  const current = await query('SELECT subtotal::float AS subtotal,amount_paid::float AS "amountPaid" FROM invoices WHERE id=$1', [id]);
  if (!current.rows.length) return message(res, 404, "No se encontró el documento de cobro.");
  const subtotal = Number(current.rows[0].subtotal);
  let amountPaid = Number(current.rows[0].amountPaid);
  if (parsed.data.status === "Pagado") amountPaid = subtotal;
  else if (parsed.data.status === "Pendiente") amountPaid = 0;
  else if (parsed.data.status === "Parcial") {
    if (parsed.data.amountPaid === undefined || parsed.data.amountPaid <= 0 || parsed.data.amountPaid >= subtotal) {
      return message(res, 400, "Para un pago parcial, registra un importe mayor que cero y menor que el total del cobro.");
    }
    amountPaid = Math.round(parsed.data.amountPaid * 100) / 100;
  }
  if (amountPaid > subtotal) return message(res, 400, "El importe recibido no puede superar el total del cobro.");
  if (parsed.data.status === "Parcial" && (amountPaid <= 0 || amountPaid >= subtotal)) return message(res, 400, "El importe parcial debe ser menor que el total después del redondeo a centavos.");
  const result = await query(`UPDATE invoices SET status=$1,amount_paid=$2,paid_at=CASE WHEN $1='Pagado' THEN NOW() WHEN $1='Pendiente' THEN NULL ELSE paid_at END WHERE id=$3 RETURNING id,status,amount_paid::float AS "amountPaid"`, [parsed.data.status, amountPaid, id]);
  await audit({ actorId: req.session.user.id, action: "INVOICE_STATUS_CHANGED", entityType: "invoice", entityId: id, details: { status: parsed.data.status, amountPaid }, ip: req.ip });
  res.json({ invoice: result.rows[0] });
}));

app.get("/api/documents", requireRole("admin", "reception", "lab", "health"), handle(async (req, res) => {
  const search = String(req.query.search || "").trim().slice(0, 100);
  const result = await query(`SELECT d.id,d.title,d.document_type AS "documentType",d.description,d.patient_id AS "patientId",p.first_name||' '||p.last_name AS "patientName",d.order_id AS "orderId",o.order_number AS "orderNumber",d.created_at AS "createdAt",u.full_name AS "responsibleName" FROM documents d LEFT JOIN patients p ON p.id=d.patient_id LEFT JOIN lab_orders o ON o.id=d.order_id LEFT JOIN users u ON u.id=d.responsible_id WHERE ($1='' OR d.title ILIKE $2 OR d.document_type ILIKE $2 OR COALESCE(p.first_name||' '||p.last_name,'') ILIKE $2 OR COALESCE(o.order_number,'') ILIKE $2) AND ($3=FALSE OR d.created_by=$4 OR EXISTS (SELECT 1 FROM lab_orders lo WHERE (lo.id=d.order_id OR lo.patient_id=d.patient_id) AND (lo.ordered_by=$4 OR EXISTS (SELECT 1 FROM appointments ap WHERE ap.patient_id=lo.patient_id AND ap.professional_id=$4))) OR EXISTS (SELECT 1 FROM appointments ap WHERE ap.patient_id=d.patient_id AND ap.professional_id=$4)) ORDER BY d.created_at DESC LIMIT 500`, [search, `%${search}%`, req.session.user.role === "health", req.session.user.id]);
  res.json({ documents: result.rows });
}));
app.post("/api/documents", requireRole("admin", "reception", "lab", "health"), handle(async (req, res) => {
  const parsed = documentSchema.safeParse(req.body);
  if (!parsed.success) return message(res, 400, "Revisa los datos del documento.", parsed.error.issues.map(i => ({ field: i.path.join("."), message: i.message })));
  const d = parsed.data;
  if (!d.patientId && !d.orderId) return message(res, 400, "Asocia el documento a un paciente o a una orden.");
  if (req.session.user.role === "health") {
    if (d.orderId && !(await canAccessClinicalOrder(req.session.user, d.orderId))) return message(res, 404, "No se encontró la orden.");
    if (d.patientId && !d.orderId) {
      const scopedPatient = await query(`SELECT 1 FROM patients p WHERE p.id=$1 AND (EXISTS (SELECT 1 FROM appointments ap WHERE ap.patient_id=p.id AND ap.professional_id=$2) OR EXISTS (SELECT 1 FROM lab_orders lo WHERE lo.patient_id=p.id AND lo.ordered_by=$2))`, [Number(d.patientId), req.session.user.id]);
      if (!scopedPatient.rows.length) return message(res, 404, "No se encontró el paciente.");
    }
  }
  if (d.orderId) {
    const order = await query("SELECT patient_id FROM lab_orders WHERE id=$1", [d.orderId]);
    if (!order.rows.length) return message(res, 400, "La orden seleccionada no existe.");
    if (d.patientId && Number(d.patientId) !== Number(order.rows[0].patient_id)) return message(res, 400, "El paciente seleccionado no corresponde a la orden.");
  }
  try {
    const result = await query(`INSERT INTO documents (title,document_type,description,patient_id,order_id,responsible_id,created_by) VALUES ($1,$2,$3,NULLIF($4,'')::bigint,NULLIF($5,'')::bigint,$6,$6) RETURNING id,title,document_type AS "documentType",description,patient_id AS "patientId",order_id AS "orderId",created_at AS "createdAt"`, [d.title, d.documentType, d.description, d.patientId, d.orderId, req.session.user.id]);
    await audit({ actorId: req.session.user.id, action: "DOCUMENT_REGISTERED", entityType: "document", entityId: result.rows[0].id, ip: req.ip });
    res.status(201).json({ document: result.rows[0] });
  } catch (err) {
    if (err.code === "23503") return message(res, 400, "El paciente u orden seleccionada no existe.");
    throw err;
  }
}));

app.get("/api/reports/summary", requireRole("admin"), handle(async (req, res) => {
  const from = typeof req.query.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from) ? req.query.from : "2000-01-01";
  const to = typeof req.query.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.to) ? req.query.to : "2999-12-31";
  if (from > to) return message(res, 400, "La fecha inicial no puede ser posterior a la fecha final.");
  const [patients, appointments, samples, sampleStatuses, orders, results, invoices, topExams, avgTime] = await Promise.all([
    query("SELECT COUNT(*)::int AS count FROM patients WHERE created_at::date BETWEEN $1 AND $2", [from, to]),
    query("SELECT COUNT(*)::int AS count FROM appointments WHERE appointment_date BETWEEN $1 AND $2", [from, to]),
    query("SELECT COUNT(*)::int AS count FROM samples WHERE created_at::date BETWEEN $1 AND $2", [from, to]),
    query("SELECT status,COUNT(*)::int AS count FROM samples WHERE created_at::date BETWEEN $1 AND $2 GROUP BY status ORDER BY status", [from, to]),
    query("SELECT COUNT(*)::int AS count FROM lab_orders WHERE created_at::date BETWEEN $1 AND $2", [from, to]),
    query("SELECT status,COUNT(*)::int AS count FROM order_items WHERE updated_at::date BETWEEN $1 AND $2 GROUP BY status ORDER BY status", [from, to]),
    query("SELECT COUNT(*)::int AS count,COALESCE(SUM(subtotal),0)::float AS total FROM invoices WHERE created_at::date BETWEEN $1 AND $2 AND status<>'Anulado'", [from, to]),
    query("SELECT e.name,COUNT(*)::int AS count FROM order_items oi JOIN exam_catalog e ON e.id=oi.exam_id JOIN lab_orders o ON o.id=oi.order_id WHERE o.created_at::date BETWEEN $1 AND $2 GROUP BY e.id,e.name ORDER BY count DESC,e.name LIMIT 8", [from, to]),
    query("SELECT ROUND(AVG(EXTRACT(EPOCH FROM (processed_at-collected_at))/60)::numeric,1)::float AS minutes FROM samples WHERE processed_at IS NOT NULL AND collected_at IS NOT NULL AND processed_at >= collected_at AND created_at::date BETWEEN $1 AND $2", [from, to])
  ]);
  res.json({ from, to, patients: patients.rows[0].count, appointments: appointments.rows[0].count, samples: samples.rows[0].count, orders: orders.rows[0].count, sampleStatuses: sampleStatuses.rows, resultStatuses: results.rows, invoices: invoices.rows[0], topExams: topExams.rows, averageProcessingMinutes: avgTime.rows[0].minutes });
}));

app.get("/api/users", requireRole("admin"), handle(async (_req, res) => {
  const result = await query("SELECT id,full_name AS \"fullName\",email,role,active,created_at AS \"createdAt\" FROM users ORDER BY created_at DESC");
  res.json({ users: result.rows });
}));
app.post("/api/users", requireRole("admin"), handle(async (req, res) => {
  const parsed = userSchema.safeParse(req.body);
  if (!parsed.success) return message(res, 400, "Revisa los datos del usuario.", parsed.error.issues.map(i => ({ field: i.path.join("."), message: i.message })));
  try {
    const hash = await bcrypt.hash(parsed.data.password, 12);
    const result = await query("INSERT INTO users(full_name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id,full_name AS \"fullName\",email,role,active,created_at AS \"createdAt\"", [parsed.data.fullName, parsed.data.email, hash, parsed.data.role]);
    await audit({ actorId: req.session.user.id, action: "USER_CREATED", entityType: "user", entityId: result.rows[0].id, details: { role: result.rows[0].role }, ip: req.ip });
    res.status(201).json({ user: result.rows[0] });
  } catch (err) {
    if (err.code === "23505") return message(res, 409, "Ya existe una cuenta con ese correo.");
    throw err;
  }
}));
app.patch("/api/users/:id", requireRole("admin"), handle(async (req, res) => {
  if (!validId(req.params.id)) return message(res, 400, "Identificador no válido.");
  const parsed = z.object({ active: z.boolean().optional(), role: z.enum(["admin", "reception", "lab", "health"]).optional() }).refine(x => x.active !== undefined || x.role !== undefined).safeParse(req.body);
  if (!parsed.success) return message(res, 400, "Indica un estado o rol válido.");
  const id = Number(req.params.id);
  if (id === Number(req.session.user.id) && parsed.data.active === false) return message(res, 409, "No puedes desactivar tu propia cuenta durante la sesión.");
  const current = await query("SELECT role,active FROM users WHERE id=$1", [id]);
  if (!current.rows.length) return message(res, 404, "No se encontró el usuario.");
  const nextActive = parsed.data.active ?? current.rows[0].active;
  const nextRole = parsed.data.role ?? current.rows[0].role;
  if (id === Number(req.session.user.id) && nextRole !== "admin") return message(res, 409, "No puedes quitarte el rol de administrador durante tu propia sesión.");
  if (current.rows[0].active && current.rows[0].role === "admin" && (!nextActive || nextRole !== "admin")) {
    const administrators = await query("SELECT COUNT(*)::int AS count FROM users WHERE active=TRUE AND role='admin'");
    if (administrators.rows[0].count <= 1) return message(res, 409, "Debe permanecer al menos un administrador activo.");
  }
  const result = await query("UPDATE users SET active=$1,role=$2 WHERE id=$3 RETURNING id,full_name AS \"fullName\",email,role,active,created_at AS \"createdAt\"", [nextActive, nextRole, id]);
  await audit({ actorId: req.session.user.id, action: "USER_PERMISSIONS_CHANGED", entityType: "user", entityId: id, details: { role: nextRole, active: nextActive }, ip: req.ip });
  res.json({ user: result.rows[0] });
}));
app.get("/api/audit", requireRole("admin"), handle(async (_req, res) => {
  const result = await query(`SELECT l.id,l.action,l.entity_type AS "entityType",l.entity_id AS "entityId",l.details,l.ip_address AS ip,l.created_at AS "createdAt",u.full_name AS "actorName" FROM audit_log l LEFT JOIN users u ON u.id=l.actor_id ORDER BY l.created_at DESC LIMIT 300`);
  res.json({ entries: result.rows });
}));

app.use("/api", (_req, res) => message(res, 404, "La ruta de la API solicitada no existe.", undefined, "ROUTE_NOT_FOUND"));
app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "../public/index.html")));
app.use((err, req, res, _next) => {
  console.error("Error no controlado:", req.method, req.path, err?.stack || err);
  if (res.headersSent) return;
  if (err?.type === "entity.parse.failed") return message(res, 400, "El cuerpo de la solicitud no es un JSON válido.");
  if (err?.type === "entity.too.large") return message(res, 413, "La solicitud es demasiado grande.");
  message(res, 500, "Ocurrió un error interno. Vuelve a intentarlo; si persiste, revisa los registros del servidor.");
});

export default app;
let server = null;
if (!process.env.VERCEL) {
  server = app.listen(port, () => {
    console.log(`BioTest disponible en http://localhost:${port} · Persistencia: ${persistenceMode}`);
    ensureReady().catch(error => console.error("BioTest: la base de datos no pudo iniciarse:", error.message));
  });
}
async function shutdown() {
  if (!server) return;
  server.close(async () => { await pool.end(); process.exit(0); });
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

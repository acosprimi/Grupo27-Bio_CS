import fs from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import { fileURLToPath } from "node:url";
dotenv.config();

const here = path.dirname(fileURLToPath(import.meta.url));
const onVercel = Boolean(process.env.VERCEL);
// No se conecta a servicios externos salvo que se active expresamente.
const usePostgres = process.env.BIOTEST_USE_POSTGRES === "true" && Boolean(process.env.DATABASE_URL);

export const persistenceMode = usePostgres ? "postgresql" : (onVercel ? "demo-memory-temporal" : "pglite-local");
export const localDataDir = (!usePostgres && !onVercel) ? path.resolve(process.env.BIOTEST_DATA_DIR || "./data") : null;
export const seedAdminEmail = (process.env.SEED_ADMIN_EMAIL || "admin@biotest.local").trim().toLowerCase();

let localDb = null;
let rawPostgresPool = null;
let readyPromise = null;

// La base se abre y se inicializa de forma perezosa. Un fallo aquí NO termina el proceso:
// cada solicitud recibe un 503 descriptivo y la siguiente solicitud reintenta.
export function ensureReady() {
  if (!readyPromise) {
    readyPromise = initialize().catch(async error => {
      readyPromise = null;
      await releaseHandles();
      throw error;
    });
  }
  return readyPromise;
}

async function releaseHandles() {
  try { if (rawPostgresPool) await rawPostgresPool.end(); } catch { /* ignorado */ }
  try { if (localDb) await localDb.close(); } catch { /* ignorado */ }
  rawPostgresPool = null;
  localDb = null;
}

async function openDatabase() {
  if (usePostgres) {
    const { default: pg } = await import("pg");
    rawPostgresPool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.PG_POOL_MAX || 5),
      ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: true },
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000
    });
    return;
  }
  const { PGlite } = await import("@electric-sql/pglite");
  if (onVercel) {
    // Demostración: la base vive en memoria de la instancia. Vercel puede reiniciarla o crear
    // instancias independientes, por lo que NO es persistencia.
    localDb = new PGlite();
  } else {
    await fs.mkdir(localDataDir, { recursive: true });
    localDb = new PGlite(localDataDir);
  }
  if (localDb.waitReady) await localDb.waitReady;
}

async function rawQuery(text, params = []) {
  const result = usePostgres ? await rawPostgresPool.query(text, params) : await localDb.query(text, params);
  return {
    rows: result.rows || [],
    rowCount: result.rowCount ?? result.affectedRows ?? result.rows?.length ?? 0
  };
}

export const pool = {
  async query(text, params = []) {
    await ensureReady();
    return rawQuery(text, params);
  },
  async end() {
    readyPromise = null;
    await releaseHandles();
  }
};

export async function query(text, params = []) {
  return pool.query(text, params);
}

export async function transaction(callback) {
  await ensureReady();
  if (rawPostgresPool) {
    const client = await rawPostgresPool.connect();
    try {
      await client.query("BEGIN");
      const result = await callback({ query: async (text, params = []) => {
        const response = await client.query(text, params);
        return { rows: response.rows || [], rowCount: response.rowCount ?? response.rows?.length ?? 0 };
      }});
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
  return localDb.transaction(async tx => callback({ query: async (text, params = []) => {
    const response = await tx.query(text, params);
    return { rows: response.rows || [], rowCount: response.affectedRows ?? response.rows?.length ?? 0 };
  }}));
}

// La auditoría nunca debe convertir en error una operación que ya se completó.
export async function audit({ actorId, action, entityType, entityId = null, details = {}, ip }) {
  try {
    await query(
      `INSERT INTO audit_log (actor_id, action, entity_type, entity_id, details, ip_address)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
      [actorId || null, action, entityType, entityId, JSON.stringify(details), ip || null]
    );
  } catch (error) {
    console.error("BioTest: no se pudo registrar el evento de auditoría:", error.message);
  }
}

async function seedDemoData() {
  if (usePostgres) return;
  if (!(onVercel || process.env.BIOTEST_SEED_DEMO === "true")) return;
  const count = await rawQuery("SELECT COUNT(*)::int AS count FROM patients");
  if (count.rows[0].count > 0) return;
  const admin = await rawQuery("SELECT id FROM users WHERE email=$1", [seedAdminEmail]);
  const createdBy = admin.rows[0]?.id ?? null;
  // Datos completamente ficticios, solo para poder probar la demostración.
  const demo = [
    ["CC", "1000000001", "Ana María", "Demostración Uno", "ana.demo@example.com", "3000000001", "1990-05-12", "Femenino", "Calle 1 # 2-3 (ficticia)"],
    ["CC", "1000000002", "Carlos", "Demostración Dos", "carlos.demo@example.com", "3000000002", "1985-11-03", "Masculino", "Carrera 4 # 5-6 (ficticia)"],
    ["TI", "1000000003", "Lucía", "Demostración Tres", "lucia.demo@example.com", "", "2010-02-20", "Femenino", ""]
  ];
  for (const row of demo) {
    await rawQuery(
      "INSERT INTO patients (document_type,document_number,first_name,last_name,email,phone,birth_date,sex,address,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8,$9,$10)",
      [...row, createdBy]
    );
  }
}

async function initialize() {
  await openDatabase();
  const sql = await fs.readFile(path.join(here, "../db/init.sql"), "utf8");
  if (localDb) await localDb.exec(sql);
  else await rawPostgresPool.query(sql);

  const configuredPassword = process.env.SEED_ADMIN_PASSWORD;
  if (usePostgres && !configuredPassword) {
    throw new Error("Configura SEED_ADMIN_PASSWORD en las variables de entorno antes de desplegar BioTest con DATABASE_URL.");
  }
  const password = configuredPassword || "BioTest-Local-2026!";
  const email = seedAdminEmail;
  const existing = await rawQuery("SELECT id,password_hash,active,role FROM users WHERE email=$1", [email]);
  const hash = await bcrypt.hash(password, onVercel ? 10 : 12);
  if (!existing.rows.length) {
    await rawQuery(
      "INSERT INTO users (full_name,email,password_hash,role,active) VALUES ($1,$2,$3,'admin',TRUE)",
      ["Administrador BioTest", email, hash]
    );
    console.log(`Usuario administrador inicial creado: ${email}`);
  } else if (!usePostgres) {
    // En el modo local/demo se repara la cuenta inicial si quedó con otra contraseña o inactiva.
    const localAdmin = existing.rows[0];
    const passwordMatches = await bcrypt.compare(password, localAdmin.password_hash || "");
    if (!passwordMatches || !localAdmin.active || localAdmin.role !== "admin") {
      await rawQuery("UPDATE users SET password_hash=$1,active=TRUE,role='admin' WHERE id=$2", [hash, localAdmin.id]);
      console.log(`Acceso inicial reparado para: ${email}`);
    }
  }
  await seedDemoData();
  if (!usePostgres && !onVercel) {
    console.log("===============================================");
    console.log("BioTest — acceso inicial local");
    console.log(`Correo: ${email}`);
    console.log(`Contraseña: ${password}`);
    console.log("===============================================");
  }
}

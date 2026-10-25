// Resolución del secreto de sesión sin exigir configuración manual en la demo.
import fs from "node:fs";
import path from "node:path";
import { createHmac, randomBytes } from "node:crypto";

const PLACEHOLDER = /^replace-with/i;

/**
 * Devuelve { secret, source, strong, error? }.
 *  - env:            SESSION_SECRET válido (>= 32 caracteres). Único modo apto para uso real.
 *  - vercel-derived: demostración en Vercel. Se deriva de identificadores del despliegue que Vercel
 *                    inyecta en todas las instancias, así que la sesión sobrevive al cambio de instancia.
 *                    NO es un secreto confidencial (los identificadores no son secretos): solo para datos ficticios.
 *  - local-file:     ejecución local. Se genera al azar y se guarda en ./data (ignorado por Git).
 *  - random-memory:  último recurso; las sesiones no sobreviven a un reinicio.
 *  - missing:        despliegue con PostgreSQL sin SESSION_SECRET: se informa el error, sin tumbar el proceso.
 */
export function resolveSessionSecret({ env = process.env, dataDir = null, requireStrong = false } = {}) {
  const configured = String(env.SESSION_SECRET || "").trim();
  if (configured.length >= 32 && !PLACEHOLDER.test(configured)) return { secret: configured, source: "env", strong: true };
  if (requireStrong) {
    return { secret: null, source: "missing", strong: false, error: "Falta SESSION_SECRET (mínimo 32 caracteres aleatorios). Configúralo en las variables de entorno del despliegue con PostgreSQL." };
  }
  if (env.VERCEL) {
    const ids = [env.VERCEL_PROJECT_ID, env.VERCEL_DEPLOYMENT_ID, env.VERCEL_GIT_REPO_ID, env.VERCEL_GIT_COMMIT_SHA, env.VERCEL_URL].filter(Boolean);
    if (env.VERCEL_PROJECT_ID || env.VERCEL_DEPLOYMENT_ID || env.VERCEL_URL) {
      const secret = createHmac("sha256", "biotest-demo-session-v1").update(ids.join("|")).digest("hex");
      return { secret, source: "vercel-derived", strong: false };
    }
    return { secret: randomBytes(32).toString("hex"), source: "random-memory", strong: false };
  }
  if (dataDir) {
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      const file = path.join(dataDir, ".session-secret");
      if (fs.existsSync(file)) {
        const saved = fs.readFileSync(file, "utf8").trim();
        if (saved.length >= 32) return { secret: saved, source: "local-file", strong: false };
      }
      const secret = randomBytes(48).toString("hex");
      fs.writeFileSync(file, secret, { mode: 0o600 });
      return { secret, source: "local-file", strong: false };
    } catch { /* se usa el respaldo en memoria */ }
  }
  return { secret: randomBytes(32).toString("hex"), source: "random-memory", strong: false };
}

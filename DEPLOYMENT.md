# Despliegue de demostración en Vercel (sin variables de entorno)

1. Sube el contenido de esta carpeta a la **raíz** de un repositorio de GitHub (`package.json`, `vercel.json`, `src/`, `public/`, `db/` deben verse directamente en la raíz).
2. En Vercel: **Add New → Project**, importa el repositorio y pulsa **Deploy**. No se necesitan variables de entorno.
3. Abre la URL. En la pantalla de acceso pulsa **«Entrar como administrador de demostración»** o escribe `admin@biotest.local` / `BioTest-Local-2026!`.

## Cómo funciona sin configurar nada

- **Sesión**: cookie firmada (HMAC) sin almacenamiento en el servidor. El secreto se deriva de identificadores que Vercel inyecta en todas las instancias de un mismo despliegue, de modo que **la sesión sobrevive al cambio o reinicio de instancia**. Un despliegue nuevo invalida las sesiones anteriores (se pedirá iniciar sesión otra vez, con un mensaje claro).
- **Datos**: base PGlite **en memoria** dentro de cada instancia, con 3 pacientes ficticios de ejemplo.

## Limitaciones (léelas)

- **Los datos NO son persistentes** en Vercel sin base externa: se pierden cuando Vercel reinicia o escala la función, y cada instancia tiene su propia base. En uso normal de una sola persona la instancia suele mantenerse activa varios minutos, pero no está garantizado. Si un registro desaparece, la interfaz lo indica y actualiza la lista.
- La derivación del secreto de sesión **no es un secreto confidencial** (los identificadores de Vercel no lo son). Es aceptable solo porque la demostración usa datos ficticios. Nunca ingreses datos reales de pacientes.
- El límite de intentos de acceso es por instancia.

## Despliegue real (datos persistentes)

Requiere PostgreSQL administrado y estas variables: `BIOTEST_USE_POSTGRES=true`, `DATABASE_URL`, `SEED_ADMIN_PASSWORD`, `SESSION_SECRET` (≥ 32 caracteres aleatorios) y `COOKIE_SECURE=true`. En ese modo el acceso de demostración queda deshabilitado. Si falta algo, la API responde 503 con la explicación y `/api/health` indica la causa (el proceso ya no se cae).

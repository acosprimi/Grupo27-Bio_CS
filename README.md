# BioTest Diagnósticos S.A.S.

Aplicación web de demostración para la gestión operativa de un laboratorio clínico. Incluye interfaz responsive, inicio de sesión, permisos por rol, auditoría y módulos de pacientes, citas, exámenes, órdenes, muestras, resultados, documentos administrativos, cobros y reportes.

## Subir a GitHub y desplegar en Vercel sin configurar variables

Este paquete está preparado para una **demostración académica** que no requiere crear una base de datos externa ni agregar variables de entorno manualmente:

1. Descarga el ZIP y descomprímelo.
2. Sube **el contenido de la carpeta del proyecto** al nivel principal de un repositorio GitHub nuevo. Debes ver `package.json`, `vercel.json`, `src/`, `public/` y `db/` directamente en la raíz del repositorio; no dejes todos esos archivos dentro de una carpeta adicional.
3. En Vercel selecciona **Add New → Project**, importa ese repositorio y pulsa **Deploy**. No necesitas completar variables de entorno para que arranque la versión de demostración.
4. Cuando termine, abre la URL de Vercel.

### Acceso inicial

- Pulsa **«Entrar como administrador de demostración»** en la pantalla de acceso (solo existe en modo demostración), o escribe:
- **Correo:** `admin@biotest.local`
- **Contraseña:** `BioTest-Local-2026!`

## Importante sobre los datos en Vercel

En Vercel la base de datos se inicia **en memoria** para no depender de servicios externos. Los cambios **no son persistentes**: pueden perderse cuando Vercel reinicia la función y cada instancia tiene su propia base. La sesión, en cambio, usa una cookie firmada que sobrevive al cambio de instancia dentro del mismo despliegue (ver `DEPLOYMENT.md`). Úsalo solo como demo académica con datos ficticios; no ingreses información real de pacientes.

En tu computador, en cambio, PGlite guarda los datos en la carpeta `data/` y no requiere PostgreSQL instalado:

1. Instala Node.js 20 o superior.
2. Abre una terminal en la carpeta del proyecto y ejecuta `npm install`.
3. Ejecuta `npm run dev`.
4. Abre `http://localhost:3000`.

En local, los datos se mantienen en el equipo mientras conserves la carpeta `data/`.

## Módulos incluidos

- Panel de indicadores.
- Registro, consulta y edición de pacientes.
- Agenda y citas.
- Catálogo de exámenes.
- Órdenes y trazabilidad de muestras.
- Registro, revisión, validación y publicación de resultados.
- Informes imprimibles.
- Registro de documentos y su asociación a pacientes u órdenes (metadatos, no archivos adjuntos).
- Gestión administrativa de cobros; no conecta pasarelas de pago ni facturación electrónica.
- Reportes, exportación CSV, usuarios, roles y auditoría.

Los intervalos del catálogo inicial son configurables y no sustituyen los rangos de referencia validados por un laboratorio. La aplicación no realiza diagnósticos automáticos.

## Comprobación de sintaxis

```bash
npm run check        # sintaxis
npm run test:unit    # sesiones firmadas y resolución del secreto (sin dependencias externas)
npm run test:e2e     # Playwright contra el servidor real (requiere npm install)
```

Prueba de interfaz sin backend real (servidor simulado + Chromium):

```bash
node tests/frontend/mock-server.mjs &
node tests/frontend/ui-flows.mjs
```

## Uso real o datos persistentes en línea

Este ZIP prioriza que la demo se pueda desplegar sin configuración. Para un sistema real con persistencia, secretos privados, sesiones compartidas, respaldos y controles de privacidad sí hace falta configurar una base de datos y variables de entorno. No uses el modo de demostración para gestionar información clínica real.

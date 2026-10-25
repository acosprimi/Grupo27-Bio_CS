# Registro de correcciones (v2.1.0)

| # | Síntoma | Causa técnica | Corrección |
|---|---------|---------------|------------|
| 1 | «Debes iniciar sesión» / 401 en `/api/dashboard` tras un rato | La sesión vivía en `MemoryStore` de una sola instancia de Vercel; otra instancia no la conocía. Además la base en memoria se recreaba por instancia | Sesión sin estado: cookie firmada (HMAC) validada contra la base en cada solicitud, con renovación deslizante (`src/session.js`, `src/server.js`) |
| 2 | 500 «configura SESSION_SECRET» | `src/server.js` lanzaba una excepción al importarse → el proceso terminaba y TODAS las rutas daban 500 | `src/config.js` resuelve el secreto sin lanzar; en modo real devuelve 503 descriptivo; `/api/health` informa la causa |
| 3 | `/api/auth/local-access` 404 | La ruta respondía 404 a propósito fuera de localhost y el frontend la consultaba siempre | Responde 200 `{available}`; `POST` inicia sesión de demostración solo en modo demostración |
| 4 | «No se pudo cargar la información» | Fallos de inicialización de la base (top-level await), 401/404 por cambio de instancia y respuestas no‑JSON mal interpretadas | Inicialización perezosa con reintento (503 `DB_UNAVAILABLE`), códigos de error (`SESSION_RESET`…), el frontend vuelve al login explicando el motivo y muestra el HTTP real |
| 5 | Consultar/Editar pacientes «no hacen nada» | Los clics no capturaban errores (promesas rechazadas silenciosas) y con otra instancia el paciente no existía (404) / sesión perdida (401); fechas `DATE` podían desfasarse un día | try/catch con mensajes visibles, lista refrescada en 404, `to_char` para fechas, validaciones del servidor en español con nombre de campo |
| 6 | Rutas `/api/...` inexistentes devolvían HTML 200 | `app.get("*")` capturaba todo | 404 JSON para `/api/*` |
| 7 | JSON mal formado → 500 | Manejador de errores genérico | 400 / 413 explícitos |
| 8 | «Citas de hoy» incorrectas por la tarde-noche | `CURRENT_DATE` en UTC vs. día de Bogotá | Se compara con la fecha de Bogotá |
| 9 | No se podía editar una cita ya pasada | Validación de fecha pasada también al editar | Se permite conservar la fecha original |
| 10 | Documentos fallaba para Laboratorista | El formulario pedía `/api/patients` (403 para ese rol) | El formulario omite pacientes para ese rol |
| 11 | Menús de estado de muestra ofrecían transiciones que el servidor rechaza | Opciones no coherentes con las reglas | Solo se ofrecen las transiciones válidas |
| 12 | Filtro «Corregido» en resultados siempre vacío | Estado que nunca se guarda | Opción eliminada |
| 13 | Auditoría fallida convertía operaciones exitosas en 500 | `audit()` lanzaba | `audit()` registra el error sin interrumpir |
| 14 | Al recargar siempre volvía al panel | Sin estado de navegación | El módulo activo se conserva en el hash |

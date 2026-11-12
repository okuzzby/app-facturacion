# YaFact (App de Facturación) — memoria del proyecto

App para monotributistas argentinos: emitir facturas electrónicas de ARCA desde el celular/PC.
Dominio de producción: **yafact.com.ar** (registrado en DonWeb). Zona horaria de negocio: Argentina (UTC-3 fijo, sin horario de verano).

## Mapa del proyecto

Monorepo en `D:\CodeVentmar\App de Facturacion`, rama `main` (GitHub `okuzzby/app-facturacion`). Push a `main` = deploy automático en Render y Vercel.

- `frontend/` — React 18 + Vite + PWA, react-router. Deploy en **Vercel** (`vercel.json`). Variables: `VITE_BACKEND_URL`, claves de Supabase. Build local: `cd frontend && npx vite build`; dev: `npm run dev`.
  - `src/pages/`: Home (inicio), Facturar, Historial, Clientes, Configuracion, Integraciones, MercadoPago, MiFacturacion, Admin, Login, Landing y páginas legales.
  - Login con Google (`supabase.auth.signInWithOAuth`, `redirectTo: window.location.origin`).
- `backend/` — Node/Express (`npm start` = `node server.js`). Deploy en **Render** (servicio `app-facturacion-backend`, plan free 512 MB, Docker con Playwright `v1.49.0-jammy`, `render.yaml` es solo referencia). Sin tests automáticos.
  - `server.js`: todas las rutas HTTP. `arca.js`: scraping Playwright del portal ARCA (login con Clave Fiscal, Monotributo, Mis Comprobantes). `arca-ws.js`/`arca-facturacion.js`/`arca-padron.js`/`ws-flow.js`/`crypto-ws.js`: emisión por WSFEv1 con certificado digital del usuario. `arca-setup.js`: alta del certificado/web service automatizando el portal. `pdf-factura.js`, `mp.js`/`mp-pro.js` (Mercado Pago y suscripción Pro), `validaciones.js`.
  - CORS: variable `CORS_ORIGINS` (+ `*.vercel.app` y localhost). Hay un fallback hardcodeado a `app-facturacion-inky.vercel.app` en `/pro/suscribir` (pendiente de limpiar).
- Dos mecanismos de ARCA distintos, no confundir:
  - **Facturar** = WSFEv1 con certificado (no usa Clave Fiscal, no pasa por captcha). Funciona.
  - **Scraping del portal** = login con Clave Fiscal vía Playwright. ARCA le pide captcha de imagen → no funciona de forma fiable (ver Pendientes).

### Credenciales y acceso para diagnóstico
- `.env` en la raíz (ignorado por git) con `SUPABASE_URL`, `SUPABASE_ACCESS_TOKEN`, `URL_RENDER`, `RENDER_API_KEY`. Nunca copiar sus valores a archivos, commits ni respuestas.
- **Logs de Render por API** (no hay MCP de Render): `GET https://api.render.com/v1/logs` con `resource=srv-da317kojo6nc73akqv30`, `ownerId=tea-da2cbabm8hqs73ejaj10`, `startTime`/`endTime` recientes y `direction=backward`. Deploys: `/v1/services/<id>/deploys`. Métricas: `/v1/metrics/memory`. En Git Bash no hay python: parsear JSON con node y un archivo temporal local (borrarlo).
- Supabase MCP conectado (proyecto `doqwjjmgaguxzlpghmoe`). La service_role se obtiene con la Management API (`api.supabase.com/v1/projects/<ref>/api-keys?reveal=true`); sirve para bajar capturas de Storage sin imprimirla.
- Supabase Auth: tras cambiar de dominio hay que mantener **Site URL** y **Redirect URLs** con yafact.com.ar (si no, el login redirige al dominio viejo).

## Base de datos (Supabase Postgres, todas con RLS)
Tablas en `public`: `perfiles`, `credenciales_arca`, `productos_configurados`, `facturas_emitidas`, `wsaa_cache`, `mp_cuentas`, `mp_cobros`, `suscripciones`, `facturacion_resumen`, `clientes`.
- `facturas_emitidas`: usada en Home para "Facturado este mes" (`created_at`, `tipo`, `importe_total`, `estado`; cuenta solo `estado='emitida'` y excluye notas de crédito).
- `credenciales_arca`: CUIT, Clave Fiscal cifrada (se lee con la RPC `get_credencial_arca_interna`), `activa`, `ws_setup_estado`.
- `facturacion_resumen`: PK `user_id`; columnas `categoria, tope, total_12m, aproximado, comprobantes, puntos, calculado_at, mensual (jsonb)`. RLS sin políticas: solo el backend (service role) la lee/escribe. Hoy sin filas útiles.
- Storage: bucket privado `facturas` (PDFs; capturas de diagnóstico en `debug/`).

## Decisiones y detalles que costó averiguar
- "Facturado este mes con la App" (Home.jsx): consulta `facturas_emitidas` con `created_at >= primerDiaMesAR()` (día 1 a las 00:00 -03:00), sin límite; se reinicia solo al cambiar de mes. La lista "Últimas facturas" usa `limit(20)` aparte.
- En React, `onClick={fn}` pasa el evento como primer argumento: usar `onClick={() => fn()}` cuando `fn` tiene parámetros.
- `supabase-js` `upsert` usa la PK por defecto; en `facturacion_resumen` se pasa `onConflict: 'user_id'`.
- `loginEnArca` (arca.js) no valida por sí mismo que el login haya entrado; `facturacionAnualCompleta` ahora chequea la URL tras el login y detecta el captcha. `irAlPortal()` espera a que ARCA llegue sola a `portalcf` en vez de saltar por URL (saltar corta el SSO).
- Facturación anual hace UN solo login a ARCA para leer Monotributo + Mis Comprobantes.

## Pendientes
- **"Tu facturación anual" DESHABILITADA para todos (2026-11-12).** Causa: ARCA muestra un captcha de imagen al login automático desde Render (`loginCaptchaAfip.xhtml`); confirmado con captura en el usuario maicolnhayperez@gmail.com, intermitente en albertzuk15a@gmail.com. Decisión: no resolver ni esquivar el captcha.
  - Cómo está apagada: `FACT_ANUAL_ACTIVA = false` en `frontend/src/pages/Home.jsx` (oculta la card, no carga ni auto-refresca) y `POST /arca/facturacion-anual` devuelve 503 salvo que en Render exista `FACT_ANUAL_ACTIVA=true`. La página `/facturacion` (MiFacturacion) queda sin entrada.
  - Ideas para retomar: calcular el anual con `facturas_emitidas` de los últimos 12 meses (aproximado, no incluye lo facturado fuera de la app), idealmente como respaldo cuando ARCA pida captcha.
- Limpiar el fallback hardcodeado `app-facturacion-inky.vercel.app` en `server.js` (`/pro/suscribir`).
- README y `.env.example` hablan de `FRONTEND_ORIGIN`, pero el código lee `CORS_ORIGINS`: unificar.
- Confirmar que Render tiene `CORS_ORIGINS` con yafact.com.ar.
- Opcional: reintento automático del scraping para el fallo intermitente de Alberto (si se reactiva).

## Notas del agente
- Contestar en español rioplatense, directo. Pedir OK antes de hacer push a `main` (cada push es un deploy a producción); el usuario suele responder "sube todo".
- Si necesita ver Render o Supabase, usar el `.env` y las consultas directas; el usuario se molesta si lo mando a otras interfaces o a copiar logs a mano.
- Commits con la línea `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. No commitear `.env` ni `.codeventmar-mcp.json`.
- Memoria adicional del agente en `C:\Users\OkuZz\.claude\projects\D--CodeVentmar-App-de-Facturacion\memory\`.

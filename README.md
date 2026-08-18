# app-facturacion

App simple de facturación para monotributistas en Argentina, con conexión a ARCA (ex-AFIP) vía automatización del portal (Clave Fiscal Nivel 3).

Proyecto separado de MerkaSoft. Monorepo con dos partes:

- `frontend/` — React + Vite. Interfaz de usuario. Se despliega en Vercel. Habla solo con el backend, nunca con ARCA directamente.
- `backend/` — Node.js + Express (y Playwright a partir de la Fase 3). Corre la automatización contra ARCA. Se despliega en Render.

Base de datos y autenticación: Supabase (Postgres + Auth + RLS) — proyecto `app-facturacion`.

## Estado

Fase 0 — esqueleto inicial desplegable. Sin lógica de facturación todavía.

## Arquitectura

```
Usuario -> Frontend (Vercel) -> Backend (Render) -> ARCA (portal web)
                  |
                  v
            Supabase (Auth + datos por usuario con RLS)
```

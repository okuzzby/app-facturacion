# app-facturacion (YaFact)

App de facturación para monotributistas en Argentina, con emisión real de
comprobantes electrónicos (Factura C / Nota de Crédito C) contra **ARCA**
(ex-AFIP) por Web Service (WSFEv1), más integración con Mercado Pago.

Proyecto separado de MerkaSoft. Monorepo con dos partes:

- `frontend/` — React + Vite. Interfaz de usuario. Se despliega en Vercel.
  Habla solo con el backend, nunca con ARCA directamente.
- `backend/` — Node.js + Express. Corre la emisión fiscal (WSFEv1 vía
  `facturajs`), la generación de PDF, la integración con Mercado Pago y el
  onboarding automático del certificado del usuario. Se despliega en Render
  (`autoDeploy: true` — cada push a `main` lo redespliega).

Base de datos y autenticación: Supabase (Postgres + Auth + RLS) — proyecto
`app-facturacion`.

## Estado actual

Emisión real en producción, no es un esqueleto. Funcionalidades implementadas:

- **Emisión de Factura C y Nota de Crédito C** por WSFEv1 (`backend/arca-ws.js`,
  `backend/ws-flow.js`), con generación de PDF propio y guardado en
  `facturas_emitidas` (Supabase Storage + tabla).
- **Onboarding automático de ARCA**: creación y autorización del certificado
  del usuario, detección del punto de venta Web Service
  (`backend/arca-setup.js`).
- **Clientes**: alta/edición de clientes guardados con CUIT (validado por
  dígito verificador) y búsqueda de datos en el padrón de ARCA. También se
  puede facturar a un cliente cargado al vuelo sin guardarlo, con opción de
  agregarlo a la lista recién después de emitir la factura.
- **Historial** de comprobantes, con replicar factura y descarga de
  duplicado electrónico (ZIP formato ARCA).
- **Mercado Pago**: conexión de cuenta, lectura de cobros y facturación de
  los mismos (`backend/mp.js`, `backend/mp-pro.js`, plan Pro).
- **Seguimiento del tope de categoría de monotributo**: gráfico de
  facturación anual (últimos 12 meses, leído directo de ARCA) y recordatorio
  de vencimiento de cuota.
- **Panel de administración** (`frontend/src/pages/Admin.jsx`) para cuentas
  autorizadas por `ADMIN_EMAILS`.

### Pendiente / a revisar

- Hay rutas de diagnóstico temporales en `backend/server.js` (`ws-spike`,
  `setup-inspeccionar`, `setup-relaciones`, `setup-crear-cert`) protegidas por
  `SPIKE_SECRET`, resabios de las pruebas de homologación — candidatas a
  limpiar cuando se confirme que no se usan más.
- `backend/arca.js` contiene el flujo viejo por automatización del portal
  (Playwright/RPA); el flujo vigente para emitir es el de WSFEv1
  (`arca-ws.js` / `ws-flow.js`).

## Arquitectura

```
Usuario -> Frontend (Vercel) -> Backend (Render) -> ARCA (WSFEv1) / Mercado Pago
                  |
                  v
            Supabase (Auth + datos por usuario con RLS)
```

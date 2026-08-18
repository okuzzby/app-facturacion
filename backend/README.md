# Backend — app-facturacion

Servicio Node.js + Express. En la Fase 0 solo expone `/health`.

## Local

```
cd backend
npm install
npm start
```

## Despliegue en Render

- Runtime: Node
- Build command: `npm install`
- Start command: `npm start`
- Root directory: `backend`

## Nota sobre Playwright (Fase 3)

La automatización de ARCA con Playwright necesita Chromium con sus dependencias
de sistema. En Render eso suele requerir un servicio basado en Docker (imagen
`mcr.microsoft.com/playwright`), que se configura desde el dashboard de Render.
Se decide y arma al llegar a la Fase 3.

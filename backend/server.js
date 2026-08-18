import express from 'express'
import cors from 'cors'

const app = express()
app.use(cors())
app.use(express.json())

// Health check — usado por el frontend y por Render para verificar que el
// servicio está vivo.
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'app-facturacion-backend', phase: 0 })
})

app.get('/', (req, res) => {
  res.send('app-facturacion backend — Fase 0. Ver /health')
})

// Los endpoints de facturación (/facturar, /anular, /historial) contra ARCA
// se agregan en las Fases 3 a 5, junto con Playwright.

const port = process.env.PORT || 3000
app.listen(port, () => {
  console.log(`Backend escuchando en puerto ${port}`)
})

import express from 'express'
import cors from 'cors'
import { chromium } from 'playwright'

const app = express()
app.use(cors())
app.use(express.json())

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'app-facturacion-backend', phase: '3A' })
})

// Verificación de Playwright: abre Chromium, entra a una página simple y
// devuelve el título. Sirve para confirmar que el navegador corre en Render.
app.get('/playwright-test', async (req, res) => {
  let browser
  try {
    browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] })
    const page = await browser.newPage()
    await page.goto('https://example.com', { waitUntil: 'domcontentloaded', timeout: 30000 })
    const title = await page.title()
    res.json({ ok: true, chromium: 'funciona', titulo: title })
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) })
  } finally {
    if (browser) await browser.close()
  }
})

app.get('/', (req, res) => {
  res.send('app-facturacion backend (Docker + Playwright). Ver /health y /playwright-test')
})

// Los endpoints de ARCA (/verificar-arca, /facturar) se agregan en 3B–3F.

const port = process.env.PORT || 3000
app.listen(port, () => {
  console.log(`Backend escuchando en puerto ${port}`)
})

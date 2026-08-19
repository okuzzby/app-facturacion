import express from 'express'
import cors from 'cors'
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'

const app = express()
app.use(cors())
app.use(express.json())

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

// Cliente para validar el token del usuario (clave pública)
const supabaseAuth =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } })
    : null

// Cliente con permisos de servicio (lee la credencial descifrada de Vault)
const supabaseAdmin =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
    : null

// Middleware: valida el token de Supabase y adjunta req.user
async function requireAuth(req, res, next) {
  if (!supabaseAuth) {
    return res.status(500).json({ error: 'Backend sin SUPABASE_URL / SUPABASE_ANON_KEY' })
  }
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Falta el token de sesión' })

  const { data, error } = await supabaseAuth.auth.getUser(token)
  if (error || !data?.user) {
    return res.status(401).json({ error: 'Token inválido o expirado' })
  }
  req.user = data.user
  next()
}

// ---------------- Endpoints públicos ----------------
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'app-facturacion-backend', phase: '3B' })
})

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

// ---------------- Endpoint protegido ----------------
// Verifica el puente: identifica al usuario por su token y confirma que el
// backend puede leer su credencial ARCA (sin devolver la clave).
app.get('/verificar-credencial', requireAuth, async (req, res) => {
  if (!supabaseAdmin) {
    return res.status(500).json({ error: 'Backend sin SUPABASE_SERVICE_ROLE_KEY' })
  }
  const { data, error } = await supabaseAdmin.rpc('get_credencial_arca_interna', {
    p_user: req.user.id,
  })
  if (error) return res.status(500).json({ error: error.message })

  const cred = Array.isArray(data) ? data[0] : data
  if (!cred) return res.json({ tiene_credencial: false })

  // Nunca devolvemos la clave: solo confirmamos que se pudo leer/descifrar.
  res.json({
    tiene_credencial: true,
    cuit: cred.cuit,
    clave_descifrada_ok: Boolean(cred.clave && cred.clave.length > 0),
  })
})

app.get('/', (req, res) => {
  res.send('app-facturacion backend (Docker + Playwright + Supabase). Ver /health')
})

const port = process.env.PORT || 3000
app.listen(port, () => {
  console.log(`Backend escuchando en puerto ${port}`)
})

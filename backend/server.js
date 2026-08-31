import express from 'express'
import cors from 'cors'
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import {
  probarLoginArca,
  listarEmpresasArca,
  abrirFormularioFactura,
  leerOpcionesComprobante,
  inspeccionarFactura,
  generarFactura,
  inspeccionarNotaCredito,
} from './arca.js'
import { emitirSpike } from './ws-spike.js' // TEMPORAL Fase 0
import { emitirFacturaFlow, anularFlow, puntosVentaFlow } from './ws-flow.js'
import { puntosVentaWS } from './arca-ws.js'
import {
  inspeccionarWSASS,
  crearCertificado,
  inspeccionarRelaciones,
  configurarWsfe,
  inspeccionarPuntosVenta,
  crearPuntoVentaWS,
} from './arca-setup.js'
import { cifrar } from './crypto-ws.js'
import {
  mpConfigurado,
  firmarState,
  verificarState,
  urlAutorizacion,
  intercambiarCodigo,
  guardarConexion,
  accessTokenValido,
  buscarPagos,
  buscarPagosTodos,
  obtenerPago,
  obtenerUsuario,
  guardarCobrosNuevos,
} from './mp.js'

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
  res.json({ status: 'ok', service: 'app-facturacion-backend', phase: '3C' })
})

// TEMPORAL — Fase 0/2: prueba de emisión por Web Service en HOMOLOGACIÓN.
// Protegido con SPIKE_SECRET. Se elimina cuando termine el spike.
// Montado en dos rutas (una de nivel superior para poder alcanzarlo).
async function handlerSpike(req, res) {
  if (!process.env.SPIKE_SECRET || req.query.key !== process.env.SPIKE_SECRET) {
    return res.status(403).json({ error: 'no autorizado' })
  }
  try {
    const out = await emitirSpike(req.query)
    console.log('[WSTEST]', JSON.stringify(out))
    res.json(out)
  } catch (e) {
    console.log('[WSTEST-ERR]', String((e && e.message) || e))
    res.status(500).json({ error: String((e && e.message) || e), stack: (e && e.stack) || null })
  }
}
app.get('/arca/ws-spike', handlerSpike)
app.get('/wscheck', handlerSpike)

// --- Emisión por Web Service (flujo real: emite + PDF + Storage + base) ---
app.post('/arca/ws/factura-generar', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(500).json({ error: 'Backend sin SUPABASE_SERVICE_ROLE_KEY' })
  try {
    const out = await emitirFacturaFlow({ supabaseAdmin, userId: req.user.id, body: req.body || {} })
    res.json(out)
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) })
  }
})

// --- Onboarding automático (Opción A): inspección de WSASS/certificados ---
app.post('/arca/setup-inspeccionar', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(500).json({ error: 'Backend sin SUPABASE_SERVICE_ROLE_KEY' })
  const { data, error } = await supabaseAdmin.rpc('get_credencial_arca_interna', { p_user: req.user.id })
  if (error) return res.status(500).json({ error: error.message })
  const cred = Array.isArray(data) ? data[0] : data
  if (!cred) return res.status(400).json({ error: 'No tenés una credencial ARCA cargada' })
  try {
    const out = await inspeccionarWSASS(cred.cuit, cred.clave, req.query.t || 'Certificados')
    res.json(out)
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) })
  }
})

// TEMPORAL — inspección del Administrador de Relaciones (para autorizar wsfe).
app.post('/arca/setup-relaciones', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(500).json({ error: 'Backend sin SUPABASE_SERVICE_ROLE_KEY' })
  const { data, error } = await supabaseAdmin.rpc('get_credencial_arca_interna', { p_user: req.user.id })
  if (error) return res.status(500).json({ error: error.message })
  const cred = Array.isArray(data) ? data[0] : data
  if (!cred) return res.status(400).json({ error: 'No tenés una credencial ARCA cargada' })
  try {
    const out = await inspeccionarRelaciones(cred.cuit, cred.clave)
    res.json(out)
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) })
  }
})

// TEMPORAL — crea un certificado de prueba (no devuelve la clave privada).
app.post('/arca/setup-crear-cert', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(500).json({ error: 'Backend sin SUPABASE_SERVICE_ROLE_KEY' })
  const { data, error } = await supabaseAdmin.rpc('get_credencial_arca_interna', { p_user: req.user.id })
  if (error) return res.status(500).json({ error: error.message })
  const cred = Array.isArray(data) ? data[0] : data
  if (!cred) return res.status(400).json({ error: 'No tenés una credencial ARCA cargada' })
  try {
    const aliasAuto = 'app' + String(Date.now()).slice(-8)
    const out = await crearCertificado(cred.cuit, cred.clave, req.query.alias || aliasAuto)
    const { privateKeyPem, ...safe } = out // no exponemos la clave privada al frontend
    res.json(safe)
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) })
  }
})

// Onboarding wsfe (REAL): crea un certificado nuevo para el CUIT del usuario, lo
// autoriza al web service wsfe y guarda cert + clave privada CIFRADA + alias en
// su fila de credenciales_arca. Nunca devuelve la clave privada al frontend.
app.post('/arca/setup-wsfe', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(500).json({ error: 'Backend sin SUPABASE_SERVICE_ROLE_KEY' })
  const { data, error } = await supabaseAdmin.rpc('get_credencial_arca_interna', { p_user: req.user.id })
  if (error) return res.status(500).json({ error: error.message })
  const cred = Array.isArray(data) ? data[0] : data
  if (!cred) return res.status(400).json({ error: 'No tenés una credencial ARCA cargada' })
  try {
    const out = await configurarWsfe(cred.cuit, cred.clave, req.query.alias || null)

    // Si se creó y capturó el certificado, lo guardamos (clave privada cifrada).
    if (out.certPem && out.privateKeyPem) {
      try {
        const keyEnc = cifrar(out.privateKeyPem)
        const { error: upErr } = await supabaseAdmin
          .from('credenciales_arca')
          .update({
            ws_cert_pem: out.certPem,
            ws_cert_key_enc: keyEnc,
            ws_cert_alias: out.alias,
          })
          .eq('user_id', req.user.id)
        out.guardado = !upErr
        if (upErr) out.guardadoError = upErr.message
      } catch (e) {
        out.guardado = false
        out.guardadoError = String((e && e.message) || e)
      }
    } else {
      out.guardado = false
    }

    // Auto-detectar el punto de venta de Web Service y setearlo (mejor esfuerzo).
    // Los PV de "Comprobantes en línea" no sirven por WS; acá tomamos el primero
    // habilitado (no bloqueado, sin baja) que reporta FEParamGetPtosVenta.
    if (out.autorizado && out.certPem && out.privateKeyPem) {
      try {
        const pv = await puntosVentaWS({
          cuit: cred.cuit,
          certPem: out.certPem,
          keyPem: out.privateKeyPem,
        })
        const habil = (pv.puntos || []).filter(
          (p) =>
            String(p.Bloqueado).toUpperCase() !== 'S' &&
            (p.FchBaja == null || String(p.FchBaja).toUpperCase() === 'NULL')
        )
        out.puntosVentaWS = habil.map((p) => ({ nro: p.Nro, tipo: p.EmisionTipo }))
        if (habil.length > 0) {
          const nro = String(habil[0].Nro)
          const { error: pvErr } = await supabaseAdmin
            .from('credenciales_arca')
            .update({ punto_venta_ws: nro })
            .eq('user_id', req.user.id)
          out.puntoVentaWsSeteado = pvErr ? null : nro
          if (pvErr) out.puntoVentaWsError = pvErr.message
        } else {
          out.puntoVentaWsSeteado = null
          out.faltaPuntoVentaWS = true
        }
      } catch (e) {
        // Un cert recién autorizado puede tardar en propagar: no rompemos el setup.
        out.puntoVentaWsError = String((e && e.message) || e)
      }
    }

    // Nunca exponemos la clave privada (ni el blob cifrado) al frontend.
    const { privateKeyPem, ...safe } = out
    res.json(safe)
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) })
  }
})

// --- Onboarding automático wsfe en SEGUNDO PLANO ---
// El usuario solo guarda su credencial; esto crea el cert, lo autoriza al wsfe,
// lo guarda cifrado y detecta/usa el punto de venta — todo por detrás. El avance
// se escribe en credenciales_arca (ws_setup_*) y el frontend lo lee en vivo.
const ESTADOS_EN_PROGRESO = [
  'iniciando',
  'creando_cert',
  'autorizando',
  'guardando',
  'detectando_pv',
  'creando_pv',
]

async function marcarSetup(userId, estado, paso, error) {
  try {
    await supabaseAdmin
      .from('credenciales_arca')
      .update({
        ws_setup_estado: estado,
        ws_setup_paso: paso || null,
        ws_setup_error: error || null,
        ws_setup_updated: new Date().toISOString(),
      })
      .eq('user_id', userId)
  } catch (e) {
    console.log('[SETUP] no se pudo marcar estado:', String((e && e.message) || e))
  }
}

async function correrOnboardingWsfe(userId, cuit, clave) {
  try {
    const out = await configurarWsfe(cuit, clave, null, (estado, paso) =>
      marcarSetup(userId, estado, paso)
    )
    if (!out || !out.certPem || !out.privateKeyPem) {
      await marcarSetup(userId, 'error', null, (out && out.error) || 'No se pudo crear el certificado')
      return
    }

    // Guardar el certificado (clave privada cifrada).
    await marcarSetup(userId, 'guardando', 'Guardando tu certificado de forma segura…')
    const keyEnc = cifrar(out.privateKeyPem)
    await supabaseAdmin
      .from('credenciales_arca')
      .update({ ws_cert_pem: out.certPem, ws_cert_key_enc: keyEnc, ws_cert_alias: out.alias })
      .eq('user_id', userId)

    if (!out.autorizado) {
      await marcarSetup(userId, 'error', null, 'No se pudo confirmar la autorización del certificado en ARCA')
      return
    }

    // Detectar el punto de venta de Web Service (mejor esfuerzo).
    await marcarSetup(userId, 'detectando_pv', 'Buscando tu punto de venta…')
    let pvSeteado = null
    try {
      const pv = await puntosVentaWS({ cuit, certPem: out.certPem, keyPem: out.privateKeyPem })
      const habil = (pv.puntos || []).filter(
        (p) =>
          String(p.Bloqueado).toUpperCase() !== 'S' &&
          (p.FchBaja == null || String(p.FchBaja).toUpperCase() === 'NULL')
      )
      if (habil.length > 0) {
        pvSeteado = String(habil[0].Nro)
        await supabaseAdmin
          .from('credenciales_arca')
          .update({ punto_venta_ws: pvSeteado })
          .eq('user_id', userId)
      }
    } catch (e) {
      // Un cert recién autorizado puede tardar en propagar; no rompemos el setup.
      console.log('[SETUP] detectar PV falló:', String((e && e.message) || e))
    }

    // Si no tiene ningún punto de venta WS, se lo creamos automáticamente.
    if (!pvSeteado) {
      await marcarSetup(userId, 'creando_pv', 'Creando tu punto de venta…')
      try {
        const cre = await crearPuntoVentaWS(cuit, clave, { dryRun: false, nombre: 'Ventas' })
        if (cre && cre.creado && cre.numero != null) {
          pvSeteado = String(cre.numero)
          await supabaseAdmin
            .from('credenciales_arca')
            .update({ punto_venta_ws: pvSeteado })
            .eq('user_id', userId)
        } else {
          console.log('[SETUP] crear PV no confirmado:', JSON.stringify(cre?.diag || cre?.error || {}))
        }
      } catch (e) {
        console.log('[SETUP] crear PV falló:', String((e && e.message) || e))
      }
    }

    if (pvSeteado) {
      await marcarSetup(userId, 'listo', 'Todo listo para facturar ✓')
    } else {
      await marcarSetup(userId, 'falta_pv', 'No pudimos habilitar un punto de venta automáticamente')
    }
  } catch (e) {
    await marcarSetup(userId, 'error', null, String((e && e.message) || e))
  }
}

app.post('/arca/setup-wsfe-async', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(500).json({ error: 'Backend sin SUPABASE_SERVICE_ROLE_KEY' })
  const { data, error } = await supabaseAdmin.rpc('get_credencial_arca_interna', { p_user: req.user.id })
  if (error) return res.status(500).json({ error: error.message })
  const cred = Array.isArray(data) ? data[0] : data
  if (!cred) return res.status(400).json({ error: 'No tenés una credencial ARCA cargada' })

  // Evitar dispararlo dos veces si ya está corriendo (salvo ?force=1).
  const { data: row } = await supabaseAdmin
    .from('credenciales_arca')
    .select('ws_setup_estado, ws_setup_updated')
    .eq('user_id', req.user.id)
    .maybeSingle()
  const enProgreso = row && ESTADOS_EN_PROGRESO.includes(row.ws_setup_estado)
  const reciente =
    row?.ws_setup_updated && Date.now() - new Date(row.ws_setup_updated).getTime() < 6 * 60 * 1000
  if (enProgreso && reciente && req.query.force !== '1') {
    return res.json({ ok: true, yaEnProgreso: true })
  }

  await marcarSetup(req.user.id, 'iniciando', 'Iniciando configuración…')
  // Fire-and-forget: no await, corre en segundo plano.
  correrOnboardingWsfe(req.user.id, cred.cuit, cred.clave)
  res.json({ ok: true, iniciado: true })
})

// TEMPORAL — crear punto de venta WS. Por defecto DRY-RUN (no guarda); con
// ?real=1 completa y aprieta Aceptar (crea el punto de venta de verdad).
app.post('/arca/setup-crear-pv', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(500).json({ error: 'Backend sin SUPABASE_SERVICE_ROLE_KEY' })
  const { data, error } = await supabaseAdmin.rpc('get_credencial_arca_interna', { p_user: req.user.id })
  if (error) return res.status(500).json({ error: error.message })
  const cred = Array.isArray(data) ? data[0] : data
  if (!cred) return res.status(400).json({ error: 'No tenés una credencial ARCA cargada' })
  try {
    const dryRun = req.query.real !== '1'
    const out = await crearPuntoVentaWS(cred.cuit, cred.clave, { dryRun })
    res.json(out)
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) })
  }
})

// TEMPORAL — inspección del ABM de Puntos de Venta (para el alta automática).
app.post('/arca/setup-puntos-venta-inspect', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(500).json({ error: 'Backend sin SUPABASE_SERVICE_ROLE_KEY' })
  const { data, error } = await supabaseAdmin.rpc('get_credencial_arca_interna', { p_user: req.user.id })
  if (error) return res.status(500).json({ error: error.message })
  const cred = Array.isArray(data) ? data[0] : data
  if (!cred) return res.status(400).json({ error: 'No tenés una credencial ARCA cargada' })
  try {
    const out = await inspeccionarPuntosVenta(cred.cuit, cred.clave, req.query.t || undefined)
    res.json(out)
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) })
  }
})

// Diagnóstico WS: lista los puntos de venta habilitados para Web Service.
app.post('/arca/ws/puntos-venta', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(500).json({ error: 'Backend sin SUPABASE_SERVICE_ROLE_KEY' })
  try {
    const out = await puntosVentaFlow({ supabaseAdmin, userId: req.user.id })
    res.json(out)
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) })
  }
})

app.post('/arca/ws/anular', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(500).json({ error: 'Backend sin SUPABASE_SERVICE_ROLE_KEY' })
  const facturaId = req.body?.facturaId
  if (!facturaId) return res.status(400).json({ error: 'Falta facturaId' })
  try {
    const out = await anularFlow({ supabaseAdmin, userId: req.user.id, facturaId })
    res.json(out)
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) })
  }
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

// Prueba de login a ARCA (3C). Lee la credencial del usuario, se loguea y
// devuelve una captura. No emite ni modifica comprobantes.
app.post('/arca/login-test', requireAuth, async (req, res) => {
  if (!supabaseAdmin) {
    return res.status(500).json({ error: 'Backend sin SUPABASE_SERVICE_ROLE_KEY' })
  }
  const { data, error } = await supabaseAdmin.rpc('get_credencial_arca_interna', {
    p_user: req.user.id,
  })
  if (error) return res.status(500).json({ error: error.message })

  const cred = Array.isArray(data) ? data[0] : data
  if (!cred) return res.status(400).json({ error: 'No tenés una credencial ARCA cargada' })

  const resultado = await probarLoginArca(cred.cuit, cred.clave)
  res.json(resultado)
})

// Detecta las empresas (representados) del usuario en RCEL. No emite nada.
app.post('/arca/empresas', requireAuth, async (req, res) => {
  if (!supabaseAdmin) {
    return res.status(500).json({ error: 'Backend sin SUPABASE_SERVICE_ROLE_KEY' })
  }
  const { data, error } = await supabaseAdmin.rpc('get_credencial_arca_interna', {
    p_user: req.user.id,
  })
  if (error) return res.status(500).json({ error: error.message })
  const cred = Array.isArray(data) ? data[0] : data
  if (!cred) return res.status(400).json({ error: 'No tenés una credencial ARCA cargada' })

  const resultado = await listarEmpresasArca(cred.cuit, cred.clave)
  res.json(resultado)
})

// Abre el formulario de factura hasta el paso 1 (sin emitir). Devuelve captura.
app.post('/arca/factura-preview', requireAuth, async (req, res) => {
  if (!supabaseAdmin) {
    return res.status(500).json({ error: 'Backend sin SUPABASE_SERVICE_ROLE_KEY' })
  }
  const { data, error } = await supabaseAdmin.rpc('get_credencial_arca_interna', {
    p_user: req.user.id,
  })
  if (error) return res.status(500).json({ error: error.message })
  const cred = Array.isArray(data) ? data[0] : data
  if (!cred) return res.status(400).json({ error: 'No tenés una credencial ARCA cargada' })

  const { data: row } = await supabaseAdmin
    .from('credenciales_arca')
    .select('empresa_representada')
    .eq('user_id', req.user.id)
    .maybeSingle()
  const empresa = row?.empresa_representada
  if (!empresa) {
    return res.status(400).json({ error: 'No elegiste una empresa a representar' })
  }

  const resultado = await abrirFormularioFactura(cred.cuit, cred.clave, empresa)
  res.json(resultado)
})

// Lee los puntos de venta y tipos de comprobante disponibles. No emite nada.
app.post('/arca/opciones-comprobante', requireAuth, async (req, res) => {
  if (!supabaseAdmin) {
    return res.status(500).json({ error: 'Backend sin SUPABASE_SERVICE_ROLE_KEY' })
  }
  const { data, error } = await supabaseAdmin.rpc('get_credencial_arca_interna', {
    p_user: req.user.id,
  })
  if (error) return res.status(500).json({ error: error.message })
  const cred = Array.isArray(data) ? data[0] : data
  if (!cred) return res.status(400).json({ error: 'No tenés una credencial ARCA cargada' })

  const { data: row } = await supabaseAdmin
    .from('credenciales_arca')
    .select('empresa_representada')
    .eq('user_id', req.user.id)
    .maybeSingle()
  const empresa = row?.empresa_representada
  if (!empresa) {
    return res.status(400).json({ error: 'No elegiste una empresa a representar' })
  }

  const resultado = await leerOpcionesComprobante(cred.cuit, cred.clave, empresa)
  res.json(resultado)
})

// Inspección del formulario hasta el paso 3 (para armar el llenado). No emite.
app.post('/arca/inspeccionar-factura', requireAuth, async (req, res) => {
  if (!supabaseAdmin) {
    return res.status(500).json({ error: 'Backend sin SUPABASE_SERVICE_ROLE_KEY' })
  }
  const { data, error } = await supabaseAdmin.rpc('get_credencial_arca_interna', {
    p_user: req.user.id,
  })
  if (error) return res.status(500).json({ error: error.message })
  const cred = Array.isArray(data) ? data[0] : data
  if (!cred) return res.status(400).json({ error: 'No tenés una credencial ARCA cargada' })

  const { data: row } = await supabaseAdmin
    .from('credenciales_arca')
    .select('empresa_representada, punto_venta, tipo_comprobante')
    .eq('user_id', req.user.id)
    .maybeSingle()
  if (!row?.empresa_representada) {
    return res.status(400).json({ error: 'No elegiste una empresa a representar' })
  }

  const resultado = await inspeccionarFactura(
    cred.cuit,
    cred.clave,
    row.empresa_representada,
    row.punto_venta,
    row.tipo_comprobante
  )
  res.json(resultado)
})

// Anula una factura emitiendo una Nota de Crédito C asociada. EMITE de verdad.
app.post('/arca/anular', requireAuth, async (req, res) => {
  if (!supabaseAdmin) {
    return res.status(500).json({ error: 'Backend sin SUPABASE_SERVICE_ROLE_KEY' })
  }
  const facturaId = req.body?.facturaId
  if (!facturaId) return res.status(400).json({ error: 'Falta facturaId' })

  // Credencial + empresa/PV
  const { data: credData, error: credErr } = await supabaseAdmin.rpc(
    'get_credencial_arca_interna',
    { p_user: req.user.id }
  )
  if (credErr) return res.status(500).json({ error: credErr.message })
  const cred = Array.isArray(credData) ? credData[0] : credData
  if (!cred) return res.status(400).json({ error: 'No tenés una credencial ARCA cargada' })

  const { data: crow } = await supabaseAdmin
    .from('credenciales_arca')
    .select('empresa_representada, punto_venta')
    .eq('user_id', req.user.id)
    .maybeSingle()
  if (!crow?.empresa_representada) {
    return res.status(400).json({ error: 'No elegiste una empresa a representar' })
  }

  // Factura original (propia)
  const { data: f, error: fErr } = await supabaseAdmin
    .from('facturas_emitidas')
    .select('*')
    .eq('id', facturaId)
    .eq('user_id', req.user.id)
    .maybeSingle()
  if (fErr) return res.status(500).json({ error: fErr.message })
  if (!f) return res.status(404).json({ error: 'Factura no encontrada' })
  if (f.estado === 'anulada') return res.status(400).json({ error: 'La factura ya está anulada' })
  if (/nota de cr/i.test(f.tipo || '')) {
    return res.status(400).json({ error: 'Una Nota de Crédito no se anula' })
  }

  // Comprobante asociado: separar PV y número de "00001-00000813".
  // ARCA exige el formato con ceros: PV a 5 dígitos y número a 8.
  const partes = String(f.numero || '').split('-')
  const pvAsoc = partes[0] ? String(parseInt(partes[0], 10)).padStart(5, '0') : ''
  const nroAsoc = partes[1] ? String(parseInt(partes[1], 10)).padStart(8, '0') : ''

  const datos = {
    concepto: f.concepto || 'Productos',
    condicionIva: f.condicion_iva || 'Consumidor Final',
    condicionesVenta: f.condiciones_venta
      ? String(f.condiciones_venta).split(',').map((s) => s.trim()).filter(Boolean)
      : ['Contado'],
    producto: f.producto,
    precio: f.precio,
  }

  const resultado = await generarFactura(
    cred.cuit,
    cred.clave,
    crow.empresa_representada,
    crow.punto_venta,
    'Nota de Crédito C',
    datos,
    true,
    {
      comprobanteAsociado: {
        tipo: 'Factura C',
        ptoVta: pvAsoc,
        nro: nroAsoc,
        fecha: f.fecha || null,
      },
    }
  )

  if (resultado.ok && resultado.emitida) {
    try {
      // Guardar la NC como comprobante propio
      const { data: ncIns } = await supabaseAdmin
        .from('facturas_emitidas')
        .insert({
          user_id: req.user.id,
          tipo: 'Nota de Crédito C',
          punto_venta: crow.punto_venta,
          numero: resultado.numero,
          cae: resultado.cae,
          cae_vto: resultado.caeVto,
          fecha: resultado.fecha,
          concepto: datos.concepto,
          condicion_iva: datos.condicionIva,
          condiciones_venta: datos.condicionesVenta.join(', '),
          producto: f.producto,
          cantidad: 1,
          precio: f.precio,
          importe_total: f.importe_total,
          estado: 'emitida',
          anula_a: f.id,
        })
        .select('id')
        .single()

      if (ncIns && resultado.pdf) {
        const path = `${req.user.id}/${ncIns.id}.pdf`
        const buf = Buffer.from(resultado.pdf, 'base64')
        const { error: upErr } = await supabaseAdmin.storage
          .from('facturas')
          .upload(path, buf, { contentType: 'application/pdf', upsert: true })
        if (!upErr) {
          await supabaseAdmin.from('facturas_emitidas').update({ pdf_path: path }).eq('id', ncIns.id)
        }
      }

      // Marcar la factura original como anulada
      await supabaseAdmin
        .from('facturas_emitidas')
        .update({ estado: 'anulada', nc_numero: resultado.numero })
        .eq('id', f.id)
    } catch (e) {
      resultado.guardadoError = String((e && e.message) || e)
    }
  }

  delete resultado.pdf
  res.json(resultado)
})

// Inspección del formulario de Nota de Crédito (para armar la anulación). No emite.
app.post('/arca/inspeccionar-nc', requireAuth, async (req, res) => {
  if (!supabaseAdmin) {
    return res.status(500).json({ error: 'Backend sin SUPABASE_SERVICE_ROLE_KEY' })
  }
  const { data, error } = await supabaseAdmin.rpc('get_credencial_arca_interna', {
    p_user: req.user.id,
  })
  if (error) return res.status(500).json({ error: error.message })
  const cred = Array.isArray(data) ? data[0] : data
  if (!cred) return res.status(400).json({ error: 'No tenés una credencial ARCA cargada' })

  const { data: row } = await supabaseAdmin
    .from('credenciales_arca')
    .select('empresa_representada, punto_venta')
    .eq('user_id', req.user.id)
    .maybeSingle()
  if (!row?.empresa_representada) {
    return res.status(400).json({ error: 'No elegiste una empresa a representar' })
  }

  const resultado = await inspeccionarNotaCredito(
    cred.cuit,
    cred.clave,
    row.empresa_representada,
    row.punto_venta
  )
  res.json(resultado)
})

// Genera la factura. Con confirmar=false llena todo y frena en el Resumen (sin
// emitir). Con confirmar=true emite la factura real en ARCA.
app.post('/arca/factura-generar', requireAuth, async (req, res) => {
  if (!supabaseAdmin) {
    return res.status(500).json({ error: 'Backend sin SUPABASE_SERVICE_ROLE_KEY' })
  }
  const datos = req.body?.datos || {}
  const confirmar = req.body?.confirmar === true

  const { data, error } = await supabaseAdmin.rpc('get_credencial_arca_interna', {
    p_user: req.user.id,
  })
  if (error) return res.status(500).json({ error: error.message })
  const cred = Array.isArray(data) ? data[0] : data
  if (!cred) return res.status(400).json({ error: 'No tenés una credencial ARCA cargada' })

  const { data: row } = await supabaseAdmin
    .from('credenciales_arca')
    .select('empresa_representada, punto_venta, tipo_comprobante')
    .eq('user_id', req.user.id)
    .maybeSingle()
  if (!row?.empresa_representada) {
    return res.status(400).json({ error: 'No elegiste una empresa a representar' })
  }
  if (!row?.punto_venta) {
    return res.status(400).json({ error: 'No configuraste el punto de venta' })
  }

  const resultado = await generarFactura(
    cred.cuit,
    cred.clave,
    row.empresa_representada,
    row.punto_venta,
    row.tipo_comprobante,
    datos,
    confirmar
  )

  // Si se emitió de verdad, guardamos el registro y el PDF.
  if (confirmar && resultado.ok && resultado.emitida) {
    try {
      const { data: ins, error: insErr } = await supabaseAdmin
        .from('facturas_emitidas')
        .insert({
          user_id: req.user.id,
          tipo: row.tipo_comprobante || 'Factura C',
          punto_venta: row.punto_venta,
          numero: resultado.numero,
          cae: resultado.cae,
          cae_vto: resultado.caeVto,
          fecha: resultado.fecha,
          concepto: datos.concepto,
          condicion_iva: datos.condicionIva,
          condiciones_venta: Array.isArray(datos.condicionesVenta)
            ? datos.condicionesVenta.join(', ')
            : datos.condicionesVenta,
          producto: datos.producto,
          cantidad: 1,
          precio: Number(datos.precio) || null,
          importe_total: Number(datos.precio) || null,
          estado: 'emitida',
        })
        .select('id')
        .single()

      if (insErr) {
        resultado.guardado = false
        resultado.guardadoError = insErr.message
      } else {
        resultado.facturaId = ins.id
        resultado.guardado = true

        if (resultado.pdf) {
          const path = `${req.user.id}/${ins.id}.pdf`
          const buf = Buffer.from(resultado.pdf, 'base64')
          const { error: upErr } = await supabaseAdmin.storage
            .from('facturas')
            .upload(path, buf, { contentType: 'application/pdf', upsert: true })
          if (!upErr) {
            await supabaseAdmin
              .from('facturas_emitidas')
              .update({ pdf_path: path })
              .eq('id', ins.id)
            resultado.pdfGuardado = true
          } else {
            resultado.pdfGuardado = false
            resultado.pdfGuardadoError = upErr.message
          }
        }
      }
    } catch (e) {
      resultado.guardado = false
      resultado.guardadoError = String((e && e.message) || e)
    }
  }

  // No devolvemos el PDF crudo al frontend (se descarga desde Storage).
  delete resultado.pdf
  res.json(resultado)
})

// ============================================================
//  Mercado Pago — conexión (OAuth), lectura de cobros y facturación
// ============================================================

// Estado de la conexión (para la pantalla de Integraciones). No expone tokens.
app.get('/mp/estado', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(500).json({ error: 'Backend sin SUPABASE_SERVICE_ROLE_KEY' })
  const { data, error } = await supabaseAdmin
    .from('mp_cuentas')
    .select('mp_user_id, auto_facturar, producto_default_id, conectada_at, access_token_enc')
    .eq('user_id', req.user.id)
    .maybeSingle()
  if (error) return res.status(500).json({ error: error.message })
  res.json({
    configurado: mpConfigurado(),
    conectada: Boolean(data && data.access_token_enc),
    auto_facturar: data?.auto_facturar || false,
    producto_default_id: data?.producto_default_id || null,
    conectada_at: data?.conectada_at || null,
  })
})

// Genera la URL de autorización de Mercado Pago. El frontend redirige ahí.
app.get('/mp/oauth/url', requireAuth, async (req, res) => {
  if (!mpConfigurado()) return res.status(500).json({ error: 'Falta configurar MP_CLIENT_ID / MP_CLIENT_SECRET' })
  const origin = String(req.query.origin || '')
  if (!/^https?:\/\//.test(origin)) return res.status(400).json({ error: 'origin inválido' })
  const state = firmarState({ u: req.user.id, o: origin })
  res.json({ url: urlAutorizacion(state) })
})

// Callback de OAuth: Mercado Pago devuelve el code acá (sin sesión → usamos state).
app.get('/mp/oauth/callback', async (req, res) => {
  const volver = (origin, q) => res.redirect(`${origin}/integraciones?${q}`)
  const st = verificarState(req.query.state)
  const origin = st?.o
  if (!st || !origin) return res.status(400).send('State inválido')
  if (req.query.error) return volver(origin, `mp=error&msg=${encodeURIComponent(String(req.query.error))}`)
  const code = req.query.code
  if (!code) return volver(origin, 'mp=error&msg=sin_codigo')
  if (!supabaseAdmin) return volver(origin, 'mp=error&msg=backend')
  try {
    const tok = await intercambiarCodigo(String(code))
    await guardarConexion(supabaseAdmin, st.u, tok)
    volver(origin, 'mp=ok')
  } catch (e) {
    volver(origin, `mp=error&msg=${encodeURIComponent(String((e && e.message) || e))}`)
  }
})

// Cambiar ajustes: facturación automática y/o producto por defecto.
app.post('/mp/config', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(500).json({ error: 'Backend sin SUPABASE_SERVICE_ROLE_KEY' })
  const patch = { updated_at: new Date().toISOString() }
  if (typeof req.body?.auto_facturar === 'boolean') patch.auto_facturar = req.body.auto_facturar
  if ('producto_default_id' in (req.body || {})) patch.producto_default_id = req.body.producto_default_id || null
  const { error } = await supabaseAdmin.from('mp_cuentas').update(patch).eq('user_id', req.user.id)
  if (error) return res.status(500).json({ error: error.message })
  res.json({ ok: true })
})

// Desconectar la cuenta de Mercado Pago (borra los tokens de nuestra base).
app.post('/mp/desconectar', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(500).json({ error: 'Backend sin SUPABASE_SERVICE_ROLE_KEY' })
  const { error } = await supabaseAdmin.from('mp_cuentas').delete().eq('user_id', req.user.id)
  if (error) return res.status(500).json({ error: error.message })
  res.json({ ok: true })
})

// Traer los últimos cobros de Mercado Pago y guardarlos (sin facturar).
app.post('/mp/cobros/sync', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(500).json({ error: 'Backend sin SUPABASE_SERVICE_ROLE_KEY' })
  try {
    const tk = await accessTokenValido(supabaseAdmin, req.user.id)
    if (!tk) return res.status(400).json({ error: 'No tenés Mercado Pago conectado' })
    // Diagnóstico temporal: qué cuenta de MP quedó conectada.
    try {
      const me = await obtenerUsuario(tk.accessToken)
      console.log(
        '[MP-ME] ' +
          JSON.stringify({
            id: me.id,
            nick: me.nickname,
            email: me.email,
            site: me.site_id,
            tipo: me.user_type,
            registro: me.registration_date,
          })
      )
    } catch (e) {
      console.log('[MP-ME] error', String((e && e.message) || e))
    }

    const pagos = await buscarPagosTodos(tk.accessToken)
    // Diagnóstico temporal: cómo viene cada pago (para afinar el filtro de entradas).
    console.log(
      '[MP-SYNC] user=' + tk.mpUserId + ' total=' + pagos.length + ' ' +
      JSON.stringify(
        pagos.slice(0, 60).map((p) => ({
          id: p.id,
          op: p.operation_type,
          col: p.collector_id ?? p.collector?.id,
          pay: p.payer?.id ?? p.payer_id,
          amt: p.transaction_amount,
          st: p.status,
          d: (p.description || '').slice(0, 24),
        }))
      )
    )
    const nuevos = await guardarCobrosNuevos(supabaseAdmin, req.user.id, pagos, tk.mpUserId)
    res.json({ ok: true, nuevos: nuevos.length })
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) })
  }
})

// Resuelve el nombre del producto elegido (o el por defecto de la cuenta).
async function resolverProducto(userId, productoId) {
  let id = productoId
  if (!id) {
    const { data: cta } = await supabaseAdmin
      .from('mp_cuentas')
      .select('producto_default_id')
      .eq('user_id', userId)
      .maybeSingle()
    id = cta?.producto_default_id || null
  }
  if (!id) return null
  const { data: prod } = await supabaseAdmin
    .from('productos_configurados')
    .select('nombre')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle()
  return prod?.nombre || null
}

// Emite una Factura C a partir de un cobro y lo marca como facturado.
async function facturarUnCobro(userId, cobro, productoNombre) {
  const body = {
    producto: productoNombre,
    precio: cobro.monto,
    cantidad: 1,
    concepto: 'Productos',
    condicionIva: 'Consumidor Final',
    condicionesVenta: ['Contado'],
  }
  const out = await emitirFacturaFlow({ supabaseAdmin, userId, body })
  if (out && out.ok && out.guardado && out.facturaId) {
    await supabaseAdmin
      .from('mp_cobros')
      .update({ facturado: true, factura_id: out.facturaId })
      .eq('id', cobro.id)
      .eq('user_id', userId)
  }
  return out
}

// Facturar los cobros seleccionados (manual). Cada cobro = una Factura C.
app.post('/mp/facturar', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(500).json({ error: 'Backend sin SUPABASE_SERVICE_ROLE_KEY' })
  const ids = Array.isArray(req.body?.cobroIds) ? req.body.cobroIds : []
  if (ids.length === 0) return res.status(400).json({ error: 'No elegiste ningún cobro' })
  const productoNombre = await resolverProducto(req.user.id, req.body?.productoId)
  if (!productoNombre) return res.status(400).json({ error: 'Elegí un producto para facturar' })

  const { data: cobros, error } = await supabaseAdmin
    .from('mp_cobros')
    .select('*')
    .eq('user_id', req.user.id)
    .in('id', ids)
  if (error) return res.status(500).json({ error: error.message })

  const resultados = []
  for (const c of cobros || []) {
    if (c.facturado) {
      resultados.push({ id: c.id, ok: true, yaFacturado: true })
      continue
    }
    try {
      const out = await facturarUnCobro(req.user.id, c, productoNombre)
      resultados.push({
        id: c.id,
        ok: Boolean(out && out.ok && out.guardado),
        numero: out?.numero || null,
        error: out && out.ok ? null : out?.error || 'No se pudo emitir',
      })
    } catch (e) {
      resultados.push({ id: c.id, ok: false, error: String((e && e.message) || e) })
    }
  }
  const emitidas = resultados.filter((r) => r.ok && !r.yaFacturado).length
  res.json({ ok: true, emitidas, resultados })
})

// Webhook de Mercado Pago: avisa cuando entra/actualiza un pago. Si el usuario
// tiene la facturación automática activada, emite la Factura C en el momento.
app.post('/mp/webhook', async (req, res) => {
  // Respondemos 200 rápido (MP reintenta si no); procesamos aparte.
  res.status(200).json({ ok: true })
  if (!supabaseAdmin) return
  try {
    const tipo = req.body?.type || req.query?.topic || req.query?.type
    if (tipo && !/payment/i.test(String(tipo))) return
    const paymentId = req.body?.data?.id || req.query?.id || req.query?.['data.id']
    const mpUserId = req.body?.user_id != null ? String(req.body.user_id) : null
    if (!paymentId) return

    // ¿De qué usuario nuestro es esta cuenta de MP?
    let q = supabaseAdmin.from('mp_cuentas').select('user_id, mp_user_id, auto_facturar, producto_default_id')
    q = mpUserId ? q.eq('mp_user_id', mpUserId) : q
    const { data: ctas } = await q
    const cta = (ctas || [])[0]
    if (!cta) return

    const tk = await accessTokenValido(supabaseAdmin, cta.user_id)
    if (!tk) return
    const pago = await obtenerPago(tk.accessToken, paymentId)
    if (!pago || pago.status !== 'approved') return

    const nuevos = await guardarCobrosNuevos(supabaseAdmin, cta.user_id, [pago], tk.mpUserId || cta.mp_user_id)

    // Facturación automática (si está activada y hay producto por defecto).
    if (cta.auto_facturar && cta.producto_default_id && nuevos.length > 0) {
      const productoNombre = await resolverProducto(cta.user_id, cta.producto_default_id)
      if (productoNombre) {
        for (const c of nuevos) {
          try {
            await facturarUnCobro(cta.user_id, c, productoNombre)
          } catch (e) {
            console.log('[MP-AUTO] error facturando cobro:', String((e && e.message) || e))
          }
        }
      }
    }
  } catch (e) {
    console.log('[MP-WEBHOOK] error:', String((e && e.message) || e))
  }
})

app.get('/', (req, res) => {
  res.send('app-facturacion backend (Docker + Playwright + Supabase). Ver /health')
})

// TEMPORAL — Fase 2: auto-test de emisión WS al arrancar, disparado por env.
// Se controla con WS_SELFTEST (factura|nc) + WS_ST_* y se lee en los logs.
async function selfTestWS() {
  const t = process.env.WS_SELFTEST
  if (!t) return
  try {
    // Modo "flow": prueba el flujo completo (emite + PDF + Storage + base).
    if (/flow/i.test(t)) {
      const out = await emitirFacturaFlow({
        supabaseAdmin,
        userId: process.env.WS_ST_USER,
        body: {
          producto: 'Servicio de prueba',
          precio: process.env.WS_ST_IMP || 2500,
          concepto: process.env.WS_ST_CONCEPTO || 'Servicios',
          condicionIva: 'Consumidor Final',
          condicionesVenta: ['Contado'],
        },
      })
      console.log('[WSTEST]', JSON.stringify(out))
      return
    }
    const esNc = /nc|nota/i.test(t)
    const q = {
      key: process.env.SPIKE_SECRET,
      tipo: esNc ? 'nc' : 'factura',
      pv: process.env.WS_ST_PV || 1,
      importe: process.env.WS_ST_IMP || 2500,
      concepto: process.env.WS_ST_CONCEPTO || 'Servicios',
    }
    if (esNc) {
      q.ncpv = process.env.WS_ST_PV || 1
      q.ncnro = process.env.WS_ST_NCNRO || 1
    }
    const out = await emitirSpike(q)
    console.log('[WSTEST]', JSON.stringify(out))
  } catch (e) {
    console.log('[WSTEST-ERR]', String((e && e.message) || e), (e && e.stack) || '')
  }
}

const port = process.env.PORT || 3000
app.listen(port, () => {
  console.log(`Backend escuchando en puerto ${port}`)
  selfTestWS()
})

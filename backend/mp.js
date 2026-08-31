// Integración con Mercado Pago: OAuth (conectar cuenta del usuario), lectura de
// cobros recibidos y refresco de tokens. Los tokens se guardan CIFRADOS con el
// mismo esquema AES-256-GCM del certificado (crypto-ws.js). Nunca se devuelven
// al frontend. Solo leemos pagos entrantes; nunca movemos dinero.
import crypto from 'crypto'
import { cifrar, descifrar } from './crypto-ws.js'

const CLIENT_ID = process.env.MP_CLIENT_ID
const CLIENT_SECRET = process.env.MP_CLIENT_SECRET
const REDIRECT_URI =
  process.env.MP_REDIRECT_URI || 'https://app-facturacion-backend.onrender.com/mp/oauth/callback'

const AUTH_BASE = 'https://auth.mercadopago.com/authorization'
const API = 'https://api.mercadopago.com'

export function mpConfigurado() {
  return Boolean(CLIENT_ID && CLIENT_SECRET)
}

// --------- state firmado (para el callback de OAuth, que llega sin sesión) ---------
// El state lleva el userId y el origen del frontend (para volver ahí), firmado con
// HMAC usando el mismo secreto del cifrado. Así el callback confía en quién es.
function hmac(data) {
  const secret = process.env.WS_KEY_ENC_SECRET || CLIENT_SECRET || 'mp-state'
  return crypto.createHmac('sha256', String(secret)).update(data).digest('base64url')
}
export function firmarState(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${body}.${hmac(body)}`
}
export function verificarState(state) {
  if (!state || typeof state !== 'string' || !state.includes('.')) return null
  const [body, sig] = state.split('.')
  if (hmac(body) !== sig) return null
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

// --------- URLs y tokens ---------
export function urlAutorizacion(state) {
  const p = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    platform_id: 'mp',
    redirect_uri: REDIRECT_URI,
    scope: 'offline_access read',
    state,
  })
  return `${AUTH_BASE}?${p.toString()}`
}

async function tokenRequest(body) {
  const r = await fetch(`${API}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) {
    throw new Error(j.message || j.error || `Mercado Pago devolvió ${r.status}`)
  }
  return j
}

export function intercambiarCodigo(code) {
  return tokenRequest({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
  })
}

export function refrescarToken(refreshToken) {
  return tokenRequest({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  })
}

// Guarda/actualiza la conexión (tokens cifrados) en mp_cuentas.
export async function guardarConexion(supabaseAdmin, userId, tok) {
  const expira = tok.expires_in
    ? new Date(Date.now() + Number(tok.expires_in) * 1000).toISOString()
    : null
  const fila = {
    user_id: userId,
    mp_user_id: tok.user_id != null ? String(tok.user_id) : null,
    access_token_enc: cifrar(tok.access_token),
    refresh_token_enc: tok.refresh_token ? cifrar(tok.refresh_token) : null,
    token_expira: expira,
    updated_at: new Date().toISOString(),
  }
  // upsert conservando auto_facturar / producto_default_id si ya existían.
  const { error } = await supabaseAdmin.from('mp_cuentas').upsert(fila, { onConflict: 'user_id' })
  if (error) throw new Error(error.message)
}

// Devuelve un access_token válido, refrescándolo si está por vencer (<30 días).
export async function accessTokenValido(supabaseAdmin, userId) {
  const { data: cta, error } = await supabaseAdmin
    .from('mp_cuentas')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!cta || !cta.access_token_enc) return null

  const vencePronto =
    !cta.token_expira ||
    new Date(cta.token_expira).getTime() - Date.now() < 30 * 24 * 60 * 60 * 1000

  if (vencePronto && cta.refresh_token_enc) {
    try {
      const nuevo = await refrescarToken(descifrar(cta.refresh_token_enc))
      await guardarConexion(supabaseAdmin, userId, nuevo)
      return { accessToken: nuevo.access_token, mpUserId: cta.mp_user_id }
    } catch {
      // si falla el refresco seguimos con el token actual (puede seguir sirviendo).
    }
  }
  return { accessToken: descifrar(cta.access_token_enc), mpUserId: cta.mp_user_id }
}

// --------- lectura de cobros ---------
// Busca los últimos pagos APROBADOS (entradas) de la cuenta.
export async function buscarPagos(accessToken, { limit = 50, offset = 0 } = {}) {
  const p = new URLSearchParams({
    sort: 'date_created',
    criteria: 'desc',
    status: 'approved',
    limit: String(limit),
    offset: String(offset),
  })
  const r = await fetch(`${API}/v1/payments/search?${p.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.message || `Mercado Pago devolvió ${r.status} al buscar pagos`)
  return j.results || []
}

// Trae varias páginas de pagos aprobados (más historial, no solo los últimos 50).
export async function buscarPagosTodos(accessToken, { pagina = 50, maxPaginas = 8 } = {}) {
  let todos = []
  for (let i = 0; i < maxPaginas; i++) {
    const page = await buscarPagos(accessToken, { limit: pagina, offset: i * pagina })
    todos = todos.concat(page)
    if (page.length < pagina) break
  }
  return todos
}

// Diagnóstico: ¿qué cuenta de Mercado Pago quedó conectada?
export async function obtenerUsuario(accessToken) {
  const r = await fetch(`${API}/users/me`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  })
  return r.json().catch(() => ({}))
}

export async function obtenerPago(accessToken, id) {
  const r = await fetch(`${API}/v1/payments/${id}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.message || `Mercado Pago devolvió ${r.status} al leer el pago`)
  return j
}

// Normaliza un pago de MP a nuestra fila de mp_cobros.
export function pagoAFila(userId, pago) {
  return {
    user_id: userId,
    mp_payment_id: String(pago.id),
    monto: pago.transaction_amount ?? null,
    descripcion: pago.description || pago.additional_info?.items?.[0]?.title || '',
    medio: pago.payment_method_id || pago.payment_type_id || null,
    estado: pago.status || null,
    fecha: pago.date_approved || pago.date_created || null,
  }
}

// ¿Es un movimiento de ENTRADA (cobro)? Dejamos pagos aprobados de monto
// positivo, y EXCLUIMOS solo lo que el usuario PAGÓ él mismo (es el payer →
// egreso, ej: ARCA, deudas). Todo lo demás —cobros, ingresos de dinero,
// transferencias recibidas, DEBIN— es entrada.
function esEntrada(p, mpUserId) {
  if (!p || p.status !== 'approved') return false
  if (!(Number(p.transaction_amount) > 0)) return false
  if (mpUserId) {
    const payer = p.payer?.id ?? p.payer_id
    if (payer != null && String(payer) === String(mpUserId)) return false // el usuario pagó → egreso
  }
  return true
}

// Inserta cobros nuevos (ignora los que ya existen para no pisar 'facturado').
// Devuelve las filas efectivamente insertadas (nuevas). Solo entradas (cobros).
export async function guardarCobrosNuevos(supabaseAdmin, userId, pagos, mpUserId) {
  const filas = pagos.filter((p) => esEntrada(p, mpUserId)).map((p) => pagoAFila(userId, p))
  if (filas.length === 0) return []
  const { data, error } = await supabaseAdmin
    .from('mp_cobros')
    .upsert(filas, { onConflict: 'user_id,mp_payment_id', ignoreDuplicates: true })
    .select('*')
  if (error) throw new Error(error.message)
  return data || []
}

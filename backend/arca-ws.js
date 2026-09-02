// Motor de emisión por Web Service de ARCA (WSFEv1), vía facturajs.
// Reemplaza al RPA para emitir. Devuelve CAE + número + fecha; el PDF y el
// guardado en base se arman aparte (server.js + pdf-factura.js).

import { AfipServices } from 'facturajs'
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const CACHE_PATH = '/tmp/.wsaa-tokens'

// --- Persistencia del token WSAA en Supabase ---
// El disco de Render es efímero (se borra en cada deploy). ARCA solo permite
// UN token válido a la vez (12 h en producción), así que si perdemos el caché
// quedamos bloqueados. Guardamos el token en la base y lo restauramos al arrancar.
const _sb =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
      })
    : null

// Caché WSAA multi-tenant: cada certificado/CUIT tiene su propio token (ARCA
// permite UN token válido por CUIT+servicio a la vez, 12 h). La clave de caché
// (cacheId) identifica al inquilino; el archivo en disco y la fila en Supabase
// van por cacheId para no pisarse entre usuarios.
function cachePathDe(cacheId) {
  return `${CACHE_PATH}-${cacheId}`
}
const _restauradas = new Set()
async function restaurarCache(cacheId) {
  if (_restauradas.has(cacheId) || !_sb) return
  const cachePath = cachePathDe(cacheId)
  try {
    const { data } = await _sb.from('wsaa_cache').select('contenido').eq('id', cacheId).maybeSingle()
    if (data?.contenido) fs.writeFileSync(cachePath, data.contenido)
  } catch (e) {
    console.log('[WSAA] no se pudo restaurar el caché:', String((e && e.message) || e))
  }
  _restauradas.add(cacheId)
}
async function guardarCache(cacheId) {
  if (!_sb) return
  const cachePath = cachePathDe(cacheId)
  try {
    if (!fs.existsSync(cachePath)) return
    const contenido = fs.readFileSync(cachePath, 'utf8')
    await _sb.from('wsaa_cache').upsert({ id: cacheId, contenido, updated_at: new Date().toISOString() })
  } catch (e) {
    console.log('[WSAA] no se pudo guardar el caché:', String((e && e.message) || e))
  }
}

// --- Certificado / clave desde el entorno (base64 o PEM directo) — fallback ---
function leerCredencial() {
  const dec = (b64) => (b64 ? Buffer.from(b64, 'base64').toString('utf8') : null)
  const certContents = dec(process.env.WS_CERT_B64) || process.env.WS_CERT_PEM
  const privateKeyContents = dec(process.env.WS_KEY_B64) || process.env.WS_KEY_PEM
  if (!certContents || !privateKeyContents) {
    throw new Error('Faltan el certificado y/o la clave del web service en el entorno')
  }
  return { certContents, privateKeyContents }
}

// Homologación por defecto para el cert del ENTORNO; en producción WS_HOMO=false.
const ES_HOMO = String(process.env.WS_HOMO ?? 'true').toLowerCase() !== 'false'

// Arma el contexto de credencial para una emisión:
//  - Si vienen certPem + keyPem (cert propio del usuario) → PRODUCCIÓN (el cert
//    se crea/autoriza en el portal real). cacheId por CUIT.
//  - Si no, usa el certificado del entorno (homologación salvo WS_HOMO=false).
// opts.homo=true fuerza homologación aun con cert propio (para pruebas).
function contextoDe(opts) {
  const cuitDigits = String(opts.cuit).replace(/\D/g, '')
  if (opts.certPem && opts.keyPem) {
    const homo = opts.homo === true
    return {
      certContents: opts.certPem,
      privateKeyContents: opts.keyPem,
      homo,
      cacheId: (homo ? 'homo-' : 'prod-') + cuitDigits,
    }
  }
  const { certContents, privateKeyContents } = leerCredencial()
  return {
    certContents,
    privateKeyContents,
    homo: ES_HOMO,
    cacheId: ES_HOMO ? 'homo' : 'prod',
  }
}

const _afips = new Map()
function afipDe(ctx) {
  if (_afips.has(ctx.cacheId)) return _afips.get(ctx.cacheId)
  const inst = new AfipServices({
    certContents: ctx.certContents,
    privateKeyContents: ctx.privateKeyContents,
    cacheTokensPath: cachePathDe(ctx.cacheId), // caché WSAA (persistido en Supabase)
    homo: ctx.homo,
    tokensExpireInHours: 12,
  })
  _afips.set(ctx.cacheId, inst)
  return inst
}

// Factura C = 11 · Nota de Crédito C = 13
function codigoTipo(tipo) {
  if (/nota de cr/i.test(tipo || '')) return 13
  return 11
}

// 'Productos'=1 · 'Servicios'=2 · 'Productos y Servicios'=3
function codigoConcepto(concepto) {
  const c = String(concepto || '').toLowerCase()
  if (/y servicio/.test(c)) return 3
  if (/servicio/.test(c)) return 2
  return 1
}

function hoyYYYYMMDD() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
}

// Próximo número para (cuit, pv, tipo) usando un contexto de credencial dado.
async function _proximo(ctx, { cuit, pv, tipo }) {
  await restaurarCache(ctx.cacheId)
  const CbteTipo = codigoTipo(tipo)
  const last = await afipDe(ctx).getLastBillNumber({
    Auth: { Cuit: Number(cuit) },
    params: { CbteTipo, PtoVta: Number(pv) },
  })
  await guardarCache(ctx.cacheId)
  return { CbteTipo, ultimo: Number(last.CbteNro), proximo: Number(last.CbteNro) + 1 }
}

// Devuelve el próximo número disponible. opts = { cuit, pv, tipo, certPem?, keyPem?, homo? }
export async function proximoNumero(opts) {
  return _proximo(contextoDe(opts), opts)
}

// Consulta un comprobante ya emitido (FECompConsultar) para recuperar sus datos
// autoritativos desde ARCA: fecha de emisión (CbteFch) y vencimiento del CAE
// (FchVto). Útil para regenerar PDFs de facturas viejas cuya fecha no quedó
// guardada. opts = { cuit, pv, tipo, nro, certPem?, keyPem?, homo? }
export async function consultarComprobante(opts) {
  const ctx = contextoDe(opts)
  const cuit = Number(String(opts.cuit).replace(/\D/g, ''))
  const CbteTipo = codigoTipo(opts.tipo)
  await restaurarCache(ctx.cacheId)
  const res = await afipDe(ctx).execRemote('wsfev1', 'FECompConsultar', {
    Auth: { Cuit: cuit },
    params: { FeCompConsReq: { CbteTipo, CbteNro: Number(opts.nro), PtoVta: Number(opts.pv) } },
  })
  await guardarCache(ctx.cacheId)
  const g = (res && res.ResultGet) || {}
  const aISO = (v) => {
    const s = v == null ? '' : String(v)
    const m = s.match(/^(\d{4})(\d{2})(\d{2})$/) // YYYYMMDD
    return m ? `${m[1]}-${m[2]}-${m[3]}` : null
  }
  return {
    ok: true,
    fecha: aISO(g.CbteFch), // fecha de emisión
    caeVto: aISO(g.FchVto), // vencimiento del CAE
    cae: g.CodAutorizacion ? String(g.CodAutorizacion) : null,
    resultado: g.Resultado || null,
    raw: g,
  }
}

// Lista los puntos de venta HABILITADOS para Web Service (FEParamGetPtosVenta).
// Los puntos de "Comprobantes en línea" (RCEL/portal) NO aparecen acá: para
// emitir por WS hace falta un punto de venta de tipo Web Service.
// opts = { cuit, certPem?, keyPem?, homo? }
export async function puntosVentaWS(opts) {
  const ctx = contextoDe(opts)
  await restaurarCache(ctx.cacheId)
  const res = await afipDe(ctx).execRemote('wsfev1', 'FEParamGetPtosVenta', {
    Auth: { Cuit: Number(String(opts.cuit).replace(/\D/g, '')) },
    params: {},
  })
  await guardarCache(ctx.cacheId)
  const rg = (res && res.ResultGet) || {}
  const raw = rg.PtoVenta || []
  const puntos = Array.isArray(raw) ? raw : [raw].filter(Boolean)
  return { ok: true, puntos, eventos: (res && res.Events) || null }
}

// Emite un comprobante C (Factura o Nota de Crédito) por web service.
// opts = {
//   cuit, pv, tipo, importe, concepto,
//   docTipo=99, docNro=0, condIvaReceptorId=5,
//   periodo: { desde, hasta, vtoPago } (YYYYMMDD) — solo servicios,
//   comprobanteAsociado: { tipo=11, ptoVta, nro } — solo Nota de Crédito,
// }
export async function emitirWS(opts) {
  const ctx = contextoDe(opts)
  const cuit = Number(opts.cuit)
  const PtoVta = Number(opts.pv)
  const importe = Number(opts.importe)
  const { CbteTipo, proximo } = await _proximo(ctx, { cuit, pv: PtoVta, tipo: opts.tipo })
  const Concepto = codigoConcepto(opts.concepto)
  const fecha = hoyYYYYMMDD()

  const det = {
    Concepto,
    DocTipo: Number(opts.docTipo ?? 99),
    DocNro: Number(opts.docNro ?? 0),
    CondicionIVAReceptorId: Number(opts.condIvaReceptorId ?? 5), // 5 = Consumidor Final
    CbteDesde: proximo,
    CbteHasta: proximo,
    CbteFch: fecha,
    ImpTotal: importe,
    ImpTotConc: 0,
    ImpNeto: importe, // en C no se discrimina IVA
    ImpOpEx: 0,
    ImpIVA: 0,
    ImpTrib: 0,
    MonId: 'PES',
    MonCotiz: 1,
  }

  // Servicios (concepto 2 o 3): fechas de servicio y vto de pago obligatorias.
  if (Concepto !== 1) {
    const per = opts.periodo || {}
    det.FchServDesde = per.desde || fecha
    det.FchServHasta = per.hasta || fecha
    det.FchVtoPago = per.vtoPago || fecha
  }

  // Nota de Crédito: comprobante asociado (la factura original).
  if (CbteTipo === 13 && opts.comprobanteAsociado) {
    const a = opts.comprobanteAsociado
    det.CbtesAsoc = {
      CbteAsoc: {
        Tipo: Number(a.tipo || 11),
        PtoVta: Number(a.ptoVta),
        Nro: Number(a.nro),
        Cuit: cuit,
      },
    }
  }

  const res = await afipDe(ctx).createBill({
    Auth: { Cuit: cuit },
    params: {
      FeCAEReq: {
        FeCabReq: { CantReg: 1, PtoVta, CbteTipo },
        FeDetReq: { FECAEDetRequest: det },
      },
    },
  })
  await guardarCache(ctx.cacheId)

  const cab = res.FeCabResp || {}
  const detArr = (res.FeDetResp && res.FeDetResp.FECAEDetResponse) || {}
  const r = Array.isArray(detArr) ? detArr[0] : detArr

  const iso = `${fecha.slice(0, 4)}-${fecha.slice(4, 6)}-${fecha.slice(6, 8)}`
  const caeVtoRaw = r.CAEFchVto ? String(r.CAEFchVto) : null
  const caeVtoIso = caeVtoRaw
    ? `${caeVtoRaw.slice(0, 4)}-${caeVtoRaw.slice(4, 6)}-${caeVtoRaw.slice(6, 8)}`
    : null

  return {
    ok: cab.Resultado === 'A',
    resultado: cab.Resultado, // A aprobado / R rechazado
    codTipo: CbteTipo,
    ptoVta: PtoVta,
    numeroInt: proximo,
    numero: `${String(PtoVta).padStart(5, '0')}-${String(proximo).padStart(8, '0')}`,
    cae: r.CAE || null,
    caeVto: caeVtoIso,
    caeVtoRaw,
    fecha: iso,
    concepto: Concepto,
    observaciones: r.Observaciones || res.Errors || null,
  }
}

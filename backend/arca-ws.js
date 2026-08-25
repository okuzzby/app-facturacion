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

let _cacheRestaurada = false
async function restaurarCache(cacheKey) {
  if (_cacheRestaurada || !_sb) return
  try {
    const { data } = await _sb.from('wsaa_cache').select('contenido').eq('id', cacheKey).maybeSingle()
    if (data?.contenido) fs.writeFileSync(CACHE_PATH, data.contenido)
  } catch (e) {
    console.log('[WSAA] no se pudo restaurar el caché:', String((e && e.message) || e))
  }
  _cacheRestaurada = true
}
async function guardarCache(cacheKey) {
  if (!_sb) return
  try {
    if (!fs.existsSync(CACHE_PATH)) return
    const contenido = fs.readFileSync(CACHE_PATH, 'utf8')
    await _sb.from('wsaa_cache').upsert({ id: cacheKey, contenido, updated_at: new Date().toISOString() })
  } catch (e) {
    console.log('[WSAA] no se pudo guardar el caché:', String((e && e.message) || e))
  }
}

// --- Certificado / clave desde el entorno (base64 o PEM directo) ---
function leerCredencial() {
  const dec = (b64) => (b64 ? Buffer.from(b64, 'base64').toString('utf8') : null)
  const certContents = dec(process.env.WS_CERT_B64) || process.env.WS_CERT_PEM
  const privateKeyContents = dec(process.env.WS_KEY_B64) || process.env.WS_KEY_PEM
  if (!certContents || !privateKeyContents) {
    throw new Error('Faltan el certificado y/o la clave del web service en el entorno')
  }
  return { certContents, privateKeyContents }
}

// Homologación por defecto; en producción se pone WS_HOMO=false.
const ES_HOMO = String(process.env.WS_HOMO ?? 'true').toLowerCase() !== 'false'
const CACHE_KEY = ES_HOMO ? 'homo' : 'prod'

let _afip = null
function afip() {
  if (_afip) return _afip
  const { certContents, privateKeyContents } = leerCredencial()
  _afip = new AfipServices({
    certContents,
    privateKeyContents,
    cacheTokensPath: CACHE_PATH, // caché del token WSAA (persistido en Supabase)
    homo: ES_HOMO,
    tokensExpireInHours: 12,
  })
  return _afip
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

// Devuelve el próximo número disponible para (cuit, pv, tipo).
export async function proximoNumero({ cuit, pv, tipo }) {
  await restaurarCache(CACHE_KEY)
  const CbteTipo = codigoTipo(tipo)
  const last = await afip().getLastBillNumber({
    Auth: { Cuit: Number(cuit) },
    params: { CbteTipo, PtoVta: Number(pv) },
  })
  await guardarCache(CACHE_KEY)
  return { CbteTipo, ultimo: Number(last.CbteNro), proximo: Number(last.CbteNro) + 1 }
}

// Emite un comprobante C (Factura o Nota de Crédito) por web service.
// opts = {
//   cuit, pv, tipo, importe, concepto,
//   docTipo=99, docNro=0, condIvaReceptorId=5,
//   periodo: { desde, hasta, vtoPago } (YYYYMMDD) — solo servicios,
//   comprobanteAsociado: { tipo=11, ptoVta, nro } — solo Nota de Crédito,
// }
export async function emitirWS(opts) {
  const cuit = Number(opts.cuit)
  const PtoVta = Number(opts.pv)
  const importe = Number(opts.importe)
  const { CbteTipo, proximo } = await proximoNumero({ cuit, pv: PtoVta, tipo: opts.tipo })
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

  const res = await afip().createBill({
    Auth: { Cuit: cuit },
    params: {
      FeCAEReq: {
        FeCabReq: { CantReg: 1, PtoVta, CbteTipo },
        FeDetReq: { FECAEDetRequest: det },
      },
    },
  })
  await guardarCache(CACHE_KEY)

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

// Regenera los PDF de facturas/NC ya emitidas con el formato nuevo (calcado de
// ARCA, 3 copias) a partir de los datos guardados. Cuando a un comprobante le
// falta la fecha de emisión o el vencimiento del CAE, los reconsulta a ARCA
// (FECompConsultar). Pisa el archivo viejo en Storage. Nada se ingresa a mano.

import { generarPdfComprobante } from './pdf-factura.js'
import { descifrar } from './crypto-ws.js'
import { consultarComprobante } from './arca-ws.js'

// Normaliza cualquier fecha a ISO (YYYY-MM-DD). Acepta ISO, DD/MM/YYYY y YYYYMMDD.
function aISO(s) {
  if (!s) return null
  const t = String(s).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t
  let m = t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (m) return `${m[3]}-${m[2]}-${m[1]}`
  m = t.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  return null
}

const conceptoNum = (c) => {
  const s = String(c || '').toLowerCase()
  if (/y servicio/.test(s)) return 3
  if (/servicio/.test(s)) return 2
  return 1
}

const codTipoDe = (tipo) => (/nota de cr/i.test(tipo || '') ? 13 : 11)

// "00001-00000816" → { pv: 1, nro: 816 }
function parseNumero(numero, pvFallback) {
  const partes = String(numero || '').split('-')
  const pv = partes[0] ? parseInt(partes[0], 10) : parseInt(pvFallback, 10)
  const nro = partes[1] != null ? parseInt(partes[1], 10) : parseInt(partes[0] || '0', 10)
  return { pv: Number.isFinite(pv) ? pv : 0, nro: Number.isFinite(nro) ? nro : 0 }
}

// Regenera TODAS las facturas de un usuario. No regenera si el emisor no tiene
// razón social cargada (evita PDFs con datos en blanco).
export async function regenerarFacturasUsuario(supabaseAdmin, userId) {
  const { data: cred } = await supabaseAdmin
    .from('credenciales_arca')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()
  if (!cred) return { userId, ok: false, motivo: 'sin credencial', total: 0, regeneradas: 0 }

  const razon = cred.razon_social || cred.empresa_representada || ''
  if (!razon) return { userId, ok: false, motivo: 'sin datos de emisor', total: 0, regeneradas: 0 }

  let certPem = cred.ws_cert_pem || null
  let keyPem = null
  try {
    keyPem = cred.ws_cert_key_enc ? descifrar(cred.ws_cert_key_enc) : null
  } catch {
    keyPem = null
  }

  const emisor = {
    razonSocial: razon,
    domicilio: cred.domicilio || '',
    cuit: cred.cuit,
    iibb: cred.iibb || '',
    inicioAct: cred.inicio_actividades || null,
    condIva: 'Responsable Monotributo',
  }

  const { data: facturas } = await supabaseAdmin
    .from('facturas_emitidas')
    .select('*')
    .eq('user_id', userId)
  const lista = facturas || []
  const porId = new Map(lista.map((f) => [f.id, f]))

  let regeneradas = 0
  const errores = []

  for (const f of lista) {
    try {
      const codTipo = codTipoDe(f.tipo)
      const esNC = codTipo === 13
      const { pv, nro } = parseNumero(f.numero, f.punto_venta)

      let fecha = aISO(f.fecha)
      let caeVto = aISO(f.cae_vto)
      let cae = f.cae

      // Fecha de emisión o vto del CAE faltantes → reconsultar a ARCA.
      if ((!fecha || !caeVto) && certPem && keyPem) {
        try {
          const c = await consultarComprobante({ cuit: cred.cuit, pv, nro, tipo: f.tipo, certPem, keyPem })
          if (c.fecha) fecha = c.fecha
          if (c.caeVto) caeVto = c.caeVto
          if (c.cae && !cae) cae = c.cae
          console.log('[REGEN-CONSULT]', f.numero, 'fecha=' + fecha, 'caeVto=' + caeVto, 'FchVto=' + (c.raw && c.raw.FchVto))
        } catch (e) {
          console.log('[REGEN-CONSULT] falló', f.numero, String((e && e.message) || e))
        }
      }

      let comprobanteAsociado = null
      if (esNC && f.anula_a) {
        const orig = porId.get(f.anula_a)
        if (orig) {
          const p = parseNumero(orig.numero, orig.punto_venta)
          comprobanteAsociado = { ptoVta: p.pv, nro: p.nro }
        }
      }

      const concepto = conceptoNum(f.concepto)
      const datos = {
        codTipo,
        ptoVta: pv,
        numero: nro,
        fecha,
        concepto,
        periodo: concepto !== 1 ? { desde: fecha, hasta: fecha, vtoPago: fecha } : null,
        emisor,
        receptor: {
          condIva: f.condicion_iva || 'Consumidor Final',
          docTipo: 99,
          docNro: 0,
          condVenta: f.condiciones_venta || 'Contado',
        },
        items: [{ descripcion: f.producto || '', cantidad: f.cantidad || 1, precioUnit: f.precio }],
        importeTotal: f.importe_total,
        cae,
        caeVto,
        comprobanteAsociado,
      }

      const pdf = await generarPdfComprobante(datos)
      const path = f.pdf_path || `${userId}/${f.id}.pdf`
      const { error: upErr } = await supabaseAdmin.storage
        .from('facturas')
        .upload(path, pdf, { contentType: 'application/pdf', upsert: true })
      if (upErr) throw new Error(upErr.message)
      if (!f.pdf_path) {
        await supabaseAdmin.from('facturas_emitidas').update({ pdf_path: path }).eq('id', f.id)
      }
      regeneradas++
    } catch (e) {
      errores.push({ id: f.id, numero: f.numero, error: String((e && e.message) || e) })
    }
  }

  return { userId, ok: true, total: lista.length, regeneradas, errores }
}

// Regenera para todos los usuarios con credencial (los que no tienen datos de
// emisor se saltan solos dentro de regenerarFacturasUsuario).
export async function regenerarTodas(supabaseAdmin) {
  const { data: creds } = await supabaseAdmin.from('credenciales_arca').select('user_id')
  const resultados = []
  for (const c of creds || []) {
    resultados.push(await regenerarFacturasUsuario(supabaseAdmin, c.user_id))
  }
  return resultados
}

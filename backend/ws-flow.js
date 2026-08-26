// Flujo completo de emisión por Web Service: emite (WSFEv1) → genera el PDF
// propio → lo sube a Storage → guarda en facturas_emitidas.

import { emitirWS } from './arca-ws.js'
import { generarPdfComprobante } from './pdf-factura.js'
import { descifrar } from './crypto-ws.js'

// Cert propio del usuario (producción). Devuelve { certPem, keyPem } listos para
// emitirWS. La clave privada se descifra en memoria; nunca sale del backend.
function certDeCred(cred) {
  if (!cred.ws_cert_pem || !cred.ws_cert_key_enc) {
    throw new Error('Tu certificado wsfe no está configurado. Corré "Configurar wsfe" primero.')
  }
  return { certPem: cred.ws_cert_pem, keyPem: descifrar(cred.ws_cert_key_enc) }
}

function emisorDeCred(cred) {
  return {
    razonSocial: cred.razon_social || cred.empresa_representada || '',
    domicilio: cred.domicilio || '',
    cuit: cred.cuit,
    iibb: cred.iibb || '',
    inicioAct: cred.inicio_actividades || null,
    condIva: 'Responsable Monotributo',
  }
}

async function cargarCred(supabaseAdmin, userId) {
  const { data: cred, error } = await supabaseAdmin
    .from('credenciales_arca')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!cred) throw new Error('No tenés configuración ARCA cargada')
  if (!cred.punto_venta_ws) throw new Error('Falta el punto de venta web service en la configuración')
  return cred
}

async function guardarPdfYFila(supabaseAdmin, userId, fila, pdfBuffer) {
  const { data: ins, error } = await supabaseAdmin
    .from('facturas_emitidas')
    .insert({ ...fila, user_id: userId })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  let pdf_path = null
  if (pdfBuffer) {
    pdf_path = `${userId}/${ins.id}.pdf`
    const { error: upErr } = await supabaseAdmin.storage
      .from('facturas')
      .upload(pdf_path, pdfBuffer, { contentType: 'application/pdf', upsert: true })
    if (!upErr) {
      await supabaseAdmin.from('facturas_emitidas').update({ pdf_path }).eq('id', ins.id)
    } else {
      pdf_path = null
    }
  }
  return { id: ins.id, pdf_path }
}

// --- Emitir Factura C por WS ---
export async function emitirFacturaFlow({ supabaseAdmin, userId, body }) {
  const cred = await cargarCred(supabaseAdmin, userId)
  const pv = cred.punto_venta_ws
  const cantidad = Number(body.cantidad || 1)
  const importe = Number(body.precio) * cantidad
  const concepto = body.concepto || 'Productos'

  const res = await emitirWS({
    cuit: cred.cuit,
    pv,
    tipo: 'Factura C',
    importe,
    concepto,
    docTipo: 99,
    docNro: 0,
    condIvaReceptorId: 5, // Consumidor Final
    ...certDeCred(cred), // cert propio del usuario → producción
  })
  if (!res.ok) return { ...res, guardado: false }

  const condVenta = Array.isArray(body.condicionesVenta)
    ? body.condicionesVenta.join(', ')
    : body.condicionesVenta || 'Contado'

  const pdf = await generarPdfComprobante({
    codTipo: res.codTipo,
    ptoVta: res.ptoVta,
    numero: res.numeroInt,
    fecha: res.fecha,
    concepto: res.concepto,
    periodo: res.concepto !== 1 ? { desde: res.fecha, hasta: res.fecha, vtoPago: res.fecha } : null,
    emisor: emisorDeCred(cred),
    receptor: {
      condIva: body.condicionIva || 'Consumidor Final',
      docTipo: 99,
      docNro: 0,
      condVenta,
    },
    items: [{ descripcion: body.producto || '', cantidad, precioUnit: body.precio }],
    importeTotal: importe,
    cae: res.cae,
    caeVto: res.caeVto,
  })

  const g = await guardarPdfYFila(
    supabaseAdmin,
    userId,
    {
      tipo: 'Factura C',
      punto_venta: pv,
      numero: res.numero,
      cae: res.cae,
      cae_vto: res.caeVto,
      fecha: res.fecha,
      concepto,
      condicion_iva: body.condicionIva || 'Consumidor Final',
      condiciones_venta: condVenta,
      producto: body.producto || '',
      cantidad,
      precio: body.precio,
      importe_total: importe,
      estado: 'emitida',
    },
    pdf
  )
  return { ...res, guardado: true, facturaId: g.id, pdf_path: g.pdf_path }
}

// --- Anular (Nota de Crédito C asociada) por WS ---
export async function anularFlow({ supabaseAdmin, userId, facturaId }) {
  const cred = await cargarCred(supabaseAdmin, userId)
  const pv = cred.punto_venta_ws

  const { data: f, error: fErr } = await supabaseAdmin
    .from('facturas_emitidas')
    .select('*')
    .eq('id', facturaId)
    .eq('user_id', userId)
    .maybeSingle()
  if (fErr) throw new Error(fErr.message)
  if (!f) throw new Error('Factura no encontrada')
  if (f.estado === 'anulada') throw new Error('La factura ya está anulada')
  if (/nota de cr/i.test(f.tipo || '')) throw new Error('Una Nota de Crédito no se anula')

  // Número de la factura original: "00001-00000002" → pv/nro
  const partes = String(f.numero || '').split('-')
  const ncPv = partes[0] ? parseInt(partes[0], 10) : parseInt(pv, 10)
  const ncNro = partes[1] ? parseInt(partes[1], 10) : 0
  const importe = Number(f.importe_total)

  const res = await emitirWS({
    cuit: cred.cuit,
    pv,
    tipo: 'Nota de Crédito C',
    importe,
    concepto: f.concepto || 'Productos',
    docTipo: 99,
    docNro: 0,
    condIvaReceptorId: 5,
    comprobanteAsociado: { tipo: 11, ptoVta: ncPv, nro: ncNro },
    ...certDeCred(cred), // cert propio del usuario → producción
  })
  if (!res.ok) return { ...res, guardado: false }

  const pdf = await generarPdfComprobante({
    codTipo: res.codTipo, // 13
    ptoVta: res.ptoVta,
    numero: res.numeroInt,
    fecha: res.fecha,
    concepto: res.concepto,
    periodo: res.concepto !== 1 ? { desde: res.fecha, hasta: res.fecha, vtoPago: res.fecha } : null,
    emisor: emisorDeCred(cred),
    receptor: {
      condIva: f.condicion_iva || 'Consumidor Final',
      docTipo: 99,
      docNro: 0,
      condVenta: f.condiciones_venta || 'Contado',
    },
    items: [{ descripcion: f.producto || '', cantidad: f.cantidad || 1, precioUnit: f.precio }],
    importeTotal: importe,
    cae: res.cae,
    caeVto: res.caeVto,
    comprobanteAsociado: { ptoVta: ncPv, nro: ncNro },
  })

  const g = await guardarPdfYFila(
    supabaseAdmin,
    userId,
    {
      tipo: 'Nota de Crédito C',
      punto_venta: pv,
      numero: res.numero,
      cae: res.cae,
      cae_vto: res.caeVto,
      fecha: res.fecha,
      concepto: f.concepto || 'Productos',
      condicion_iva: f.condicion_iva || 'Consumidor Final',
      condiciones_venta: f.condiciones_venta || 'Contado',
      producto: f.producto,
      cantidad: f.cantidad || 1,
      precio: f.precio,
      importe_total: importe,
      estado: 'emitida',
      anula_a: f.id,
    },
    pdf
  )

  // Marcar la original como anulada
  await supabaseAdmin
    .from('facturas_emitidas')
    .update({ estado: 'anulada', nc_numero: res.numero })
    .eq('id', f.id)

  return { ...res, guardado: true, facturaId: g.id, pdf_path: g.pdf_path }
}

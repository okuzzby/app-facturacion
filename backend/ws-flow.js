// Flujo completo de emisión por Web Service: emite (WSFEv1) → genera el PDF
// propio → lo sube a Storage → guarda en facturas_emitidas.

import { emitirWS, puntosVentaWS } from './arca-ws.js'
import { generarPdfComprobante } from './pdf-factura.js'
import { descifrar } from './crypto-ws.js'
import { validarReceptor } from './validaciones.js'

// Formatea un CUIT de 11 dígitos como XX-XXXXXXXX-X para mostrarlo en el PDF.
function formatearCUIT(cuit) {
  const c = String(cuit || '').replace(/\D/g, '')
  return c.length === 11 ? `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}` : c
}

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
  if (cred.activa === false) throw new Error('Tu cuenta de ARCA está desconectada. Reconectala en Configuración.')
  // Mientras se está configurando (trayendo datos del emisor, etc.) no emitimos,
  // para no generar comprobantes con datos incompletos.
  const EN_PROGRESO = ['iniciando', 'creando_cert', 'autorizando', 'guardando', 'detectando_pv', 'creando_pv', 'capturando_datos']
  if (EN_PROGRESO.includes(cred.ws_setup_estado)) {
    throw new Error('Tu cuenta se está configurando. Esperá unos minutos a que termine para poder facturar.')
  }
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

// --- Diagnóstico: puntos de venta habilitados para WS ---
export async function puntosVentaFlow({ supabaseAdmin, userId }) {
  const { data: cred, error } = await supabaseAdmin
    .from('credenciales_arca')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!cred) throw new Error('No tenés configuración ARCA cargada')
  const out = await puntosVentaWS({ cuit: cred.cuit, ...certDeCred(cred) })
  return { ...out, cuit: cred.cuit, punto_venta_ws_actual: cred.punto_venta_ws || null }
}

// --- Emitir Factura C por WS ---
export async function emitirFacturaFlow({ supabaseAdmin, userId, body }) {
  const cred = await cargarCred(supabaseAdmin, userId)
  const pv = cred.punto_venta_ws
  const concepto = body.concepto || 'Productos'

  // Receptor: Consumidor Final (default) o un cliente con CUIT. Se valida acá
  // (CUIT módulo 11 + mapeo de condición IVA) antes de emitir.
  const receptor = validarReceptor(body.receptor)

  // Ítems normalizados por validarFactura: [{ descripcion, precio, cantidad }].
  // Compatibilidad: si viniera el formato viejo, lo envolvemos en un ítem.
  const items =
    Array.isArray(body.items) && body.items.length
      ? body.items
      : [{ descripcion: body.producto || '', precio: Number(body.precio), cantidad: Number(body.cantidad || 1) }]
  const importe =
    typeof body.total === 'number'
      ? body.total
      : Math.round(items.reduce((a, it) => a + Number(it.precio) * Number(it.cantidad), 0) * 100) / 100

  const res = await emitirWS({
    cuit: cred.cuit,
    pv,
    tipo: 'Factura C',
    importe,
    concepto,
    docTipo: receptor.docTipo,
    docNro: receptor.docNro,
    condIvaReceptorId: receptor.condIvaReceptorId,
    ...certDeCred(cred), // cert propio del usuario → producción
  })
  if (!res.ok) return { ...res, guardado: false }

  const condVenta = Array.isArray(body.condicionesVenta)
    ? body.condicionesVenta.join(', ')
    : body.condicionesVenta || 'Contado'

  // El PDF espera { descripcion, cantidad, precioUnit } por ítem.
  const itemsPdf = items.map((it) => ({
    descripcion: it.descripcion,
    cantidad: it.cantidad,
    precioUnit: it.precio,
  }))

  const pdf = await generarPdfComprobante({
    codTipo: res.codTipo,
    ptoVta: res.ptoVta,
    numero: res.numeroInt,
    fecha: res.fecha,
    concepto: res.concepto,
    periodo: res.concepto !== 1 ? { desde: res.fecha, hasta: res.fecha, vtoPago: res.fecha } : null,
    emisor: emisorDeCred(cred),
    receptor: {
      condIva: receptor.condIva,
      razonSocial: receptor.razonSocial,
      docTipo: receptor.docTipo,
      docNro: receptor.docTipo === 80 ? formatearCUIT(receptor.cuit) : (receptor.docNro || 0),
      domicilio: receptor.domicilio,
      condVenta,
    },
    items: itemsPdf,
    importeTotal: importe,
    cae: res.cae,
    caeVto: res.caeVto,
  })

  // Resumen para la columna `producto` (lo que se ve en Historial/Inicio).
  const unidades = items.reduce((a, it) => a + Number(it.cantidad), 0)
  const resumenProducto =
    items.length === 1
      ? items[0].descripcion
      : `${items[0].descripcion} + ${items.length - 1} ${items.length - 1 === 1 ? 'ítem más' : 'ítems más'}`

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
      condicion_iva: receptor.condIva,
      condiciones_venta: condVenta,
      receptor_nombre: receptor.razonSocial || null,
      receptor_cuit: receptor.cuit || null,
      receptor_domicilio: receptor.domicilio || null,
      receptor_doc_tipo: receptor.docTipo,
      producto: resumenProducto,
      // Compatibilidad de columnas viejas: 1 × total (precio*cantidad = importe_total).
      cantidad: 1,
      precio: importe,
      importe_total: importe,
      items: itemsPdf,
      estado: 'emitida',
    },
    pdf
  )
  return { ...res, guardado: true, facturaId: g.id, pdf_path: g.pdf_path, unidades }
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

  // La NC va al mismo receptor que la factura original.
  const recepNC = validarReceptor({
    condIva: f.condicion_iva,
    razonSocial: f.receptor_nombre,
    cuit: f.receptor_cuit,
    domicilio: f.receptor_domicilio,
  })

  const res = await emitirWS({
    cuit: cred.cuit,
    pv,
    tipo: 'Nota de Crédito C',
    importe,
    concepto: f.concepto || 'Productos',
    docTipo: recepNC.docTipo,
    docNro: recepNC.docNro,
    condIvaReceptorId: recepNC.condIvaReceptorId,
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
      condIva: recepNC.condIva,
      razonSocial: recepNC.razonSocial,
      docTipo: recepNC.docTipo,
      docNro: recepNC.docTipo === 80 ? formatearCUIT(recepNC.cuit) : (recepNC.docNro || 0),
      domicilio: recepNC.domicilio,
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
      receptor_nombre: f.receptor_nombre || null,
      receptor_cuit: f.receptor_cuit || null,
      receptor_domicilio: f.receptor_domicilio || null,
      receptor_doc_tipo: f.receptor_doc_tipo || recepNC.docTipo,
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

// Genera el PDF de un comprobante C (Factura o Nota de Crédito) replicando el
// formato oficial de ARCA al detalle (posiciones, tamaños y tipografía), con el
// QR oficial. Emite las 3 copias: ORIGINAL, DUPLICADO y TRIPLICADO.
// Devuelve un Buffer.
//
// Coordenadas tomadas de una factura real de ARCA (A4 595x842). El origen es
// arriba-izquierda; los valores "top" salen medidos del PDF original. Se aplica
// un pequeño ajuste vertical (VOFF) para alinear la línea base de PDFKit
// (Helvetica) con el tope de glifo que reporta ARCA (Arial), tipografías
// métricamente equivalentes.

import PDFDocument from 'pdfkit'
import QRCode from 'qrcode'

// ARCA muestra los importes SIN separador de miles: "2500,00".
const money = (n) => Number(n || 0).toFixed(2).replace('.', ',')

const fechaAR = (iso) => {
  if (!iso) return ''
  const [y, m, d] = String(iso).split('-')
  return `${d}/${m}/${y}`
}

function qrUrl(datos) {
  const payload = {
    ver: 1,
    fecha: datos.fecha,
    cuit: Number(datos.emisor.cuit),
    ptoVta: Number(datos.ptoVta),
    tipoCmp: Number(datos.codTipo),
    nroCmp: Number(datos.numero),
    importe: Number(datos.importeTotal),
    moneda: 'PES',
    ctz: 1,
    tipoDocRec: Number(datos.receptor.docTipo || 99),
    nroDocRec: Number(datos.receptor.docNro || 0),
    tipoCodAut: 'E',
    codAut: Number(datos.cae),
  }
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64')
  return `https://www.afip.gob.ar/fe/qr/?p=${b64}`
}

// Ajuste vertical global: PDFKit posiciona el tope de línea; ARCA reporta el
// tope del glifo. ~1.8pt sube el texto para calzar.
const VOFF = -1.8

export async function generarPdfComprobante(datos) {
  const qrDataUrl = await QRCode.toDataURL(qrUrl(datos), { margin: 1, width: 220 })
  const qrPng = Buffer.from(qrDataUrl.split(',')[1], 'base64')

  const esNC = Number(datos.codTipo) === 13
  const titulo = esNC ? 'NOTA DE CRÉDITO' : 'FACTURA'
  const codImp = esNC ? 'COD. 013' : 'COD. 011'

  return await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0 })
    const chunks = []
    doc.on('data', (c) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const copias = ['ORIGINAL', 'DUPLICADO', 'TRIPLICADO']
    copias.forEach((copia, i) => {
      if (i > 0) doc.addPage({ size: 'A4', margin: 0 })
      dibujarComprobante(doc, datos, { copia, titulo, codImp, esNC, qrPng })
    })

    doc.end()
  })
}

function dibujarComprobante(doc, d, ctx) {
  const { copia, titulo, codImp, esNC, qrPng } = ctx

  // ---- helpers ----
  const put = (t, x, top, o = {}) => {
    const f = o.f || 'Helvetica'
    const s = o.s || 9
    doc.font(f).fontSize(s).fillColor(o.color || '#000')
    const opt = {}
    if (o.w != null) opt.width = o.w
    if (o.align) opt.align = o.align
    if (o.lineGap != null) opt.lineGap = o.lineGap
    doc.text(t == null ? '' : String(t), x, top + VOFF, opt)
  }
  const B = (t, x, top, o = {}) => put(t, x, top, { ...o, f: 'Helvetica-Bold' })
  const N = (t, x, top, o = {}) => put(t, x, top, { ...o, f: 'Helvetica' })
  const box = (x, y, w, h) => doc.roundedRect(x, y, w, h, 3).lineWidth(0.8).stroke('#000')
  const hline = (x1, x2, y) => doc.moveTo(x1, y).lineTo(x2, y).lineWidth(0.8).stroke('#000')
  const vline = (x, y1, y2) => doc.moveTo(x, y1).lineTo(x, y2).lineWidth(0.8).stroke('#000')

  const LX = 15
  const RX = 581

  // ¿Se muestra la banda "Período Facturado"? (Servicios / Prod. y Servicios)
  const conPeriodo = Number(d.concepto) !== 1
  // Sin período, el receptor y la tabla suben 22pt (alto de la banda).
  const pOff = conPeriodo ? 0 : -22

  // ======================= CAJA ENCABEZADO (23 -> 169) =======================
  box(LX, 23, RX - LX, 146)
  hline(LX, RX, 50.4) // separa la barra de copia del encabezado

  // Barra de copia (ORIGINAL / DUPLICADO / TRIPLICADO)
  B(copia, LX, 32, { s: 14, w: RX - LX, align: 'center' })

  // Caja de la letra "C" centrada, tapando la línea divisoria
  const cbx = 275, cby = 51, cbw = 47, cbh = 41
  doc.rect(cbx, cby, cbw, cbh).lineWidth(0.9).fillAndStroke('#ffffff', '#000')
  doc.fillColor('#000').font('Helvetica-Bold').fontSize(24).text('C', cbx, cby + 4, { width: cbw, align: 'center' })
  B(codImp, cbx, cby + 29, { s: 8, w: cbw, align: 'center' })

  // Divisor vertical izquierda/derecha (solo debajo de la caja C)
  vline(298.5, 89, 169)

  // ----- Columna izquierda (emisor) -----
  const razon = d.emisor.razonSocial || ''
  const domicilio = d.emisor.domicilio || ''
  B(razon, LX, 69, { s: 10, w: 260, align: 'center' })

  B('Razón Social:', 21, 109.5, { s: 9 })
  N(razon, 84, 109.5, { s: 9, w: 190 })

  B('Domicilio Comercial:', 21, 133.5, { s: 9 })
  N(domicilio, 116, 133.5, { s: 9, w: 162, lineGap: 1 })

  B('Condición frente al IVA:', 21, 158.3, { s: 9 })
  N(d.emisor.condIva || 'Responsable Monotributo', 131, 158.3, { s: 9 })

  // ----- Columna derecha -----
  B(titulo, 341, 63, { s: 18 })

  B('Punto de Venta:', 341, 92.1, { s: 9 })
  B(String(d.ptoVta).padStart(5, '0'), 417, 92.1, { s: 10 })
  B('Comp. Nro:', 461, 92.1, { s: 9 })
  B(String(d.numero).padStart(8, '0'), 517, 92.1, { s: 10 })

  B('Fecha de Emisión:', 341, 108.3, { s: 9 })
  B(fechaAR(d.fecha), 428, 108.3, { s: 10 })

  // Etiqueta bold + valor normal, con el valor pegado a la etiqueta + un gap
  // fijo (medido en runtime para que nunca se encimen ni queden pegados).
  const labVal = (label, value, x, top, s = 9, gap = 4) => {
    doc.font('Helvetica-Bold').fontSize(s)
    const lw = doc.widthOfString(label)
    B(label, x, top, { s })
    N(value, x + lw + gap, top, { s })
  }
  labVal('CUIT:', d.emisor.cuit, 341, 131.3)
  labVal('Ingresos Brutos:', d.emisor.iibb || '', 341, 143.3)
  labVal('Fecha de Inicio de Actividades:', fechaAR(d.emisor.inicioAct), 341, 155.3)

  // ======================= BANDA PERÍODO (170 -> 192) =======================
  if (conPeriodo) {
    box(LX, 170, RX - LX, 22)
    B('Período Facturado Desde:', 21, 177.4, { s: 10 })
    N(fechaAR(d.periodo?.desde || d.fecha), 159, 177.4, { s: 10 })
    B('Hasta:', 232, 177.4, { s: 10 })
    N(fechaAR(d.periodo?.hasta || d.fecha), 265, 177.4, { s: 10 })
    B('Fecha de Vto. para el pago:', 363, 177.4, { s: 10 })
    N(fechaAR(d.periodo?.vtoPago || d.fecha), 495, 177.4, { s: 10 })
  }

  // ======================= BANDA RECEPTOR (194 -> 256) =======================
  const recTop = 194 + pOff
  box(LX, recTop, RX - LX, 62)
  B('Doc.:', 21, recTop + 6, { s: 8 })
  N(d.receptor.docNro ? String(d.receptor.docNro) : '-', 43, recTop + 6, { s: 8 })
  B('Apellido y Nombre / Razón Social:', 222, recTop + 3, { s: 8 })
  B('Condición frente al IVA:', 21, recTop + 20, { s: 8 })
  N(d.receptor.condIva || 'Consumidor Final', 130, recTop + 20, { s: 8 })
  B('Domicilio:', 312, recTop + 20, { s: 8 })
  B('Condición de venta:', 21, recTop + 40, { s: 8 })
  N(d.receptor.condVenta || 'Contado', 113, recTop + 40, { s: 8 })

  // ======================= TABLA DE ÍTEMS =======================
  // Cabecera gris con celdas (bordes verticales en los cortes de columna)
  const thTop = 258 + pOff
  const thBot = 276 + pOff
  const cortes = [15, 55, 196, 261, 304, 384, 416, 489, 581]
  doc.rect(LX, thTop, RX - LX, thBot - thTop).fillAndStroke('#d6d6d6', '#000')
  doc.fillColor('#000')
  for (const cx of cortes) vline(cx, thTop, thBot)
  hline(LX, RX, thBot)

  B('Código', 19, thTop + 5.5, { s: 8 })
  B('Producto / Servicio', 60, thTop + 5.5, { s: 8 })
  B('Cantidad', 205, thTop + 5.5, { s: 8, w: 52, align: 'center' })
  B('U. Medida', 263, thTop + 5.5, { s: 8 })
  B('Precio Unit.', 316, thTop + 6, { s: 7, w: 66, align: 'center' })
  B('% Bonif', 385, thTop + 6, { s: 7 })
  B('Imp. Bonif.', 428, thTop + 6, { s: 7 })
  B('Subtotal', 500, thTop + 6, { s: 7, w: 78, align: 'center' })

  // Filas (área abierta, sin bordes laterales)
  let rowTop = thBot + 6
  for (const it of d.items || []) {
    const sub = Number(it.cantidad || 1) * Number(it.precioUnit || 0)
    N(String(it.descripcion || ''), 57, rowTop, { s: 8, w: 135 })
    N(money(it.cantidad || 1), 196, rowTop, { s: 8, w: 61, align: 'right' })
    N('unidades', 261, rowTop, { s: 7, w: 43, align: 'center' })
    N(money(it.precioUnit), 304, rowTop, { s: 8, w: 76, align: 'right' })
    N('0,00', 384, rowTop, { s: 8, w: 30, align: 'right' })
    N('0,00', 416, rowTop, { s: 8, w: 71, align: 'right' })
    N(money(sub), 489, rowTop, { s: 8, w: 89, align: 'right' })
    rowTop += 15
  }

  // Comprobantes asociados (solo Nota de Crédito)
  if (esNC && d.comprobanteAsociado) {
    const a = d.comprobanteAsociado
    const nroA = `${String(a.ptoVta).padStart(5, '0')}-${String(a.nro).padStart(8, '0')}`
    N(`Comprobante Asociado — Factura C: ${nroA}`, 21, rowTop + 6, { s: 8 })
  }

  // ======================= CAJA TOTALES (516 -> 610) =======================
  box(LX, 516, RX - LX, 94)
  const totLine = (label, val, top, s) => {
    B(label, 300, top, { s, w: 181, align: 'right' })
    B('$', 486, top, { s })
    B(money(val), 500, top, { s, w: 78, align: 'right' })
  }
  totLine('Subtotal:', d.importeTotal, 554.5, 9)
  totLine('Importe Otros Tributos:', 0, 572.5, 9)
  totLine('Importe Total:', d.importeTotal, 590.6, 10)

  // ======================= PIE (fuera del marco) =======================
  doc.image(qrPng, 20, 636, { width: 80 })

  // Logo textual ARCA
  B('ARCA', 116, 644, { s: 14 })
  N('AGENCIA DE RECAUDACIÓN', 116, 661, { s: 5 })
  N('Y CONTROL ADUANERO', 116, 667, { s: 5 })

  B('Pág. 1/1', 275.8, 649.4, { s: 10 })

  B('CAE N°:', 434.6, 646.6, { s: 10 })
  N(String(d.cae || ''), 478, 646.6, { s: 10 })
  B('Fecha de Vto. de CAE:', 366.4, 661.6, { s: 10 })
  N(fechaAR(d.caeVto), 478, 661.6, { s: 10 })

  put('Comprobante Autorizado', 116, 688.5, { f: 'Helvetica-BoldOblique', s: 9 })
  put(
    'Esta Agencia no se responsabiliza por los datos ingresados en el detalle de la operación',
    116, 708, { f: 'Helvetica-BoldOblique', s: 6 }
  )
}

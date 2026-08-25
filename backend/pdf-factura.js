// Genera el PDF de un comprobante C (Factura o Nota de Crédito) imitando el
// formato oficial de ARCA, con el QR oficial. Devuelve un Buffer.

import PDFDocument from 'pdfkit'
import QRCode from 'qrcode'

const money = (n) =>
  Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

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

export async function generarPdfComprobante(datos) {
  const qrDataUrl = await QRCode.toDataURL(qrUrl(datos), { margin: 1, width: 200 })
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

    const W = doc.page.width // 595.28
    const M = 25
    const L = M
    const R = W - M
    const CW = R - L
    const midX = W / 2

    const box = (x, y, w, h) => doc.rect(x, y, w, h).lineWidth(0.7).stroke('#000')
    const B = (t, x, y, o = {}) => doc.font('Helvetica-Bold').fontSize(o.fs || 8).fillColor('#000').text(t, x, y, o)
    const N = (t, x, y, o = {}) => doc.font('Helvetica').fontSize(o.fs || 8).fillColor('#000').text(t, x, y, o)
    // etiqueta en negrita + valor normal en la misma línea
    const LV = (label, val, x, y, o = {}) => {
      doc.font('Helvetica-Bold').fontSize(o.fs || 8).fillColor('#000').text(label + ' ', x, y, { continued: true })
      doc.font('Helvetica').text(val == null ? '' : String(val))
    }

    let y = M

    // ---- Barra ORIGINAL ----
    box(L, y, CW, 20)
    B('ORIGINAL', L, y + 6, { width: CW, align: 'center', fs: 10 })
    y += 20

    // ---- Encabezado ----
    const hTop = y
    const hH = 124
    box(L, hTop, CW, hH)
    doc.moveTo(midX, hTop).lineTo(midX, hTop + hH).lineWidth(0.7).stroke('#000')

    // Caja letra C centrada sobre el divisor (relleno blanco para tapar la línea)
    const cbw = 54, cbh = 54, cbx = midX - cbw / 2, cby = hTop + 6
    doc.rect(cbx, cby, cbw, cbh).lineWidth(0.9).fillAndStroke('#ffffff', '#000')
    doc.fillColor('#000').font('Helvetica-Bold').fontSize(34).text('C', cbx, cby + 5, { width: cbw, align: 'center' })
    doc.font('Helvetica-Bold').fontSize(7).fillColor('#000').text(codImp, cbx, cby + cbh - 12, { width: cbw, align: 'center' })

    // Izquierda
    const lx = L + 10
    B(datos.emisor.razonSocial || '', lx, hTop + 14, { width: midX - lx - 30, align: 'center', fs: 11 })
    let ly = hTop + 46
    LV('Razón Social:', datos.emisor.razonSocial || '', lx, ly); ly += 16
    doc.font('Helvetica-Bold').fontSize(8).text('Domicilio Comercial: ', lx, ly, { continued: true })
    doc.font('Helvetica').text(datos.emisor.domicilio || '', { width: midX - lx - 12 })
    ly = doc.y + 2
    LV('Condición frente al IVA:', datos.emisor.condIva || 'Responsable Monotributo', lx, ly)

    // Derecha (toda la columna arranca a la derecha de la caja C)
    const rx = midX + 40
    B(titulo, rx, hTop + 14, { fs: 18 })
    let ry = hTop + 44
    doc.font('Helvetica-Bold').fontSize(9).text('Punto de Venta: ', rx, ry, { continued: true })
    doc.font('Helvetica').text(String(datos.ptoVta).padStart(5, '0'), { continued: true })
    doc.font('Helvetica-Bold').text('   Comp. Nro: ', { continued: true })
    doc.font('Helvetica').text(String(datos.numero).padStart(8, '0'))
    ry += 16
    LV('Fecha de Emisión:', fechaAR(datos.fecha), rx, ry, { fs: 9 }); ry += 18
    LV('CUIT:', datos.emisor.cuit, rx, ry); ry += 13
    LV('Ingresos Brutos:', datos.emisor.iibb || '', rx, ry); ry += 13
    LV('Fecha de Inicio de Actividades:', fechaAR(datos.emisor.inicioAct), rx, ry)

    y = hTop + hH

    // ---- Período facturado (solo Servicios / Prod. y Servicios) ----
    if (Number(datos.concepto) !== 1) {
      box(L, y, CW, 18)
      doc.font('Helvetica-Bold').fontSize(8).text('Período Facturado Desde: ', L + 8, y + 5, { continued: true })
      doc.font('Helvetica').text(fechaAR(datos.periodo?.desde || datos.fecha), { continued: true })
      doc.font('Helvetica-Bold').text('   Hasta: ', { continued: true })
      doc.font('Helvetica').text(fechaAR(datos.periodo?.hasta || datos.fecha), { continued: true })
      doc.font('Helvetica-Bold').text('     Fecha de Vto. para el pago: ', { continued: true })
      doc.font('Helvetica').text(fechaAR(datos.periodo?.vtoPago || datos.fecha))
      y += 18
    }

    // ---- Receptor ----
    const recH = 52
    box(L, y, CW, recH)
    LV('Doc.:', datos.receptor.docNro ? String(datos.receptor.docNro) : '-', L + 8, y + 6)
    B('Apellido y Nombre / Razón Social:', midX - 40, y + 6)
    LV('Condición frente al IVA:', datos.receptor.condIva || 'Consumidor Final', L + 8, y + 22)
    B('Domicilio:', midX - 40, y + 22)
    LV('Condición de venta:', datos.receptor.condVenta || 'Contado', L + 8, y + 38)
    y += recH + 4

    // ---- Comprobantes asociados (solo NC) ----
    if (esNC && datos.comprobanteAsociado) {
      const a = datos.comprobanteAsociado
      const nroA = `${String(a.ptoVta).padStart(5, '0')}-${String(a.nro).padStart(8, '0')}`
      N(`Comprobante Asociado — Factura C: ${nroA}`, L + 2, y, { fs: 8 })
      y += 14
    }

    // ---- Tabla de ítems ----
    const cols = [
      { k: 'codigo', t: 'Código', x: L, w: 45, a: 'left' },
      { k: 'desc', t: 'Producto / Servicio', x: L + 45, w: 200, a: 'left' },
      { k: 'cant', t: 'Cantidad', x: L + 245, w: 55, a: 'right' },
      { k: 'med', t: 'U. Medida', x: L + 300, w: 55, a: 'center' },
      { k: 'pu', t: 'Precio Unit.', x: L + 355, w: 60, a: 'right' },
      { k: 'bon', t: '% Bonif', x: L + 415, w: 40, a: 'right' },
      { k: 'impbon', t: 'Imp. Bonif.', x: L + 455, w: 45, a: 'right' },
      { k: 'sub', t: 'Subtotal', x: L + 500, w: CW - 500, a: 'right' },
    ]
    const headY = y
    doc.rect(L, headY, CW, 16).fillAndStroke('#dddddd', '#000')
    doc.fillColor('#000')
    for (const c of cols) B(c.t, c.x + 3, headY + 5, { width: c.w - 6, align: c.a, fs: 7.5 })
    y = headY + 16

    for (const it of datos.items || []) {
      const sub = Number(it.cantidad || 1) * Number(it.precioUnit || 0)
      const rowY = y + 4
      N('', cols[0].x + 3, rowY, { width: cols[0].w - 6 })
      N(String(it.descripcion || ''), cols[1].x + 3, rowY, { width: cols[1].w - 6 })
      N(money(it.cantidad || 1), cols[2].x + 3, rowY, { width: cols[2].w - 6, align: 'right' })
      N('unidades', cols[3].x + 3, rowY, { width: cols[3].w - 6, align: 'center' })
      N(money(it.precioUnit), cols[4].x + 3, rowY, { width: cols[4].w - 6, align: 'right' })
      N('0,00', cols[5].x + 3, rowY, { width: cols[5].w - 6, align: 'right' })
      N('0,00', cols[6].x + 3, rowY, { width: cols[6].w - 6, align: 'right' })
      N(money(sub), cols[7].x + 3, rowY, { width: cols[7].w - 6, align: 'right' })
      y += 18
    }

    // ---- Caja grande (cuerpo + totales) ----
    const totBoxTop = headY + 16
    const totBoxH = 250
    box(L, totBoxTop, CW, totBoxH)

    // Totales abajo a la derecha
    let ty = totBoxTop + totBoxH - 66
    const tLabelX = midX + 40
    const tLabelW = R - 90 - (tLabelX)
    const totLine = (label, val, bold) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica-Bold').fontSize(bold ? 11 : 9)
      doc.text(label, tLabelX, ty, { width: R - 12 - tLabelX - 90, align: 'right', continued: false })
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9)
      doc.text('$ ' + money(val), R - 92, ty, { width: 80, align: 'right' })
      ty += bold ? 20 : 16
    }
    totLine('Subtotal:', datos.importeTotal)
    totLine('Importe Otros Tributos:', 0)
    totLine('Importe Total:', datos.importeTotal, true)

    y = totBoxTop + totBoxH + 14

    // ---- Pie: QR + logo + CAE ----
    doc.image(qrPng, L, y, { width: 85 })
    // Logo textual ARCA
    B('ARCA', L + 95, y + 20, { fs: 15 })
    N('AGENCIA DE RECAUDACIÓN', L + 95, y + 38, { fs: 5.5 })
    N('Y CONTROL ADUANERO', L + 95, y + 45, { fs: 5.5 })
    B('Pág. 1/1', midX - 20, y + 22, { fs: 9 })
    // CAE a la derecha
    doc.font('Helvetica-Bold').fontSize(10).text('CAE N°:  ', R - 220, y + 18, { continued: true })
    doc.font('Helvetica').text(String(datos.cae || ''))
    doc.font('Helvetica-Bold').text('Fecha de Vto. de CAE:  ', R - 220, y + 34, { continued: true })
    doc.font('Helvetica').text(fechaAR(datos.caeVto))

    doc.font('Helvetica-BoldOblique').fontSize(9).text('Comprobante Autorizado', L + 95, y + 60)
    doc.font('Helvetica').fontSize(6.5).fillColor('#333').text(
      'Esta Agencia no se responsabiliza por los datos ingresados en el detalle de la operación',
      L + 95, y + 72, { width: CW - 95 }
    )

    doc.end()
  })
}

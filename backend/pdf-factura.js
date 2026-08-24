// Genera el PDF de un comprobante C (Factura o Nota de Crédito) para monotributo,
// con el QR oficial de ARCA. Devuelve un Buffer.
//
// datos = {
//   tipo: 'Factura C' | 'Nota de Crédito C',
//   codTipo: 11 | 13,               // tipoCmp para el QR
//   ptoVta: 1, numero: 1,           // números
//   fecha: '2026-08-24',            // YYYY-MM-DD
//   concepto: 1|2|3,
//   periodo: { desde, hasta, vtoPago } | null,  // solo servicios (YYYY-MM-DD)
//   emisor: { razonSocial, domicilio, cuit, iibb, inicioAct, condIva },
//   receptor: { condIva, docTipo, docNro, nombre, domicilio, condVenta },
//   items: [{ descripcion, cantidad, precioUnit }],
//   importeTotal: 100,
//   cae: '86340796216239', caeVto: '2026-09-03',
// }

import PDFDocument from 'pdfkit'
import QRCode from 'qrcode'

const money = (n) =>
  Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const fechaAR = (iso) => {
  if (!iso) return ''
  const [y, m, d] = String(iso).split('-')
  return `${d}/${m}/${y}`
}

// Construye la URL del QR de ARCA (JSON base64).
function qrUrl(datos) {
  const payload = {
    ver: 1,
    fecha: datos.fecha, // YYYY-MM-DD
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
  const qrDataUrl = await QRCode.toDataURL(qrUrl(datos), { margin: 1, width: 220 })
  const qrPng = Buffer.from(qrDataUrl.split(',')[1], 'base64')

  const nroFmt = `${String(datos.ptoVta).padStart(5, '0')}-${String(datos.numero).padStart(8, '0')}`
  const esNC = Number(datos.codTipo) === 13
  const titulo = esNC ? 'NOTA DE CRÉDITO' : 'FACTURA'
  const codImp = esNC ? 'COD. 013' : 'COD. 011'

  return await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 })
    const chunks = []
    doc.on('data', (c) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const W = doc.page.width
    const M = 40
    const midX = W / 2

    // ---- Encabezado: caja con letra C en el medio ----
    const top = M
    const hH = 105
    doc.rect(M, top, W - 2 * M, hH).stroke()
    doc.moveTo(midX, top).lineTo(midX, top + hH).stroke()

    // Letra C centrada sobre el divisor
    doc.rect(midX - 22, top + 6, 44, 40).stroke()
    doc.fontSize(28).font('Helvetica-Bold').text('C', midX - 22, top + 11, { width: 44, align: 'center' })
    doc.fontSize(7).font('Helvetica').text(codImp, midX - 30, top + 49, { width: 60, align: 'center' })

    // Izquierda: emisor
    doc.fontSize(13).font('Helvetica-Bold').text(datos.emisor.razonSocial || '', M + 12, top + 16, { width: midX - M - 30 })
    doc.fontSize(8).font('Helvetica').text('ORIGINAL', M + 12, top + 84)

    // Derecha: título a la derecha de la caja, número y fecha debajo
    doc.fontSize(16).font('Helvetica-Bold').text(titulo, midX + 30, top + 16, { width: midX - M - 40, align: 'right' })
    doc.fontSize(9).font('Helvetica')
    doc.text(
      `Punto de Venta: ${String(datos.ptoVta).padStart(5, '0')}      Comp. Nro: ${String(datos.numero).padStart(8, '0')}`,
      midX + 12,
      top + 66
    )
    doc.text(`Fecha de Emisión: ${fechaAR(datos.fecha)}`, midX + 12, top + 84)

    let y = top + hH + 12

    // ---- Datos del emisor ----
    doc.fontSize(9).font('Helvetica')
    const linea = (label, val) => {
      doc.font('Helvetica-Bold').text(label, M + 12, y, { continued: true })
      doc.font('Helvetica').text(' ' + (val || ''))
      y += 14
    }
    linea('CUIT:', datos.emisor.cuit)
    linea('Ingresos Brutos:', datos.emisor.iibb || '')
    linea('Domicilio Comercial:', datos.emisor.domicilio || '')
    linea('Fecha de Inicio de Actividades:', fechaAR(datos.emisor.inicioAct) || '')
    linea('Condición frente al IVA:', datos.emisor.condIva || 'Responsable Monotributo')

    if (Number(datos.concepto) !== 1 && datos.periodo) {
      y += 2
      doc.font('Helvetica-Bold').text(
        `Período Facturado — Desde: ${fechaAR(datos.periodo.desde)}  Hasta: ${fechaAR(datos.periodo.hasta)}  Vto. Pago: ${fechaAR(datos.periodo.vtoPago)}`,
        M + 12, y
      )
      y += 14
    }

    y += 6
    doc.moveTo(M, y).lineTo(W - M, y).stroke()
    y += 8

    // ---- Datos del receptor ----
    const rDoc = Number(datos.receptor.docTipo) === 80 ? 'CUIT' : Number(datos.receptor.docTipo) === 96 ? 'DNI' : 'Doc'
    linea('Condición frente al IVA:', datos.receptor.condIva || 'Consumidor Final')
    linea(`${rDoc}:`, datos.receptor.docNro ? String(datos.receptor.docNro) : '—')
    if (datos.receptor.nombre) linea('Apellido y Nombre / Razón Social:', datos.receptor.nombre)
    linea('Condición de venta:', datos.receptor.condVenta || 'Contado')

    y += 6
    // ---- Tabla de items ----
    const colX = { desc: M + 6, cant: W - M - 210, medida: W - M - 150, precio: W - M - 90, sub: W - M - 6 }
    doc.rect(M, y, W - 2 * M, 18).fillAndStroke('#eeeeee', '#000000')
    doc.fillColor('#000000').fontSize(8).font('Helvetica-Bold')
    doc.text('Producto / Servicio', colX.desc, y + 5)
    doc.text('Cant.', colX.cant, y + 5)
    doc.text('U. Medida', colX.medida, y + 5)
    doc.text('P. Unit.', colX.precio, y + 5)
    doc.text('Subtotal', colX.sub - 50, y + 5, { width: 50, align: 'right' })
    y += 20

    doc.font('Helvetica').fontSize(8)
    for (const it of datos.items || []) {
      const sub = Number(it.cantidad || 1) * Number(it.precioUnit || 0)
      doc.text(String(it.descripcion || ''), colX.desc, y, { width: colX.cant - colX.desc - 6 })
      doc.text(money(it.cantidad || 1), colX.cant, y)
      doc.text('unidades', colX.medida, y)
      doc.text('$' + money(it.precioUnit), colX.precio, y)
      doc.text('$' + money(sub), colX.sub - 50, y, { width: 50, align: 'right' })
      y += 16
    }

    y += 8
    doc.moveTo(M, y).lineTo(W - M, y).stroke()
    y += 8
    doc.fontSize(11).font('Helvetica-Bold')
    doc.text('Importe Total: $' + money(datos.importeTotal), M, y, { width: W - 2 * M, align: 'right' })
    y += 30

    // ---- Pie: QR + CAE ----
    doc.image(qrPng, M, y, { width: 90 })
    doc.fontSize(9).font('Helvetica-Bold')
    doc.text('CAE N°: ', M + 110, y + 10, { continued: true }).font('Helvetica').text(String(datos.cae || ''))
    doc.font('Helvetica-Bold').text('Fecha de Vto. de CAE: ', M + 110, y + 28, { continued: true }).font('Helvetica').text(fechaAR(datos.caeVto))
    doc.font('Helvetica').fontSize(7).fillColor('#666666').text(
      'Comprobante Autorizado — Esta Agencia no se responsabiliza por los datos ingresados en el detalle de la operación',
      M + 110, y + 52, { width: W - M - (M + 110) }
    )

    doc.end()
  })
}

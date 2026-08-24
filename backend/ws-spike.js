// TEMPORAL — Fase 0/2. Prueba de emisión por Web Service (WSFEv1) en
// HOMOLOGACIÓN, usando el motor real arca-ws.js. Se elimina al terminar.

import { emitirWS } from './arca-ws.js'

export async function emitirSpike(q) {
  const tipo = /nota/i.test(q.tipo || '') ? 'Nota de Crédito C' : 'Factura C'
  const opts = {
    cuit: q.cuit || 20960814909,
    pv: q.pv || 1,
    tipo,
    importe: q.importe || 100,
    concepto: q.concepto || 'Productos',
  }
  // Para Nota de Crédito: comprobante asociado (factura original a anular).
  if (tipo === 'Nota de Crédito C') {
    opts.comprobanteAsociado = {
      tipo: 11,
      ptoVta: Number(q.ncpv || q.pv || 1),
      nro: Number(q.ncnro || 1),
    }
  }
  return await emitirWS(opts)
}

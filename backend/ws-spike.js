// TEMPORAL — Fase 0. Prueba de emisión por Web Service (WSFEv1) contra
// HOMOLOGACIÓN de ARCA. No toca producción. Se elimina cuando termine el spike.
//
// Requiere en Render las variables de entorno:
//   WS_CERT_PEM  = contenido del certificado de homologación (cert.pem)
//   WS_KEY_PEM   = contenido de la clave privada (private_key.key)
//   SPIKE_SECRET = un secreto cualquiera para proteger el endpoint
//
// Devuelve el CAE si todo anda.

import { AfipServices } from 'facturajs'

export async function emitirSpike({ cuit, pv, importe }) {
  const certContents = process.env.WS_CERT_PEM
  const privateKeyContents = process.env.WS_KEY_PEM
  if (!certContents || !privateKeyContents) {
    throw new Error('Faltan WS_CERT_PEM y/o WS_KEY_PEM en el entorno')
  }

  const afip = new AfipServices({
    certContents,
    privateKeyContents,
    cacheTokensPath: '/tmp/.lastTokens',
    homo: true, // HOMOLOGACIÓN
    tokensExpireInHours: 12,
  })

  const Auth = { Cuit: Number(cuit) }
  const CbteTipo = 11 // Factura C
  const PtoVta = Number(pv)

  const last = await afip.getLastBillNumber({ Auth, params: { CbteTipo, PtoVta } })
  const proximo = Number(last.CbteNro) + 1

  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  const fecha = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
  const monto = Number(importe || 100)

  const res = await afip.createBill({
    Auth,
    params: {
      FeCAEReq: {
        FeCabReq: { CantReg: 1, PtoVta, CbteTipo },
        FeDetReq: {
          FECAEDetRequest: {
            Concepto: 1,
            DocTipo: 99,
            DocNro: 0,
            CondicionIVAReceptorId: 5,
            CbteDesde: proximo,
            CbteHasta: proximo,
            CbteFch: fecha,
            ImpTotal: monto,
            ImpTotConc: 0,
            ImpNeto: monto,
            ImpOpEx: 0,
            ImpIVA: 0,
            ImpTrib: 0,
            MonId: 'PES',
            MonCotiz: 1,
          },
        },
      },
    },
  })

  const cab = res.FeCabResp || {}
  const detArr = (res.FeDetResp && res.FeDetResp.FECAEDetResponse) || {}
  const det = Array.isArray(detArr) ? detArr[0] : detArr

  return {
    ok: cab.Resultado === 'A',
    resultado: cab.Resultado,
    numero: `${String(PtoVta).padStart(5, '0')}-${String(proximo).padStart(8, '0')}`,
    cae: det.CAE || null,
    caeVto: det.CAEFchVto || null,
    observaciones: det.Observaciones || res.Errors || null,
  }
}

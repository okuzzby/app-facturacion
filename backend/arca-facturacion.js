// Resumen de facturación anual (últimos 12 meses) para la barra de "tope de
// categoría" del Inicio. Suma las Facturas C y resta las Notas de Crédito C
// emitidas ante ARCA, recorriendo todos los puntos de venta del usuario con su
// propio certificado (WSFEv1). Es una operación pesada: se cachea en la base y
// se recalcula solo cuando el usuario toca "Actualizar".

import { puntosVentaWS, consultarComprobante, proximoNumero } from './arca-ws.js'
import { descifrar } from './crypto-ws.js'

// Escala del monotributo — TOPE de ingresos brutos anuales por categoría (ARCA).
// VIGENTE: agosto 2026 (ajuste del 16,8%). Hay que actualizar estos valores
// cuando ARCA publique la nueva escala (~enero y ~julio de cada año).
export const ESCALA_MONOTRIBUTO = {
  vigencia: 'Agosto 2026',
  topes: {
    A: 12009410, B: 17595182, C: 24670494, D: 30628651, E: 36028231,
    F: 45151659, G: 53995798, H: 81924660, I: 91699761, J: 105012519, K: 126610830,
  },
}

export function topeDeCategoria(cat) {
  if (!cat) return null
  return ESCALA_MONOTRIBUTO.topes[String(cat).toUpperCase()] ?? null
}

function certDeCred(cred) {
  if (!cred.ws_cert_pem || !cred.ws_cert_key_enc) {
    throw new Error('Tu certificado wsfe no está configurado.')
  }
  return { certPem: cred.ws_cert_pem, keyPem: descifrar(cred.ws_cert_key_enc) }
}

function isoHaceMeses(meses) {
  const d = new Date()
  d.setMonth(d.getMonth() - meses)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// Suma neta facturada (Facturas C menos Notas de Crédito C) de los últimos
// `meses`, recorriendo comprobante por comprobante en ARCA. Devuelve el total,
// cuántos comprobantes leyó y si se cortó por el tope de seguridad (aproximado).
export async function resumenFacturacionFlow({ supabaseAdmin, userId, meses = 12 }) {
  const { data: cred, error } = await supabaseAdmin
    .from('credenciales_arca')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!cred) throw new Error('No tenés configuración ARCA cargada')
  if (cred.activa === false) throw new Error('Tu cuenta de ARCA está desconectada.')

  const cuit = cred.cuit
  const { certPem, keyPem } = certDeCred(cred)

  // 1) Puntos de venta del usuario (todos los habilitados para WS).
  let puntos = []
  try {
    const pv = await puntosVentaWS({ cuit, certPem, keyPem })
    puntos = (pv.puntos || []).map((p) => Number(p.Nro)).filter(Boolean)
  } catch (e) {
    console.log('[FACT-ANUAL] no se pudieron listar puntos de venta:', String((e && e.message) || e))
  }
  // Aseguramos incluir el punto de venta guardado (el que usa la app para emitir).
  if (cred.punto_venta_ws && !puntos.includes(Number(cred.punto_venta_ws))) {
    puntos.push(Number(cred.punto_venta_ws))
  }
  if (!puntos.length) throw new Error('No se encontraron puntos de venta para consultar')

  const corte = isoHaceMeses(meses) // ISO YYYY-MM-DD: no contamos comprobantes anteriores a esta fecha
  const MAX_LEIDOS = 800 // tope de seguridad para no colgarnos con cuentas enormes

  let total = 0
  let leidos = 0
  let aproximado = false

  for (const pv of puntos) {
    for (const tipo of ['Factura C', 'Nota de Crédito C']) {
      let ultimo = 0
      try {
        const r = await proximoNumero({ cuit, pv, tipo, certPem, keyPem })
        ultimo = r.ultimo
      } catch (e) {
        // Ese tipo puede no existir en ese punto de venta: seguimos.
        continue
      }
      // Recorremos de más nuevo a más viejo; cortamos al salir de la ventana.
      for (let nro = ultimo; nro >= 1; nro--) {
        if (leidos >= MAX_LEIDOS) { aproximado = true; break }
        let c
        try {
          c = await consultarComprobante({ cuit, pv, tipo, nro, certPem, keyPem })
        } catch (e) {
          continue
        }
        leidos++
        const fecha = c.fecha // ISO YYYY-MM-DD (o null)
        if (fecha && fecha < corte) break // ya salimos de los últimos `meses`
        const imp = Number(c.raw?.ImpTotal) || 0
        if (/nota de cr/i.test(tipo)) total -= imp
        else total += imp
      }
      if (aproximado) break
    }
    if (aproximado) break
  }

  total = Math.max(0, Math.round(total * 100) / 100)
  return { total, puntos: puntos.length, comprobantes: leidos, aproximado, meses }
}

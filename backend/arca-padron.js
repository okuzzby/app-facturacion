// Consulta al Padrón de ARCA (datos del contribuyente) por Web Service, usando
// el certificado propio del usuario. Trae Razón Social / Nombre, Domicilio fiscal
// e Inicio de actividades para completar el PDF de la factura.
//
// Requiere que el certificado esté AUTORIZADO para el servicio de padrón en el
// "Administrador de Relaciones" de ARCA (igual que wsfe).
import { AfipSoap } from 'facturajs'
import soap from 'soap'
import https from 'https'

// aws.afip.gov.ar suele exigir ciphers "viejos" con Node moderno.
function agente() {
  return new https.Agent({ ciphers: 'DEFAULT@SECLEVEL=1', minVersion: 'TLSv1' })
}

// Endpoints de producción del padrón (Sistema Registral).
const ENDPOINTS = {
  ws_sr_padron_a13: 'https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA13?WSDL',
  ws_sr_padron_a5: 'https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA5?WSDL',
  ws_sr_constancia_inscripcion:
    'https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA5?WSDL',
}

function tokenWsaa({ certPem, keyPem, cuit, servicio }) {
  const engine = new AfipSoap({
    certContents: certPem,
    privateKeyContents: keyPem,
    homo: false,
    cacheTokensPath: `/tmp/.wsaa-padron-${String(cuit).replace(/\D/g, '')}`,
    tokensExpireInHours: 12,
  })
  return engine.getTokens(servicio)
}

// Extrae los campos que nos interesan de la respuesta (persona física o jurídica).
function parsePersona(persona) {
  if (!persona) return {}
  const dg = persona.datosGenerales || persona
  const razonSocial =
    (dg.razonSocial && String(dg.razonSocial).trim()) ||
    [dg.apellido, dg.nombre].filter(Boolean).join(' ').trim() ||
    ''
  const dom = dg.domicilioFiscal || {}
  const domicilio = [
    dom.direccion,
    dom.localidad,
    dom.descripcionProvincia && dom.descripcionProvincia !== 'CIUDAD AUTONOMA BUENOS AIRES'
      ? dom.descripcionProvincia
      : dom.descripcionProvincia,
  ]
    .filter(Boolean)
    .join(' - ')
  // Inicio de actividades: la fecha más antigua de las actividades declaradas.
  let inicio = null
  const act = dg.actividad || persona.datosMonotributo?.actividadMonotributista
  const arr = Array.isArray(act) ? act : act ? [act] : []
  const fechas = arr.map((a) => a.periodo || a.fechaInicio || a.nomenclador).filter(Boolean)
  if (dg.fechaInscripcion) inicio = dg.fechaInscripcion
  else if (fechas.length) inicio = String(fechas.sort()[0])
  return { razonSocial, domicilio, inicio }
}

// Devuelve { ok, razonSocial, domicilio, inicio } o { ok:false, error }.
export async function datosPadron({ cuit, certPem, keyPem, servicio = 'ws_sr_padron_a13' }) {
  const cuitNum = Number(String(cuit).replace(/\D/g, ''))
  const wsdl = ENDPOINTS[servicio] || ENDPOINTS.ws_sr_padron_a13
  const cred = await tokenWsaa({ certPem, keyPem, cuit: cuitNum, servicio })
  const token = cred?.tokens?.token
  const sign = cred?.tokens?.sign
  if (!token || !sign) throw new Error('No se obtuvo token WSAA para ' + servicio)

  const client = await soap.createClientAsync(wsdl, {
    wsdl_options: { httpsAgent: agente() },
  })
  // Forzamos el agente TLS también en las llamadas.
  client.setHttpClient?.(client.httpClient)

  const metodo = /a13/.test(wsdl) ? 'getPersona' : 'getPersona_v2'
  const call = client[metodo + 'Async']
  if (!call) throw new Error('Método SOAP no encontrado: ' + metodo)
  const [res] = await call.call(client, {
    token,
    sign,
    cuitRepresentada: cuitNum,
    idPersona: cuitNum,
  })

  const persona =
    res?.personaReturn?.persona || res?.persona || res?.personaReturn || res || {}
  const datos = parsePersona(persona)
  return { ok: true, servicio, ...datos, raw: persona }
}

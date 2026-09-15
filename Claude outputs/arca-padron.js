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

// De un valor cualquiera del padrón devuelve la letra de categoría de monotributo
// (A..K) si la encuentra. Acepta "C", "Categoria C", "MONOTRIBUTO C", etc.
function normalizarCategoria(v) {
  if (v == null) return null
  const s = String(v).toUpperCase()
  const m = s.match(/(?:^|[^A-Z])([A-K])(?:$|[^A-Z])/)
  return m ? m[1] : null
}

// Busca recursivamente la categoría de monotributo en la respuesta del padrón.
// ARCA la devuelve con distinta forma según el servicio: a veces como string
// ("C"), a veces como objeto ({ descripcionCategoria: "C", idCategoria: ... }).
// Recorremos las claves que hablan de "categoría" y sacamos la letra A..K.
function buscarCategoria(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 6) return null
  for (const [k, v] of Object.entries(obj)) {
    if (/categor/i.test(k)) {
      if (typeof v === 'string' || typeof v === 'number') {
        const c = normalizarCategoria(v)
        if (c) return c
      } else if (v && typeof v === 'object') {
        for (const key of ['descripcionCategoria', 'categoria', 'descripcion', 'nombre', 'desc', 'codigo']) {
          const c = normalizarCategoria(v[key])
          if (c) return c
        }
        const c = buscarCategoria(v, depth + 1)
        if (c) return c
      }
    }
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') {
      const c = buscarCategoria(v, depth + 1)
      if (c) return c
    }
  }
  return null
}

// Extrae los campos que nos interesan de la respuesta (persona física o jurídica).
function parsePersona(persona) {
  if (!persona) return {}
  const dg = persona.datosGenerales || persona
  const razonSocial =
    (dg.razonSocial && String(dg.razonSocial).trim()) ||
    [dg.apellido, dg.nombre].filter(Boolean).join(' ').trim() ||
    ''
  // Nombre de pila (solo personas físicas). Se usa para el saludo "Hola, {nombre}".
  const nombre = (dg.nombre && String(dg.nombre).trim()) || ''
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

  // Categoría de monotributo (si el contribuyente es monotributista). La buscamos
  // en toda la persona porque ARCA la ubica en distintos lugares según el servicio.
  const dm = persona.datosMonotributo || dg.datosMonotributo || {}
  const categoria = buscarCategoria(persona)

  return { razonSocial, nombre, domicilio, inicio, categoria, datosMonotributo: dm }
}

// Devuelve { ok, razonSocial, domicilio, inicio } o { ok:false, error }.
// `cuit` es el CONSUMIDOR (dueño del certificado autorizado al padrón).
// `idPersona` es el CUIT a consultar; si no se pasa, se consulta el mismo `cuit`.
// Así, con UN certificado autorizado (el de la app) consultamos cualquier CUIT.
export async function datosPadron({ cuit, idPersona, certPem, keyPem, servicio = 'ws_sr_padron_a13' }) {
  const cuitNum = Number(String(cuit).replace(/\D/g, '')) // consumidor / representada
  const target = Number(String(idPersona ?? cuit).replace(/\D/g, '')) // a consultar
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
    idPersona: target,
  })

  const persona =
    res?.personaReturn?.persona || res?.persona || res?.personaReturn || res || {}
  const datos = parsePersona(persona)
  return { ok: true, servicio, ...datos, raw: persona }
}

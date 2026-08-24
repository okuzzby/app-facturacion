import { chromium } from 'playwright'
import pdfParse from 'pdf-parse/lib/pdf-parse.js'

const LOGIN_URL = 'https://auth.afip.gob.ar/contribuyente_/login.xhtml'
const RCEL_URL = 'https://fe.afip.gob.ar/rcel/jsp/index_bis.jsp'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

// Cronómetro para diagnóstico de velocidad. Se reinicia al empezar cada emisión.
const _timer = { t0: 0 }
function marcaT() {
  if (!_timer.t0) return ''
  return `[+${((Date.now() - _timer.t0) / 1000).toFixed(1)}s] `
}

async function abrir() {
  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  const context = await browser.newContext({
    viewport: { width: 1280, height: 820 },
    locale: 'es-AR',
    userAgent: UA,
  })
  const page = await context.newPage()
  return { browser, page }
}

async function captura(page) {
  try {
    if (!page) return null
    const buf = await page.screenshot({ fullPage: false })
    return buf.toString('base64')
  } catch {
    return null
  }
}

// Lista los campos (input/select/textarea) visibles de la página actual.
function dumpCampos(page) {
  return page.evaluate(() => {
    const visible = (el) => !!(el.offsetParent || el.offsetWidth || el.offsetHeight)
    return [...document.querySelectorAll('input, select, textarea')]
      .filter((el) => el.type !== 'hidden')
      .map((el) => {
        const o = {
          tag: el.tagName.toLowerCase(),
          type: el.type || '',
          name: el.name || '',
          id: el.id || '',
          vis: visible(el),
          ro: el.readOnly || false,
        }
        if (el.tagName.toLowerCase() === 'select') {
          o.opts = [...el.options].map((op) => op.textContent.trim()).slice(0, 12)
        } else {
          o.val = (el.value || '').slice(0, 20)
        }
        return o
      })
  })
}

// Hace clic en el botón "Continuar" y espera la navegación.
async function clickContinuar(page, pasos, etiqueta = 'Continuar') {
  const btn = page
    .locator(
      'input[type=button][value*="Continuar"], input[type=submit][value*="Continuar"], button:has-text("Continuar")'
    )
    .first()
  await btn.click({ timeout: 20000 })
  await page.waitForLoadState('domcontentloaded', { timeout: 60000 }).catch(() => {})
  // En vez de dormir fijo, esperamos a que la red se aquiete (JSF terminó de
  // renderar). Timeout corto para que NUNCA cuelgue si ARCA hace polling.
  await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {})
  await page.waitForTimeout(300)
  pasos.push(`${marcaT()}${etiqueta} → Continuar`)
}

// Encuentra el <select> que contiene una opción que matchea regexOpcion, y
// elige la opción que matchea regexElegir.
async function selectConOpcion(page, regexOpcion, regexElegir) {
  const selects = page.locator('select')
  const n = await selects.count()
  for (let i = 0; i < n; i++) {
    const s = selects.nth(i)
    const pares = await s
      .locator('option')
      .evaluateAll((os) => os.map((o) => ({ value: o.value, text: (o.textContent || '').trim() })))
    if (pares.some((p) => regexOpcion.test(p.text))) {
      const target = pares.find((p) => regexElegir.test(p.text))
      if (target) {
        await s.selectOption({ value: target.value })
        return target.text
      }
      return null
    }
  }
  return null
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Elige, en el <select> indicado por `selector`, la opción cuyo texto matchea
// `regexText`. Selecciona por VALUE interno (evita problemas de espacios).
async function elegirEnSelect(page, selector, regexText) {
  const loc = page.locator(selector).first()
  const pares = await loc
    .locator('option')
    .evaluateAll((os) => os.map((o) => ({ value: o.value, text: (o.textContent || '').trim() })))
  const t = pares.find((p) => regexText.test(p.text))
  if (t) {
    await loc.selectOption({ value: t.value })
    return t.text
  }
  return null
}

// Aprieta "Imprimir..." y captura el PDF del comprobante (por popup o descarga).
async function capturarPdf(destino) {
  const context = destino.context()
  const btn = destino
    .locator('input[value*="Imprimir"], button:has-text("Imprimir")')
    .first()
  try {
    // Preparamos ambos listeners ANTES del click. La descarga suele dispararse
    // en 1-2s y resuelve apenas ocurre (no esperamos el timeout completo).
    const downloadP = destino.waitForEvent('download', { timeout: 9000 }).catch(() => null)
    const popupP = context.waitForEvent('page', { timeout: 9000 }).catch(() => null)
    await btn.click({ timeout: 15000 }).catch(() => {})

    const download = await downloadP
    if (download) {
      const stream = await download.createReadStream()
      const chunks = []
      for await (const ch of stream) chunks.push(ch)
      const buf = Buffer.concat(chunks)
      return { base64: buf.toString('base64'), via: 'download', bytes: buf.length }
    }
    const popup = await popupP
    if (popup) {
      await popup.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {})
      const url = popup.url()
      const resp = await context.request.get(url).catch(() => null)
      if (resp) {
        const buf = await resp.body()
        return { base64: buf.toString('base64'), via: 'popup', url, bytes: buf.length }
      }
      return { base64: null, via: 'popup-sin-cuerpo', url }
    }
    return { base64: null, via: 'sin-popup-ni-descarga' }
  } catch (e) {
    return { base64: null, via: 'error', error: String((e && e.message) || e) }
  }
}

function extraerNumero(texto) {
  // Caso ARCA: pdf-parse deja las etiquetas juntas y los valores pegados debajo:
  //   "Punto de Venta:Comp. Nro:\n0000100000009"  ->  PV=00001, Nro=00000009
  // (13 dígitos = 5 de PV + 8 de número). Es la fuente más confiable.
  const junto = texto.match(/Punto de Venta:\s*Comp\.?\s*Nro\.?:?\s*(\d{13})/i)
  if (junto) {
    const d = junto[1]
    return `${d.slice(0, 5)}-${d.slice(5)}`
  }
  // Caso separado: "Punto de Venta: 00001  Comp. Nro: 00000813"
  // El lookahead (?!\d) evita cortar el número si tiene ceros a la izquierda.
  const pv = (texto.match(/Punto de Venta:?\s*(\d{1,5})(?!\d)/i) || [])[1]
  const nro = (texto.match(/Comp\.?\s*Nro\.?:?\s*(\d{1,8})(?!\d)/i) || [])[1]
  if (pv && nro) return `${pv.padStart(5, '0')}-${nro.padStart(8, '0')}`
  // Fallback: patrón explícito NNNNN-NNNNNNNN
  const m = texto.match(/(\d{4,5})\s*-\s*(\d{7,8})/)
  if (m) return `${m[1]}-${m[2]}`
  return nro ? nro.padStart(8, '0') : null
}

// Login con Clave Fiscal. Deja la sesión abierta en el portal.
async function loginEnArca(page, cuit, clave, pasos) {
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
  const cuitLimpio = String(cuit).replace(/[^0-9]/g, '')
  await page.waitForSelector('[id="F1:username"]', { timeout: 30000 })
  await page.fill('[id="F1:username"]', cuitLimpio)
  pasos.push('CUIT ingresado')
  await page.click('[id="F1:btnSiguiente"]')
  await page.waitForSelector('[id="F1:password"]', { timeout: 30000 })
  await page.fill('[id="F1:password"]', clave)
  pasos.push('Clave ingresada')
  await page.click('[id="F1:btnIngresar"]')
  // No esperamos networkidle completo del portal (SPA que puede seguir pidiendo
  // datos). Con domcontentloaded + un colchón acotado alcanza; el buscador del
  // portal se auto-espera después en entrarARcel.
  await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {})
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {})
  pasos.push('Login OK')
}

const RUIDO = /^(salir|ingresar|volver|continuar|aceptar|cancelar|limpiar|siguiente|ayuda|inicio)$/i

const PORTAL_URL = 'https://portalcf.cloud.afip.gob.ar/portal/app/'

// Desde el portal (ya logueado), busca y abre "Comprobantes en línea".
// No se puede entrar directo a la URL de RCEL (da Forbidden): hay que
// clickear el servicio en el portal para que ARCA habilite el acceso.
async function entrarARcel(page, pasos) {
  const context = page.context()
  if (!page.url().includes('portalcf')) {
    await page
      .goto(PORTAL_URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
      .catch(() => {})
  }
  // El buscador se auto-espera al hacer fill; solo dejamos un colchón chico.
  await page.waitForTimeout(600)
  pasos.push('En el portal, buscando el servicio')

  // Buscar "Comprobantes en línea" en el buscador del portal
  const buscador = page
    .locator(
      '#buscadorInput, input[placeholder*="Busc"], input[placeholder*="busc"], input[type="search"]'
    )
    .first()
  try {
    await buscador.fill('Comprobantes en línea', { timeout: 12000 })
    await page.waitForTimeout(800)
    pasos.push('Servicio buscado en el portal')
  } catch {
    pasos.push('No se encontró el buscador; intento clickear por texto')
  }

  // Click en el resultado VISIBLE del buscador. Apuntamos al subtítulo
  // (único del resultado real) y forzamos que sea visible, para no caer en
  // una copia oculta del texto "Comprobantes en línea".
  const resultado = page
    .getByText(/sistema de emisi[oó]n de comprobantes electr[oó]nicos/i)
    .and(page.locator(':visible'))
    .first()
  await resultado.waitFor({ state: 'visible', timeout: 15000 })
  await resultado.scrollIntoViewIfNeeded().catch(() => {})
  const [popup] = await Promise.all([
    context.waitForEvent('page', { timeout: 15000 }).catch(() => null),
    resultado.click({ timeout: 15000 }),
  ])
  const destino = popup || page
  await destino.waitForLoadState('domcontentloaded', { timeout: 60000 }).catch(() => {})
  await destino.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {})
  await destino.waitForTimeout(500)
  pasos.push('Servicio abierto (RCEL)')
  return destino
}

// Login + entra a RCEL y devuelve la lista de empresas a representar.
export async function listarEmpresasArca(cuit, clave) {
  const pasos = []
  let browser
  let page
  try {
    ;({ browser, page } = await abrir())
    await loginEnArca(page, cuit, clave, pasos)

    const destino = await entrarARcel(page, pasos)

    const candidatas = await destino.$$eval(
      'input[type=button], input[type=submit], button, a',
      (els) => els.map((el) => (el.value || el.textContent || '').trim())
    )
    const empresas = [...new Set(candidatas)].filter(
      (t) => t && t.length > 3 && !/^\s*$/.test(t)
    )
    // Quitar textos que claramente no son empresas
    const filtradas = empresas.filter((t) => !RUIDO.test(t))

    pasos.push(`Empresas detectadas: ${filtradas.length}`)
    return {
      ok: true,
      url: destino.url(),
      title: await destino.title().catch(() => null),
      empresas: filtradas,
      pasos,
      screenshot: await captura(destino),
    }
  } catch (e) {
    return {
      ok: false,
      error: String((e && e.message) || e),
      url: page ? page.url() : null,
      pasos,
      screenshot: await captura(page),
    }
  } finally {
    if (browser) await browser.close()
  }
}

// Desde el login: entra a RCEL, selecciona la empresa y abre "Generar
// Comprobantes". Devuelve la página que quedó en el paso 1 del formulario.
async function irAGenerarComprobante(page, empresa, pasos) {
  const destino = await entrarARcel(page, pasos)

  pasos.push(`Seleccionando empresa: ${empresa}`)
  const btnEmpresa = destino
    .locator(
      `input[value="${empresa}"], button:has-text("${empresa}"), a:has-text("${empresa}")`
    )
    .first()
  await btnEmpresa.click({ timeout: 20000 })
  await destino.waitForLoadState('domcontentloaded', { timeout: 60000 }).catch(() => {})
  await destino.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {})
  await destino.waitForTimeout(500)
  pasos.push('Empresa seleccionada (menú RCEL)')

  const generar = destino
    .getByText(/generar comprobantes/i)
    .and(destino.locator(':visible'))
    .first()
  await generar.click({ timeout: 20000 })
  await destino.waitForLoadState('domcontentloaded', { timeout: 60000 }).catch(() => {})
  await destino.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {})
  // Esperamos a que el paso 1 tenga sus <select> (PV/Tipo) antes de seguir.
  await destino.locator('select').first().waitFor({ timeout: 15000 }).catch(() => {})
  await destino.waitForTimeout(400)
  pasos.push('En Generar Comprobantes (paso 1)')
  return destino
}

// Abre el formulario hasta el paso 1 y devuelve una captura. NO emite nada.
export async function abrirFormularioFactura(cuit, clave, empresa) {
  const pasos = []
  let browser
  let page
  let destino
  try {
    ;({ browser, page } = await abrir())
    await loginEnArca(page, cuit, clave, pasos)
    destino = await irAGenerarComprobante(page, empresa, pasos)
    return {
      ok: true,
      url: destino.url(),
      title: await destino.title().catch(() => null),
      pasos,
      screenshot: await captura(destino || page),
    }
  } catch (e) {
    return {
      ok: false,
      error: String((e && e.message) || e),
      url: (destino || page) ? (destino || page).url() : null,
      pasos,
      screenshot: await captura(destino || page),
    }
  } finally {
    if (browser) await browser.close()
  }
}

// Lee las opciones de Punto de Venta y Tipo de Comprobante del paso 1.
// El Tipo suele poblarse recién después de elegir un Punto de Venta, así que
// se selecciona el primero para poder leer los tipos. NO emite nada.
export async function leerOpcionesComprobante(cuit, clave, empresa) {
  const pasos = []
  let browser
  let page
  let destino
  try {
    ;({ browser, page } = await abrir())
    await loginEnArca(page, cuit, clave, pasos)
    destino = await irAGenerarComprobante(page, empresa, pasos)

    const selects = destino.locator('select')
    const pvSel = selects.nth(0)
    const tipoSel = selects.nth(1)

    const limpiar = (arr) =>
      arr.map((t) => t.trim()).filter((t) => t && !/seleccionar/i.test(t))

    const puntosVenta = limpiar(
      await pvSel.locator('option').evaluateAll((opts) => opts.map((o) => o.textContent))
    )

    // Seleccionar el primer punto de venta real para poblar los tipos
    if (puntosVenta.length) {
      await pvSel.selectOption({ index: 1 }).catch(() => {})
      await destino.waitForTimeout(2500)
      pasos.push('Punto de venta de prueba seleccionado')
    }

    const tiposComprobante = limpiar(
      await tipoSel.locator('option').evaluateAll((opts) => opts.map((o) => o.textContent))
    )

    pasos.push(`Puntos de venta: ${puntosVenta.length} · Tipos: ${tiposComprobante.length}`)
    return {
      ok: true,
      url: destino.url(),
      puntosVenta,
      tiposComprobante,
      pasos,
      screenshot: await captura(destino || page),
    }
  } catch (e) {
    return {
      ok: false,
      error: String((e && e.message) || e),
      url: (destino || page) ? (destino || page).url() : null,
      pasos,
      screenshot: await captura(destino || page),
    }
  } finally {
    if (browser) await browser.close()
  }
}

// Inspección: avanza hasta el paso 3 del formulario y devuelve los campos
// reales de cada paso (para armar el llenado). NO emite nada.
export async function inspeccionarFactura(cuit, clave, empresa, pv, tipo) {
  const pasos = []
  const campos = {}
  let browser
  let page
  let destino
  try {
    ;({ browser, page } = await abrir())
    await loginEnArca(page, cuit, clave, pasos)
    destino = await irAGenerarComprobante(page, empresa, pasos)

    // Paso previo: Punto de Venta + Tipo de Comprobante
    const selects = destino.locator('select')
    const pvSel = selects.nth(0)
    const tipoSel = selects.nth(1)
    const pvPares = await pvSel
      .locator('option')
      .evaluateAll((os) => os.map((o) => ({ value: o.value, text: (o.textContent || '').trim() })))
    const pvCodigo = pv ? String(pv).split('-')[0].trim() : ''
    const pvT =
      pvPares.find((p) => pvCodigo && p.text.startsWith(pvCodigo)) ||
      pvPares.find((p) => p.text && !/seleccionar/i.test(p.text))
    if (pvT) await pvSel.selectOption({ value: pvT.value })
    await destino.waitForTimeout(2500)
    const tipoPares = await tipoSel
      .locator('option')
      .evaluateAll((os) => os.map((o) => ({ value: o.value, text: (o.textContent || '').trim() })))
    const tipoT =
      tipoPares.find((p) => p.text === tipo) || tipoPares.find((p) => /factura c/i.test(p.text))
    if (tipoT) await tipoSel.selectOption({ value: tipoT.value })
    pasos.push(`PV=${pvT ? pvT.text : '?'} · Tipo=${tipoT ? tipoT.text : '?'}`)
    await clickContinuar(destino, pasos, 'PV/Tipo')

    // PASO 1: Datos de Emisión (usamos "Productos" para evitar el período)
    campos.paso1 = await dumpCampos(destino)
    await selectConOpcion(destino, /Productos y Servicios/i, /^Productos$/i)
    pasos.push('Concepto = Productos')
    await clickContinuar(destino, pasos, 'Datos Emisión')

    // PASO 2: Receptor
    campos.paso2 = await dumpCampos(destino)
    await selectConOpcion(destino, /Consumidor Final/i, /^Consumidor Final$/i)
    await destino.waitForTimeout(800)
    await destino.evaluate(() => {
      const cbs = [...document.querySelectorAll('input[type=checkbox]')]
      for (const cb of cbs) {
        let t = ''
        if (cb.id) {
          const l = document.querySelector(`label[for="${cb.id}"]`)
          if (l) t = l.textContent
        }
        if (!t && cb.closest('label')) t = cb.closest('label').textContent
        if (!t) {
          let n = cb.nextSibling
          while (n) {
            if (n.nodeType === 3 && n.textContent.trim()) {
              t = n.textContent
              break
            }
            if (n.nodeType === 1) {
              t = n.textContent
              break
            }
            n = n.nextSibling
          }
        }
        if (/contado/i.test((t || '').trim()) && !cb.checked) {
          cb.click()
          break
        }
      }
    })
    pasos.push('Condición IVA = Consumidor Final · Contado tildado')
    await clickContinuar(destino, pasos, 'Receptor')

    // PASO 3: Operación (solo inspección)
    campos.paso3 = await dumpCampos(destino)
    pasos.push('En paso 3 (Datos de la Operación) — inspección')

    return {
      ok: true,
      url: destino.url(),
      title: await destino.title().catch(() => null),
      pasos,
      campos,
      screenshot: await captura(destino),
    }
  } catch (e) {
    return {
      ok: false,
      error: String((e && e.message) || e),
      url: (destino || page) ? (destino || page).url() : null,
      pasos,
      campos,
      screenshot: await captura(destino || page),
    }
  } finally {
    if (browser) await browser.close()
  }
}

// Mapa de condiciones de venta → id del checkbox en el paso 2.
const CV_MAP = {
  contado: '#formadepago1',
  'transferencia bancaria': '#formadepago6',
  transferencia: '#formadepago6',
  otra: '#formadepago7',
}

// Llena todo el formulario de factura. Si confirmar=false, se detiene en el
// Resumen (paso 4) SIN emitir. Si confirmar=true, emite la factura real.
export async function generarFactura(cuit, clave, empresa, pv, tipo, datos, confirmar = false, extra = {}) {
  const pasos = []
  const d = datos || {}
  let browser
  let page
  let destino
  _timer.t0 = Date.now() // arranca el cronómetro de diagnóstico
  try {
    ;({ browser, page } = await abrir())
    pasos.push(`${marcaT()}Browser lanzado`)
    await loginEnArca(page, cuit, clave, pasos)
    pasos.push(`${marcaT()}Login ARCA listo`)
    destino = await irAGenerarComprobante(page, empresa, pasos)
    pasos.push(`${marcaT()}En formulario (paso 1)`)

    // PV + Tipo (por valor interno)
    const selects = destino.locator('select')
    const pvSel = selects.nth(0)
    const tipoSel = selects.nth(1)
    const pvPares = await pvSel
      .locator('option')
      .evaluateAll((os) => os.map((o) => ({ value: o.value, text: (o.textContent || '').trim() })))
    const pvCodigo = pv ? String(pv).split('-')[0].trim() : ''
    const pvT =
      pvPares.find((p) => pvCodigo && p.text.startsWith(pvCodigo)) ||
      pvPares.find((p) => p.text && !/seleccionar/i.test(p.text))
    if (pvT) await pvSel.selectOption({ value: pvT.value })
    // Al elegir PV, ARCA repuebla el select de Tipo por AJAX. Esperamos a que
    // tenga opciones reales en vez de dormir 2.5s fijos.
    await tipoSel.locator('option').nth(2).waitFor({ timeout: 10000 }).catch(() => {})
    await destino.waitForTimeout(300)
    const tipoPares = await tipoSel
      .locator('option')
      .evaluateAll((os) => os.map((o) => ({ value: o.value, text: (o.textContent || '').trim() })))
    const tipoT =
      tipoPares.find((p) => p.text === tipo) ||
      (tipo && tipoPares.find((p) => p.text.toLowerCase().includes(String(tipo).toLowerCase()))) ||
      tipoPares.find((p) => /factura c/i.test(p.text))
    if (tipoT) await tipoSel.selectOption({ value: tipoT.value })
    pasos.push(`PV=${pvT ? pvT.text : '?'} · Tipo=${tipoT ? tipoT.text : '?'}`)
    await clickContinuar(destino, pasos, 'PV/Tipo')

    // PASO 1: Datos de Emisión
    const concepto = d.concepto || 'Productos'
    await elegirEnSelect(destino, '#idconcepto', new RegExp('^' + escapeRe(concepto) + '$', 'i'))
    await destino.waitForTimeout(500)
    if (/servicio/i.test(concepto)) {
      if (d.periodoDesde) await destino.locator('#fsd').fill(d.periodoDesde).catch(() => {})
      if (d.periodoHasta) await destino.locator('#fsh').fill(d.periodoHasta).catch(() => {})
      if (d.vtoPago) await destino.locator('#vencimientopago').fill(d.vtoPago).catch(() => {})
    }
    pasos.push('Concepto = ' + concepto)
    await clickContinuar(destino, pasos, 'Datos Emisión')

    // PASO 2: Receptor
    await elegirEnSelect(
      destino,
      '#idivareceptor',
      new RegExp('^' + escapeRe(d.condicionIva || 'Consumidor Final') + '$', 'i')
    )
    await destino.waitForTimeout(400)
    const conds = d.condicionesVenta && d.condicionesVenta.length ? d.condicionesVenta : ['Contado']
    const idsCV = conds
      .map((c) => CV_MAP[String(c).toLowerCase().trim()])
      .filter(Boolean)
      .map((s) => s.replace('#', ''))
    await destino.evaluate((ids) => {
      ids.forEach((id) => {
        const el = document.getElementById(id)
        if (el && !el.checked) el.click()
      })
    }, idsCV)
    await destino.waitForTimeout(500)
    pasos.push('IVA = ' + (d.condicionIva || 'Consumidor Final') + ' · Venta: ' + conds.join(', '))

    // Comprobante asociado (para Nota de Crédito): apunta a la factura original
    if (extra.comprobanteAsociado) {
      const a = extra.comprobanteAsociado
      await elegirEnSelect(
        destino,
        '#cmp_asoc_tipo',
        new RegExp('^' + escapeRe(a.tipo || 'Factura C') + '$', 'i')
      )
      await destino.locator('[name="cmpAsociadoPtoVta"]').first().fill(String(a.ptoVta || ''))
      await destino.locator('[name="cmpAsociadoNro"]').first().fill(String(a.nro || ''))
      if (a.fecha) {
        await destino
          .locator('[name="cmpAsociadoFechaEmision"]')
          .first()
          .fill(String(a.fecha))
          .catch(() => {})
      }
      await destino.waitForTimeout(500)
      pasos.push(`Comprobante asociado: ${a.tipo} ${a.ptoVta}-${a.nro}`)
    }

    await clickContinuar(destino, pasos, 'Receptor')

    // PASO 3: Datos de la Operación
    await destino.locator('#detalle_descripcion1').fill(String(d.producto || ''))
    await destino.locator('#detalle_cantidad1').fill('1')
    await elegirEnSelect(destino, '#detalle_medida1', /unidades/i)
    await destino.locator('#detalle_precio1').fill(String(d.precio || ''))
    await destino.locator('#detalle_precio1').press('Tab').catch(() => {})
    await destino.waitForTimeout(600)
    pasos.push(`Detalle: ${d.producto || ''} · $${d.precio || ''}`)
    await clickContinuar(destino, pasos, 'Operación')

    // PASO 4: Resumen
    await destino.waitForTimeout(700)
    pasos.push(`${marcaT()}En Resumen (paso 4)`)
    const shotResumen = await captura(destino)

    if (confirmar) {
      // 1) Botón "Confirmar Datos..." del resumen
      const btnDatos = destino
        .locator('input[value*="Confirmar"], button:has-text("Confirmar Datos")')
        .first()
      await btnDatos.click({ timeout: 20000 })
      // El click del modal siguiente ya auto-espera a que sea visible, así que
      // alcanza con un colchón chico para que aparezca el cartel de confirmación.
      await destino.waitForTimeout(600)
      pasos.push('Clic en "Confirmar Datos"')

      // 2) Cartel final "¿Confirma la Operación?" → botón "Confirmar" (exacto)
      const btnModal = destino
        .getByText('Confirmar', { exact: true })
        .and(destino.locator(':visible'))
        .first()
      await btnModal.click({ timeout: 20000 })
      await destino.waitForLoadState('domcontentloaded', { timeout: 60000 }).catch(() => {})
      // La señal de que ARCA terminó de emitir es la pantalla final con el botón
      // "Imprimir". Esperar por ese botón es más rápido y más confiable que un
      // sleep fijo: resuelve apenas está listo, y aguanta si ARCA tarda más.
      await destino
        .locator('input[value*="Imprimir"], button:has-text("Imprimir")')
        .first()
        .waitFor({ state: 'visible', timeout: 30000 })
        .catch(() => {})
      await destino.waitForTimeout(400)
      pasos.push(`${marcaT()}CONFIRMADO — factura emitida`)

      const shotFinal = await captura(destino)
      const finalText = await destino.evaluate(() => document.body.innerText).catch(() => '')

      // Capturar el PDF oficial y leer número/CAE
      const pdfInfo = await capturarPdf(destino)
      pasos.push(`${marcaT()}PDF capturado (${pdfInfo.via})`)
      let pdfText = ''
      if (pdfInfo.base64) {
        try {
          const parsed = await pdfParse(Buffer.from(pdfInfo.base64, 'base64'))
          pdfText = parsed.text || ''
        } catch (e) {
          pdfInfo.parseError = String((e && e.message) || e)
        }
      }

      const texto = `${pdfText}\n${finalText}`
      const numero = extraerNumero(texto)
      const cae =
        (texto.match(/CAE\s*N?º?\s*:?\s*(\d{14})/i) || [])[1] ||
        (texto.match(/\b(\d{14})\b/) || [])[1] ||
        null
      const caeVto =
        (texto.match(/(?:Vto\.?|Vencimiento)[^\d]{0,20}(\d{2}\/\d{2}\/\d{4})/i) || [])[1] || null
      const fecha =
        (texto.match(/Fecha de Emisi[oó]n:?\s*(\d{2}\/\d{2}\/\d{4})/i) || [])[1] || null

      pasos.push(`${marcaT()}FIN (total)`)
      console.log('[TIMING]', pasos.join(' | '))

      return {
        ok: true,
        emitida: true,
        url: destino.url(),
        numero,
        cae,
        caeVto,
        fecha,
        pdf: pdfInfo.base64 || null,
        pdfInfo: { via: pdfInfo.via, bytes: pdfInfo.bytes, url: pdfInfo.url, error: pdfInfo.error, parseError: pdfInfo.parseError },
        diagnostico: {
          finalText: (finalText || '').slice(0, 1200),
          pdfText: (pdfText || '').slice(0, 1200),
        },
        pasos,
        screenshot: shotFinal,
      }
    }

    return {
      ok: true,
      emitida: false,
      url: destino.url(),
      title: await destino.title().catch(() => null),
      pasos,
      screenshot: shotResumen,
    }
  } catch (e) {
    return {
      ok: false,
      error: String((e && e.message) || e),
      url: (destino || page) ? (destino || page).url() : null,
      pasos,
      screenshot: await captura(destino || page),
    }
  } finally {
    if (browser) await browser.close()
  }
}

// Inspección de la Nota de Crédito C: avanza hasta el paso 2 (donde está el
// "Comprobante Asociado") y devuelve los campos. NO emite nada.
export async function inspeccionarNotaCredito(cuit, clave, empresa, pv) {
  const pasos = []
  const campos = {}
  let browser
  let page
  let destino
  try {
    ;({ browser, page } = await abrir())
    await loginEnArca(page, cuit, clave, pasos)
    destino = await irAGenerarComprobante(page, empresa, pasos)

    // PV + Tipo = Nota de Crédito C
    const selects = destino.locator('select')
    const pvSel = selects.nth(0)
    const tipoSel = selects.nth(1)
    const pvPares = await pvSel
      .locator('option')
      .evaluateAll((os) => os.map((o) => ({ value: o.value, text: (o.textContent || '').trim() })))
    const pvCodigo = pv ? String(pv).split('-')[0].trim() : ''
    const pvT =
      pvPares.find((p) => pvCodigo && p.text.startsWith(pvCodigo)) ||
      pvPares.find((p) => p.text && !/seleccionar/i.test(p.text))
    if (pvT) await pvSel.selectOption({ value: pvT.value })
    await destino.waitForTimeout(2500)
    const tipoPares = await tipoSel
      .locator('option')
      .evaluateAll((os) => os.map((o) => ({ value: o.value, text: (o.textContent || '').trim() })))
    const tipoT = tipoPares.find((p) => /nota de cr[eé]dito c/i.test(p.text))
    if (tipoT) await tipoSel.selectOption({ value: tipoT.value })
    pasos.push(`Tipo=${tipoT ? tipoT.text : '?'} · tipos: ${tipoPares.map((p) => p.text).join(' | ')}`)
    await clickContinuar(destino, pasos, 'PV/Tipo')

    // PASO 1
    campos.paso1 = await dumpCampos(destino)
    await selectConOpcion(destino, /Productos y Servicios/i, /^Productos$/i)
    await clickContinuar(destino, pasos, 'Datos Emisión')

    // PASO 2: acá está el "Comprobante Asociado" de la NC
    campos.paso2 = await dumpCampos(destino)
    pasos.push('En paso 2 (Receptor + Comprobante Asociado) — inspección NC')

    return {
      ok: true,
      url: destino.url(),
      title: await destino.title().catch(() => null),
      pasos,
      campos,
      screenshot: await captura(destino),
    }
  } catch (e) {
    return {
      ok: false,
      error: String((e && e.message) || e),
      url: (destino || page) ? (destino || page).url() : null,
      pasos,
      campos,
      screenshot: await captura(destino || page),
    }
  } finally {
    if (browser) await browser.close()
  }
}

// Solo login (diagnóstico). No toca comprobantes.
export async function probarLoginArca(cuit, clave) {
  const pasos = []
  let browser
  let page
  try {
    ;({ browser, page } = await abrir())
    await loginEnArca(page, cuit, clave, pasos)
    await page.waitForTimeout(2000)
    return {
      ok: true,
      url: page.url(),
      title: await page.title().catch(() => null),
      pasos,
      screenshot: await captura(page),
    }
  } catch (e) {
    return {
      ok: false,
      error: String((e && e.message) || e),
      url: page ? page.url() : null,
      pasos,
      screenshot: await captura(page),
    }
  } finally {
    if (browser) await browser.close()
  }
}

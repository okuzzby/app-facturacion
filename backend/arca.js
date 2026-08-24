import { chromium } from 'playwright'
import pdfParse from 'pdf-parse/lib/pdf-parse.js'

const LOGIN_URL = 'https://auth.afip.gob.ar/contribuyente_/login.xhtml'
const RCEL_URL = 'https://fe.afip.gob.ar/rcel/jsp/index_bis.jsp'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

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
  await page.waitForTimeout(2500)
  pasos.push(`${etiqueta} → Continuar`)
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
    const [popup, download] = await Promise.all([
      context.waitForEvent('page', { timeout: 12000 }).catch(() => null),
      destino.waitForEvent('download', { timeout: 12000 }).catch(() => null),
      btn.click({ timeout: 15000 }).catch(() => {}),
    ])

    if (download) {
      const stream = await download.createReadStream()
      const chunks = []
      for await (const ch of stream) chunks.push(ch)
      const buf = Buffer.concat(chunks)
      return { base64: buf.toString('base64'), via: 'download', bytes: buf.length }
    }
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
  const m = texto.match(/(\d{4,5})\s*-\s*(\d{7,8})/)
  if (m) return `${m[1]}-${m[2]}`
  const pv = (texto.match(/Punto de Venta:?\s*(\d{3,5})/i) || [])[1]
  const nro = (texto.match(/Comp\.?\s*Nro:?\s*(\d{6,8})/i) || [])[1]
  if (pv && nro) return `${pv}-${nro}`
  return nro || null
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
  await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {})
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
  await page.waitForTimeout(2000)
  pasos.push('En el portal, buscando el servicio')

  // Buscar "Comprobantes en línea" en el buscador del portal
  const buscador = page
    .locator(
      '#buscadorInput, input[placeholder*="Busc"], input[placeholder*="busc"], input[type="search"]'
    )
    .first()
  try {
    await buscador.fill('Comprobantes en línea', { timeout: 12000 })
    await page.waitForTimeout(2500)
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
  await destino.waitForTimeout(2500)
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
  await destino.waitForTimeout(2500)
  pasos.push('Empresa seleccionada (menú RCEL)')

  const generar = destino
    .getByText(/generar comprobantes/i)
    .and(destino.locator(':visible'))
    .first()
  await generar.click({ timeout: 20000 })
  await destino.waitForLoadState('domcontentloaded', { timeout: 60000 }).catch(() => {})
  await destino.waitForTimeout(2500)
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
export async function generarFactura(cuit, clave, empresa, pv, tipo, datos, confirmar = false) {
  const pasos = []
  const d = datos || {}
  let browser
  let page
  let destino
  try {
    ;({ browser, page } = await abrir())
    await loginEnArca(page, cuit, clave, pasos)
    destino = await irAGenerarComprobante(page, empresa, pasos)

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
    await destino.waitForTimeout(2500)
    const tipoPares = await tipoSel
      .locator('option')
      .evaluateAll((os) => os.map((o) => ({ value: o.value, text: (o.textContent || '').trim() })))
    const tipoT = tipoPares.find((p) => p.text === tipo) || tipoPares.find((p) => /factura c/i.test(p.text))
    if (tipoT) await tipoSel.selectOption({ value: tipoT.value })
    pasos.push(`PV=${pvT ? pvT.text : '?'} · Tipo=${tipoT ? tipoT.text : '?'}`)
    await clickContinuar(destino, pasos, 'PV/Tipo')

    // PASO 1: Datos de Emisión
    const concepto = d.concepto || 'Productos'
    await elegirEnSelect(destino, '#idconcepto', new RegExp('^' + escapeRe(concepto) + '$', 'i'))
    await destino.waitForTimeout(1500)
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
    await destino.waitForTimeout(1000)
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
    await clickContinuar(destino, pasos, 'Receptor')

    // PASO 3: Datos de la Operación
    await destino.locator('#detalle_descripcion1').fill(String(d.producto || ''))
    await destino.locator('#detalle_cantidad1').fill('1')
    await elegirEnSelect(destino, '#detalle_medida1', /unidades/i)
    await destino.locator('#detalle_precio1').fill(String(d.precio || ''))
    await destino.locator('#detalle_precio1').press('Tab').catch(() => {})
    await destino.waitForTimeout(1200)
    pasos.push(`Detalle: ${d.producto || ''} · $${d.precio || ''}`)
    await clickContinuar(destino, pasos, 'Operación')

    // PASO 4: Resumen
    await destino.waitForTimeout(1500)
    pasos.push('En Resumen (paso 4)')
    const shotResumen = await captura(destino)

    if (confirmar) {
      // 1) Botón "Confirmar Datos..." del resumen
      const btnDatos = destino
        .locator('input[value*="Confirmar"], button:has-text("Confirmar Datos")')
        .first()
      await btnDatos.click({ timeout: 20000 })
      await destino.waitForTimeout(2500)
      pasos.push('Clic en "Confirmar Datos"')

      // 2) Cartel final "¿Confirma la Operación?" → botón "Confirmar" (exacto)
      const btnModal = destino
        .getByText('Confirmar', { exact: true })
        .and(destino.locator(':visible'))
        .first()
      await btnModal.click({ timeout: 20000 })
      await destino.waitForLoadState('domcontentloaded', { timeout: 60000 }).catch(() => {})
      await destino.waitForTimeout(4500)
      pasos.push('CONFIRMADO — factura emitida')

      const shotFinal = await captura(destino)
      const finalText = await destino.evaluate(() => document.body.innerText).catch(() => '')

      // Capturar el PDF oficial y leer número/CAE
      const pdfInfo = await capturarPdf(destino)
      pasos.push('PDF: ' + pdfInfo.via)
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

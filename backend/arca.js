import { chromium } from 'playwright'

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

  // Click en el resultado; puede abrir una pestaña nueva (popup)
  const opcion = page.getByText(/comprobantes en l[ií]nea/i).first()
  const [popup] = await Promise.all([
    context.waitForEvent('page', { timeout: 15000 }).catch(() => null),
    opcion.click({ timeout: 15000 }),
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

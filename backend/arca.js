import { chromium } from 'playwright'

const LOGIN_URL = 'https://auth.afip.gob.ar/contribuyente_/login.xhtml'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

// Intenta loguearse en ARCA (ex-AFIP) con Clave Fiscal y devuelve una captura
// de dónde quedó. NO emite ni toca comprobantes: solo login + screenshot.
export async function probarLoginArca(cuit, clave) {
  const pasos = []
  let browser
  let page

  const capturar = async () => {
    try {
      if (!page) return null
      const buf = await page.screenshot({ fullPage: false })
      return buf.toString('base64')
    } catch {
      return null
    }
  }

  try {
    browser = await chromium.launch({
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    })
    const context = await browser.newContext({
      viewport: { width: 1280, height: 820 },
      locale: 'es-AR',
      userAgent: UA,
    })
    page = await context.newPage()

    pasos.push('Abriendo el login de ARCA')
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 })

    // Paso 1: CUIT
    const cuitLimpio = String(cuit).replace(/[^0-9]/g, '')
    await page.waitForSelector('[id="F1:username"]', { timeout: 30000 })
    await page.fill('[id="F1:username"]', cuitLimpio)
    pasos.push('CUIT ingresado')
    await page.click('[id="F1:btnSiguiente"]')

    // Paso 2: Clave Fiscal
    await page.waitForSelector('[id="F1:password"]', { timeout: 30000 })
    await page.fill('[id="F1:password"]', clave)
    pasos.push('Clave ingresada')
    await page.click('[id="F1:btnIngresar"]')

    // Esperar a que cargue el portal después del login
    await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {})
    await page.waitForTimeout(3000)
    pasos.push('Terminó el login (revisar captura)')

    return {
      ok: true,
      url: page.url(),
      title: await page.title().catch(() => null),
      pasos,
      screenshot: await capturar(),
    }
  } catch (e) {
    return {
      ok: false,
      error: String((e && e.message) || e),
      url: page ? page.url() : null,
      title: page ? await page.title().catch(() => null) : null,
      pasos,
      screenshot: await capturar(),
    }
  } finally {
    if (browser) await browser.close()
  }
}

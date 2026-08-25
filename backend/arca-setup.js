// Onboarding automático (Opción A): con la Clave Fiscal del usuario, el RPA crea
// un certificado propio para su CUIT, lo autoriza al web service de facturación
// (wsfe) y lee sus datos. Todo por detrás; el usuario solo dio su clave.
//
// Este archivo se va construyendo por partes; primero, inspección para mapear
// las pantallas de WSASS.

import forge from 'node-forge'
import fs from 'fs'
import { abrir, loginEnArca, captura, dumpCampos } from './arca.js'

const PORTAL_URL = 'https://portalcf.cloud.afip.gob.ar/portal/app/'

// Genera clave privada + CSR (PKCS#10) con el CUIT en el serialNumber.
export function generarCsr(cuit, alias) {
  const keys = forge.pki.rsa.generateKeyPair(2048)
  const csr = forge.pki.createCertificationRequest()
  csr.publicKey = keys.publicKey
  csr.setSubject([
    { shortName: 'C', value: 'AR' },
    { shortName: 'O', value: 'APP FACTURACION' },
    { shortName: 'CN', value: alias },
    { name: 'serialNumber', value: `CUIT ${cuit}` },
  ])
  csr.sign(keys.privateKey, forge.md.sha256.create())
  return {
    privateKeyPem: forge.pki.privateKeyToPem(keys.privateKey),
    csrPem: forge.pki.certificationRequestToPem(csr),
  }
}

// Vuelca links/botones/inputs visibles de la página (para mapear navegación).
async function dumpNavegacion(page) {
  return page.evaluate(() => {
    const vis = (el) => !!(el.offsetParent || el.offsetWidth || el.offsetHeight)
    const links = [...document.querySelectorAll('a')]
      .filter(vis)
      .map((a) => (a.textContent || '').trim())
      .filter((t) => t && t.length > 1)
    const botones = [...document.querySelectorAll('input[type=button],input[type=submit],button')]
      .filter(vis)
      .map((b) => (b.value || b.textContent || '').trim())
      .filter(Boolean)
    const inputs = [...document.querySelectorAll('input,select,textarea')]
      .filter((el) => el.type !== 'hidden' && vis(el))
      .map((el) => ({ tag: el.tagName.toLowerCase(), type: el.type || '', name: el.name || '', id: el.id || '' }))
    return {
      links: [...new Set(links)].slice(0, 60),
      botones: [...new Set(botones)].slice(0, 40),
      inputs: inputs.slice(0, 40),
    }
  })
}

// Navega hasta el formulario "Agregar alias" de Administración de Certificados
// Digitales y devuelve la página (destino).
async function irAAgregarCertificado(page, pasos) {
  const context = page.context()
  if (!page.url().includes('portalcf')) {
    await page.goto(PORTAL_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {})
  }
  await page.waitForTimeout(1500)
  const buscador = page
    .locator('#buscadorInput, input[placeholder*="Busc"], input[placeholder*="busc"], input[type="search"]')
    .first()
  await buscador.fill('Administración de Certificados Digitales', { timeout: 12000 }).catch(() => {})
  await page.waitForTimeout(2000)
  const link = page
    .getByText(/Administraci[oó]n de Certificados Digitales/i)
    .and(page.locator(':visible'))
    .first()
  await link.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {})
  const [popup] = await Promise.all([
    context.waitForEvent('page', { timeout: 15000 }).catch(() => null),
    link.click({ timeout: 15000 }).catch(() => {}),
  ])
  const destino = popup || page
  await destino.waitForLoadState('domcontentloaded', { timeout: 60000 }).catch(() => {})
  await destino.waitForTimeout(2500)
  pasos.push('En Administración de Certificados Digitales')
  // Clic "Agregar alias"
  await destino
    .locator('#cmdIngresar, input[name="cmdIngresar"]')
    .first()
    .click({ timeout: 15000 })
    .catch(() => {})
  await destino.waitForLoadState('domcontentloaded', { timeout: 60000 }).catch(() => {})
  await destino.waitForTimeout(2500)
  pasos.push('En formulario Agregar alias')
  return destino
}

// Crea un certificado nuevo en ARCA (producción): genera el CSR, llena el alias,
// sube el CSR como archivo y captura el certificado resultante.
// Devuelve { ok, alias, certPem, privateKeyPem, screenshot, pasos }.
export async function crearCertificado(cuit, clave, alias) {
  const pasos = []
  let browser
  let page
  let destino
  const { privateKeyPem, csrPem } = generarCsr(cuit, alias)
  const tmpCsr = `/tmp/csr-${cuit}-${Date.now()}.csr`
  fs.writeFileSync(tmpCsr, csrPem)
  try {
    ;({ browser, page } = await abrir())
    await loginEnArca(page, cuit, clave, pasos)
    destino = await irAAgregarCertificado(page, pasos)

    await destino.locator('#txtAliasCertificado').fill(alias, { timeout: 15000 })
    await destino.locator('#archivo').setInputFiles(tmpCsr)
    pasos.push(`Alias "${alias}" + CSR cargados`)

    const context = destino.context()
    const downloadP = destino.waitForEvent('download', { timeout: 12000 }).catch(() => null)
    const popupP = context.waitForEvent('page', { timeout: 12000 }).catch(() => null)
    await destino
      .locator('#cmdIngresar, input[name="cmdIngresar"]')
      .first()
      .click({ timeout: 15000 })
      .catch(() => {})
    await destino.waitForLoadState('domcontentloaded', { timeout: 60000 }).catch(() => {})
    await destino.waitForTimeout(4000)

    const buscarPem = (s) => {
      const m = String(s || '').match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/)
      return m ? m[0] : null
    }

    let certPem = null
    let via = 'pagina'
    const download = await downloadP
    if (download) {
      const stream = await download.createReadStream()
      const chunks = []
      for await (const ch of stream) chunks.push(ch)
      certPem = buscarPem(Buffer.concat(chunks).toString('utf8'))
      if (certPem) via = 'download'
    }

    // Textos de la página (innerText + valores de textarea/input)
    const scrape = async (pg) => {
      if (!pg) return { url: null, text: '', fieldVals: [] }
      const text = await pg.evaluate(() => document.body?.innerText || '').catch(() => '')
      const fieldVals = await pg
        .evaluate(() =>
          [...document.querySelectorAll('textarea, input[type=text], pre')]
            .map((el) => el.value || el.textContent || '')
            .filter((v) => v && v.length > 40)
        )
        .catch(() => [])
      return { url: pg.url(), text: text.slice(0, 1500), fieldVals }
    }

    const popup = await popupP
    const dPage = await scrape(destino)
    const dPopup = popup ? await scrape(popup) : null

    if (!certPem) {
      const candidatos = [dPage.text, ...(dPage.fieldVals || [])]
      if (dPopup) candidatos.push(dPopup.text, ...(dPopup.fieldVals || []))
      for (const c of candidatos) {
        const p = buscarPem(c)
        if (p) {
          certPem = p
          via = dPopup && buscarPem(dPopup.text) ? 'popup' : 'campo'
          break
        }
      }
    }
    pasos.push(`Resultado (${via})${certPem ? ' — certificado capturado' : ' — sin certificado'}`)

    return {
      ok: !!certPem,
      alias,
      certPem: certPem || null,
      privateKeyPem: certPem ? privateKeyPem : null,
      via,
      url: destino.url(),
      diag: {
        pageUrl: dPage.url,
        pageText: dPage.text,
        pageFields: (dPage.fieldVals || []).map((v) => v.slice(0, 80)),
        popupUrl: dPopup?.url || null,
        popupText: dPopup?.text || null,
      },
      pasos,
      screenshot: await captura(popup || destino),
    }
  } catch (e) {
    return {
      ok: false,
      error: String((e && e.message) || e),
      pasos,
      screenshot: await captura(destino || page),
    }
  } finally {
    try {
      fs.unlinkSync(tmpCsr)
    } catch {}
    if (browser) await browser.close()
  }
}

// Entra al portal, busca "Administración de Certificados Digitales", lo abre y
// devuelve una captura + el mapa de la pantalla de adentro. NO crea nada.
export async function inspeccionarWSASS(cuit, clave, termino = 'Certificados') {
  const pasos = []
  let browser
  let page
  let destino
  try {
    ;({ browser, page } = await abrir())
    await loginEnArca(page, cuit, clave, pasos)

    const context = page.context()
    if (!page.url().includes('portalcf')) {
      await page.goto(PORTAL_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {})
    }
    await page.waitForTimeout(1500)

    const buscador = page
      .locator('#buscadorInput, input[placeholder*="Busc"], input[placeholder*="busc"], input[type="search"]')
      .first()
    await buscador.fill('Administración de Certificados Digitales', { timeout: 12000 }).catch(() => {})
    await page.waitForTimeout(2000)
    pasos.push('Buscado: Administración de Certificados Digitales')

    // Abrir el servicio (suele abrirse en una pestaña nueva)
    const link = page
      .getByText(/Administraci[oó]n de Certificados Digitales/i)
      .and(page.locator(':visible'))
      .first()
    await link.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {})
    const [popup] = await Promise.all([
      context.waitForEvent('page', { timeout: 15000 }).catch(() => null),
      link.click({ timeout: 15000 }).catch(() => {}),
    ])
    destino = popup || page
    await destino.waitForLoadState('domcontentloaded', { timeout: 60000 }).catch(() => {})
    await destino.waitForTimeout(2500)
    pasos.push('Abierto Administración de Certificados Digitales')

    // Volcamos los alias/certificados ya existentes
    const aliasExistentes = await destino.evaluate(() =>
      [...document.querySelectorAll('table tr')]
        .map((tr) => (tr.textContent || '').replace(/\s+/g, ' ').trim())
        .filter((t) => t && t.length < 120)
        .slice(0, 20)
    ).catch(() => [])

    // Clic en "Agregar alias" para ver el formulario de creación
    await destino
      .locator('#cmdIngresar, input[name="cmdIngresar"], input[value*="Agregar"], a:has-text("Agregar")')
      .first()
      .click({ timeout: 15000 })
      .catch(() => {})
    await destino.waitForLoadState('domcontentloaded', { timeout: 60000 }).catch(() => {})
    await destino.waitForTimeout(2500)
    pasos.push('Clic en "Agregar alias"')

    return {
      ok: true,
      url: destino.url(),
      title: await destino.title().catch(() => null),
      pasos,
      aliasExistentes,
      nav: await dumpNavegacion(destino),
      campos: await dumpCampos(destino).catch(() => null),
      screenshot: await captura(destino),
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

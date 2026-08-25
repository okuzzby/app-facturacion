// Onboarding automático (Opción A): con la Clave Fiscal del usuario, el RPA crea
// un certificado propio para su CUIT, lo autoriza al web service de facturación
// (wsfe) y lee sus datos. Todo por detrás; el usuario solo dio su clave.
//
// Este archivo se va construyendo por partes; primero, inspección para mapear
// las pantallas de WSASS.

import forge from 'node-forge'
import { abrir, loginEnArca, captura } from './arca.js'

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

// Inspección: entra al portal, busca el servicio (WSASS/certificados) y devuelve
// una captura + el mapa de navegación. NO crea ni autoriza nada.
export async function inspeccionarWSASS(cuit, clave, termino = 'Certificados') {
  const pasos = []
  let browser
  let page
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
    let dumpBusqueda = null
    try {
      await buscador.fill(termino, { timeout: 12000 })
      await page.waitForTimeout(2000)
      pasos.push(`Buscado en el portal: ${termino}`)
      // Capturamos las opciones que ofrece el buscador
      dumpBusqueda = await page.evaluate(() =>
        [...document.querySelectorAll('a, li, .resultado, [class*="result"]')]
          .map((e) => (e.textContent || '').trim())
          .filter((t) => t && t.length > 3 && t.length < 120)
          .slice(0, 40)
      )
    } catch {
      pasos.push('No se encontró el buscador del portal')
    }

    return {
      ok: true,
      url: page.url(),
      title: await page.title().catch(() => null),
      pasos,
      resultadosBusqueda: [...new Set(dumpBusqueda || [])],
      nav: await dumpNavegacion(page),
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

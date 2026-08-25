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
    const buscarPem = (s) => {
      const m = String(s || '').match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/)
      return m ? m[0] : null
    }
    const derAPem = (buf) => {
      try {
        const asn1 = forge.asn1.fromDer(forge.util.createBuffer(buf.toString('binary')))
        return forge.pki.certificateToPem(forge.pki.certificateFromAsn1(asn1))
      } catch {
        return null
      }
    }
    const bytesACert = (buf) => buscarPem(buf.toString('utf8')) || derAPem(buf)

    // 1) Enviar el formulario -> ARCA crea el cert y vuelve a la lista.
    await destino
      .locator('#cmdIngresar, input[name="cmdIngresar"]')
      .first()
      .click({ timeout: 15000 })
      .catch(() => {})
    await destino.waitForLoadState('domcontentloaded', { timeout: 60000 }).catch(() => {})
    await destino.waitForTimeout(3000)
    pasos.push('Certificado creado — de vuelta en la lista')

    // 2) Clic en el primer "Ver" (el alias recién creado aparece primero) -> detalle.
    await destino
      .locator('a')
      .filter({ hasText: /^\s*Ver\s*$/ })
      .first()
      .click({ timeout: 15000 })
      .catch(() => {})
    await destino.waitForLoadState('domcontentloaded', { timeout: 60000 }).catch(() => {})
    await destino.waitForTimeout(3000)
    pasos.push('En el detalle del certificado')

    let certPem = null
    let via = 'sin'

    // ¿El PEM ya está en el texto de la página?
    const scrapeAll = async (pg) => {
      if (!pg) return []
      const out = []
      for (const fr of pg.frames()) {
        const t = await fr
          .evaluate(() => {
            const body = document.body ? document.body.innerText : ''
            const fields = [...document.querySelectorAll('textarea, input[type=text], pre')].map(
              (e) => e.value || e.textContent || ''
            )
            return [body, ...fields]
          })
          .catch(() => [])
        out.push(...t)
      }
      return out.filter((s) => s && s.length > 20)
    }
    for (const c of await scrapeAll(destino)) {
      const p = buscarPem(c)
      if (p) {
        certPem = p
        via = 'texto'
        break
      }
    }

    // 3) Si no está, apretar "Descargar" y bajar el archivo del certificado.
    const detalleEls = await destino
      .evaluate(() =>
        [...document.querySelectorAll('a, input, img, button')]
          .map((e) => ({
            tag: e.tagName,
            text: (e.textContent || e.value || e.alt || '').trim().slice(0, 30),
            href: e.getAttribute('href'),
            onclick: (e.getAttribute('onclick') || '').slice(0, 100),
            src: (e.getAttribute('src') || '').slice(-50),
            id: e.id || '',
            name: e.name || '',
          }))
          .filter((e) =>
            /descarg|\.cer|\.crt|\.pem|certificad|download/i.test(
              (e.text || '') + (e.href || '') + (e.onclick || '') + (e.src || '') + (e.name || '')
            )
          )
      )
      .catch(() => [])

    if (!certPem) {
      const dlP = destino.waitForEvent('download', { timeout: 15000 }).catch(() => null)
      // "Descargar" es un input[type=image] con alt "Descargar" (postback ASP.NET).
      const btnDesc = destino
        .locator('input[type=image][alt*="Descargar" i], input[alt="Descargar"]')
        .first()
      if (await btnDesc.count().catch(() => 0)) {
        await btnDesc.click({ timeout: 15000 }).catch(() => {})
      } else {
        await destino
          .getByRole('button', { name: /descargar/i })
          .first()
          .click({ timeout: 15000 })
          .catch(() => {})
      }
      await destino.waitForTimeout(2500)
      const dl = await dlP
      if (dl) {
        const stream = await dl.createReadStream()
        const chunks = []
        for await (const ch of stream) chunks.push(ch)
        certPem = bytesACert(Buffer.concat(chunks))
        if (certPem) via = 'descarga'
      }
      // Si no fue descarga, tal vez el cert quedó en el texto de la página.
      if (!certPem) {
        for (const c of await scrapeAll(destino)) {
          const p = buscarPem(c)
          if (p) {
            certPem = p
            via = 'texto2'
            break
          }
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
        destinoUrl: destino.url(),
        detalleEls,
      },
      pasos,
      screenshot: await captura(destino),
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

// Inspecciona el "Administrador de Relaciones" (donde se autoriza el cert al
// servicio wsfe). Abre el servicio y devuelve captura + mapa. NO cambia nada.
export async function inspeccionarRelaciones(cuit, clave) {
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
    await buscador.fill('Administrador de Relaciones', { timeout: 12000 }).catch(() => {})
    await page.waitForTimeout(2000)
    pasos.push('Buscado: Administrador de Relaciones')
    const link = page
      .getByText(/Administrador de Relaciones/i)
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
    pasos.push('Abierto Administrador de Relaciones')

    // Seleccionar el contribuyente = el propio CUIT del usuario (si hay dropdown).
    const sel = destino
      .locator('#tblAutoridadAplicacion_cmbCont, select[name="tblAutoridadAplicacion:cmbCont"], select')
      .first()
    if (await sel.count().catch(() => 0)) {
      const opts = await sel
        .locator('option')
        .evaluateAll((os) => os.map((o) => ({ value: o.value, text: (o.textContent || '').trim() })))
      const cuitDigits = String(cuit).replace(/\D/g, '')
      const target = opts.find((o) => o.text.replace(/\D/g, '').includes(cuitDigits))
      if (target) {
        await sel.selectOption({ value: target.value }).catch(() => {})
        await destino.waitForLoadState('domcontentloaded', { timeout: 60000 }).catch(() => {})
        await destino.waitForTimeout(2500)
        pasos.push('Contribuyente seleccionado: ' + target.text)
      } else {
        pasos.push('No se encontró el contribuyente en el dropdown')
      }
    }

    // Clic en "Nueva Relación" para crear la autorización del servicio.
    const btnNueva = destino
      .locator('#cmdNuevaRelacion, input[name="cmdNuevaRelacion"]')
      .first()
    if (await btnNueva.count().catch(() => 0)) {
      await btnNueva.click({ timeout: 15000 }).catch(() => {})
      await destino.waitForLoadState('domcontentloaded', { timeout: 60000 }).catch(() => {})
      await destino.waitForTimeout(2500)
      pasos.push('Clic en Nueva Relación')
    }

    // Representado = el propio usuario.
    const cboRep = destino.locator('#cboRepresentado, select[name="cboRepresentado"]').first()
    if (await cboRep.count().catch(() => 0)) {
      const opts = await cboRep
        .locator('option')
        .evaluateAll((os) => os.map((o) => ({ value: o.value, text: (o.textContent || '').trim() })))
      const cd = String(cuit).replace(/\D/g, '')
      const t = opts.find((o) => o.text.replace(/\D/g, '').includes(cd))
      if (t) {
        await cboRep.selectOption({ value: t.value }).catch(() => {})
        await destino.waitForTimeout(1000)
        pasos.push('Representado = ' + t.text)
      }
    }

    // Buscar servicio -> abre la lista de organismos.
    const btnBuscar = destino.locator('#cmdBuscarServicio, input[name="cmdBuscarServicio"]').first()
    if (await btnBuscar.count().catch(() => 0)) {
      await btnBuscar.click({ timeout: 15000 }).catch(() => {})
      await destino.waitForLoadState('domcontentloaded', { timeout: 60000 }).catch(() => {})
      await destino.waitForTimeout(2500)
      pasos.push('Clic en Buscar servicio')
    }

    // El árbol de servicios ya está en el DOM: cada servicio es un link
    // setService('relationAdd','web://<id>'). Listamos los relacionados a factura.
    const serviciosTree = await destino
      .evaluate(() =>
        [...document.querySelectorAll('a[href*="setService"]')]
          .map((a) => ({
            text: (a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 70),
            href: (a.getAttribute('href') || '').slice(0, 120),
          }))
          .filter((s) => /facturaci[oó]n electr|wsfe|comprobantes t|constataci/i.test(s.text))
      )
      .catch(() => [])

    const totalServicios = await destino
      .evaluate(() => document.querySelectorAll('a[href*="setService"]').length)
      .catch(() => 0)

    return {
      ok: true,
      url: destino.url(),
      title: await destino.title().catch(() => null),
      pasos,
      diag: { totalServicios, serviciosTree },
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

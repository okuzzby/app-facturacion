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

// ============================================================================
// ONBOARDING REAL: crea un certificado nuevo para el CUIT del usuario y lo
// AUTORIZA al web service wsfe dentro del "Administrador de Relaciones".
// Devuelve { ok, alias, certPem, privateKeyPem, autorizado, pasos, screenshot }.
// El endpoint (server.js) cifra la clave privada y la guarda; NUNCA se devuelve
// al frontend.
//
// Flujo mapeado y validado (dry-run) en sesiones previas:
//   login -> Administrador de Relaciones -> elegir contribuyente
//   -> nav directo relationAdd.aspx?representado=<cuit>&servicename=ws://wsfe
//   -> click #cmdBuscarUsuario -> userSearch.aspx
//   -> elegir el alias nuevo en #cboComputadoresAdministrados (autopostback)
//   -> click CONFIRMAR (#cmdSeleccionarServicio, confirmar.gif) -> crea relación
//   -> (defensivo) segundo CONFIRMAR si aparece pantalla de resumen
// ============================================================================
export async function configurarWsfe(cuit, clave, aliasForzado) {
  const pasos = []
  const alias = aliasForzado || 'app' + String(Date.now()).slice(-8)

  // --- Paso 1: crear el certificado (abre/cierra su propio browser) ---
  const cert = await crearCertificado(cuit, clave, alias)
  for (const p of cert.pasos || []) pasos.push('cert: ' + p)
  if (!cert.ok || !cert.certPem || !cert.privateKeyPem) {
    return {
      ok: false,
      etapa: 'crear-cert',
      alias,
      autorizado: false,
      error: cert.error || 'No se pudo crear o capturar el certificado',
      pasos,
      screenshot: cert.screenshot || null,
    }
  }
  pasos.push('Certificado "' + alias + '" creado y capturado ✓')

  // --- Paso 2: autorizar el certificado al servicio wsfe ---
  let browser
  let page
  let destino
  let autorizado = false
  let dr = null
  const diag = {}
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

    // Elegir el contribuyente = el propio CUIT (si hay dropdown).
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
        await Promise.all([
          destino.waitForLoadState('domcontentloaded', { timeout: 60000 }).catch(() => {}),
          sel.selectOption({ value: target.value }).catch(() => {}),
        ])
        await destino.waitForTimeout(2000)
        pasos.push('Contribuyente seleccionado: ' + target.text)
      }
    }

    // Nav directo al formulario de la relación con wsfe ya seteado.
    const cuitDigits2 = String(cuit).replace(/\D/g, '')
    let origin = 'https://serviciosweb.afip.gob.ar'
    try {
      origin = new URL(destino.url()).origin
    } catch {}
    const relUrl = `${origin}/clavefiscal/adminRel/relationAdd.aspx?representado=${cuitDigits2}&servicename=ws://wsfe`
    await destino.goto(relUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {})
    await destino.waitForTimeout(2500)
    diag.relUrl = relUrl
    diag.wsfeInvocado = /relationadd/i.test(destino.url()) && /wsfe/i.test(destino.url())
    pasos.push('Navegado a relationAdd.aspx (wsfe): ' + (diag.wsfeInvocado ? 'ok' : 'revisar'))

    // Click "Buscar" del Representante -> abre userSearch.aspx (posible popup).
    const btnBuscarRep = destino.locator('#cmdBuscarUsuario, input[name="cmdBuscarUsuario"]').first()
    if (!(await btnBuscarRep.count().catch(() => 0))) {
      throw new Error('No apareció el botón Buscar (cmdBuscarUsuario) en relationAdd')
    }
    const [pop2] = await Promise.all([
      destino.context().waitForEvent('page', { timeout: 12000 }).catch(() => null),
      btnBuscarRep.click({ timeout: 15000 }).catch(() => {}),
    ])
    dr = pop2 || destino
    await dr.waitForLoadState('domcontentloaded', { timeout: 60000 }).catch(() => {})
    await dr.waitForTimeout(2500)
    pasos.push('Abierto buscador de computador (userSearch.aspx)')

    // Elegir el alias RECIÉN creado en el dropdown de computadores.
    const cboComp = dr
      .locator('#cboComputadoresAdministrados, select[name="cboComputadoresAdministrados"]')
      .first()
    if (!(await cboComp.count().catch(() => 0))) {
      throw new Error('No apareció el dropdown de computadores (cboComputadoresAdministrados)')
    }
    const opts = await cboComp
      .locator('option')
      .evaluateAll((os) =>
        os.map((o) => ({ value: o.value, text: (o.textContent || '').replace(/\s+/g, ' ').trim() }))
      )
    diag.opcionesComputador = opts.map((o) => o.text).slice(0, 30)
    const aliasLc = alias.toLowerCase()
    // node: base64 del alias por si el value viene codificado.
    let aliasB64 = ''
    try {
      aliasB64 = Buffer.from(alias, 'utf8').toString('base64')
    } catch {}
    let target =
      opts.find((o) => o.text && o.text.toLowerCase().includes(aliasLc)) ||
      opts.find((o) => o.value && o.value.toLowerCase().includes(aliasLc)) ||
      (aliasB64 && opts.find((o) => o.value && o.value.includes(aliasB64)))
    // Si hay UNA sola opción con valor no vacío, es la del cert nuevo.
    if (!target) {
      const noVacias = opts.filter((o) => o.value && o.value.trim())
      if (noVacias.length === 1) target = noVacias[0]
    }
    if (!target) {
      throw new Error(
        'No encontré el alias "' + alias + '" en el dropdown de computadores. Opciones: ' +
          JSON.stringify(diag.opcionesComputador)
      )
    }
    // selectOption dispara el autopostback -> esperar recarga.
    await Promise.all([
      dr.waitForLoadState('domcontentloaded', { timeout: 60000 }).catch(() => {}),
      cboComp.selectOption({ value: target.value }).catch(() => {}),
    ])
    await dr.waitForTimeout(3000)
    pasos.push('Alias seleccionado en el dropdown: ' + target.text)

    // CONFIRMAR: cmdSeleccionarServicio (input[type=image], confirmar.gif).
    const confirmar1 = dr
      .locator(
        '#cmdSeleccionarServicio, input[name="cmdSeleccionarServicio"], input[type=image][src*="confirmar" i], input[type=image][alt*="confirm" i]'
      )
      .first()
    if (!(await confirmar1.count().catch(() => 0))) {
      throw new Error('No apareció el botón CONFIRMAR (cmdSeleccionarServicio) tras elegir el alias')
    }
    await Promise.all([
      dr.waitForLoadState('domcontentloaded', { timeout: 60000 }).catch(() => {}),
      confirmar1.click({ timeout: 15000 }).catch(() => {}),
    ])
    await dr.waitForTimeout(3000)
    pasos.push('CONFIRMAR (seleccionar servicio) clickeado')

    // Defensivo: puede aparecer una pantalla de resumen con un CONFIRMAR final.
    for (let i = 0; i < 2; i++) {
      const urlAhora = dr.url()
      if (/aceptada=true/i.test(urlAhora) && /wsfe/i.test(urlAhora)) {
        autorizado = true
        break
      }
      const yaOk = await dr
        .evaluate(() =>
          /se ha creado|fue creada|creada con [eé]xito|exitosamente|relaci[oó]n.*(creada|agregada|guardada)/i.test(
            document.body.innerText || ''
          )
        )
        .catch(() => false)
      if (yaOk) {
        autorizado = true
        break
      }
      const confirmarN = dr
        .locator(
          'input[type=image][src*="confirmar" i], input[type=image][alt*="confirm" i], ' +
            '#cmdConfirmar, input[name="cmdConfirmar"], input[type=submit][value*="onfirm" i], ' +
            'input[type=button][value*="onfirm" i], button:has-text("Confirmar")'
        )
        .first()
      if (await confirmarN.count().catch(() => 0)) {
        await Promise.all([
          dr.waitForLoadState('domcontentloaded', { timeout: 60000 }).catch(() => {}),
          confirmarN.click({ timeout: 15000 }).catch(() => {}),
        ])
        await dr.waitForTimeout(3000)
        pasos.push('CONFIRMAR final clickeado (pantalla de resumen)')
      } else {
        break
      }
    }

    // Verificación final. ARCA no muestra texto de éxito: cae en goMain.aspx con
    // la confirmación en la URL, p.ej. ...?relation=R2|<b64>|<cuit>|ws://wsfe|<cuit>|aceptada=True
    // Ese "aceptada=True" (+ wsfe) es la señal definitiva de que la relación quedó.
    const urlFinal = dr.url()
    diag.urlFinal = urlFinal
    const textoFinal = await dr
      .evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 600))
      .catch(() => '')
    diag.textoFinal = textoFinal
    if (!autorizado) {
      autorizado =
        (/aceptada=true/i.test(urlFinal) && /wsfe/i.test(urlFinal)) ||
        /se ha creado|fue creada|creada con [eé]xito|exitosamente|relaci[oó]n.*(creada|agregada|guardada)/i.test(
          textoFinal
        )
    }
    pasos.push('Autorización wsfe: ' + (autorizado ? 'CONFIRMADA ✓' : 'sin confirmación textual (revisar captura)'))

    return {
      ok: !!(cert.certPem && cert.privateKeyPem),
      etapa: autorizado ? 'autorizado' : 'autorizacion-incierta',
      alias,
      certPem: cert.certPem,
      privateKeyPem: cert.privateKeyPem,
      autorizado,
      url: dr.url(),
      diag,
      pasos,
      screenshot: await captura(dr),
    }
  } catch (e) {
    return {
      ok: false,
      etapa: 'autorizar',
      alias,
      // Devolvemos el cert igual: se creó bien; solo falló/quedó dudosa la autorización.
      certPem: cert.certPem,
      privateKeyPem: cert.privateKeyPem,
      autorizado: false,
      error: String((e && e.message) || e),
      diag,
      pasos,
      screenshot: await captura(dr || destino || page),
    }
  } finally {
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

    // En vez de navegar el árbol de servicios (inestable en producción), vamos
    // DIRECTO al formulario de la relación con el servicio wsfe ya seteado. Esta
    // es la URL que dio el run exitoso: relationAdd.aspx?representado=<cuit>&servicename=ws://wsfe
    const cuitDigits2 = String(cuit).replace(/\D/g, '')
    let origin = 'https://serviciosweb.afip.gob.ar'
    try {
      origin = new URL(destino.url()).origin
    } catch {}
    const relUrl = `${origin}/clavefiscal/adminRel/relationAdd.aspx?representado=${cuitDigits2}&servicename=ws://wsfe`
    await destino.goto(relUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {})
    await destino.waitForTimeout(2500)
    pasos.push('Navegado directo a relationAdd.aspx (wsfe)')
    pasos.push('URL relacion: ' + destino.url())
    const wsfeInvocado = /relationadd/i.test(destino.url()) && /wsfe/i.test(destino.url())

    // Mapear la pantalla resultante: selects (representante/computador) + botones.
    const selects = await destino
      .evaluate(() =>
        [...document.querySelectorAll('select')].map((s) => ({
          id: s.id || null,
          name: s.getAttribute('name') || null,
          opciones: [...s.options].slice(0, 30).map((o) => ({
            value: o.value,
            text: (o.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
          })),
        }))
      )
      .catch(() => [])

    const controles = await destino
      .evaluate(() =>
        [...document.querySelectorAll('input[type=submit], input[type=image], input[type=button], button')]
          .map((el) => ({
            tipo: el.type || el.tagName.toLowerCase(),
            id: el.id || null,
            name: el.getAttribute('name') || null,
            valor: (el.value || el.alt || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
          }))
          .slice(0, 40)
      )
      .catch(() => [])

    // Clic en "Buscar" del Representante -> abre la búsqueda del computador/certificado.
    let repBuscar = null
    const ctx2 = destino.context()
    const btnBuscarRep = destino.locator('#cmdBuscarUsuario, input[name="cmdBuscarUsuario"]').first()
    if (await btnBuscarRep.count().catch(() => 0)) {
      const [pop2] = await Promise.all([
        ctx2.waitForEvent('page', { timeout: 12000 }).catch(() => null),
        btnBuscarRep.click({ timeout: 15000 }).catch(() => {}),
      ])
      const dr = pop2 || destino
      await dr.waitForLoadState('domcontentloaded', { timeout: 60000 }).catch(() => {})
      await dr.waitForTimeout(2500)
      pasos.push('Clic en Buscar Representante')
      const inputs = await dr
        .evaluate(() =>
          [...document.querySelectorAll('input[type=text], input[type=search], input:not([type])')]
            .map((i) => ({
              id: i.id || null,
              name: i.getAttribute('name') || null,
              placeholder: i.getAttribute('placeholder') || null,
            }))
            .slice(0, 20)
        )
        .catch(() => [])
      const selects2 = await dr
        .evaluate(() =>
          [...document.querySelectorAll('select')].map((s) => ({
            id: s.id || null,
            name: s.getAttribute('name') || null,
            opciones: [...s.options].slice(0, 40).map((o) => ({
              value: o.value,
              text: (o.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
            })),
          }))
        )
        .catch(() => [])
      // Dump COMPLETO de botones (sin filtro) para ver el BUSCAR del computador.
      const controles2 = await dr
        .evaluate(() =>
          [...document.querySelectorAll('input[type=submit], input[type=image], input[type=button], button')]
            .map((el) => ({
              tipo: el.type || el.tagName.toLowerCase(),
              id: el.id || null,
              name: el.getAttribute('name') || null,
              alt: el.getAttribute('alt') || null,
              src: ((el.getAttribute && el.getAttribute('src')) || '').split('/').pop() || null,
              valor: (el.value || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
            }))
            .slice(0, 40)
        )
        .catch(() => [])

      // DRY-RUN: seleccionar el computador (primer alias real). El select tiene
      // autopostback: al elegir el alias, ARCA recarga la página y aparece el
      // botón CONFIRMAR. NO se confirma la relación: solo mapeamos esa pantalla.
      let computadorSeleccionado = null
      let confirmScreen = null
      const cboComp = dr
        .locator('#cboComputadoresAdministrados, select[name="cboComputadoresAdministrados"]')
        .first()
      if (await cboComp.count().catch(() => 0)) {
        const opts = await cboComp
          .locator('option')
          .evaluateAll((os) =>
            os.map((o) => ({ value: o.value, text: (o.textContent || '').replace(/\s+/g, ' ').trim() }))
          )
        const target = opts.find((o) => o.value && o.value.trim())
        if (target) {
          // selectOption dispara el postback -> esperamos la navegación/recarga.
          await Promise.all([
            dr.waitForLoadState('domcontentloaded', { timeout: 60000 }).catch(() => {}),
            cboComp.selectOption({ value: target.value }).catch(() => {}),
          ])
          await dr.waitForTimeout(3000)
          computadorSeleccionado = target.text
          pasos.push('Computador seleccionado (dry-run): ' + target.text)
          // Mapear TODOS los botones de la pantalla resultante (busco el CONFIRMAR).
          const confBtns = await dr
            .evaluate(() =>
              [...document.querySelectorAll('input[type=submit], input[type=image], input[type=button], button, a')]
                .map((el) => ({
                  tipo: el.type || el.tagName.toLowerCase(),
                  id: el.id || null,
                  name: el.getAttribute('name') || null,
                  alt: el.getAttribute('alt') || null,
                  src: ((el.getAttribute && el.getAttribute('src')) || '').split('/').pop() || null,
                  href: ((el.getAttribute && el.getAttribute('href')) || '').slice(0, 80) || null,
                  valor: (el.value || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
                }))
                .filter((c) => /confirm|grabar|aceptar|guardar/i.test((c.valor || '') + (c.alt || '') + (c.src || '') + (c.id || '') + (c.name || '')))
                .slice(0, 20)
            )
            .catch(() => [])
          const todosBtns = await dr
            .evaluate(() =>
              [...document.querySelectorAll('input[type=submit], input[type=image], input[type=button], button')]
                .map((el) => ({
                  tipo: el.type || el.tagName.toLowerCase(),
                  id: el.id || null,
                  name: el.getAttribute('name') || null,
                  alt: el.getAttribute('alt') || null,
                  src: ((el.getAttribute && el.getAttribute('src')) || '').split('/').pop() || null,
                  valor: (el.value || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
                }))
                .slice(0, 40)
            )
            .catch(() => [])
          const confTexto = await dr
            .evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 600))
            .catch(() => null)
          confirmScreen = {
            url: dr.url(),
            title: await dr.title().catch(() => null),
            botonConfirmar: confBtns,
            todosBotones: todosBtns,
            texto: confTexto,
            screenshot: await captura(dr),
          }
        }
      }

      repBuscar = {
        url: dr.url(),
        title: await dr.title().catch(() => null),
        inputs,
        selects: selects2,
        controles: controles2,
        computadorSeleccionado,
        confirmScreen,
        screenshot: await captura(dr),
      }
    } else {
      pasos.push('No se encontró el botón Buscar Representante')
    }

    return {
      ok: true,
      url: destino.url(),
      title: await destino.title().catch(() => null),
      pasos,
      diag: { relUrl, wsfeInvocado, selects, controles, repBuscar },
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

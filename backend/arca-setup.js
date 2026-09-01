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
export async function configurarWsfe(cuit, clave, aliasForzado, onProgreso) {
  const pasos = []
  const alias = aliasForzado || 'app' + String(Date.now()).slice(-8)
  // onProgreso(estado, textoAmigable) — opcional, para reportar avance en vivo.
  const prog = async (estado, texto) => {
    try {
      if (typeof onProgreso === 'function') await onProgreso(estado, texto)
    } catch {}
  }

  // --- Paso 1: crear el certificado (abre/cierra su propio browser) ---
  await prog('creando_cert', 'Creando tu certificado digital…')
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
  await prog('autorizando', 'Autorizando el certificado en ARCA…')

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

// AUTORIZA un certificado YA EXISTENTE (por su alias) para un servicio web
// cualquiera dentro del "Administrador de Relaciones". Misma navegación que
// configurarWsfe pero parametrizada por servicio y sin crear el certificado.
// servicio = nombre del WS (ej: 'ws_sr_constancia_inscripcion', 'ws_sr_padron_a13').
export async function autorizarServicio(cuit, clave, alias, servicio) {
  const pasos = []
  const svcSlug = String(servicio).toLowerCase()
  let browser
  let page
  let destino
  let dr = null
  let autorizado = false
  const diag = { servicio }
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
    const link = page.getByText(/Administrador de Relaciones/i).and(page.locator(':visible')).first()
    await link.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {})
    const [popup] = await Promise.all([
      context.waitForEvent('page', { timeout: 15000 }).catch(() => null),
      link.click({ timeout: 15000 }).catch(() => {}),
    ])
    destino = popup || page
    await destino.waitForLoadState('domcontentloaded', { timeout: 60000 }).catch(() => {})
    await destino.waitForTimeout(2500)
    pasos.push('Abierto Administrador de Relaciones')

    const cuitDigits = String(cuit).replace(/\D/g, '')
    const sel = destino
      .locator('#tblAutoridadAplicacion_cmbCont, select[name="tblAutoridadAplicacion:cmbCont"], select')
      .first()
    if (await sel.count().catch(() => 0)) {
      const opts = await sel
        .locator('option')
        .evaluateAll((os) => os.map((o) => ({ value: o.value, text: (o.textContent || '').trim() })))
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

    let origin = 'https://serviciosweb.afip.gob.ar'
    try {
      origin = new URL(destino.url()).origin
    } catch {}
    const relUrl = `${origin}/clavefiscal/adminRel/relationAdd.aspx?representado=${cuitDigits}&servicename=ws://${servicio}`
    await destino.goto(relUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {})
    await destino.waitForTimeout(2500)
    diag.relUrl = relUrl
    diag.svcInvocado = /relationadd/i.test(destino.url()) && destino.url().toLowerCase().includes(svcSlug)
    pasos.push('Navegado a relationAdd.aspx (' + servicio + '): ' + (diag.svcInvocado ? 'ok' : 'revisar'))

    const btnBuscarRep = destino.locator('#cmdBuscarUsuario, input[name="cmdBuscarUsuario"]').first()
    if (!(await btnBuscarRep.count().catch(() => 0))) {
      throw new Error('No apareció el botón Buscar (cmdBuscarUsuario) en relationAdd — puede que el servicio no exista con ese nombre')
    }
    const [pop2] = await Promise.all([
      destino.context().waitForEvent('page', { timeout: 12000 }).catch(() => null),
      btnBuscarRep.click({ timeout: 15000 }).catch(() => {}),
    ])
    dr = pop2 || destino
    await dr.waitForLoadState('domcontentloaded', { timeout: 60000 }).catch(() => {})
    await dr.waitForTimeout(2500)
    pasos.push('Abierto buscador de computador')

    const cboComp = dr
      .locator('#cboComputadoresAdministrados, select[name="cboComputadoresAdministrados"]')
      .first()
    if (!(await cboComp.count().catch(() => 0))) {
      throw new Error('No apareció el dropdown de computadores (cboComputadoresAdministrados)')
    }
    const opts = await cboComp
      .locator('option')
      .evaluateAll((os) => os.map((o) => ({ value: o.value, text: (o.textContent || '').replace(/\s+/g, ' ').trim() })))
    diag.opcionesComputador = opts.map((o) => o.text).slice(0, 30)
    const aliasLc = String(alias).toLowerCase()
    let aliasB64 = ''
    try {
      aliasB64 = Buffer.from(String(alias), 'utf8').toString('base64')
    } catch {}
    let target =
      opts.find((o) => o.text && o.text.toLowerCase().includes(aliasLc)) ||
      opts.find((o) => o.value && o.value.toLowerCase().includes(aliasLc)) ||
      (aliasB64 && opts.find((o) => o.value && o.value.includes(aliasB64)))
    if (!target) {
      const noVacias = opts.filter((o) => o.value && o.value.trim())
      if (noVacias.length === 1) target = noVacias[0]
    }
    if (!target) {
      throw new Error('No encontré el alias "' + alias + '" en el dropdown. Opciones: ' + JSON.stringify(diag.opcionesComputador))
    }
    await Promise.all([
      dr.waitForLoadState('domcontentloaded', { timeout: 60000 }).catch(() => {}),
      cboComp.selectOption({ value: target.value }).catch(() => {}),
    ])
    await dr.waitForTimeout(3000)
    pasos.push('Alias seleccionado: ' + target.text)

    const confirmar1 = dr
      .locator('#cmdSeleccionarServicio, input[name="cmdSeleccionarServicio"], input[type=image][src*="confirmar" i], input[type=image][alt*="confirm" i]')
      .first()
    if (!(await confirmar1.count().catch(() => 0))) {
      throw new Error('No apareció el botón CONFIRMAR (cmdSeleccionarServicio)')
    }
    await Promise.all([
      dr.waitForLoadState('domcontentloaded', { timeout: 60000 }).catch(() => {}),
      confirmar1.click({ timeout: 15000 }).catch(() => {}),
    ])
    await dr.waitForTimeout(3000)
    pasos.push('CONFIRMAR (seleccionar servicio) clickeado')

    for (let i = 0; i < 2; i++) {
      const urlAhora = dr.url().toLowerCase()
      if (/aceptada=true/i.test(urlAhora) && urlAhora.includes(svcSlug)) {
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
        pasos.push('CONFIRMAR final clickeado')
      } else {
        break
      }
    }

    const urlFinal = dr.url()
    diag.urlFinal = urlFinal
    const textoFinal = await dr
      .evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 600))
      .catch(() => '')
    diag.textoFinal = textoFinal
    if (!autorizado) {
      autorizado =
        (/aceptada=true/i.test(urlFinal) && urlFinal.toLowerCase().includes(svcSlug)) ||
        /se ha creado|fue creada|creada con [eé]xito|exitosamente|relaci[oó]n.*(creada|agregada|guardada)/i.test(textoFinal)
    }
    pasos.push('Autorización ' + servicio + ': ' + (autorizado ? 'CONFIRMADA ✓' : 'sin confirmación textual'))

    return { ok: autorizado, servicio, alias, autorizado, url: dr.url(), diag, pasos, screenshot: await captura(dr) }
  } catch (e) {
    return {
      ok: false,
      servicio,
      alias,
      autorizado: false,
      error: String((e && e.message) || e),
      diag,
      pasos,
      screenshot: await captura(dr || destino || page).catch(() => null),
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

// ============================================================================
// INSPECCIÓN del "Administración de puntos de venta y domicilios" de ARCA.
// Objetivo: mapear las pantallas para el ALTA de un punto de venta de Web
// Service (para quien no tiene ninguno). NO crea ni cambia nada: solo navega y
// vuelca selects/inputs/botones + capturas en cada etapa.
// ============================================================================
export async function inspeccionarPuntosVenta(cuit, clave, termino) {
  const pasos = []
  const etapas = []
  let browser
  let page
  let destino
  const buscar = termino || 'Administración de puntos de venta'
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
    await buscador.fill(buscar, { timeout: 12000 }).catch(() => {})
    await page.waitForTimeout(2000)
    pasos.push('Buscado: ' + buscar)

    const link = page
      .getByText(/puntos de venta/i)
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
    pasos.push('Abierto servicio: ' + destino.url())

    // Volcado de una pantalla (selects con opciones, inputs, botones/links, captura).
    const snap = async (nombre) => {
      const selects = await destino
        .evaluate(() =>
          [...document.querySelectorAll('select')].map((s) => ({
            id: s.id || null,
            name: s.getAttribute('name') || null,
            opciones: [...s.options].slice(0, 40).map((o) => ({
              value: o.value,
              text: (o.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 90),
            })),
          }))
        )
        .catch(() => [])
      const inputs = await destino
        .evaluate(() =>
          [...document.querySelectorAll('input, textarea')]
            .filter((e) => e.type !== 'hidden')
            .map((e) => ({
              tag: e.tagName.toLowerCase(),
              type: e.type || '',
              id: e.id || null,
              name: e.getAttribute('name') || null,
              placeholder: e.getAttribute('placeholder') || null,
              value: (e.value || '').slice(0, 40) || null,
            }))
            .slice(0, 50)
        )
        .catch(() => [])
      const botones = await destino
        .evaluate(() =>
          [...document.querySelectorAll('input[type=submit], input[type=image], input[type=button], button, a')]
            .map((el) => ({
              tipo: el.type || el.tagName.toLowerCase(),
              id: el.id || null,
              name: el.getAttribute('name') || null,
              alt: el.getAttribute('alt') || null,
              src: ((el.getAttribute && el.getAttribute('src')) || '').split('/').pop() || null,
              href: ((el.getAttribute && el.getAttribute('href')) || '').slice(0, 90) || null,
              valor: (el.value || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
            }))
            .filter((b) => b.valor || b.alt || b.href)
            .slice(0, 60)
        )
        .catch(() => [])
      const texto = await destino
        .evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 500))
        .catch(() => null)
      return {
        etapa: nombre,
        url: destino.url(),
        title: await destino.title().catch(() => null),
        selects,
        inputs,
        botones,
        texto,
        screenshot: await captura(destino),
      }
    }

    // Mapear la pantalla de selección de empresa antes de entrar.
    etapas.push(await snap('empresa'))

    // Seleccionar empresa: en PVE es un BOTÓN con el nombre del contribuyente
    // (no un <select>). Clic al primer botón/enlace "con nombre" que no sea Salir.
    const cands = destino.locator('input[type=button], input[type=submit], button, a')
    const nCand = await cands.count().catch(() => 0)
    for (let i = 0; i < nCand; i++) {
      const el = cands.nth(i)
      const txt = (
        (await el.getAttribute('value').catch(() => null)) ||
        (await el.innerText().catch(() => '')) ||
        ''
      ).trim()
      if (!txt || /salir|cerrar|volver|ayuda|inicio/i.test(txt)) continue
      if (!/[A-Za-zÁÉÍÓÚÑáéíóúñ]{4,}/.test(txt)) continue
      await Promise.all([
        destino.waitForLoadState('domcontentloaded', { timeout: 60000 }).catch(() => {}),
        el.click({ timeout: 15000 }).catch(() => {}),
      ])
      await destino.waitForTimeout(2500)
      pasos.push('Empresa seleccionada: ' + txt)
      break
    }

    etapas.push(await snap('menu'))

    // Entrar a "A/B/M de puntos de venta".
    const irA = destino
      .getByText(/A\s*\/?\s*B\s*\/?\s*M|Puntos de Venta|Administrar|Gestionar/i)
      .and(destino.locator(':visible'))
      .first()
    if (await irA.count().catch(() => 0)) {
      await irA.click({ timeout: 15000 }).catch(() => {})
      await destino.waitForLoadState('domcontentloaded', { timeout: 60000 }).catch(() => {})
      await destino.waitForTimeout(2500)
      pasos.push('Clic en A/B/M de puntos de venta')
      etapas.push(await snap('abm'))
    }

    // Abrir el formulario de alta (Agregar / Nuevo / Alta). NO se envía nada:
    // solo mapeamos los campos (incluido el select de "Sistema").
    const agregar = destino
      .getByText(/Agregar|Nuevo|Alta|Crear/i)
      .and(destino.locator(':visible'))
      .first()
    if (await agregar.count().catch(() => 0)) {
      await agregar.click({ timeout: 15000 }).catch(() => {})
      await destino.waitForLoadState('domcontentloaded', { timeout: 60000 }).catch(() => {})
      await destino.waitForTimeout(2500)
      pasos.push('Clic en Agregar/Nuevo/Alta')
      etapas.push(await snap('alta'))
    }

    return {
      ok: true,
      url: destino.url(),
      pasos,
      etapas,
      screenshot: etapas.length ? etapas[etapas.length - 1].screenshot : await captura(destino),
    }
  } catch (e) {
    return {
      ok: false,
      error: String((e && e.message) || e),
      url: (destino || page) ? (destino || page).url() : null,
      pasos,
      etapas,
      screenshot: await captura(destino || page),
    }
  } finally {
    if (browser) await browser.close()
  }
}

// ============================================================================
// CREACIÓN de un punto de venta de Web Service (sistema MAW = "Factura
// Electronica - Monotributo - Web Services") en el ABM de PVE.
// Por defecto dryRun=true: abre el diálogo de alta, elige el sistema + domicilio
// y NO guarda (cancela) — sirve para verificar el formulario. Con dryRun=false
// completa y aprieta Aceptar (crea el punto de venta de verdad).
// Devuelve { ok, dryRun, creado, numero, pasos, diag, screenshot }.
// ============================================================================
export async function crearPuntoVentaWS(cuit, clave, opts = {}) {
  const dryRun = opts.dryRun !== false // por defecto NO guarda
  const pasos = []
  const diag = {}
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
    await buscador.fill('Administración de puntos de venta', { timeout: 12000 }).catch(() => {})
    await page.waitForTimeout(2000)
    const link = page
      .getByText(/puntos de venta/i)
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
    pasos.push('Abierto servicio de puntos de venta')

    // Seleccionar empresa (botón con el nombre del contribuyente).
    const cands = destino.locator('input[type=button], input[type=submit], button, a')
    const nCand = await cands.count().catch(() => 0)
    for (let i = 0; i < nCand; i++) {
      const el = cands.nth(i)
      const txt = (
        (await el.getAttribute('value').catch(() => null)) ||
        (await el.innerText().catch(() => '')) ||
        ''
      ).trim()
      if (!txt || /salir|cerrar|volver|ayuda|inicio/i.test(txt)) continue
      if (!/[A-Za-zÁÉÍÓÚÑáéíóúñ]{4,}/.test(txt)) continue
      await Promise.all([
        destino.waitForLoadState('domcontentloaded', { timeout: 60000 }).catch(() => {}),
        el.click({ timeout: 15000 }).catch(() => {}),
      ])
      await destino.waitForTimeout(2500)
      pasos.push('Empresa seleccionada: ' + txt)
      break
    }

    // Ir al A/B/M de puntos de venta.
    const abm = destino.locator('#btn_abm_pto_vta, a[href="abmPuntosVenta.do"]').first()
    if (await abm.count().catch(() => 0)) {
      await Promise.all([
        destino.waitForLoadState('domcontentloaded', { timeout: 60000 }).catch(() => {}),
        abm.click({ timeout: 15000 }).catch(() => {}),
      ])
    } else {
      const u = new URL('abmPuntosVenta.do', destino.url()).href
      await destino.goto(u, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {})
    }
    await destino.waitForTimeout(2500)
    pasos.push('En A/B/M de puntos de venta')

    // Al entrar salta un cartel "ATENCION"/advertencias que tapa la pantalla:
    // hay que cerrarlo antes de poder tocar "Agregar..".
    const cerrarModales = async () => {
      for (const sel of [
        '#dlgAdvertencias_btn_Cerrar',
        '#btnTutClose',
        '.ui-dialog[aria-describedby] .ui-dialog-titlebar-close',
      ]) {
        const b = destino.locator(sel).first()
        if (await b.isVisible().catch(() => false)) {
          await b.click({ timeout: 5000 }).catch(() => {})
          await destino.waitForTimeout(800)
          pasos.push('Cerrado cartel: ' + sel)
        }
      }
    }
    await cerrarModales()

    // Leer la grilla de PV existentes (número + descripción del sistema).
    const filas = await destino
      .evaluate(() =>
        [...document.querySelectorAll('table tr')]
          .map((r) => [...r.querySelectorAll('td')].map((td) => (td.textContent || '').replace(/\s+/g, ' ').trim()))
          .filter((c) => c.length >= 2 && c.length <= 15 && /^\d+$/.test(c[0]))
          .slice(0, 40)
      )
      .catch(() => [])
    diag.filas = filas
    const numerosUsados = filas.map((f) => parseInt(f[0], 10)).filter((n) => !isNaN(n))
    diag.numerosUsados = numerosUsados
    diag.yaTieneWS = filas.some((f) => /web service/i.test(f.join(' ')) && /monotributo/i.test(f.join(' ')))

    // Abrir el diálogo "Agregar.." (id exacto para no agarrar el del filtro).
    const btnAgregar = destino.locator('#tblmiGrilla_btn_0').first()
    if (!(await btnAgregar.count().catch(() => 0))) {
      throw new Error('No se encontró el botón Agregar (#tblmiGrilla_btn_0)')
    }
    await btnAgregar.click({ timeout: 15000 }).catch(() => {})
    await destino.waitForTimeout(1500)
    // Por si el cartel ATENCION reaparece sobre el diálogo de alta.
    await cerrarModales()
    await destino
      .waitForFunction(
        () => {
          const s = document.querySelector('#frmAlta_sisCodigo')
          return s && s.options && s.options.length > 0
        },
        { timeout: 15000 }
      )
      .catch(() => {})
    await destino.waitForTimeout(500)
    pasos.push('Diálogo de alta abierto')

    // Snapshot del formulario de alta.
    const dumpSelect = async (sid) =>
      destino
        .evaluate((id) => {
          const s = document.querySelector(id)
          if (!s) return null
          return {
            value: s.value,
            opciones: [...s.options].map((o) => ({
              value: o.value,
              text: (o.textContent || '').replace(/\s+/g, ' ').trim(),
            })),
          }
        }, sid)
        .catch(() => null)
    diag.sistema = await dumpSelect('#frmAlta_sisCodigo')
    diag.domicilio = await dumpSelect('#frmAlta_codTipoDomicilio')
    diag.actividad = await dumpSelect('#frmAlta_idActividad')
    diag.pveNro = await destino
      .evaluate(() => {
        const i = document.querySelector('#frmAlta_pveNro')
        return i
          ? { value: i.value, readOnly: i.readOnly, disabled: i.disabled, placeholder: i.getAttribute('placeholder') }
          : null
      })
      .catch(() => null)
    diag.nombreFantasia = await destino
      .evaluate(() => {
        const i = document.querySelector('#frmAlta_pveNombreFantasia')
        return i ? { value: i.value, readOnly: i.readOnly } : null
      })
      .catch(() => null)

    // Elegir el sistema MAW (Web Services Monotributo).
    const sisMAW =
      (diag.sistema?.opciones || []).find((o) => o.value === 'MAW') ||
      (diag.sistema?.opciones || []).find((o) => /monotributo/i.test(o.text) && /web service/i.test(o.text))
    if (sisMAW) {
      await destino.selectOption('#frmAlta_sisCodigo', { value: sisMAW.value }).catch(() => {})
      await destino.waitForTimeout(800)
      pasos.push('Sistema elegido: ' + sisMAW.text + ' (' + sisMAW.value + ')')
    } else {
      pasos.push('OJO: no se encontró el sistema MAW en el select de alta')
    }

    // Domicilio: primer valor no vacío.
    const dom = (diag.domicilio?.opciones || []).find((o) => o.value && o.value.trim())
    if (dom) {
      await destino.selectOption('#frmAlta_codTipoDomicilio', { value: dom.value }).catch(() => {})
      pasos.push('Domicilio: ' + dom.text)
    }
    // Actividad: primer valor no vacío (si corresponde).
    const act = (diag.actividad?.opciones || []).find((o) => o.value && o.value.trim())
    if (act) {
      await destino.selectOption('#frmAlta_idActividad', { value: act.value }).catch(() => {})
      pasos.push('Actividad: ' + act.text)
    }

    // Número propuesto: si el campo está vacío y editable, el primer libre.
    let numeroPropuesto = null
    if (diag.pveNro && !diag.pveNro.value && !diag.pveNro.readOnly && !diag.pveNro.disabled) {
      const usados = new Set(numerosUsados)
      let n = 1
      while (usados.has(n)) n++
      numeroPropuesto = n
    } else if (diag.pveNro && diag.pveNro.value) {
      numeroPropuesto = diag.pveNro.value
    }
    diag.numeroPropuesto = numeroPropuesto

    const shotDialogo = await captura(destino)

    if (dryRun) {
      pasos.push('DRY-RUN: no se guarda. Cancelando…')
      const cancelar = destino.locator('#dlgAltaPtoVta_btn_Cancelar').first()
      if (await cancelar.count().catch(() => 0)) await cancelar.click({ timeout: 8000 }).catch(() => {})
      return { ok: true, dryRun: true, creado: false, numeroPropuesto, pasos, diag, screenshot: shotDialogo }
    }

    // MODO REAL: completar número + nombre y guardar.
    const nombre = opts.nombre || 'APP Facturacion'
    if (numeroPropuesto != null && diag.pveNro && !diag.pveNro.readOnly && !diag.pveNro.disabled) {
      await destino.fill('#frmAlta_pveNro', String(numeroPropuesto)).catch(() => {})
    }
    await destino.fill('#frmAlta_pveNombreFantasia', nombre).catch(() => {})
    pasos.push('Formulario completado (número ' + numeroPropuesto + ', nombre ' + nombre + ')')

    const aceptar = destino.locator('#btnAltaEdicAceptar').first()
    await aceptar.click({ timeout: 15000 }).catch(() => {})
    await destino.waitForTimeout(2000)

    // Confirmación de ARCA: "¿Ha ingresado los datos correctamente?" -> Sí.
    let clicSi = false
    const siLoc = destino
      .getByText(/^\s*s[ií]\s*$/i)
      .and(destino.locator(':visible'))
      .first()
    if (await siLoc.count().catch(() => 0)) {
      await siLoc.click({ timeout: 8000 }).catch(() => {})
      clicSi = true
    }
    if (!clicSi) {
      // Fallback: clic vía DOM sobre el elemento cuyo texto/valor es exactamente "Sí".
      clicSi = await destino
        .evaluate(() => {
          const cands = [...document.querySelectorAll('button, input[type=button], input[type=submit], a')]
          const el = cands.find((e) => {
            const t = (e.value || e.textContent || '').trim()
            return /^s[ií]$/i.test(t) && (e.offsetParent || e.offsetWidth || e.offsetHeight)
          })
          if (el) {
            el.click()
            return true
          }
          return false
        })
        .catch(() => false)
    }
    if (clicSi) pasos.push('Confirmado (Sí) el alta')
    await destino.waitForTimeout(3000)

    // Cerrar posibles carteles de éxito/advertencia tras confirmar.
    for (const sel of ['#dlgAdvertencias_btn_Cerrar', '#dlgBajaInfo_btn_Aceptar', '#btnTutClose']) {
      const b = destino.locator(sel).first()
      if (await b.isVisible().catch(() => false)) {
        await b.click({ timeout: 6000 }).catch(() => {})
        await destino.waitForTimeout(1000)
      }
    }

    const textoFinal = await destino
      .evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 600))
      .catch(() => '')
    diag.textoFinal = textoFinal
    // Verificar: releer la grilla y ver si el número quedó con sistema Web Services.
    const filasPost = await destino
      .evaluate(() =>
        [...document.querySelectorAll('table tr')]
          .map((r) => [...r.querySelectorAll('td')].map((td) => (td.textContent || '').replace(/\s+/g, ' ').trim()))
          .filter((c) => c.length >= 2 && c.length <= 15 && /^\d+$/.test(c[0]))
          .slice(0, 40)
      )
      .catch(() => [])
    diag.filasPost = filasPost
    const creado =
      filasPost.some(
        (f) =>
          String(f[0]) === String(numeroPropuesto) &&
          /web service/i.test(f.join(' ')) &&
          /monotributo/i.test(f.join(' '))
      ) || /correctamente|se agreg|alta.*exit|generado/i.test(textoFinal)

    return { ok: true, dryRun: false, creado, numero: numeroPropuesto, pasos, diag, screenshot: await captura(destino) }
  } catch (e) {
    return {
      ok: false,
      error: String((e && e.message) || e),
      pasos,
      diag,
      screenshot: await captura(destino || page),
    }
  } finally {
    if (browser) await browser.close()
  }
}

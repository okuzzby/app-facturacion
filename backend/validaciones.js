// Validaciones de entrada del backend. Regla de oro: nunca confiar en lo que
// manda el cliente. Aunque el frontend ya limita los campos, acá se revalida
// todo antes de emitir ante ARCA o tocar la base.

export const CONCEPTOS = ['Productos', 'Servicios', 'Productos y Servicios']
export const IVA_OPCIONES = [
  'Consumidor Final',
  'Responsable Monotributo',
  'IVA Responsable Inscripto',
  'IVA Sujeto Exento',
  'IVA No Alcanzado',
]
export const COND_VENTA = ['Contado', 'Transferencia Bancaria', 'Otra']

// Condiciones frente al IVA que puede tener un RECEPTOR (cliente), con su código
// oficial CondicionIVAReceptorId (RG 5616) que exige ARCA en WSFEv1.
export const COND_IVA_RECEPTOR = {
  'Consumidor Final': 5,
  'IVA Responsable Inscripto': 1,
  'Responsable Monotributo': 6,
  'IVA Sujeto Exento': 4,
  'IVA No Alcanzado': 15,
}

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// Caracteres de control (0x00-0x1F y 0x7F) escritos con escapes ASCII.
const RE_CONTROL = /[\x00-\x1F\x7F]/g

export function esUUID(s) {
  return typeof s === 'string' && RE_UUID.test(s)
}

// Limpia texto libre: saca caracteres de control, colapsa espacios, recorta y
// limita la longitud. Evita que entren "códigos raros" o payloads enormes.
export function limpiarTexto(v, max = 80) {
  let s = String(v ?? '')
  s = s.replace(RE_CONTROL, ' ').replace(/\s+/g, ' ').trim()
  return s.slice(0, max)
}

// Valida un ítem individual (descripción + precio + cantidad).
function validarItem(raw, i) {
  const descripcion = limpiarTexto(raw?.producto ?? raw?.descripcion, 80)
  if (!descripcion) throw new Error(`Ítem ${i + 1}: descripción inválida`)
  // Redondeamos a 2 decimales (centavos): ARCA no acepta más.
  const precio = Math.round(Number(raw?.precio) * 100) / 100
  if (!Number.isFinite(precio) || precio <= 0 || precio > 100000000) {
    throw new Error(`Ítem ${i + 1}: precio inválido`)
  }
  const cantidad = Number(raw?.cantidad)
  if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 99999) {
    throw new Error(`Ítem ${i + 1}: cantidad inválida`)
  }
  return { descripcion, precio, cantidad }
}

// Valida y normaliza los datos de una factura. Acepta el formato nuevo con
// `items: [...]` y también el viejo de un solo producto (compatibilidad).
// Lanza Error con mensaje claro si algo no cierra (el endpoint lo devuelve 400).
export function validarFactura(body = {}) {
  const itemsRaw =
    Array.isArray(body.items) && body.items.length
      ? body.items
      : [{ producto: body.producto, precio: body.precio, cantidad: body.cantidad }]
  if (itemsRaw.length > 50) throw new Error('Demasiados ítems (máx. 50)')

  const items = itemsRaw.map(validarItem)
  const total = Math.round(items.reduce((a, it) => a + it.precio * it.cantidad, 0) * 100) / 100
  if (!Number.isFinite(total) || total <= 0 || total > 100000000) {
    throw new Error('El total de la factura es inválido')
  }

  const concepto = CONCEPTOS.includes(body.concepto) ? body.concepto : 'Productos'
  const condicionIva = IVA_OPCIONES.includes(body.condicionIva)
    ? body.condicionIva
    : 'Consumidor Final'

  const condIn = Array.isArray(body.condicionesVenta) ? body.condicionesVenta : []
  const condicionesVenta = condIn.filter((c) => COND_VENTA.includes(c))
  if (condicionesVenta.length === 0) condicionesVenta.push('Contado')

  // Receptor (Consumidor Final o un cliente con CUIT). Se valida y normaliza acá
  // para que el flujo de emisión lo reciba ya limpio.
  const receptor = validarReceptor(body.receptor)

  return { items, total, concepto, condicionIva, condicionesVenta, receptor }
}

// Deja un CUIT en 11 dígitos (saca guiones, puntos y espacios).
export function limpiarCUIT(v) {
  return String(v ?? '').replace(/\D/g, '')
}

// Valida un CUIT argentino: 11 dígitos y dígito verificador (módulo 11).
export function esCUITValido(v) {
  const c = limpiarCUIT(v)
  if (!/^\d{11}$/.test(c)) return false
  const mult = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
  let suma = 0
  for (let i = 0; i < 10; i++) suma += Number(c[i]) * mult[i]
  const resto = suma % 11
  let dv = 11 - resto
  if (dv === 11) dv = 0
  if (dv === 10) dv = 9 // caso especial (tipos 23/24): el verificador es 9
  return dv === Number(c[10])
}

// Valida y normaliza el receptor de una factura.
//  - Sin receptor o Consumidor Final sin CUIT  → Consumidor Final (como hoy).
//  - Con cliente (CUIT)  → DocTipo 80 + CUIT + CondicionIVAReceptorId mapeado.
// Devuelve siempre un objeto listo para emitirWS y para el PDF/DB.
export function validarReceptor(receptor) {
  const CF = {
    razonSocial: '',
    cuit: null,
    condIva: 'Consumidor Final',
    condIvaReceptorId: 5,
    docTipo: 99,
    docNro: 0,
    domicilio: '',
  }
  if (!receptor || typeof receptor !== 'object') return CF

  const condIva = COND_IVA_RECEPTOR[receptor.condIva] ? receptor.condIva : 'Consumidor Final'
  const condIvaReceptorId = COND_IVA_RECEPTOR[condIva]
  const cuit = limpiarCUIT(receptor.cuit)
  const razonSocial = limpiarTexto(receptor.razonSocial ?? receptor.nombre, 120)
  const domicilio = limpiarTexto(receptor.domicilio, 120)

  // Consumidor Final sin CUIT: comprobante anónimo, igual que hoy.
  if (condIva === 'Consumidor Final' && !cuit) return CF

  // Cualquier otra condición exige CUIT válido; Consumidor Final con CUIT también
  // sale identificado (DocTipo 80).
  if (!esCUITValido(cuit)) throw new Error('El CUIT del cliente no es válido')
  if (!razonSocial) throw new Error('Falta el nombre o razón social del cliente')

  return {
    razonSocial,
    cuit,
    condIva,
    condIvaReceptorId,
    docTipo: 80, // CUIT
    docNro: Number(cuit),
    domicilio,
  }
}

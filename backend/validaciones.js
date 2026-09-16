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

  return { items, total, concepto, condicionIva, condicionesVenta }
}

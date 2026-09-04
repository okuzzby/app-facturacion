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

// Valida y normaliza los datos de una factura. Lanza Error con mensaje claro
// si algo no cierra (el endpoint lo devuelve como 400).
export function validarFactura(body = {}) {
  const producto = limpiarTexto(body.producto, 80)
  if (!producto) throw new Error('Producto/servicio inválido')

  const precio = Number(body.precio)
  if (!Number.isFinite(precio) || precio <= 0 || precio > 100000000) {
    throw new Error('Precio inválido')
  }

  const cantidad = Number(body.cantidad)
  if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 99999) {
    throw new Error('Cantidad inválida')
  }

  const concepto = CONCEPTOS.includes(body.concepto) ? body.concepto : 'Productos'
  const condicionIva = IVA_OPCIONES.includes(body.condicionIva)
    ? body.condicionIva
    : 'Consumidor Final'

  const condIn = Array.isArray(body.condicionesVenta) ? body.condicionesVenta : []
  const condicionesVenta = condIn.filter((c) => COND_VENTA.includes(c))
  if (condicionesVenta.length === 0) condicionesVenta.push('Contado')

  return { producto, precio, cantidad, concepto, condicionIva, condicionesVenta }
}

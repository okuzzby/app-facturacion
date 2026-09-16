// Helpers de clientes (receptores de factura). Se comparten entre la página de
// Clientes y el selector "Facturar a" del formulario de factura.

// Condiciones frente al IVA que puede tener un cliente. El value es exactamente
// lo que espera el backend (COND_IVA_RECEPTOR en validaciones.js).
export const COND_IVA_CLIENTE = [
  'Consumidor Final',
  'IVA Responsable Inscripto',
  'Responsable Monotributo',
  'IVA Sujeto Exento',
  'IVA No Alcanzado',
]

// Etiqueta corta para chips y listas.
export const COND_IVA_CORTA = {
  'Consumidor Final': 'Consumidor Final',
  'IVA Responsable Inscripto': 'Resp. Inscripto',
  'Responsable Monotributo': 'Monotributo',
  'IVA Sujeto Exento': 'Exento',
  'IVA No Alcanzado': 'No Alcanzado',
}

export function condCorta(c) {
  return COND_IVA_CORTA[c] || c || 'Consumidor Final'
}

// Deja solo dígitos, máximo 11.
export function limpiarCUIT(v) {
  return String(v ?? '').replace(/\D/g, '').slice(0, 11)
}

// Formatea mientras se escribe: XX-XXXXXXXX-X.
export function formatearCUIT(v) {
  const c = limpiarCUIT(v)
  if (c.length <= 2) return c
  if (c.length <= 10) return `${c.slice(0, 2)}-${c.slice(2)}`
  return `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}`
}

// Valida CUIT argentino (11 dígitos + verificador módulo 11).
export function esCUITValido(v) {
  const c = limpiarCUIT(v)
  if (!/^\d{11}$/.test(c)) return false
  const mult = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
  let suma = 0
  for (let i = 0; i < 10; i++) suma += Number(c[i]) * mult[i]
  let dv = 11 - (suma % 11)
  if (dv === 11) dv = 0
  if (dv === 10) dv = 9
  return dv === Number(c[10])
}

// Iniciales para el avatar del cliente.
export function iniciales(nombre) {
  const p = String(nombre || '').trim().split(/\s+/).filter(Boolean)
  if (!p.length) return '?'
  return (p[0][0] + (p[1] ? p[1][0] : '')).toUpperCase()
}

// Valida y normaliza lo que carga el usuario en el formulario de cliente.
// Devuelve { ok, datos } o { ok:false, error }.
export function validarClienteForm({ nombre, cuit, condIva, domicilio }) {
  const nom = String(nombre || '').trim().slice(0, 120)
  if (!nom) return { ok: false, error: 'Escribí el nombre o razón social' }
  const cond = COND_IVA_CLIENTE.includes(condIva) ? condIva : 'Consumidor Final'
  const c = limpiarCUIT(cuit)
  const esCF = cond === 'Consumidor Final'
  if (!esCF && !c) return { ok: false, error: 'Esta condición de IVA necesita el CUIT del cliente' }
  if (c && !esCUITValido(c)) return { ok: false, error: 'El CUIT no es válido' }
  return {
    ok: true,
    datos: {
      nombre: nom,
      cuit: c || null,
      cond_iva: cond,
      domicilio: String(domicilio || '').trim().slice(0, 120) || null,
    },
  }
}

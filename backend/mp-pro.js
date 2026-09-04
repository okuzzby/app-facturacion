// Suscripción paga al plan Pro mediante Mercado Pago (preapproval = débito
// mensual recurrente). Cobra la cuenta de Mercado Pago DE YAFACT (negocio),
// distinta de la que conecta cada usuario para leer sus cobros.
//
// Requiere en el entorno:
//   MP_ACCESS_TOKEN  -> access token de la cuenta MP de YaFact (con Suscripciones)
//   PRO_PRECIO       -> monto mensual a cobrar (ARS). Por defecto 7260.
//   PRO_BACK_URL     -> (opcional) URL a la que vuelve el usuario tras autorizar
const API = 'https://api.mercadopago.com'

const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || ''
export const PRO_PRECIO = Number(process.env.PRO_PRECIO || 7260)

export function proConfigurado() {
  return Boolean(ACCESS_TOKEN)
}

async function mpFetch(path, { method = 'GET', body } = {}) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) {
    const msg = j?.message || j?.error || `MP error ${r.status}`
    throw new Error(msg)
  }
  return j
}

// Crea una suscripción (preapproval) pendiente y devuelve el punto de pago
// (init_point) al que se redirige al usuario para autorizarla.
export async function crearPreapproval({ email, userId, backUrl }) {
  const body = {
    reason: 'YaFact Pro',
    external_reference: String(userId),
    payer_email: email,
    back_url: backUrl,
    auto_recurring: {
      frequency: 1,
      frequency_type: 'months',
      transaction_amount: PRO_PRECIO,
      currency_id: 'ARS',
    },
    status: 'pending',
  }
  const j = await mpFetch('/preapproval', { method: 'POST', body })
  return { id: j.id, initPoint: j.init_point || j.sandbox_init_point || null }
}

// Consulta el estado de una suscripción.
export async function obtenerPreapproval(id) {
  return mpFetch(`/preapproval/${encodeURIComponent(id)}`)
}

// Cancela una suscripción (deja de cobrarse).
export async function cancelarPreapproval(id) {
  return mpFetch(`/preapproval/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: { status: 'cancelled' },
  })
}

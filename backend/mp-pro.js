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

// Crea una suscripción (preapproval). Si viene `cardToken` (tarjeta tokenizada
// en el navegador), la suscripción se AUTORIZA en el momento cobrando esa
// tarjeta, sin que el usuario inicie sesión en Mercado Pago. Si no, cae al flujo
// viejo con init_point (por compatibilidad).
export async function crearPreapproval({ email, userId, cardToken, backUrl }) {
  const body = {
    reason: 'YaFact Pro',
    external_reference: String(userId),
    payer_email: email,
    auto_recurring: {
      frequency: 1,
      frequency_type: 'months',
      transaction_amount: PRO_PRECIO,
      currency_id: 'ARS',
    },
  }
  if (cardToken) {
    body.card_token_id = cardToken
    body.status = 'authorized'
  } else {
    body.back_url = backUrl
    body.status = 'pending'
  }
  const j = await mpFetch('/preapproval', { method: 'POST', body })
  return { id: j.id, status: j.status || null, initPoint: j.init_point || j.sandbox_init_point || null }
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

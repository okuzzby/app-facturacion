import { useEffect, useRef } from 'react'

// Public Key de la app de Mercado Pago de YaFact (NO es secreta; va en el front).
const PUBLIC_KEY = import.meta.env.VITE_MP_PUBLIC_KEY

// Carga el SDK de Mercado Pago una sola vez.
let sdkPromise = null
function cargarSdk() {
  if (typeof window !== 'undefined' && window.MercadoPago) return Promise.resolve()
  if (sdkPromise) return sdkPromise
  sdkPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://sdk.mercadopago.com/js/v2'
    s.async = true
    s.onload = resolve
    s.onerror = () => reject(new Error('No se pudo cargar Mercado Pago'))
    document.body.appendChild(s)
  })
  return sdkPromise
}

// Formulario de tarjeta (Card Payment Brick). Tokeniza la tarjeta en el
// navegador y entrega el token vía onSubmitToken (que debe devolver una Promise).
export default function MpCardBrick({ amount, onSubmitToken, onError }) {
  const controllerRef = useRef(null)

  useEffect(() => {
    let cancelado = false
    if (!PUBLIC_KEY) {
      onError?.('Falta configurar la Public Key de Mercado Pago (VITE_MP_PUBLIC_KEY).')
      return
    }
    cargarSdk()
      .then(async () => {
        if (cancelado) return
        // eslint-disable-next-line no-undef
        const mp = new window.MercadoPago(PUBLIC_KEY, { locale: 'es-AR' })
        const bricks = mp.bricks()
        controllerRef.current = await bricks.create('cardPayment', 'mp-brick-cont', {
          initialization: { amount: Number(amount) || 0 },
          customization: { visual: { hidePaymentButton: false } },
          callbacks: {
            onReady: () => {},
            onError: (e) => onError?.(e?.message || 'Error en el formulario de pago'),
            onSubmit: (cardFormData) => onSubmitToken(cardFormData),
          },
        })
      })
      .catch((e) => onError?.(e?.message || 'No se pudo cargar Mercado Pago'))

    return () => {
      cancelado = true
      try {
        controllerRef.current?.unmount?.()
      } catch {
        /* noop */
      }
    }
  }, [amount])

  return <div id="mp-brick-cont" />
}

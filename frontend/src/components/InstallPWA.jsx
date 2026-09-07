import { useEffect, useState } from 'react'

function esStandalone() {
  try {
    return (
      window.matchMedia?.('(display-mode: standalone)')?.matches ||
      window.navigator.standalone === true
    )
  } catch {
    return false
  }
}
function esMobile() {
  return /android|iphone|ipad|ipod|mobile/i.test(window.navigator.userAgent || '')
}
function esIOS() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent || '')
}

const IconInstalar = () => (
  <svg viewBox="0 0 24 24">
    <path d="M12 3v12M8 11l4 4 4-4M5 21h14" />
  </svg>
)

// Ítem de menú "Instalar app": solo aparece en el celular y desaparece cuando la
// app ya está instalada en ese dispositivo (o en escritorio).
export default function InstallPWA({ onClose }) {
  // Arrancamos con lo que ya haya capturado main.jsx (el evento suele dispararse
  // apenas carga la página, antes de que este botón exista).
  const [deferred, setDeferred] = useState(() => window.__yafactInstall || null)
  const [standalone, setStandalone] = useState(esStandalone())
  const [ayuda, setAyuda] = useState(false)

  useEffect(() => {
    // Por si el evento llega mientras el botón ya está en pantalla.
    const onBip = (e) => {
      e.preventDefault()
      window.__yafactInstall = e
      setDeferred(e)
    }
    const onReady = () => setDeferred(window.__yafactInstall || null)
    const onInstalled = () => setStandalone(true)
    window.addEventListener('beforeinstallprompt', onBip)
    window.addEventListener('yafact-install-ready', onReady)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBip)
      window.removeEventListener('yafact-install-ready', onReady)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  // Solo en celular y si todavía no está instalada.
  if (standalone || !esMobile()) return null

  async function instalar() {
    if (deferred) {
      deferred.prompt()
      const r = await deferred.userChoice.catch(() => null)
      // El evento sirve una sola vez.
      window.__yafactInstall = null
      setDeferred(null)
      if (r?.outcome === 'accepted') onClose?.()
      return
    }
    // Sin instalador nativo (iPhone, o Android que aún no lo ofreció): mostramos ayuda.
    setAyuda(true)
  }

  return (
    <>
      <button type="button" className="menu-install" onClick={instalar}>
        <IconInstalar /> <span>Instalar app</span>
      </button>
      {ayuda && (
        <p className="menu-install-ayuda">
          {esIOS()
            ? 'En iPhone: tocá Compartir y después “Agregar a pantalla de inicio”.'
            : 'Abrí el menú de tu navegador (⋮) y elegí “Instalar app” o “Agregar a pantalla de inicio”.'}
        </p>
      )}
    </>
  )
}

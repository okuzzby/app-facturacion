import { useEffect, useState } from 'react'

// ¿Ya está instalada / abierta como app?
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
function esIOS() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent || '')
}

// Banner "Instalá YaFact": botón nativo en Android/escritorio; instrucción en iPhone.
export default function InstallPWA() {
  const [deferred, setDeferred] = useState(null)
  const [visible, setVisible] = useState(false)
  const [iosHelp, setIosHelp] = useState(false)

  useEffect(() => {
    if (esStandalone()) return
    try {
      if (localStorage.getItem('yf_install_dismiss') === '1') return
    } catch {
      /* noop */
    }
    const onBip = (e) => {
      e.preventDefault()
      setDeferred(e)
      setVisible(true)
    }
    const onInstalled = () => setVisible(false)
    window.addEventListener('beforeinstallprompt', onBip)
    window.addEventListener('appinstalled', onInstalled)
    // iPhone no dispara beforeinstallprompt: mostramos el banner con la ayuda.
    if (esIOS()) setVisible(true)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBip)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  function cerrar() {
    setVisible(false)
    try {
      localStorage.setItem('yf_install_dismiss', '1')
    } catch {
      /* noop */
    }
  }

  async function instalar() {
    if (esIOS()) {
      setIosHelp(true)
      return
    }
    if (!deferred) return
    deferred.prompt()
    const { outcome } = await deferred.userChoice.catch(() => ({ outcome: 'dismissed' }))
    setDeferred(null)
    if (outcome === 'accepted') setVisible(false)
  }

  if (!visible) return null

  return (
    <div className="pwa-banner">
      <div className="pwa-banner-row">
        <div className="pwa-banner-txt">
          <strong>Instalá YaFact</strong>
          <span>Tenela en tu celular como una app, siempre a mano.</span>
        </div>
        <div className="pwa-banner-acts">
          <button type="button" className="secundario" onClick={cerrar}>Ahora no</button>
          <button type="button" onClick={instalar}>Instalar</button>
        </div>
      </div>
      {iosHelp && (
        <div className="pwa-ios">
          En iPhone: tocá el botón <strong>Compartir</strong> (el cuadradito con la flecha) y después{' '}
          <strong>“Agregar a pantalla de inicio”</strong>.
        </div>
      )}
    </div>
  )
}

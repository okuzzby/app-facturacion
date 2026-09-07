import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext'
import './index.css'

// Chrome dispara `beforeinstallprompt` apenas carga la página, mucho antes de que
// se abra el menú donde vive el botón "Instalar app". Lo capturamos acá (lo más
// temprano posible) y lo guardamos en una global para que el botón lo use después
// y pueda abrir el instalador nativo real (sin caer al texto de ayuda).
window.__yafactInstall = null
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  window.__yafactInstall = e
  // Avisamos por si el botón ya está montado en pantalla.
  window.dispatchEvent(new Event('yafact-install-ready'))
})
window.addEventListener('appinstalled', () => {
  window.__yafactInstall = null
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
)

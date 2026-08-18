import { useEffect, useState } from 'react'

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL

export default function App() {
  const [backendStatus, setBackendStatus] = useState('sin verificar')

  useEffect(() => {
    if (!BACKEND_URL) return
    fetch(`${BACKEND_URL}/health`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data) => setBackendStatus(data.status === 'ok' ? 'conectado' : 'respuesta inesperada'))
      .catch(() => setBackendStatus('sin conexión'))
  }, [])

  return (
    <div className="card">
      <h1>App Facturación</h1>
      <p>Esqueleto inicial — Fase 0</p>
      <p className="status">
        Backend: <strong>{backendStatus}</strong>
      </p>
    </div>
  )
}

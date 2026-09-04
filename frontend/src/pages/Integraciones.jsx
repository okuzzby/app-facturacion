import { useEffect, useState, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

const fecha = (s) =>
  s ? new Date(s).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' }) : ''

const IconAtras = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M15 18l-6-6 6-6" /></svg>
)
const IconMP = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
    <rect x="2" y="5" width="20" height="14" rx="3" /><path d="M2 10h20" />
  </svg>
)

async function apiMP(path, { method = 'GET', body } = {}) {
  const backend = import.meta.env.VITE_BACKEND_URL
  if (!backend) throw new Error('Falta VITE_BACKEND_URL')
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) throw new Error('No hay sesión activa')
  const r = await fetch(`${backend}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || `Error ${r.status}`)
  return j
}

export default function Integraciones() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()

  const [estado, setEstado] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [msg, setMsg] = useState(null)
  const [error, setError] = useState(null)
  const [conectando, setConectando] = useState(false)

  const cargarEstado = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const est = await apiMP('/mp/estado')
      setEstado(est)
    } catch (e) {
      setError(e.message ?? String(e))
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    if (supabase) cargarEstado()
  }, [cargarEstado])

  // Aviso al volver del OAuth de Mercado Pago.
  useEffect(() => {
    const mp = params.get('mp')
    if (!mp) return
    if (mp === 'ok') setMsg('¡Mercado Pago conectado! Ya podés facturar tus cobros desde Facturar → Mercado Pago.')
    else setError('No se pudo conectar Mercado Pago: ' + (params.get('msg') || 'error'))
    const p = new URLSearchParams(params)
    p.delete('mp')
    p.delete('msg')
    setParams(p, { replace: true })
  }, [params, setParams])

  async function conectar() {
    setError(null)
    setConectando(true)
    try {
      const { url } = await apiMP(`/mp/oauth/url?origin=${encodeURIComponent(window.location.origin)}`)
      window.location.href = url
    } catch (e) {
      setError(e.message ?? String(e))
      setConectando(false)
    }
  }

  async function desconectar() {
    setError(null)
    try {
      await apiMP('/mp/desconectar', { method: 'POST' })
      setMsg('Mercado Pago desconectado.')
      await cargarEstado()
    } catch (e) {
      setError(e.message ?? String(e))
    }
  }

  const conectada = estado?.conectada
  const pro = estado?.pro

  return (
    <div className="page">
      <div className="page-head page-head-back">
        <button type="button" className="icon-btn" onClick={() => navigate(-1)} aria-label="Atrás">
          <IconAtras />
        </button>
        <h1>Integraciones</h1>
      </div>

      {msg && <p className="ok">{msg}</p>}
      {error && <p className="error">{error}</p>}
      {cargando && <p className="sub">Cargando…</p>}

      {!cargando && estado && !estado.configurado && (
        <div className="setup-box setup-aviso">
          <p style={{ margin: 0 }}>La conexión con Mercado Pago todavía no está habilitada en el servidor.</p>
        </div>
      )}

      {!cargando && estado && estado.configurado && (
        <section className="seccion">
          <div className="int-head">
            <span className="int-ic"><IconMP /></span>
            <div className="int-titulo">
              <h2>Mercado Pago</h2>
              <div className="sub">
                {conectada ? 'Cuenta conectada ✓' : 'Conectá tu cuenta para facturar tus cobros'}
              </div>
            </div>
            {conectada && <span className="badge badge-ok">Conectado</span>}
            {!pro && <span className="badge badge-warn">Pro</span>}
          </div>

          {!pro ? (
            <div className="setup-box setup-aviso" style={{ marginTop: 6 }}>
              <p style={{ margin: 0 }}>
                La integración con <strong>Mercado Pago</strong> es parte del plan <strong>Pro</strong>.
                Con Pro conectás tu cuenta, ves tus cobros y los facturás (a mano o en automático).
              </p>
              {conectada && (
                <div className="fila-botones" style={{ marginTop: 10 }}>
                  <button type="button" className="peligro" onClick={desconectar}>Desconectar</button>
                </div>
              )}
            </div>
          ) : !conectada ? (
            <div className="fila-botones" style={{ marginTop: 6 }}>
              <button type="button" onClick={conectar} disabled={conectando}>
                {conectando ? 'Abriendo…' : 'Conectar Mercado Pago'}
              </button>
            </div>
          ) : (
            <>
              {estado.conectada_at && (
                <p className="sub" style={{ marginTop: 2 }}>Conectada el {fecha(estado.conectada_at)}</p>
              )}
              <p className="sub">Facturá tus cobros desde <strong>Facturar → Mercado Pago</strong>.</p>
              <div className="fila-botones" style={{ marginTop: 10 }}>
                <button type="button" className="peligro" onClick={desconectar}>Desconectar</button>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  )
}

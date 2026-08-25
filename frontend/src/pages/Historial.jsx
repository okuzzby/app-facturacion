import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

export default function Historial() {
  const [facturas, setFacturas] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [confirmando, setConfirmando] = useState(null)
  const [anulando, setAnulando] = useState(null)
  const [msg, setMsg] = useState(null)
  const [errorShot, setErrorShot] = useState(null)

  async function cargar() {
    setCargando(true)
    const { data, error } = await supabase
      .from('facturas_emitidas')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) setError(error.message)
    setFacturas(data ?? [])
    setCargando(false)
  }

  useEffect(() => {
    if (supabase) cargar()
  }, [])

  async function imprimir(f) {
    setError(null)
    if (!f.pdf_path) {
      setError('Esta factura no tiene PDF guardado.')
      return
    }
    const { data, error } = await supabase.storage
      .from('facturas')
      .createSignedUrl(f.pdf_path, 120)
    if (error) {
      setError(error.message)
      return
    }
    window.open(data.signedUrl, '_blank')
  }

  async function anular(f) {
    setError(null)
    setMsg(null)
    setErrorShot(null)
    setConfirmando(null)
    setAnulando(f.id)
    try {
      const backend = import.meta.env.VITE_BACKEND_URL
      if (!backend) throw new Error('Falta VITE_BACKEND_URL')
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('No hay sesión activa')

      const r = await fetch(`${backend}/arca/ws/anular`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ facturaId: f.id }),
      })
      const j = await r.json()
      if (!r.ok) {
        setErrorShot(j.screenshot || null)
        throw new Error(j.error || 'Error del backend')
      }
      if (!j.ok) {
        setErrorShot(j.screenshot || null)
        throw new Error(j.error || 'ARCA no pudo generar la Nota de Crédito')
      }
      setMsg(`Factura anulada con Nota de Crédito Nº ${j.numero || ''}.`)
      await cargar()
    } catch (e) {
      setError(e.message ?? String(e))
    } finally {
      setAnulando(null)
    }
  }

  const esFactura = (f) => !/nota de cr/i.test(f.tipo || '')

  return (
    <div className="card card-wide">
      <div className="topbar">
        <Link to="/" className="volver">← Volver</Link>
        <h1>Historial</h1>
      </div>

      {cargando && <p>Cargando…</p>}
      {!cargando && facturas.length === 0 && (
        <p className="sub">Todavía no emitiste comprobantes desde la app.</p>
      )}

      <div className="lista-facturas">
        {facturas.map((f) => (
          <div key={f.id} className={`factura-item ${f.estado === 'anulada' ? 'anulada' : ''}`}>
            <div className="factura-datos">
              <div className="factura-linea1">
                <strong>{f.tipo || 'Factura C'}</strong>
                {f.numero && <span className="numero"> Nº {f.numero}</span>}
                <span className={`estado estado-${f.estado}`}>{f.estado}</span>
              </div>
              <div className="factura-linea2">
                {f.producto} · ${f.importe_total}
              </div>
              <div className="sub">
                {new Date(f.created_at).toLocaleString('es-AR')}
                {f.estado === 'anulada' && f.nc_numero ? ` · NC ${f.nc_numero}` : ''}
              </div>
            </div>

            <div className="factura-acciones">
              <button
                type="button"
                className="secundario"
                onClick={() => imprimir(f)}
                disabled={!f.pdf_path || anulando === f.id}
              >
                Imprimir
              </button>

              {esFactura(f) && f.estado === 'emitida' && (
                confirmando === f.id ? (
                  <span className="confirmar-anular">
                    ¿Anular?
                    <button type="button" className="peligro" onClick={() => anular(f)} disabled={anulando === f.id}>
                      {anulando === f.id ? 'Anulando…' : 'Sí'}
                    </button>
                    <button type="button" className="secundario" onClick={() => setConfirmando(null)} disabled={anulando === f.id}>
                      No
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="peligro"
                    onClick={() => setConfirmando(f.id)}
                    disabled={anulando != null}
                  >
                    Anular
                  </button>
                )
              )}
            </div>
          </div>
        ))}
      </div>

      {anulando && (
        <p className="sub">Emitiendo la Nota de Crédito en ARCA (puede tardar)…</p>
      )}
      {msg && <p className="ok">{msg}</p>}
      {error && <p className="error">{error}</p>}
      {errorShot && (
        <img className="shot" alt="captura del error" src={`data:image/png;base64,${errorShot}`} />
      )}
    </div>
  )
}

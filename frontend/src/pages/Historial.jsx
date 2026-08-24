import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

export default function Historial() {
  const [facturas, setFacturas] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)

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

  return (
    <div className="card card-wide">
      <div className="topbar">
        <Link to="/" className="volver">← Volver</Link>
        <h1>Historial</h1>
      </div>

      {cargando && <p>Cargando…</p>}
      {!cargando && facturas.length === 0 && (
        <p className="sub">Todavía no emitiste facturas desde la app.</p>
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
                {f.cae ? ` · CAE ${f.cae}` : ''}
              </div>
            </div>
            <button
              type="button"
              className="secundario"
              onClick={() => imprimir(f)}
              disabled={!f.pdf_path}
            >
              Imprimir
            </button>
          </div>
        ))}
      </div>

      {error && <p className="error">{error}</p>}
    </div>
  )
}

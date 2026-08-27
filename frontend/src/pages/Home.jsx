import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'

const money = (n) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(
    Number(n) || 0
  )
const money2 = (n) =>
  new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0)
const tipoCorto = (t) => (/nota de cr/i.test(t || '') ? 'NC' : 'FC')
const fechaCorta = (s) => new Date(s).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' })
const IconDoc = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
    <path d="M6 2h9l3 3v17H6z" /><path d="M9 12h6M9 16h4" />
  </svg>
)

const nombreCorto = (email) => {
  if (!email) return ''
  const base = email.split('@')[0].replace(/[._-]+/g, ' ').trim()
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : ''
}

export default function Home() {
  const { user } = useAuth()
  const [facturas, setFacturas] = useState([])
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    if (!supabase) return
    ;(async () => {
      const { data } = await supabase
        .from('facturas_emitidas')
        .select('id, tipo, numero, producto, importe_total, estado, created_at')
        .order('created_at', { ascending: false })
        .limit(20)
      setFacturas(data ?? [])
      setCargando(false)
    })()
  }, [])

  const ahora = new Date()
  const delMes = facturas.filter((f) => {
    const d = new Date(f.created_at)
    return d.getMonth() === ahora.getMonth() && d.getFullYear() === ahora.getFullYear()
  })
  const emitidasMes = delMes.filter((f) => f.estado === 'emitida' && !/nota de cr/i.test(f.tipo || ''))
  const totalMes = emitidasMes.reduce((a, f) => a + (Number(f.importe_total) || 0), 0)
  const ultimas = facturas.slice(0, 4)

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Hola{nombreCorto(user?.email) ? `, ${nombreCorto(user?.email)}` : ''}</h1>
          <div className="sub">Emití una factura en pocos toques.</div>
        </div>
      </div>

      <Link to="/facturar" className="hero-facturar">
        <div>
          <div className="t">Emitir una Factura C</div>
          <div className="d">CAE automático · tu factura lista en segundos</div>
        </div>
        <span className="hero-cta">Nueva factura →</span>
      </Link>

      <div className="stats">
        <div className="card stat">
          <div className="k">Facturado este mes</div>
          <div className="v">{money(totalMes)}</div>
        </div>
        <div className="card stat">
          <div className="k">Comprobantes emitidos</div>
          <div className="v">{emitidasMes.length}</div>
        </div>
      </div>

      <div className="card">
        <div className="page-head" style={{ marginBottom: 8 }}>
          <h2 style={{ fontSize: 17, fontWeight: 800 }}>Últimas facturas</h2>
          <Link to="/historial" className="boton-link secundario-link">Ver historial</Link>
        </div>

        {cargando && <p className="sub">Cargando…</p>}
        {!cargando && ultimas.length === 0 && (
          <p className="sub">Todavía no emitiste comprobantes. Tocá “Facturar” para empezar.</p>
        )}

        {ultimas.length > 0 && (
          <div className="lista-facturas">
            {ultimas.map((f) => {
              const [ent, dec] = money2(f.importe_total).split(',')
              return (
                <div key={f.id} className={`hrow ${f.estado === 'anulada' ? 'anulada' : ''}`}>
                  <span className="hrow-ic"><IconDoc /></span>
                  <div className="hrow-mid">
                    <div className="hrow-t">{f.producto || f.tipo || 'Factura C'}</div>
                    <div className="hrow-meta">
                      {tipoCorto(f.tipo)} · Nº {f.numero} · {fechaCorta(f.created_at)}
                      {f.estado === 'anulada' && <span className="hrow-anulada"> · Anulada</span>}
                    </div>
                  </div>
                  <div className="hrow-right">
                    <div className="hrow-monto">$ {ent}<small>,{dec}</small></div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

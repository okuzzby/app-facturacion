import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

const money0 = (n) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(Number(n) || 0)
const money = (n) =>
  new Intl.NumberFormat('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Number(n) || 0)

const MES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const nombreMes = (periodo) => {
  const m = Number(String(periodo).split('-')[1]) - 1
  return MES_CORTO[m] || ''
}
const periodoActual = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function MiFacturacion() {
  const [resumen, setResumen] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [mesMonto, setMesMonto] = useState(300000)

  useEffect(() => {
    ;(async () => {
      try {
        const backend = import.meta.env.VITE_BACKEND_URL
        if (!backend || !supabase) return setCargando(false)
        const { data: { session } } = await supabase.auth.getSession()
        const t = session?.access_token
        if (!t) return setCargando(false)
        const r = await fetch(`${backend}/arca/facturacion-anual`, { headers: { Authorization: `Bearer ${t}` } })
        const j = await r.json()
        setResumen(r.ok ? j : { vacio: true })
      } catch {
        setResumen({ vacio: true })
      } finally {
        setCargando(false)
      }
    })()
  }, [])

  const mensual = resumen?.mensual || []
  const escala = resumen?.escala || []

  const { max, escalaY, total12, prom } = useMemo(() => {
    const vals = mensual.map((m) => Math.max(0, Number(m.neto) || 0))
    const max = vals.length ? Math.max(...vals) : 0
    const escalaY = max > 0 ? Math.ceil(max / 10000) * 10000 : 10000
    const total12 = mensual.reduce((a, m) => a + (Number(m.neto) || 0), 0)
    const prom = mensual.length ? total12 / mensual.length : 0
    return { max, escalaY, total12, prom }
  }, [mensual])

  // Simulador de categoría
  const anual = mesMonto * 12
  const sim = useMemo(() => {
    for (const e of escala) {
      if (anual <= Number(e.tope)) return { cat: e.cat, tope: Number(e.tope), over: false }
    }
    return { cat: null, tope: null, over: true }
  }, [anual, escala])

  const hoyPeriodo = periodoActual()

  if (cargando) {
    return (
      <div className="page">
        <div className="card"><p className="sub">Cargando…</p></div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Mi facturación</h1>
          <div className="sub">Tu facturación mes a mes y en qué categoría caés</div>
        </div>
        <Link to="/" className="boton-link secundario-link">Volver al inicio</Link>
      </div>

      {/* Gráfico mensual */}
      <div className="card">
        <div className="fac-card-h">
          <div className="fac-card-t">Facturación mes a mes</div>
          <div className="fac-card-s">Últimos 12 meses · datos de ARCA</div>
        </div>

        {mensual.length === 0 ? (
          <p className="sub" style={{ marginTop: 12 }}>
            Todavía no calculamos tu facturación mensual. Se actualiza sola una vez por día;
            también podés tocar “Actualizar” en la card de facturación del Inicio.
          </p>
        ) : (
          <>
            <div className="fac-chart">
              <div className="fac-grid">
                {[1, 0.5, 0].map((f) => (
                  <div className="fac-gridline" key={f} style={{ bottom: `${f * 100}%` }}>
                    <span>{f === 0 ? '0' : money(Math.round(escalaY * f))}</span>
                  </div>
                ))}
                <div className="fac-bars">
                  {mensual.map((m) => {
                    const v = Math.max(0, Number(m.neto) || 0)
                    const h = escalaY > 0 ? Math.round((v / escalaY) * 100) : 0
                    const cur = m.periodo === hoyPeriodo
                    return (
                      <div className={`fac-col ${cur ? 'cur' : ''}`} key={m.periodo}>
                        <div className="fac-tip">{money0(m.neto)}</div>
                        <div className="fac-bar" style={{ height: `${h}%` }} />
                      </div>
                    )
                  })}
                </div>
              </div>
              <div className="fac-xlabels">
                {mensual.map((m) => (
                  <span key={m.periodo} className={m.periodo === hoyPeriodo ? 'cur' : ''}>{nombreMes(m.periodo)}</span>
                ))}
              </div>
            </div>
            <div className="fac-foot">
              <span>Total 12 meses: <b>{money0(total12)}</b></span>
              <span>Promedio mensual: <b>{money0(prom)}</b></span>
            </div>
            <p className="fac-nota">Suma tus Facturas y resta las Notas de Crédito, tal como las ve ARCA.</p>
          </>
        )}
      </div>

      {/* Simulador de categoría */}
      {escala.length > 0 && (
        <div className="card">
          <div className="fac-card-h">
            <div className="fac-card-t">Simulá tu categoría</div>
            <div className="fac-card-s">¿Cuánto facturás por mes?</div>
          </div>

          <div className="sim-row">
            <span className="sim-lbl">Facturación mensual estimada</span>
            <span className="sim-val">{money0(mesMonto)}</span>
          </div>
          <input
            type="range"
            min={50000}
            max={12000000}
            step={50000}
            value={mesMonto}
            onChange={(e) => setMesMonto(Number(e.target.value))}
            className="sim-slider"
          />

          <div className="sim-anual">
            <span className="sim-anual-k">Proyección anual (× 12)</span>
            <span className="sim-anual-v">{money0(anual)}</span>
          </div>

          <div className="sim-res">
            <span className={`sim-badge ${sim.over ? 'over' : ''}`}>{sim.over ? '!' : sim.cat}</span>
            <div className="sim-txt">
              {sim.over ? (
                <>
                  <b>Excede el monotributo</b>
                  <small>Con esa facturación anual pasarías al Régimen General.</small>
                </>
              ) : (
                <>
                  <b>Quedarías en Categoría {sim.cat}</b>
                  <small>Tope anual {money0(sim.tope)} · te quedan {money0(sim.tope - anual)} de margen</small>
                </>
              )}
            </div>
          </div>

          <div className="sim-escala">
            {escala.map((e) => (
              <div
                key={e.cat}
                className={`sim-seg ${anual > Number(e.tope) ? 'pasado' : e.cat === sim.cat ? 'cur' : ''}`}
              />
            ))}
          </div>
          <div className="sim-escala-lbls">
            {escala.map((e) => (
              <span key={e.cat} className={e.cat === sim.cat ? 'cur' : ''}>{e.cat}</span>
            ))}
          </div>
          {resumen?.vigencia && <p className="fac-nota">Escala vigente: {resumen.vigencia}.</p>}
        </div>
      )}
    </div>
  )
}

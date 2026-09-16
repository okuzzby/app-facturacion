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

const primerNombre = (n) => {
  if (!n) return ''
  const w = String(n).trim().split(/\s+/)[0]
  return w ? w.charAt(0).toUpperCase() + w.slice(1) : ''
}

const fmtActualizado = (iso) => {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })
  } catch {
    return ''
  }
}
const IconActualizar = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1">
    <path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" />
  </svg>
)

export default function Home() {
  const { perfilNombre } = useAuth()
  const [facturas, setFacturas] = useState([])
  const [cargando, setCargando] = useState(true)
  // IDs de facturas que vienen de un cobro de Mercado Pago (para la etiqueta MP).
  const [mpIds, setMpIds] = useState(() => new Set())
  // Barra de tope de categoría (se calcula en el backend contra ARCA).
  const [resumen, setResumen] = useState(null)
  const [actualizando, setActualizando] = useState(false)
  const [errorResumen, setErrorResumen] = useState(null)

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
      const ids = (data ?? []).map((f) => f.id)
      if (ids.length) {
        const { data: mp } = await supabase.from('mp_cobros').select('factura_id').in('factura_id', ids)
        setMpIds(new Set((mp ?? []).map((r) => r.factura_id).filter(Boolean)))
      }
    })()
  }, [])

  // Carga el resumen de facturación anual guardado (sin recalcular).
  useEffect(() => {
    ;(async () => {
      try {
        const backend = import.meta.env.VITE_BACKEND_URL
        if (!backend || !supabase) return setResumen({ vacio: true })
        const { data: { session } } = await supabase.auth.getSession()
        const t = session?.access_token
        if (!t) return setResumen({ vacio: true })
        const r = await fetch(`${backend}/arca/facturacion-anual`, { headers: { Authorization: `Bearer ${t}` } })
        const j = await r.json()
        setResumen(r.ok ? j : { vacio: true })
      } catch {
        // Si no pudimos leer el guardado, mostramos la card en modo "calcular".
        setResumen({ vacio: true })
      }
    })()
  }, [])

  async function actualizarResumen() {
    setActualizando(true)
    setErrorResumen(null)
    try {
      const backend = import.meta.env.VITE_BACKEND_URL
      const { data: { session } } = await supabase.auth.getSession()
      const t = session?.access_token
      if (!t) throw new Error('No hay sesión activa')
      const r = await fetch(`${backend}/arca/facturacion-anual`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${t}` },
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'No se pudo actualizar')
      setResumen(j)
    } catch (e) {
      setErrorResumen(e.message ?? String(e))
    } finally {
      setActualizando(false)
    }
  }

  const ahora = new Date()
  const delMes = facturas.filter((f) => {
    const d = new Date(f.created_at)
    return d.getMonth() === ahora.getMonth() && d.getFullYear() === ahora.getFullYear()
  })
  const emitidasMes = delMes.filter((f) => f.estado === 'emitida' && !/nota de cr/i.test(f.tipo || ''))
  const totalMes = emitidasMes.reduce((a, f) => a + (Number(f.importe_total) || 0), 0)
  const ultimas = facturas.slice(0, 4)

  // Derivados de la barra de tope de categoría.
  const tieneTope = resumen && !resumen.vacio && Number(resumen.tope) > 0
  const pct = tieneTope ? Math.min(100, Math.round((Number(resumen.total) / Number(resumen.tope)) * 100)) : 0
  const nivel = pct >= 95 ? 'crit' : pct >= 80 ? 'warn' : 'ok'
  const queda = tieneTope ? Math.max(0, Number(resumen.tope) - Number(resumen.total)) : 0

  return (
    <div className="page">
      <div className="page-head saludo-page">
        <div>
          <h1>Hola{primerNombre(perfilNombre) ? `, ${primerNombre(perfilNombre)}` : ''}</h1>
          <div className="sub">Emití una factura en pocos toques.</div>
        </div>
      </div>

      <div className="mes-card">
        <div className="mes-k">Facturado este mes con la App</div>
        <div className="mes-v">{money(totalMes)}</div>
        <div className="mes-sub">
          {emitidasMes.length} {emitidasMes.length === 1 ? 'comprobante emitido' : 'comprobantes emitidos'}
        </div>
      </div>

      {/* Tu facturación anual vs. el tope de tu categoría (dato de ARCA).
          La card está SIEMPRE presente; si todavía no cargó, avisa. */}
      <div className="tope-card">
        <div className="tope-top">
          <div className="tope-q">Tu facturación anual</div>
          {resumen?.categoria && <span className="cat-badge">Categoría {resumen.categoria}</span>}
        </div>

        {!resumen ? (
          <p className="tope-txt tope-cargando"><span className="spinner-inline" /> Actualizando datos…</p>
        ) : resumen.vacio ? (
          <>
            <p className="tope-txt">
              Traemos de ARCA cuánto llevás facturado en el año y te mostramos cuánto te queda antes de
              recategorizar.
            </p>
            <button type="button" className="tope-btn" onClick={actualizarResumen} disabled={actualizando}>
              {actualizando ? 'Calculando… (puede tardar)' : 'Calcular ahora'}
            </button>
            {errorResumen && <p className="error" style={{ marginTop: 8 }}>{errorResumen}</p>}
          </>
        ) : (
          <>
            {tieneTope ? (
              <>
                <div className={`tope-bar ${nivel}`}><span style={{ width: `${pct}%` }} /></div>
                <div className="tope-ends">
                  <span>Facturaste <b>{money(resumen.total)}</b></span>
                  <span>Tope <b>{money(resumen.tope)}</b></span>
                </div>
                <div className={`tope-queda ${nivel}`}>
                  {pct >= 100
                    ? 'Alcanzaste el tope de tu categoría. Conviene recategorizar.'
                    : <>Te quedan <b>{money(queda)}</b> antes de pasar de categoría.</>}
                </div>
              </>
            ) : (
              <p className="tope-txt">
                Facturaste <b>{money(resumen.total)}</b>{resumen.periodo ? ` (${resumen.periodo})` : ''}.
                {!resumen.categoria && ' No pudimos leer tu categoría en ARCA.'}
              </p>
            )}

            <div className="tope-foot">
              <span className="tope-upd">
                {resumen.periodo ? `${resumen.periodo} · ` : ''}Actualizado {fmtActualizado(resumen.calculadoAt)}
              </span>
              <button type="button" className="tope-btn sm" onClick={actualizarResumen} disabled={actualizando}>
                <IconActualizar /> {actualizando ? 'Actualizando…' : 'Actualizar'}
              </button>
            </div>
            {errorResumen && <p className="error" style={{ marginTop: 8 }}>{errorResumen}</p>}
          </>
        )}
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
                  <span className={`hrow-ic ${mpIds.has(f.id) ? 'hrow-ic-mp' : ''}`}><IconDoc /></span>
                  <div className="hrow-mid">
                    <div className="hrow-t">{f.producto || f.tipo || 'Factura C'}</div>
                    <div className="hrow-meta">
                      {tipoCorto(f.tipo)} · Nº {f.numero} · {fechaCorta(f.created_at)}
                      {mpIds.has(f.id) && <span className="badge-mp">MP</span>}
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

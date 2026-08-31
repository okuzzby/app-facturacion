import { useEffect, useState, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

const money = (n) =>
  new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0)
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
  const [productos, setProductos] = useState([])
  const [cobros, setCobros] = useState([])
  const [cargando, setCargando] = useState(true)
  const [msg, setMsg] = useState(null)
  const [error, setError] = useState(null)

  const [seleccion, setSeleccion] = useState(() => new Set())
  const [productoFacturar, setProductoFacturar] = useState('')
  const [sincronizando, setSincronizando] = useState(false)
  const [facturando, setFacturando] = useState(false)
  const [conectando, setConectando] = useState(false)

  const cargarCobros = useCallback(async () => {
    const { data } = await supabase
      .from('mp_cobros')
      .select('*')
      .order('fecha', { ascending: false })
      .limit(100)
    setCobros(data ?? [])
  }, [])

  const cargarTodo = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const [est, prods] = await Promise.all([
        apiMP('/mp/estado'),
        supabase.from('productos_configurados').select('id, nombre').order('created_at', { ascending: true }),
      ])
      setEstado(est)
      setProductos(prods.data ?? [])
      if (est.conectada) await cargarCobros()
    } catch (e) {
      setError(e.message ?? String(e))
    } finally {
      setCargando(false)
    }
  }, [cargarCobros])

  useEffect(() => {
    if (supabase) cargarTodo()
  }, [cargarTodo])

  // Aviso al volver del OAuth de Mercado Pago.
  useEffect(() => {
    const mp = params.get('mp')
    if (!mp) return
    if (mp === 'ok') setMsg('¡Mercado Pago conectado! Ya podés traer tus cobros.')
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
      await cargarTodo()
    } catch (e) {
      setError(e.message ?? String(e))
    }
  }

  async function guardarConfig(patch) {
    setError(null)
    setEstado((e) => ({ ...e, ...patch })) // optimista
    try {
      await apiMP('/mp/config', { method: 'POST', body: patch })
    } catch (e) {
      setError(e.message ?? String(e))
      cargarTodo()
    }
  }

  async function sincronizar() {
    setError(null)
    setMsg(null)
    setSincronizando(true)
    try {
      const r = await apiMP('/mp/cobros/sync', { method: 'POST' })
      await cargarCobros()
      setMsg(r.nuevos > 0 ? `Se trajeron ${r.nuevos} cobro(s) nuevo(s).` : 'No hay cobros nuevos.')
    } catch (e) {
      setError(e.message ?? String(e))
    } finally {
      setSincronizando(false)
    }
  }

  function toggleSel(id) {
    setSeleccion((prev) => {
      const s = new Set(prev)
      s.has(id) ? s.delete(id) : s.add(id)
      return s
    })
  }

  async function facturarSeleccion() {
    setError(null)
    setMsg(null)
    if (!productoFacturar) return setError('Elegí con qué producto facturar.')
    const ids = [...seleccion]
    if (ids.length === 0) return setError('Marcá al menos un cobro.')
    setFacturando(true)
    try {
      const r = await apiMP('/mp/facturar', {
        method: 'POST',
        body: { cobroIds: ids, productoId: productoFacturar },
      })
      const fallidas = (r.resultados || []).filter((x) => !x.ok)
      setMsg(`${r.emitidas} factura(s) emitida(s).` + (fallidas.length ? ` ${fallidas.length} con error.` : ''))
      setSeleccion(new Set())
      await cargarCobros()
    } catch (e) {
      setError(e.message ?? String(e))
    } finally {
      setFacturando(false)
    }
  }

  const pendientes = cobros.filter((c) => !c.facturado)
  const conectada = estado?.conectada

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
        <>
          {/* Tarjeta de conexión Mercado Pago */}
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
            </div>

            {!conectada ? (
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

                <div className="int-opcion">
                  <div>
                    <div className="int-op-t">Facturar automáticamente</div>
                    <div className="sub">Cuando entra un cobro, emite la Factura C sola.</div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={estado.auto_facturar}
                    className={`mp-sw ${estado.auto_facturar ? 'on' : ''}`}
                    onClick={() => guardarConfig({ auto_facturar: !estado.auto_facturar })}
                  >
                    <span className="mp-sw-dot" />
                  </button>
                </div>

                {estado.auto_facturar && (
                  <div className="campo" style={{ marginTop: 4 }}>
                    <span>Producto por defecto (para el modo automático)</span>
                    <select
                      value={estado.producto_default_id || ''}
                      onChange={(e) => guardarConfig({ producto_default_id: e.target.value || null })}
                    >
                      <option value="">— Elegí un producto —</option>
                      {productos.map((p) => (
                        <option key={p.id} value={p.id}>{p.nombre}</option>
                      ))}
                    </select>
                    {!estado.producto_default_id && (
                      <p className="sub" style={{ color: 'var(--red)' }}>
                        Elegí un producto: sin esto, el modo automático no puede facturar.
                      </p>
                    )}
                  </div>
                )}

                <div className="fila-botones" style={{ marginTop: 10 }}>
                  <button type="button" className="peligro" onClick={desconectar}>Desconectar</button>
                </div>
              </>
            )}
          </section>

          {/* Cobros para facturar (modo manual) */}
          {conectada && (
            <section className="seccion">
              <div className="sec-head">
                <h2>Cobros de Mercado Pago</h2>
                <button type="button" className="secundario" onClick={sincronizar} disabled={sincronizando}>
                  {sincronizando ? 'Actualizando…' : 'Actualizar'}
                </button>
              </div>

              {!estado.auto_facturar && pendientes.length > 0 && (
                <div className="mp-facturar-bar">
                  <select value={productoFacturar} onChange={(e) => setProductoFacturar(e.target.value)}>
                    <option value="">Facturar como…</option>
                    {productos.map((p) => (
                      <option key={p.id} value={p.id}>{p.nombre}</option>
                    ))}
                  </select>
                  <button type="button" onClick={facturarSeleccion} disabled={facturando || seleccion.size === 0}>
                    {facturando ? 'Facturando…' : `Facturar (${seleccion.size})`}
                  </button>
                </div>
              )}

              {estado.auto_facturar && (
                <p className="sub">Modo automático activado: los cobros se facturan solos al acreditarse.</p>
              )}

              {cobros.length === 0 && (
                <p className="sub">
                  Todavía no hay cobros. Tocá <strong>Actualizar</strong> para traerlos desde Mercado Pago.
                </p>
              )}

              <div className="lista-facturas">
                {cobros.map((c) => {
                  const [ent, dec] = money(c.monto).split(',')
                  const marcado = seleccion.has(c.id)
                  const seleccionable = !c.facturado && !estado.auto_facturar
                  return (
                    <div key={c.id} className="hrow">
                      {seleccionable ? (
                        <button
                          type="button"
                          className={`chk ${marcado ? 'on' : ''}`}
                          onClick={() => toggleSel(c.id)}
                          aria-label="Seleccionar cobro"
                        >
                          {marcado && (
                            <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><path d="M5 12l5 5L20 7" /></svg>
                          )}
                        </button>
                      ) : (
                        <span className="hrow-ic"><IconMP /></span>
                      )}
                      <div className="hrow-mid">
                        <div className="hrow-t">{c.descripcion || 'Cobro Mercado Pago'}</div>
                        <div className="hrow-meta">
                          {c.medio ? `${c.medio} · ` : ''}{fecha(c.fecha)}
                          {c.facturado && <span className="hrow-fact"> · Facturado ✓</span>}
                        </div>
                      </div>
                      <div className="hrow-right">
                        <div className="hrow-monto">$ {ent}<small>,{dec}</small></div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}

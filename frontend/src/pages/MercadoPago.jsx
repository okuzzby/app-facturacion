import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
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
const IconCompartir = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
    <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
    <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
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

export default function MercadoPago() {
  const navigate = useNavigate()

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

  // Paginación
  const [pageSize, setPageSize] = useState(10)
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const totalPaginas = Math.max(1, Math.ceil(total / pageSize))

  const cargarCobros = useCallback(async (pg, ps) => {
    const desde = pg * ps
    const { data, count } = await supabase
      .from('mp_cobros')
      .select('*', { count: 'exact' })
      .order('fecha', { ascending: false })
      .range(desde, desde + ps - 1)
    setCobros(data ?? [])
    setTotal(count ?? 0)
  }, [])

  const cargarTodo = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const [est, prods] = await Promise.all([
        apiMP('/mp/estado'),
        supabase.from('productos_configurados').select('id, nombre').order('created_at', { ascending: true }),
      ])
      // Sin cuenta conectada → esta pantalla no aplica: mandamos a Integraciones.
      if (!est.conectada) {
        navigate('/integraciones', { replace: true })
        return
      }
      setEstado(est)
      setProductos(prods.data ?? [])
    } catch (e) {
      setError(e.message ?? String(e))
    } finally {
      setCargando(false)
    }
  }, [navigate])

  useEffect(() => {
    if (supabase) cargarTodo()
  }, [cargarTodo])

  // Carga la página de cobros cuando hay cuenta conectada y al cambiar página/tamaño.
  useEffect(() => {
    if (estado?.conectada) cargarCobros(page, pageSize)
  }, [estado?.conectada, page, pageSize, cargarCobros])

  async function guardarConfig(patch) {
    setError(null)
    setEstado((e) => ({ ...e, ...patch }))
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
      setPage(0)
      await cargarCobros(0, pageSize)
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
      await cargarCobros(page, pageSize)
    } catch (e) {
      setError(e.message ?? String(e))
    } finally {
      setFacturando(false)
    }
  }

  // Comparte / descarga el PDF de la factura vinculada a un cobro ya facturado.
  // Mismo comportamiento que el botón Compartir del Historial.
  async function compartirCobro(c) {
    setError(null)
    if (!c.factura_id) return setError('Este cobro no tiene factura vinculada.')
    let numero = ''
    let pdfPath = null
    try {
      const { data: f } = await supabase
        .from('facturas_emitidas')
        .select('numero, pdf_path')
        .eq('id', c.factura_id)
        .maybeSingle()
      numero = f?.numero || ''
      pdfPath = f?.pdf_path || null
    } catch (e) {
      return setError(e.message ?? String(e))
    }
    if (!pdfPath) return setError('La factura todavía no tiene PDF guardado.')

    let url
    try {
      const { data, error: e } = await supabase.storage.from('facturas').createSignedUrl(pdfPath, 120)
      if (e) throw e
      url = data.signedUrl
    } catch (e) {
      return setError(e.message ?? String(e))
    }
    const nombre = `comprobante-${String(numero || c.id).replace(/[^\dA-Za-z-]/g, '')}.pdf`

    // 1) Compartir el ARCHIVO (menú nativo del celular).
    try {
      const resp = await fetch(url)
      const blob = await resp.blob()
      const file = new File([blob], nombre, { type: 'application/pdf' })
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: `Comprobante ${numero || ''}` })
        return
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return
    }
    // 2) Compartir el LINK.
    try {
      if (navigator.share) {
        await navigator.share({ title: `Comprobante ${numero || ''}`, url })
        return
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return
    }
    // 3) Fallback: abrir el PDF.
    window.open(url, '_blank')
  }

  const pendientes = cobros.filter((c) => !c.facturado)

  return (
    <div className="page">
      <div className="page-head page-head-back">
        <button type="button" className="icon-btn" onClick={() => navigate(-1)} aria-label="Atrás">
          <IconAtras />
        </button>
        <h1>Mercado Pago</h1>
      </div>

      {msg && <p className="ok">{msg}</p>}
      {error && <p className="error">{error}</p>}
      {cargando && <p className="sub">Cargando…</p>}

      {!cargando && estado && (
        <>
          {/* Facturación automática */}
          <section className="seccion">
            <div className="int-opcion" style={{ borderTop: 'none', paddingTop: 0, marginTop: 0 }}>
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
              <div className="campo" style={{ marginTop: 10 }}>
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
          </section>

          {/* Cobros para facturar (manual) */}
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
                      {c.facturado && c.factura_id && (
                        <div className="hrow-acc">
                          <button
                            type="button"
                            className="icon-btn sm"
                            onClick={() => compartirCobro(c)}
                            title="Compartir factura"
                            aria-label="Compartir factura"
                          >
                            <IconCompartir />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {total > 0 && (
              <div className="paginador">
                <label className="pag-size">
                  Mostrar
                  <select
                    value={pageSize}
                    onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0) }}
                  >
                    <option value={10}>10</option>
                    <option value={20}>20</option>
                  </select>
                </label>
                <div className="pag-nav">
                  <button type="button" className="secundario" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>‹ Anterior</button>
                  <span className="pag-info">Página {page + 1} de {totalPaginas}</span>
                  <button type="button" className="secundario" disabled={page + 1 >= totalPaginas} onClick={() => setPage((p) => p + 1)}>Siguiente ›</button>
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import CalendarioRango from '../components/CalendarioRango'

const CONCEPTOS = ['Productos', 'Servicios', 'Productos y Servicios']
const IVA_OPCIONES = [
  'Consumidor Final',
  'Responsable Monotributo',
  'IVA Responsable Inscripto',
  'IVA Sujeto Exento',
  'IVA No Alcanzado',
]
// value = lo que se guarda/envía; label = lo que se muestra (corto).
const COND_VENTA = [
  { v: 'Contado', l: 'Contado' },
  { v: 'Transferencia Bancaria', l: 'Transferencia' },
  { v: 'Otra', l: 'Otra' },
]

// Convierte "10.000,20" o "10000.20" a número.
function parsePrecio(s) {
  let t = String(s ?? '').trim()
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.')
  const n = Number(t.replace(/[^\d.]/g, ''))
  return isNaN(n) ? 0 : n
}
const money = (n) =>
  new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0)

// Estados intermedios del onboarding automático de facturación electrónica.
const SETUP_EN_PROGRESO = [
  'iniciando',
  'creando_cert',
  'autorizando',
  'guardando',
  'detectando_pv',
  'creando_pv',
]

function hoyDDMMYYYY() {
  const d = new Date()
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}/${d.getFullYear()}`
}

export default function Facturar() {
  const [cred, setCred] = useState(null)
  const [productos, setProductos] = useState([])
  const [cargandoInit, setCargandoInit] = useState(true)

  const [concepto, setConcepto] = useState('Productos')
  const [periodoDesde, setPeriodoDesde] = useState(hoyDDMMYYYY())
  const [periodoHasta, setPeriodoHasta] = useState(hoyDDMMYYYY())
  const [vtoPago, setVtoPago] = useState(hoyDDMMYYYY())
  const [condicionIva, setCondicionIva] = useState('Consumidor Final')
  const [condicionesVenta, setCondicionesVenta] = useState(['Contado'])
  const [productoSel, setProductoSel] = useState('')
  const [productoCustom, setProductoCustom] = useState('')
  const [precio, setPrecio] = useState('')
  const [cantidad, setCantidad] = useState(1)
  const [calAbierto, setCalAbierto] = useState(false)

  const [vista, setVista] = useState('elegir') // 'elegir' | 'form'
  const [paso, setPaso] = useState('form') // 'form' | 'preview'
  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState(null)
  const [error, setError] = useState(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (!supabase) return
    ;(async () => {
      const { data: c } = await supabase
        .from('credenciales_arca')
        .select('cuit, punto_venta_ws, ws_cert_alias, ws_setup_estado')
        .maybeSingle()
      setCred(c ?? null)
      const { data: p } = await supabase
        .from('productos_configurados')
        .select('nombre')
        .order('created_at', { ascending: true })
      const nombres = (p ?? []).map((x) => x.nombre)
      setProductos(nombres)
      setProductoSel(nombres[0] ?? 'otro')
      setCargandoInit(false)
    })()
  }, [])

  const esServicio = /servicio/i.test(concepto)
  const productoFinal = productoSel === 'otro' ? productoCustom.trim() : productoSel
  const precioNum = parsePrecio(precio)
  const total = precioNum * cantidad

  function toggleCondVenta(c) {
    setCondicionesVenta((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]
    )
  }

  function irAPreview(e) {
    e.preventDefault()
    setError(null)
    if (!productoFinal) return setError('Elegí o escribí un producto/servicio')
    if (precioNum <= 0) return setError('Ingresá un precio válido')
    if (condicionesVenta.length === 0) return setError('Elegí al menos una condición de venta')
    setPaso('preview')
  }

  async function confirmar() {
    setEnviando(true)
    setError(null)
    try {
      const backend = import.meta.env.VITE_BACKEND_URL
      if (!backend) throw new Error('Falta VITE_BACKEND_URL')
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('No hay sesión activa')

      const body = {
        producto: productoFinal,
        precio: precioNum,
        cantidad,
        concepto,
        condicionIva,
        condicionesVenta,
      }

      const r = await fetch(`${backend}/arca/ws/factura-generar`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Error del backend')
      if (!j.ok) throw new Error(j.error || 'ARCA no pudo generar la factura')
      setResultado(j)
    } catch (e) {
      setError(e.message ?? String(e))
    } finally {
      setEnviando(false)
    }
  }

  function nuevaFactura() {
    setResultado(null)
    setError(null)
    setPaso('form')
    setPrecio('')
    setCantidad(1)
    setProductoCustom('')
  }

  if (cargandoInit) {
    return (
      <div className="page">
        <div className="card"><p className="sub">Cargando…</p></div>
      </div>
    )
  }

  // Facturación electrónica lista = tiene certificado + punto de venta WS.
  const setupListo =
    !!((cred?.ws_cert_alias && cred?.punto_venta_ws) || cred?.ws_setup_estado === 'listo')
  const setupEnProgreso = SETUP_EN_PROGRESO.includes(cred?.ws_setup_estado)

  if (!setupListo) {
    return (
      <div className="page">
        <div className="page-head"><h1>Facturar</h1></div>
        <div className="card">
          {setupEnProgreso ? (
            <p style={{ margin: 0 }}>
              <span className="spinner-inline" /> Estamos configurando tu facturación electrónica…
              Andá a Configuración para ver el avance; en unos minutos vas a poder facturar.
            </p>
          ) : (
            <p className="error" style={{ margin: 0 }}>
              Primero configurá tu facturación electrónica: cargá tu CUIT y Clave Fiscal en
              Configuración y el sistema deja todo listo solo.
            </p>
          )}
          <div style={{ marginTop: 14 }}>
            <Link to="/configuracion" className="boton-link">Ir a Configuración</Link>
          </div>
        </div>
      </div>
    )
  }

  // Elegir tipo de comprobante (Factura C / Nota de crédito C)
  if (vista === 'elegir' && !resultado) {
    return (
      <div className="page">
        <div className="page-head">
          <div><h1>Facturar</h1><div className="sub">Elegí qué querés hacer</div></div>
        </div>

        <div className="opciones-fact">
          <div className="opcion-wrap">
            <button type="button" className="opcion" onClick={() => setVista('form')}>
              <span className="opcion-ic">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                  <path d="M6 2h8l4 4v16H6z" /><path d="M14 2v4h4" /><path d="M9 12h6M9 16h4" />
                </svg>
              </span>
              <span className="opcion-body">
                <span className="opcion-t">Factura C</span>
                <span className="opcion-d">Producto o Servicio</span>
              </span>
              <span className="opcion-cta">Emitir Factura C</span>
            </button>
          </div>

          <div className="opcion-wrap">
            <button type="button" className="opcion" onClick={() => navigate('/historial?nc=1')}>
              <span className="opcion-ic opcion-ic-dark">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                  <path d="M6 2h8l4 4v16H6z" /><path d="M14 2v4h4" /><path d="M9 14h6" />
                </svg>
              </span>
              <span className="opcion-body">
                <span className="opcion-t">Nota de crédito C</span>
                <span className="opcion-d">Anular una factura ya emitida</span>
              </span>
              <span className="opcion-cta opcion-cta-dark">Emitir Nota de crédito C</span>
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Resultado (factura emitida)
  if (resultado) {
    return (
      <div className="page">
        <div className="page-head"><h1>Factura emitida ✓</h1></div>
        <div className="card">
          <div className="setup-box setup-ok">
            <p className="ok" style={{ margin: 0 }}>La factura se generó en ARCA.</p>
            {resultado.numero && (
              <p style={{ margin: '6px 0 0' }}>
                Comprobante Nº <strong>{resultado.numero}</strong>
                {resultado.cae ? ` · CAE ${resultado.cae}` : ''}
              </p>
            )}
          </div>
          <div className="fila-botones" style={{ marginTop: 16 }}>
            <button type="button" onClick={nuevaFactura}>Hacer otra factura</button>
            <Link to="/historial" className="boton-link secundario-link">Ver historial</Link>
          </div>
        </div>
      </div>
    )
  }

  // Vista previa
  if (paso === 'preview') {
    return (
      <div className="page">
        <div className="page-head">
          <div><h1>Revisá la factura</h1><div className="sub">Confirmá los datos antes de emitir.</div></div>
        </div>
        <div className="card">
          <dl className="resumen">
            <div><dt>Emisor</dt><dd>CUIT {cred.cuit}</dd></div>
            <div><dt>Punto de venta</dt><dd>{cred.punto_venta_ws}</dd></div>
            <div><dt>Comprobante</dt><dd>Factura C</dd></div>
            <div><dt>Fecha</dt><dd>Hoy ({hoyDDMMYYYY()})</dd></div>
            <div><dt>Concepto</dt><dd>{concepto}</dd></div>
            {esServicio && (
              <div><dt>Período</dt><dd>{periodoDesde} a {periodoHasta} · Vto {vtoPago}</dd></div>
            )}
            <div><dt>Condición IVA</dt><dd>{condicionIva}</dd></div>
            <div><dt>Condición de venta</dt><dd>{condicionesVenta.join(', ')}</dd></div>
            <div><dt>Producto</dt><dd>{productoFinal}</dd></div>
            <div><dt>Precio unitario</dt><dd>$ {money(precioNum)}</dd></div>
            <div><dt>Cantidad</dt><dd>{cantidad}</dd></div>
            <div><dt>Total</dt><dd>$ {money(total)}</dd></div>
          </dl>

          <div className="setup-box setup-aviso" style={{ marginTop: 4 }}>
            <p style={{ margin: 0 }}>
              Al confirmar se emite una factura <strong>real</strong> en ARCA. No se puede deshacer
              automáticamente (se anula con Nota de Crédito).
            </p>
          </div>

          <div className="fila-botones" style={{ marginTop: 16 }}>
            <button type="button" className="secundario" onClick={() => setPaso('form')} disabled={enviando}>
              Volver
            </button>
            <button type="button" onClick={confirmar} disabled={enviando}>
              {enviando ? 'Emitiendo…' : 'Confirmar y emitir'}
            </button>
          </div>
          {error && <p className="error" style={{ marginTop: 10 }}>{error}</p>}
        </div>
      </div>
    )
  }

  // Formulario
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Nueva factura</h1>
          <div className="sub">Factura C · Punto de venta {cred.punto_venta_ws} · Fecha hoy</div>
        </div>
        <button type="button" className="secundario" onClick={() => setVista('elegir')}>← Volver</button>
      </div>
      <div className="card">
      <form onSubmit={irAPreview} className="form">
        <label className="campo">
          <span>Fecha</span>
          <input type="text" value={`Hoy (${hoyDDMMYYYY()})`} disabled />
        </label>

        <label className="campo">
          <span>Concepto</span>
          <select value={concepto} onChange={(e) => setConcepto(e.target.value)}>
            {CONCEPTOS.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>

        {esServicio && (
          <>
            <div className="campo">
              <span>Período</span>
              <button type="button" className="periodo-box" onClick={() => setCalAbierto(true)}>
                <span>{periodoDesde} – {periodoHasta}</span>
                <svg className="cal-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" />
                </svg>
              </button>
            </div>
            <label className="campo">
              <span>Vto. para el pago</span>
              <input type="text" value={vtoPago} onChange={(e) => setVtoPago(e.target.value)} />
            </label>
          </>
        )}

        <label className="campo">
          <span>Condición frente al IVA</span>
          <select value={condicionIva} onChange={(e) => setCondicionIva(e.target.value)}>
            {IVA_OPCIONES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>

        <label className="campo">
          <span>Condición de venta</span>
          <select
            value={condicionesVenta[0] || 'Contado'}
            onChange={(e) => setCondicionesVenta([e.target.value])}
          >
            {COND_VENTA.map((c) => (
              <option key={c.v} value={c.v}>{c.l}</option>
            ))}
          </select>
        </label>

        <label className="campo">
          <span>Producto / Servicio</span>
          <select value={productoSel} onChange={(e) => setProductoSel(e.target.value)}>
            {productos.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
            <option value="otro">Otro (escribir)…</option>
          </select>
        </label>

        {productoSel === 'otro' && (
          <label className="campo">
            <span>Descripción</span>
            <input
              type="text"
              value={productoCustom}
              onChange={(e) => setProductoCustom(e.target.value)}
              placeholder="Ej: Servicio de flete"
            />
          </label>
        )}

        <div className="cant-precio">
          <div className="campo">
            <span>Cantidad</span>
            <div className="stepper">
              <button type="button" onClick={() => setCantidad((c) => Math.max(1, c - 1))} aria-label="Menos">−</button>
              <span className="stepper-val">{cantidad}</span>
              <button type="button" onClick={() => setCantidad((c) => c + 1)} aria-label="Más">+</button>
            </div>
          </div>
          <div className="campo">
            <span>Precio unitario</span>
            <div className="precio-field">
              <span className="precio-sig">$</span>
              <input
                type="text"
                inputMode="decimal"
                value={precio}
                onChange={(e) => setPrecio(e.target.value)}
                placeholder="0,00"
              />
            </div>
          </div>
        </div>

        <button type="submit">Continuar →</button>
      </form>
      {error && <p className="error" style={{ marginTop: 10 }}>{error}</p>}
      </div>

      {calAbierto && (
        <CalendarioRango
          desde={periodoDesde}
          hasta={periodoHasta}
          onAplicar={(d, h) => { setPeriodoDesde(d); setPeriodoHasta(h); setCalAbierto(false) }}
          onCerrar={() => setCalAbierto(false)}
        />
      )}
    </div>
  )
}

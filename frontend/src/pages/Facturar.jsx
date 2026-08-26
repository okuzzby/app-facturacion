import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

const CONCEPTOS = ['Productos', 'Servicios', 'Productos y Servicios']
const IVA_OPCIONES = [
  'Consumidor Final',
  'Responsable Monotributo',
  'IVA Responsable Inscripto',
  'IVA Sujeto Exento',
  'IVA No Alcanzado',
]
const COND_VENTA = ['Contado', 'Transferencia Bancaria', 'Otra']

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

  const [paso, setPaso] = useState('form') // 'form' | 'preview'
  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState(null)
  const [error, setError] = useState(null)

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

  function toggleCondVenta(c) {
    setCondicionesVenta((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]
    )
  }

  function irAPreview(e) {
    e.preventDefault()
    setError(null)
    if (!productoFinal) return setError('Elegí o escribí un producto/servicio')
    if (!precio || Number(precio) <= 0) return setError('Ingresá un precio válido')
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
        precio: String(precio),
        cantidad: 1,
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
    setProductoCustom('')
  }

  if (cargandoInit) {
    return (
      <div className="card">
        <p>Cargando…</p>
      </div>
    )
  }

  // Facturación electrónica lista = tiene certificado + punto de venta WS.
  const setupListo =
    !!((cred?.ws_cert_alias && cred?.punto_venta_ws) || cred?.ws_setup_estado === 'listo')
  const setupEnProgreso = SETUP_EN_PROGRESO.includes(cred?.ws_setup_estado)

  if (!setupListo) {
    return (
      <div className="card">
        <div className="topbar">
          <Link to="/" className="volver">← Volver</Link>
          <h1>Facturar</h1>
        </div>
        {setupEnProgreso ? (
          <p>
            Estamos configurando tu facturación electrónica… Andá a Configuración para ver el
            avance; en unos minutos vas a poder facturar.
          </p>
        ) : (
          <p className="error">
            Primero configurá tu facturación electrónica: cargá tu CUIT y Clave Fiscal en
            Configuración y el sistema deja todo listo solo.
          </p>
        )}
        <Link to="/configuracion" className="boton-link">Ir a Configuración</Link>
      </div>
    )
  }

  // Resultado (factura emitida)
  if (resultado) {
    return (
      <div className="card card-wide">
        <div className="topbar">
          <Link to="/" className="volver">← Inicio</Link>
          <h1>Factura emitida ✓</h1>
        </div>
        <p className="ok">La factura se generó en ARCA.</p>
        {resultado.numero && (
          <p>
            Comprobante Nº <strong>{resultado.numero}</strong>
            {resultado.cae ? ` · CAE ${resultado.cae}` : ''}
          </p>
        )}
        {resultado.screenshot && (
          <img
            className="shot"
            alt="factura ARCA"
            src={`data:image/png;base64,${resultado.screenshot}`}
          />
        )}
        <div className="fila-botones">
          <button type="button" onClick={nuevaFactura}>Hacer otra factura</button>
          <Link to="/historial" className="boton-link secundario-link">Ver historial</Link>
        </div>
      </div>
    )
  }

  // Vista previa
  if (paso === 'preview') {
    return (
      <div className="card card-wide">
        <div className="topbar">
          <h1>Revisá la factura</h1>
        </div>
        <div className="cred-cargada">
          <p>Emisor: <strong>CUIT {cred.cuit}</strong></p>
          <p>Punto de venta: <strong>{cred.punto_venta_ws}</strong></p>
          <p>Comprobante: <strong>Factura C</strong></p>
          <p>Fecha: <strong>Hoy ({hoyDDMMYYYY()})</strong></p>
          <p>Concepto: <strong>{concepto}</strong></p>
          {esServicio && (
            <p className="sub">Período: {periodoDesde} a {periodoHasta} · Vto: {vtoPago}</p>
          )}
          <p>Condición IVA: <strong>{condicionIva}</strong></p>
          <p>Condición de venta: <strong>{condicionesVenta.join(', ')}</strong></p>
          <p>Producto: <strong>{productoFinal}</strong></p>
          <p>Cantidad: <strong>1</strong> · Precio: <strong>${precio}</strong></p>
        </div>

        <p className="aviso">
          Al confirmar se emite una factura REAL en ARCA. Esta acción no se puede deshacer
          automáticamente.
        </p>

        <div className="fila-botones">
          <button type="button" className="secundario" onClick={() => setPaso('form')} disabled={enviando}>
            Volver
          </button>
          <button type="button" onClick={confirmar} disabled={enviando}>
            {enviando ? 'Emitiendo…' : 'Confirmar y emitir'}
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </div>
    )
  }

  // Formulario
  return (
    <div className="card card-wide">
      <div className="topbar">
        <Link to="/" className="volver">← Volver</Link>
        <h1>Facturar</h1>
      </div>

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
          <div className="periodo">
            <label className="campo">
              <span>Período desde</span>
              <input type="text" value={periodoDesde} onChange={(e) => setPeriodoDesde(e.target.value)} />
            </label>
            <label className="campo">
              <span>Período hasta</span>
              <input type="text" value={periodoHasta} onChange={(e) => setPeriodoHasta(e.target.value)} />
            </label>
            <label className="campo">
              <span>Vto. para el pago</span>
              <input type="text" value={vtoPago} onChange={(e) => setVtoPago(e.target.value)} />
            </label>
          </div>
        )}

        <label className="campo">
          <span>Condición frente al IVA</span>
          <select value={condicionIva} onChange={(e) => setCondicionIva(e.target.value)}>
            {IVA_OPCIONES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>

        <div className="campo">
          <span>Condición de venta</span>
          <div className="cv-opciones">
            {COND_VENTA.map((c) => (
              <label key={c} className="cv-opt">
                <input
                  type="checkbox"
                  checked={condicionesVenta.includes(c)}
                  onChange={() => toggleCondVenta(c)}
                />
                <span>{c}</span>
              </label>
            ))}
          </div>
        </div>

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

        <div className="fila-fija">
          <label className="campo">
            <span>Cantidad</span>
            <input type="text" value="1" disabled />
          </label>
          <label className="campo">
            <span>Medida</span>
            <input type="text" value="Unidades" disabled />
          </label>
        </div>

        <label className="campo">
          <span>Precio unitario</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={precio}
            onChange={(e) => setPrecio(e.target.value)}
            placeholder="0.00"
          />
        </label>

        <button type="submit">Continuar</button>
      </form>
      {error && <p className="error">{error}</p>}
    </div>
  )
}

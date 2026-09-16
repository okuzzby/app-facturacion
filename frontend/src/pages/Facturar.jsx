import { useEffect, useState } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import CalendarioRango from '../components/CalendarioRango'
import ClienteForm from '../components/ClienteForm'
import { condCorta, formatearCUIT, iniciales } from '../lib/clientes'

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

// Convierte lo que escribe el usuario a número. Acepta "." o "," como separador
// decimal de forma indiferente, entiende los separadores de miles y redondea
// siempre a 2 decimales (centavos). Ejemplos:
//   "100,50" y "100.50" -> 100.5 · "1.500" -> 1500 · "1.500,50" -> 1500.5
function parsePrecio(s) {
  const t = String(s ?? '').trim().replace(/[^\d.,]/g, '')
  if (!t) return 0
  const m = t.match(/^(.*)[.,](\d{1,2})$/)
  let n
  if (m) {
    const entero = m[1].replace(/[.,]/g, '') || '0'
    n = Number(entero + '.' + m[2])
  } else {
    n = Number(t.replace(/[.,]/g, ''))
  }
  return isNaN(n) ? 0 : Math.round(n * 100) / 100
}
const money = (n) =>
  new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0)

const SETUP_EN_PROGRESO = [
  'iniciando',
  'creando_cert',
  'autorizando',
  'guardando',
  'detectando_pv',
  'creando_pv',
  'capturando_datos',
]

function hoyDDMMYYYY() {
  const d = new Date()
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}/${d.getFullYear()}`
}

const itemVacio = () => ({ desc: '', precio: '', cantidad: 1 })

export default function Facturar() {
  const { user } = useAuth()
  const [cred, setCred] = useState(null)
  const [productos, setProductos] = useState([])
  const [cargandoInit, setCargandoInit] = useState(true)

  const [concepto, setConcepto] = useState('Productos')
  const [periodoDesde, setPeriodoDesde] = useState(hoyDDMMYYYY())
  const [periodoHasta, setPeriodoHasta] = useState(hoyDDMMYYYY())
  const [vtoPago, setVtoPago] = useState(hoyDDMMYYYY())
  const [condicionesVenta, setCondicionesVenta] = useState(['Contado'])
  const [items, setItems] = useState([itemVacio()])
  const [calAbierto, setCalAbierto] = useState(false)

  // Receptor: Consumidor Final (default) o un cliente guardado con CUIT.
  const [facturarA, setFacturarA] = useState('cf') // 'cf' | 'cliente'
  const [clientes, setClientes] = useState([])
  const [clienteSel, setClienteSel] = useState(null)
  const [mostrarNuevoCliente, setMostrarNuevoCliente] = useState(false)
  const [guardandoCliente, setGuardandoCliente] = useState(false)
  const [clienteError, setClienteError] = useState(null)
  // La condición IVA de la factura la define el receptor elegido.
  const condicionIva = facturarA === 'cliente' && clienteSel ? clienteSel.cond_iva : 'Consumidor Final'

  const [vista, setVista] = useState('elegir') // 'elegir' | 'form'
  const [paso, setPaso] = useState('form') // 'form' | 'preview'
  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState(null)
  const [error, setError] = useState(null)
  const [replicandoNumero, setReplicandoNumero] = useState(null)
  const navigate = useNavigate()
  const location = useLocation()
  const replicar = location.state?.replicar

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
      setProductos((p ?? []).map((x) => x.nombre))

      const { data: cl } = await supabase
        .from('clientes')
        .select('*')
        .order('nombre', { ascending: true })
      setClientes(cl ?? [])

      // Si venimos de "Replicar" (desde el Historial), precargamos un ítem.
      if (replicar) {
        setItems([{ desc: replicar.producto || '', precio: replicar.importe ? money(replicar.importe) : '', cantidad: 1 }])
        setReplicandoNumero(replicar.numero || null)
        setVista('form')
      }
      setCargandoInit(false)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const esServicio = /servicio/i.test(concepto)
  const total = items.reduce((a, it) => a + parsePrecio(it.precio) * Number(it.cantidad || 0), 0)

  function toggleCondVenta(c) {
    setCondicionesVenta((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]))
  }

  function elegirFacturarA(modo) {
    setFacturarA(modo)
    setError(null)
    if (modo === 'cf') {
      setClienteSel(null)
      setMostrarNuevoCliente(false)
    } else if (!clienteSel && clientes.length === 0) {
      // Sin clientes guardados: abrimos directo el alta.
      setMostrarNuevoCliente(true)
    }
  }

  async function crearClienteAlVuelo(datos) {
    setGuardandoCliente(true)
    setClienteError(null)
    try {
      const { data, error } = await supabase
        .from('clientes')
        .insert({ ...datos, user_id: user.id })
        .select('*')
        .single()
      if (error) throw error
      setClientes((prev) => [...prev, data].sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '')))
      setClienteSel(data)
      setMostrarNuevoCliente(false)
    } catch (e) {
      setClienteError(e.message || String(e))
    } finally {
      setGuardandoCliente(false)
    }
  }

  function setItemDesc(i, v) {
    setItems((arr) => arr.map((it, idx) => (idx === i ? { ...it, desc: v.slice(0, 80) } : it)))
  }
  function setItemPrecio(i, v) {
    const limpio = v.replace(/[^\d.,]/g, '').slice(0, 15)
    setItems((arr) => arr.map((it, idx) => (idx === i ? { ...it, precio: limpio } : it)))
  }
  function setItemCantidad(i, delta) {
    setItems((arr) =>
      arr.map((it, idx) =>
        idx === i ? { ...it, cantidad: Math.min(99999, Math.max(1, Number(it.cantidad) + delta)) } : it
      )
    )
  }
  function agregarItem() {
    setItems((arr) => (arr.length >= 50 ? arr : [...arr, itemVacio()]))
  }
  function quitarItem(i) {
    setItems((arr) => (arr.length <= 1 ? arr : arr.filter((_, idx) => idx !== i)))
  }

  function irAPreview(e) {
    e.preventDefault()
    setError(null)
    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      const desc = it.desc.trim()
      if (!desc) return setError(`Ítem ${i + 1}: escribí una descripción`)
      if (desc.length > 80) return setError(`Ítem ${i + 1}: la descripción es muy larga (máx. 80)`)
      const precio = parsePrecio(it.precio)
      if (precio <= 0) return setError(`Ítem ${i + 1}: ingresá un precio válido`)
      if (precio > 100000000) return setError(`Ítem ${i + 1}: el precio es demasiado alto`)
      if (!Number.isInteger(Number(it.cantidad)) || it.cantidad < 1 || it.cantidad > 99999)
        return setError(`Ítem ${i + 1}: cantidad inválida`)
    }
    if (total <= 0) return setError('El total de la factura debe ser mayor a 0')
    if (condicionesVenta.length === 0) return setError('Elegí al menos una condición de venta')
    if (facturarA === 'cliente' && !clienteSel) return setError('Elegí o cargá un cliente, o pasá a Consumidor Final')
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
        items: items.map((it) => ({
          producto: it.desc.trim(),
          precio: parsePrecio(it.precio),
          cantidad: Number(it.cantidad),
        })),
        concepto,
        condicionIva,
        condicionesVenta,
      }

      // Si se factura a un cliente, mandamos el receptor (el backend valida CUIT).
      if (facturarA === 'cliente' && clienteSel) {
        body.receptor = {
          razonSocial: clienteSel.nombre,
          cuit: clienteSel.cuit,
          condIva: clienteSel.cond_iva,
          domicilio: clienteSel.domicilio || '',
        }
      }

      const r = await fetch(`${backend}/arca/ws/factura-generar`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
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
    setItems([itemVacio()])
    setReplicandoNumero(null)
    setFacturarA('cf')
    setClienteSel(null)
    setMostrarNuevoCliente(false)
  }

  if (cargandoInit) {
    return (
      <div className="page">
        <div className="card"><p className="sub">Cargando…</p></div>
      </div>
    )
  }

  const setupEnProgreso = SETUP_EN_PROGRESO.includes(cred?.ws_setup_estado)
  const setupListo =
    !setupEnProgreso &&
    (cred?.ws_setup_estado === 'listo' ||
      (!cred?.ws_setup_estado && !!(cred?.ws_cert_alias && cred?.punto_venta_ws)))

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

  // Elegir tipo de comprobante
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

          <div className="opcion-wrap">
            <button type="button" className="opcion" onClick={() => navigate('/mercadopago')}>
              <span className="opcion-ic opcion-ic-mp">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                  <rect x="2" y="5" width="20" height="14" rx="3" /><path d="M2 10h20" />
                </svg>
              </span>
              <span className="opcion-body">
                <span className="opcion-t">Mercado Pago</span>
                <span className="opcion-d">Facturá tus cobros recibidos</span>
              </span>
              <span className="opcion-cta opcion-cta-mp">Ver cobros</span>
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Resultado
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
            {esServicio && <div><dt>Período</dt><dd>{periodoDesde} – {periodoHasta}</dd></div>}
            {esServicio && <div><dt>Vto. para el pago</dt><dd>{vtoPago}</dd></div>}
            <div>
              <dt>Cliente</dt>
              <dd>
                {facturarA === 'cliente' && clienteSel ? (
                  <>
                    {clienteSel.nombre}
                    {clienteSel.cuit ? ` · CUIT ${formatearCUIT(clienteSel.cuit)}` : ''}
                  </>
                ) : (
                  'Consumidor Final'
                )}
              </dd>
            </div>
            <div><dt>Condición IVA</dt><dd>{condicionIva}</dd></div>
            <div><dt>Condición de venta</dt><dd>{condicionesVenta.join(', ')}</dd></div>
          </dl>

          <div className="prev-items">
            <div className="prev-items-tit">Detalle</div>
            {items.map((it, i) => {
              const sub = parsePrecio(it.precio) * Number(it.cantidad)
              return (
                <div className="prev-item" key={i}>
                  <div className="prev-item-d">
                    {it.desc.trim()}
                    <small>{it.cantidad} × $ {money(parsePrecio(it.precio))}</small>
                  </div>
                  <div className="prev-item-m">$ {money(sub)}</div>
                </div>
              )
            })}
          </div>

          <div className="total-card">
            <div className="total-top">Total a facturar</div>
            <div className="total-monto">
              <span className="tm-sig">$</span>
              <span className="tm-ent">{money(total).split(',')[0]}</span>
              <span className="tm-dec">,{money(total).split(',')[1]}</span>
            </div>
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
      <div className="page-head page-head-back">
        <button type="button" className="icon-btn" onClick={() => setVista('elegir')} aria-label="Volver">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <div>
          <h1>Nueva factura</h1>
          <div className="sub">Factura C · Punto de venta {cred.punto_venta_ws} · Fecha hoy</div>
        </div>
      </div>
      <div className="card">
      {replicandoNumero && (
        <div className="repl-banner">
          <span className="repl-banner-ic">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
              <rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h8" />
            </svg>
          </span>
          <span>Replicando la factura <strong>Nº {replicandoNumero}</strong>. Cambiá lo que necesites y emitila con fecha de hoy.</span>
        </div>
      )}
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
              <input
                type="text"
                inputMode="numeric"
                placeholder="dd/mm/aaaa"
                value={vtoPago}
                onChange={(e) => setVtoPago(e.target.value.replace(/[^\d/]/g, '').slice(0, 10))}
                maxLength={10}
              />
            </label>
          </>
        )}

        {/* Facturar a: Consumidor Final (default) o un cliente con CUIT */}
        <div className="campo">
          <span>Facturar a</span>
          <div className="fact-a">
            <button
              type="button"
              className={`fact-a-op ${facturarA === 'cf' ? 'on' : ''}`}
              onClick={() => elegirFacturarA('cf')}
            >
              <span className="fact-a-dot" />
              <span className="fact-a-t">Consumidor Final</span>
              <span className="fact-a-s">Sin datos del cliente</span>
            </button>
            <button
              type="button"
              className={`fact-a-op ${facturarA === 'cliente' ? 'on' : ''}`}
              onClick={() => elegirFacturarA('cliente')}
            >
              <span className="fact-a-dot" />
              <span className="fact-a-t">Un cliente</span>
              <span className="fact-a-s">Con CUIT y datos</span>
            </button>
          </div>
        </div>

        {facturarA === 'cliente' && (
          <div className="cli-picker">
            {clienteSel && !mostrarNuevoCliente && (
              <div className="cli-chip">
                <span className="cli-av">{iniciales(clienteSel.nombre)}</span>
                <span className="cli-info">
                  <span className="cli-nm">{clienteSel.nombre}</span>
                  <span className="cli-cu">
                    {clienteSel.cuit ? formatearCUIT(clienteSel.cuit) : 'Sin CUIT'} · {condCorta(clienteSel.cond_iva)}
                  </span>
                </span>
                <button type="button" className="cli-chip-x" onClick={() => setClienteSel(null)}>Cambiar</button>
              </div>
            )}

            {!clienteSel && !mostrarNuevoCliente && (
              <>
                {clientes.length > 0 && (
                  <label className="campo">
                    <span>Elegí un cliente guardado</span>
                    <select
                      value=""
                      onChange={(e) => {
                        const c = clientes.find((x) => x.id === e.target.value)
                        if (c) setClienteSel(c)
                      }}
                    >
                      <option value="" disabled>Seleccioná…</option>
                      {clientes.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nombre} — {c.cuit ? formatearCUIT(c.cuit) : 'Sin CUIT'}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <button
                  type="button"
                  className="cli-nuevo-inline"
                  onClick={() => { setClienteError(null); setMostrarNuevoCliente(true) }}
                >
                  <span className="cli-nuevo-plus">＋</span> Cargar un cliente nuevo
                </button>
              </>
            )}

            {mostrarNuevoCliente && (
              <div className="cli-nuevo-box">
                <div className="cli-nuevo-tit">Nuevo cliente</div>
                <ClienteForm
                  onGuardar={crearClienteAlVuelo}
                  onCancelar={clientes.length > 0 || clienteSel ? () => setMostrarNuevoCliente(false) : null}
                  guardando={guardandoCliente}
                  errorExterno={clienteError}
                  ctaLabel="Guardar y usar"
                />
              </div>
            )}
          </div>
        )}

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

        {/* Ítems */}
        <div className="campo"><span>Ítems</span></div>
        <datalist id="productos-guardados">
          {productos.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>

        {items.map((it, i) => (
          <div className="fact-item" key={i}>
            <div className="fact-item-head">
              <span className="fact-item-n">Ítem {i + 1}</span>
              {items.length > 1 && (
                <button type="button" className="fact-item-x" onClick={() => quitarItem(i)} aria-label="Quitar ítem">✕</button>
              )}
            </div>
            <input
              type="text"
              className="fact-desc"
              list="productos-guardados"
              value={it.desc}
              onChange={(e) => setItemDesc(i, e.target.value)}
              placeholder="Producto o servicio"
              maxLength={80}
            />
            <div className="cant-precio">
              <div className="campo">
                <span>Cantidad</span>
                <div className="stepper">
                  <button type="button" onClick={() => setItemCantidad(i, -1)} aria-label="Menos">−</button>
                  <span className="stepper-val">{it.cantidad}</span>
                  <button type="button" onClick={() => setItemCantidad(i, +1)} aria-label="Más">+</button>
                </div>
              </div>
              <div className="campo">
                <span>Precio unitario</span>
                <div className="precio-field">
                  <span className="precio-sig">$</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={it.precio}
                    onChange={(e) => setItemPrecio(i, e.target.value)}
                    maxLength={15}
                    placeholder="0,00"
                  />
                </div>
              </div>
            </div>
            <div className="fact-item-sub">Subtotal: <b>$ {money(parsePrecio(it.precio) * Number(it.cantidad))}</b></div>
          </div>
        ))}

        <button type="button" className="fact-add" onClick={agregarItem} disabled={items.length >= 50}>
          <span className="fact-add-plus">＋</span> Agregar otro ítem
        </button>

        <div className="fact-total">
          <span className="fact-total-k">Total a facturar</span>
          <span className="fact-total-v">$ {money(total)}</span>
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

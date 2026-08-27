import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

const money = (n) =>
  new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0)
const tipoCorto = (t) => (/nota de cr/i.test(t || '') ? 'NC' : 'FC')
const fechaCorta = (s) => new Date(s).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' })

const IconDoc = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
    <path d="M6 2h9l3 3v17H6z" /><path d="M9 12h6M9 16h4" />
  </svg>
)
const IconImprimir = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
    <path d="M6 9V3h12v6" /><rect x="6" y="14" width="12" height="7" rx="1" />
    <path d="M6 17H4a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-2" /><path d="M9 18h6" />
  </svg>
)
const IconCompartir = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
    <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
    <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
  </svg>
)

export default function Historial() {
  const [facturas, setFacturas] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [confirmando, setConfirmando] = useState(null)
  const [anulando, setAnulando] = useState(null)
  const [msg, setMsg] = useState(null)
  const [errorShot, setErrorShot] = useState(null)
  const [params] = useSearchParams()
  const modoAnular = params.get('nc') === '1'

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

  async function urlFirmada(f) {
    const { data, error } = await supabase.storage.from('facturas').createSignedUrl(f.pdf_path, 120)
    if (error) throw error
    return data.signedUrl
  }

  async function imprimir(f) {
    setError(null)
    if (!f.pdf_path) return setError('Esta factura no tiene PDF guardado.')
    try {
      window.open(await urlFirmada(f), '_blank')
    } catch (e) {
      setError(e.message ?? String(e))
    }
  }

  async function compartir(f) {
    setError(null)
    if (!f.pdf_path) return setError('Esta factura no tiene PDF guardado.')
    let url
    try {
      url = await urlFirmada(f)
    } catch (e) {
      return setError(e.message ?? String(e))
    }
    const nombre = `comprobante-${String(f.numero || f.id).replace(/[^\dA-Za-z-]/g, '')}.pdf`

    // 1) Compartir el ARCHIVO (menú nativo del celular).
    try {
      const resp = await fetch(url)
      const blob = await resp.blob()
      const file = new File([blob], nombre, { type: 'application/pdf' })
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: `Comprobante ${f.numero || ''}` })
        return
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return // el usuario canceló
    }
    // 2) Compartir el LINK (si el navegador lo soporta).
    try {
      if (navigator.share) {
        await navigator.share({ title: `Comprobante ${f.numero || ''}`, url })
        return
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return
    }
    // 3) Fallback: abrir el PDF.
    window.open(url, '_blank')
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
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ facturaId: f.id }),
      })
      const j = await r.json()
      if (!r.ok) { setErrorShot(j.screenshot || null); throw new Error(j.error || 'Error del backend') }
      if (!j.ok) { setErrorShot(j.screenshot || null); throw new Error(j.error || 'ARCA no pudo generar la Nota de Crédito') }
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
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Historial</h1>
          <div className="sub">
            {modoAnular ? 'Elegí la factura a anular con una Nota de Crédito' : 'Todos tus comprobantes emitidos'}
          </div>
        </div>
      </div>

      {modoAnular && (
        <div className="setup-box setup-aviso">
          <p style={{ margin: 0 }}>
            Tocá <strong>N Crédito C</strong> en la factura que quieras anular. Se emite una Nota de
            Crédito C asociada.
          </p>
        </div>
      )}

      <div className="card">
        {cargando && <p className="sub">Cargando…</p>}
        {!cargando && facturas.length === 0 && (
          <p className="sub">Todavía no emitiste comprobantes desde la app.</p>
        )}

        <div className="lista-facturas">
          {facturas.map((f) => {
            const [ent, dec] = money(f.importe_total).split(',')
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
                  <div className="hrow-acc">
                    <button
                      type="button"
                      className="icon-btn sm"
                      onClick={() => imprimir(f)}
                      disabled={!f.pdf_path || anulando === f.id}
                      title="Imprimir"
                      aria-label="Imprimir"
                    >
                      <IconImprimir />
                    </button>
                    <button
                      type="button"
                      className="icon-btn sm"
                      onClick={() => compartir(f)}
                      disabled={!f.pdf_path || anulando === f.id}
                      title="Compartir"
                      aria-label="Compartir"
                    >
                      <IconCompartir />
                    </button>

                    {modoAnular && esFactura(f) && f.estado === 'emitida' && (
                      confirmando === f.id ? (
                        <span className="confirmar-anular">
                          ¿Anular?
                          <button type="button" className="peligro" onClick={() => anular(f)} disabled={anulando === f.id}>
                            {anulando === f.id ? '…' : 'Sí'}
                          </button>
                          <button type="button" className="secundario" onClick={() => setConfirmando(null)} disabled={anulando === f.id}>
                            No
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="peligro sm-btn"
                          onClick={() => setConfirmando(f.id)}
                          disabled={anulando != null}
                        >
                          N Crédito C
                        </button>
                      )
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {anulando && <p className="sub">Emitiendo la Nota de Crédito en ARCA (puede tardar)…</p>}
        {msg && <p className="ok">{msg}</p>}
        {error && <p className="error">{error}</p>}
        {errorShot && (
          <img className="shot" alt="captura del error" src={`data:image/png;base64,${errorShot}`} />
        )}
      </div>
    </div>
  )
}

import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { COND_IVA_CLIENTE, formatearCUIT, validarClienteForm, esCUITValido, limpiarCUIT } from '../lib/clientes'

// Formulario de alta/edición de un cliente. No toca la base: valida y devuelve
// los datos limpios por onGuardar. Lo usan la página Clientes y el alta al vuelo
// dentro de Facturar.
export default function ClienteForm({ inicial, onGuardar, onCancelar, guardando, errorExterno, ctaLabel }) {
  const [nombre, setNombre] = useState(inicial?.nombre || '')
  const [cuit, setCuit] = useState(inicial?.cuit ? formatearCUIT(inicial.cuit) : '')
  const [condIva, setCondIva] = useState(inicial?.cond_iva || 'Consumidor Final')
  const [domicilio, setDomicilio] = useState(inicial?.domicilio || '')
  const [error, setError] = useState(null)
  const [buscando, setBuscando] = useState(false)
  const [okMsg, setOkMsg] = useState(null)

  const esCF = condIva === 'Consumidor Final'
  const cuitValido = esCUITValido(cuit)

  // Trae razón social, domicilio y condición IVA desde el padrón de ARCA.
  async function buscarEnArca() {
    setError(null)
    setOkMsg(null)
    if (!cuitValido) return setError('Ingresá un CUIT válido para buscar en ARCA')
    setBuscando(true)
    try {
      const backend = import.meta.env.VITE_BACKEND_URL
      if (!backend) throw new Error('Falta VITE_BACKEND_URL')
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('No hay sesión activa')
      const r = await fetch(`${backend}/arca/padron-cliente`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ cuit: limpiarCUIT(cuit) }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'No se pudo buscar en ARCA')
      if (j.razonSocial) setNombre(j.razonSocial)
      if (j.condIva) setCondIva(j.condIva)
      if (j.domicilio) setDomicilio(j.domicilio)
      setOkMsg('Datos traídos de ARCA. Revisalos y guardá.')
    } catch (e) {
      setError(e.message ?? String(e))
    } finally {
      setBuscando(false)
    }
  }

  function submit(e) {
    e.preventDefault()
    setError(null)
    const r = validarClienteForm({ nombre, cuit, condIva, domicilio })
    if (!r.ok) return setError(r.error)
    onGuardar(r.datos)
  }

  return (
    <form className="cli-form" onSubmit={submit}>
      <label className="campo">
        <span>Nombre o razón social</span>
        <input
          type="text"
          value={nombre}
          onChange={(e) => setNombre(e.target.value.slice(0, 120))}
          placeholder="Ej: Distribuidora Cefiro SRL"
          maxLength={120}
          autoFocus
        />
      </label>

      <label className="campo">
        <span>Condición frente al IVA</span>
        <select value={condIva} onChange={(e) => setCondIva(e.target.value)}>
          {COND_IVA_CLIENTE.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </label>

      <div className="campo">
        <span>CUIT {esCF && <small className="campo-opt">(opcional)</small>}</span>
        <div className="cuit-buscar">
          <input
            type="text"
            inputMode="numeric"
            value={cuit}
            onChange={(e) => { setCuit(formatearCUIT(e.target.value)); setOkMsg(null) }}
            placeholder="XX-XXXXXXXX-X"
            maxLength={13}
          />
          <button
            type="button"
            className="cuit-buscar-btn"
            onClick={buscarEnArca}
            disabled={!cuitValido || buscando}
            title="Buscar los datos del cliente en ARCA"
          >
            {buscando ? <span className="spinner-inline" /> : 'Buscar en ARCA'}
          </button>
        </div>
        <small className="cuit-hint">Poné el CUIT y buscá: traemos nombre, domicilio y condición de IVA de ARCA.</small>
        {okMsg && <small className="cuit-ok">✓ {okMsg}</small>}
      </div>

      <label className="campo">
        <span>Domicilio <small className="campo-opt">(opcional)</small></span>
        <input
          type="text"
          value={domicilio}
          onChange={(e) => setDomicilio(e.target.value.slice(0, 120))}
          placeholder="Calle 123, Localidad"
          maxLength={120}
        />
      </label>

      {(error || errorExterno) && <p className="error" style={{ margin: '2px 0 0' }}>{error || errorExterno}</p>}

      <div className="fila-botones" style={{ marginTop: 12 }}>
        {onCancelar && (
          <button type="button" className="secundario" onClick={onCancelar} disabled={guardando}>
            Cancelar
          </button>
        )}
        <button type="submit" disabled={guardando}>
          {guardando ? 'Guardando…' : ctaLabel || 'Guardar cliente'}
        </button>
      </div>
    </form>
  )
}

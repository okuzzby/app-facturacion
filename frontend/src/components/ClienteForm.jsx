import { useState } from 'react'
import { COND_IVA_CLIENTE, formatearCUIT, validarClienteForm } from '../lib/clientes'

// Formulario de alta/edición de un cliente. No toca la base: valida y devuelve
// los datos limpios por onGuardar. Lo usan la página Clientes y el alta al vuelo
// dentro de Facturar.
export default function ClienteForm({ inicial, onGuardar, onCancelar, guardando, errorExterno, ctaLabel }) {
  const [nombre, setNombre] = useState(inicial?.nombre || '')
  const [cuit, setCuit] = useState(inicial?.cuit ? formatearCUIT(inicial.cuit) : '')
  const [condIva, setCondIva] = useState(inicial?.cond_iva || 'Consumidor Final')
  const [domicilio, setDomicilio] = useState(inicial?.domicilio || '')
  const [error, setError] = useState(null)

  const esCF = condIva === 'Consumidor Final'

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

      <label className="campo">
        <span>CUIT {esCF && <small className="campo-opt">(opcional)</small>}</span>
        <input
          type="text"
          inputMode="numeric"
          value={cuit}
          onChange={(e) => setCuit(formatearCUIT(e.target.value))}
          placeholder="XX-XXXXXXXX-X"
          maxLength={13}
        />
      </label>

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

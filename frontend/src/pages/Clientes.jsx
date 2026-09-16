import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import ClienteForm from '../components/ClienteForm'
import { condCorta, formatearCUIT, iniciales } from '../lib/clientes'

// Directorio de clientes guardados. Alta, edición y borrado. Sirven para
// facturar más rápido (elegir el cliente en vez de reescribir el CUIT).
export default function Clientes() {
  const { user } = useAuth()
  const [clientes, setClientes] = useState([])
  const [cargando, setCargando] = useState(true)
  const [q, setQ] = useState('')
  const [error, setError] = useState(null)

  // Panel de alta/edición: null = cerrado, 'nuevo' = alta, objeto = edición.
  const [editando, setEditando] = useState(null)
  const [guardando, setGuardando] = useState(false)
  const [formError, setFormError] = useState(null)

  async function cargar() {
    if (!supabase) return
    const { data, error } = await supabase
      .from('clientes')
      .select('*')
      .order('nombre', { ascending: true })
    if (error) setError(error.message)
    else setClientes(data || [])
    setCargando(false)
  }

  useEffect(() => {
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filtrados = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return clientes
    const soloNum = t.replace(/\D/g, '')
    return clientes.filter((c) => {
      const nom = (c.nombre || '').toLowerCase()
      const cu = (c.cuit || '')
      return nom.includes(t) || (soloNum && cu.includes(soloNum))
    })
  }, [clientes, q])

  async function guardar(datos) {
    setGuardando(true)
    setFormError(null)
    try {
      if (editando && editando !== 'nuevo') {
        const { error } = await supabase
          .from('clientes')
          .update({ ...datos, updated_at: new Date().toISOString() })
          .eq('id', editando.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('clientes').insert({ ...datos, user_id: user.id })
        if (error) throw error
      }
      setEditando(null)
      await cargar()
    } catch (e) {
      setFormError(e.message || String(e))
    } finally {
      setGuardando(false)
    }
  }

  async function borrar(id) {
    setGuardando(true)
    setFormError(null)
    try {
      const { error } = await supabase.from('clientes').delete().eq('id', id)
      if (error) throw error
      setEditando(null)
      await cargar()
    } catch (e) {
      setFormError(e.message || String(e))
    } finally {
      setGuardando(false)
    }
  }

  if (cargando) {
    return (
      <div className="page">
        <div className="card"><p className="sub">Cargando…</p></div>
      </div>
    )
  }

  // Panel de alta/edición (pantalla propia, más cómodo en celular).
  if (editando) {
    const esEdicion = editando !== 'nuevo'
    return (
      <div className="page">
        <div className="page-head page-head-back">
          <button type="button" className="icon-btn" onClick={() => setEditando(null)} aria-label="Volver">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <div>
            <h1>{esEdicion ? 'Editar cliente' : 'Nuevo cliente'}</h1>
            <div className="sub">{esEdicion ? 'Actualizá los datos del cliente' : 'Queda guardado para facturar más rápido'}</div>
          </div>
        </div>
        <div className="card">
          <ClienteForm
            inicial={esEdicion ? editando : null}
            onGuardar={guardar}
            onCancelar={() => setEditando(null)}
            guardando={guardando}
            errorExterno={formError}
            ctaLabel={esEdicion ? 'Guardar cambios' : 'Guardar cliente'}
          />
          {esEdicion && (
            <button
              type="button"
              className="cli-borrar"
              onClick={() => borrar(editando.id)}
              disabled={guardando}
            >
              Eliminar cliente
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Clientes</h1>
          <div className="sub">Guardados para facturar más rápido</div>
        </div>
      </div>

      <div className="card">
        <button type="button" className="cli-nuevo" onClick={() => { setFormError(null); setEditando('nuevo') }}>
          <span className="cli-nuevo-plus">＋</span> Nuevo cliente
        </button>

        {clientes.length > 0 && (
          <div className="cli-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3-3" /></svg>
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por nombre o CUIT…"
            />
          </div>
        )}

        {error && <p className="error">{error}</p>}

        {clientes.length === 0 ? (
          <div className="cli-vacio">
            <p>Todavía no tenés clientes guardados.</p>
            <p className="sub">Cargá uno y lo vas a poder elegir al facturar, sin reescribir el CUIT.</p>
          </div>
        ) : filtrados.length === 0 ? (
          <p className="sub" style={{ marginTop: 14 }}>No hay clientes que coincidan con “{q}”.</p>
        ) : (
          <div className="cli-lista">
            {filtrados.map((c) => (
              <button type="button" key={c.id} className="cli-row" onClick={() => { setFormError(null); setEditando(c) }}>
                <span className="cli-av">{iniciales(c.nombre)}</span>
                <span className="cli-info">
                  <span className="cli-nm">{c.nombre}</span>
                  <span className="cli-cu">
                    {c.cuit ? formatearCUIT(c.cuit) : 'Sin CUIT'} · {condCorta(c.cond_iva)}
                  </span>
                </span>
                <span className="cli-go">›</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

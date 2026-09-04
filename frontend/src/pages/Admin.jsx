import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'

const DURACIONES = [
  { v: 0, l: 'Sin vencimiento' },
  { v: 1, l: '1 mes' },
  { v: 3, l: '3 meses' },
  { v: 6, l: '6 meses' },
  { v: 12, l: '12 meses' },
]

function fechaCorta(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  } catch {
    return '—'
  }
}

async function token() {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  return session?.access_token
}

export default function Admin() {
  const { esAdmin } = useAuth()
  const [usuarios, setUsuarios] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [prohibido, setProhibido] = useState(false)
  // Borrador por usuario: { [id]: { plan, meses } }
  const [draft, setDraft] = useState({})
  const [guardandoId, setGuardandoId] = useState(null)
  const [okId, setOkId] = useState(null)

  async function cargar() {
    setError(null)
    setCargando(true)
    try {
      const backend = import.meta.env.VITE_BACKEND_URL
      if (!backend) throw new Error('Falta VITE_BACKEND_URL')
      const t = await token()
      if (!t) throw new Error('No hay sesión activa')
      const r = await fetch(`${backend}/admin/usuarios`, {
        headers: { Authorization: `Bearer ${t}` },
      })
      if (r.status === 403) {
        setProhibido(true)
        return
      }
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Error del backend')
      setUsuarios(j.usuarios || [])
    } catch (e) {
      setError(e.message ?? String(e))
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => {
    cargar()
  }, [])

  function setDraftPlan(id, plan) {
    setDraft((d) => ({ ...d, [id]: { ...(d[id] || {}), plan } }))
  }
  function setDraftMeses(id, meses) {
    setDraft((d) => ({ ...d, [id]: { ...(d[id] || {}), meses: Number(meses) } }))
  }

  async function guardar(u) {
    const d = draft[u.id] || {}
    const plan = d.plan || u.plan || 'gratis'
    const meses = d.meses ?? 0
    setGuardandoId(u.id)
    setOkId(null)
    setError(null)
    try {
      const backend = import.meta.env.VITE_BACKEND_URL
      const t = await token()
      const r = await fetch(`${backend}/admin/plan`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: u.id, plan, meses }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'No se pudo guardar')
      setOkId(u.id)
      await cargar()
    } catch (e) {
      setError(e.message ?? String(e))
    } finally {
      setGuardandoId(null)
    }
  }

  if (prohibido || esAdmin === false) {
    return (
      <div className="page">
        <div className="page-head"><div><h1>Admin</h1></div></div>
        <section className="seccion">
          <p className="error">No tenés permisos para ver esta sección.</p>
        </section>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Admin</h1><div className="sub">Asigná planes a los usuarios</div></div>
      </div>

      <section className="seccion">
        {cargando ? (
          <p className="sub">Cargando usuarios…</p>
        ) : (
          <div className="admin-tabla">
            {usuarios.map((u) => {
              const d = draft[u.id] || {}
              const plan = d.plan || u.plan || 'gratis'
              const meses = d.meses ?? 0
              return (
                <div className="admin-row" key={u.id}>
                  <div className="admin-user">
                    <span className="admin-email">{u.email}</span>
                    <span className="admin-meta">
                      Plan actual:{' '}
                      <strong className={u.proVigente ? 'plan-pro' : 'plan-gratis'}>
                        {u.proVigente ? 'Pro' : 'Gratis'}
                      </strong>
                      {u.plan === 'pro' && <> · vence {fechaCorta(u.vence)}</>}
                    </span>
                  </div>
                  <div className="admin-controles">
                    <select value={plan} onChange={(e) => setDraftPlan(u.id, e.target.value)}>
                      <option value="gratis">Gratis</option>
                      <option value="pro">Pro</option>
                    </select>
                    <select
                      value={meses}
                      onChange={(e) => setDraftMeses(u.id, e.target.value)}
                      disabled={plan !== 'pro'}
                    >
                      {DURACIONES.map((x) => (
                        <option key={x.v} value={x.v}>{x.l}</option>
                      ))}
                    </select>
                    <button type="button" onClick={() => guardar(u)} disabled={guardandoId === u.id}>
                      {guardandoId === u.id ? 'Guardando…' : 'Guardar'}
                    </button>
                    {okId === u.id && <span className="ok admin-ok">✓</span>}
                  </div>
                </div>
              )
            })}
            {usuarios.length === 0 && <p className="sub">No hay usuarios todavía.</p>}
          </div>
        )}
        {error && <p className="error">{error}</p>}
      </section>
    </div>
  )
}

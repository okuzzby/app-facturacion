import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'

export default function Configuracion() {
  const { user } = useAuth()

  // ---- credencial ARCA ----
  const [credencial, setCredencial] = useState(null) // {cuit, updated_at} o null
  const [editandoCred, setEditandoCred] = useState(false)
  const [cuit, setCuit] = useState('')
  const [clave, setClave] = useState('')
  const [credMsg, setCredMsg] = useState(null)
  const [credError, setCredError] = useState(null)
  const [guardandoCred, setGuardandoCred] = useState(false)

  // ---- verificación de conexión con el backend ----
  const [verifMsg, setVerifMsg] = useState(null)
  const [verifError, setVerifError] = useState(null)
  const [verificando, setVerificando] = useState(false)

  // ---- prueba de login ARCA (3C, desarrollo) ----
  const [arcaCargando, setArcaCargando] = useState(false)
  const [arcaMsg, setArcaMsg] = useState(null)
  const [arcaError, setArcaError] = useState(null)
  const [arcaShot, setArcaShot] = useState(null)
  const [arcaPasos, setArcaPasos] = useState([])

  // ---- productos ----
  const [productos, setProductos] = useState([])
  const [nuevoProducto, setNuevoProducto] = useState('')
  const [prodError, setProdError] = useState(null)

  async function cargarCredencial() {
    const { data } = await supabase
      .from('credenciales_arca')
      .select('cuit, updated_at')
      .maybeSingle()
    setCredencial(data ?? null)
    setEditandoCred(!data)
  }

  async function cargarProductos() {
    const { data } = await supabase
      .from('productos_configurados')
      .select('id, nombre')
      .order('created_at', { ascending: true })
    setProductos((data ?? []).map((p) => ({ ...p, borrador: p.nombre })))
  }

  useEffect(() => {
    if (!supabase) return
    cargarCredencial()
    cargarProductos()
  }, [])

  async function guardarCredencial(e) {
    e.preventDefault()
    setCredError(null)
    setCredMsg(null)
    setGuardandoCred(true)
    try {
      const { error } = await supabase.rpc('set_credencial_arca', {
        p_cuit: cuit.trim(),
        p_clave: clave,
      })
      if (error) throw error
      setClave('')
      setCredMsg('Credencial guardada de forma segura.')
      setEditandoCred(false)
      await cargarCredencial()
    } catch (err) {
      setCredError(err.message ?? 'No se pudo guardar')
    } finally {
      setGuardandoCred(false)
    }
  }

  async function borrarCredencial() {
    setCredError(null)
    setCredMsg(null)
    const { error } = await supabase.rpc('borrar_credencial_arca')
    if (error) {
      setCredError(error.message)
      return
    }
    setCuit('')
    setClave('')
    setCredencial(null)
    setEditandoCred(true)
  }

  async function verificarConexion() {
    setVerifMsg(null)
    setVerifError(null)
    setVerificando(true)
    try {
      const backend = import.meta.env.VITE_BACKEND_URL
      if (!backend) throw new Error('Falta VITE_BACKEND_URL en el frontend')
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('No hay sesión activa')

      const r = await fetch(`${backend}/verificar-credencial`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Error del backend')

      if (j.tiene_credencial) {
        setVerifMsg(
          `Conexión OK ✓ El backend te identificó y leyó tu credencial (CUIT ${j.cuit}).`
        )
      } else {
        setVerifMsg('Conexión OK ✓ pero todavía no cargaste una credencial ARCA.')
      }
    } catch (e) {
      setVerifError(e.message ?? String(e))
    } finally {
      setVerificando(false)
    }
  }

  async function probarArca() {
    setArcaMsg(null)
    setArcaError(null)
    setArcaShot(null)
    setArcaPasos([])
    setArcaCargando(true)
    try {
      const backend = import.meta.env.VITE_BACKEND_URL
      if (!backend) throw new Error('Falta VITE_BACKEND_URL en el frontend')
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('No hay sesión activa')

      const r = await fetch(`${backend}/arca/login-test`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Error del backend')

      setArcaPasos(j.pasos || [])
      setArcaShot(j.screenshot || null)
      setArcaMsg(
        `${j.ok ? 'Terminó ✓' : 'Terminó con aviso'} — URL: ${j.url || '-'} · Título: ${
          j.title || '-'
        }`
      )
      if (!j.ok && j.error) setArcaError(j.error)
    } catch (e) {
      setArcaError(e.message ?? String(e))
    } finally {
      setArcaCargando(false)
    }
  }

  async function agregarProducto(e) {
    e.preventDefault()
    setProdError(null)
    const nombre = nuevoProducto.trim()
    if (!nombre) return
    const { error } = await supabase
      .from('productos_configurados')
      .insert({ user_id: user.id, nombre })
    if (error) {
      setProdError(error.message)
      return
    }
    setNuevoProducto('')
    cargarProductos()
  }

  async function guardarProducto(id, nombre) {
    setProdError(null)
    const limpio = nombre.trim()
    if (!limpio) return
    const { error } = await supabase
      .from('productos_configurados')
      .update({ nombre: limpio })
      .eq('id', id)
    if (error) setProdError(error.message)
    else cargarProductos()
  }

  async function borrarProducto(id) {
    setProdError(null)
    const { error } = await supabase
      .from('productos_configurados')
      .delete()
      .eq('id', id)
    if (error) setProdError(error.message)
    else cargarProductos()
  }

  function cambiarBorrador(id, valor) {
    setProductos((prev) =>
      prev.map((p) => (p.id === id ? { ...p, borrador: valor } : p))
    )
  }

  return (
    <div className="card card-wide">
      <div className="topbar">
        <Link to="/" className="volver">← Volver</Link>
        <h1>Configuración</h1>
      </div>

      {/* ---------------- Credencial ARCA ---------------- */}
      <section className="seccion">
        <h2>Conexión con ARCA</h2>

        {credencial && !editandoCred ? (
          <div className="cred-cargada">
            <p className="ok">Credencial cargada ✓</p>
            <p>CUIT: <strong>{credencial.cuit}</strong></p>
            <p className="sub">
              Actualizada: {new Date(credencial.updated_at).toLocaleString('es-AR')}
            </p>
            <div className="fila-botones">
              <button type="button" onClick={() => setEditandoCred(true)}>
                Actualizar
              </button>
              <button type="button" className="peligro" onClick={borrarCredencial}>
                Borrar
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={guardarCredencial} className="form">
            <input
              type="text"
              placeholder="CUIT (ej: 20-12345678-9)"
              value={cuit}
              onChange={(e) => setCuit(e.target.value)}
              required
            />
            <input
              type="password"
              placeholder="Clave Fiscal (Nivel 3)"
              value={clave}
              onChange={(e) => setClave(e.target.value)}
              required
              autoComplete="new-password"
            />
            <p className="sub">
              La Clave Fiscal se guarda cifrada. No se vuelve a mostrar.
            </p>
            <div className="fila-botones">
              <button type="submit" disabled={guardandoCred}>
                {guardandoCred ? 'Guardando…' : 'Guardar credencial'}
              </button>
              {credencial && (
                <button
                  type="button"
                  className="secundario"
                  onClick={() => {
                    setEditandoCred(false)
                    setClave('')
                    setCredError(null)
                  }}
                >
                  Cancelar
                </button>
              )}
            </div>
          </form>
        )}
        {credMsg && <p className="ok">{credMsg}</p>}
        {credError && <p className="error">{credError}</p>}

        <div className="verif">
          <button type="button" className="secundario" onClick={verificarConexion} disabled={verificando}>
            {verificando ? 'Verificando…' : 'Verificar conexión con el backend'}
          </button>
          {verifMsg && <p className="ok">{verifMsg}</p>}
          {verifError && <p className="error">{verifError}</p>}
        </div>
      </section>

      {/* ---------------- Productos ---------------- */}
      <section className="seccion">
        <h2>Productos / Servicios</h2>
        <p className="sub">
          Estas son las opciones que vas a poder elegir al facturar.
        </p>

        <ul className="lista-productos">
          {productos.map((p) => (
            <li key={p.id}>
              <input
                type="text"
                value={p.borrador}
                onChange={(e) => cambiarBorrador(p.id, e.target.value)}
              />
              <button
                type="button"
                onClick={() => guardarProducto(p.id, p.borrador)}
                disabled={p.borrador.trim() === p.nombre}
              >
                Guardar
              </button>
              <button
                type="button"
                className="peligro"
                onClick={() => borrarProducto(p.id)}
              >
                Borrar
              </button>
            </li>
          ))}
        </ul>

        <form onSubmit={agregarProducto} className="agregar">
          <input
            type="text"
            placeholder="Nuevo producto / servicio"
            value={nuevoProducto}
            onChange={(e) => setNuevoProducto(e.target.value)}
          />
          <button type="submit">Agregar</button>
        </form>
        {prodError && <p className="error">{prodError}</p>}
      </section>

      {/* ---------------- Prueba login ARCA (3C, desarrollo) ---------------- */}
      <section className="seccion">
        <h2>Prueba de conexión ARCA (desarrollo)</h2>
        <p className="sub">
          Hace login en ARCA con tu credencial y devuelve una captura de dónde
          llegó. No emite ni toca ningún comprobante.
        </p>
        <button type="button" onClick={probarArca} disabled={arcaCargando}>
          {arcaCargando ? 'Probando (puede tardar)…' : 'Probar login ARCA'}
        </button>
        {arcaMsg && <p className="ok">{arcaMsg}</p>}
        {arcaError && <p className="error">{arcaError}</p>}
        {arcaPasos.length > 0 && (
          <ol className="pasos">
            {arcaPasos.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ol>
        )}
        {arcaShot && (
          <img
            className="shot"
            alt="captura ARCA"
            src={`data:image/png;base64,${arcaShot}`}
          />
        )}
      </section>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'

// Estados intermedios del onboarding automático de facturación electrónica.
const SETUP_EN_PROGRESO = [
  'iniciando',
  'creando_cert',
  'autorizando',
  'guardando',
  'detectando_pv',
  'creando_pv',
  'capturando_datos',
]

export default function Configuracion() {
  const { user, refrescarPerfil, refrescarPlan, signOut, esPro } = useAuth()

  // ---- plan / suscripción Pro ----
  const [proEstado, setProEstado] = useState(null)
  const [proMsg, setProMsg] = useState(null)
  const [proError, setProError] = useState(null)
  const [proAccion, setProAccion] = useState(false)

  // ---- eliminar cuenta ----
  const [delAbierto, setDelAbierto] = useState(false) // panel desplegado
  const [delTexto, setDelTexto] = useState('') // debe escribir "ELIMINAR"
  const [delModal, setDelModal] = useState(false) // 2da confirmación (modal)
  const [delPass, setDelPass] = useState('')
  const [delCargando, setDelCargando] = useState(false)
  const [delError, setDelError] = useState(null)
  // ¿Tiene contraseña (registro con email) o entró solo con Google?
  const tienePassword =
    !!(user?.identities || []).some((i) => i.provider === 'email') ||
    user?.app_metadata?.provider === 'email'

  // ---- perfil (nombre para el saludo) ----

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
  const [arcaCampos, setArcaCampos] = useState(null)
  const [debugUrl, setDebugUrl] = useState(null)

  // ---- empresa a representar (ARCA) ----
  const [empresas, setEmpresas] = useState([])
  const [empresaSel, setEmpresaSel] = useState('')
  const [detectando, setDetectando] = useState(false)
  const [empresaMsg, setEmpresaMsg] = useState(null)
  const [empresaError, setEmpresaError] = useState(null)

  // ---- punto de venta y tipo de comprobante ----
  const [pvOpciones, setPvOpciones] = useState([])
  const [tipoOpciones, setTipoOpciones] = useState([])
  const [pvSel, setPvSel] = useState('')
  const [tipoSel, setTipoSel] = useState('')
  const [detectandoOpc, setDetectandoOpc] = useState(false)
  const [opcMsg, setOpcMsg] = useState(null)
  const [opcError, setOpcError] = useState(null)

  // ---- productos ----
  const [productos, setProductos] = useState([])
  const [nuevoProducto, setNuevoProducto] = useState('')
  const [prodError, setProdError] = useState(null)

  async function cargarCredencial() {
    const { data } = await supabase
      .from('credenciales_arca')
      .select(
        'cuit, updated_at, empresa_representada, punto_venta, tipo_comprobante, punto_venta_ws, ws_cert_alias, ws_setup_estado, ws_setup_paso, ws_setup_error, ws_setup_updated, activa'
      )
      .maybeSingle()
    setCredencial(data ?? null)
    const desconectada = !data || data.activa === false
    setEditandoCred(desconectada)
    // Al reconectar con la misma cuenta, precargamos el CUIT para que el usuario
    // solo tenga que ingresar la Clave Fiscal.
    if (data?.activa === false && data?.cuit) setCuit(data.cuit)
  }

  // Dispara el onboarding automático (cert + autorizar + punto de venta) en el
  // backend, que corre en segundo plano. force=true reintenta uno que falló.
  async function iniciarSetupWsfe(force = false) {
    try {
      const backend = import.meta.env.VITE_BACKEND_URL
      if (!backend) return
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) return
      await fetch(`${backend}/arca/setup-wsfe-async${force ? '?force=1' : ''}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
    } catch {
      // silencioso: el estado se refleja igual leyendo la fila
    } finally {
      await cargarCredencial()
    }
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


  // Mientras el onboarding automático está en curso, refrescamos la fila cada
  // 3s para mostrar el avance en vivo. Se corta solo al llegar a un estado final.
  useEffect(() => {
    if (!credencial) return
    if (SETUP_EN_PROGRESO.includes(credencial.ws_setup_estado)) {
      const t = setTimeout(() => {
        cargarCredencial()
      }, 3000)
      return () => clearTimeout(t)
    }
    // Estado final: si quedó listo, refrescamos el saludo (el nombre vino del
    // padrón durante la conexión).
    if (credencial.ws_setup_estado === 'listo') refrescarPerfil()
  }, [credencial])

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
      setCredMsg('Credencial guardada. Configurando para dejarla lista…')
      setEditandoCred(false)
      await cargarCredencial()
      // Arranca todo el proceso automático (cert + autorizar + punto de venta).
      await iniciarSetupWsfe(false)
      // Releemos para reflejar el estado "en progreso" y que arranque el polling
      // (si no, quedaba mostrando el estado viejo, a veces el ✓ verde).
      await cargarCredencial()
    } catch (err) {
      setCredError(err.message ?? 'No se pudo guardar')
    } finally {
      setGuardandoCred(false)
    }
  }

  async function desconectar() {
    setCredError(null)
    setCredMsg(null)
    // Desconexión "blanda": borra la Clave Fiscal guardada pero conserva el
    // certificado y la configuración. Al reconectar con la misma cuenta no se
    // vuelven a crear certificados.
    if (!window.confirm('¿Desconectar ARCA? Se borrará tu Clave Fiscal guardada. El certificado se conserva, así que reconectar con la misma cuenta será inmediato.')) return
    const { error } = await supabase.rpc('desconectar_arca')
    if (error) {
      setCredError(error.message)
      return
    }
    setClave('')
    setEditandoCred(true)
    await cargarCredencial()
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

  async function probarFormularioFactura() {
    setArcaMsg(null)
    setArcaError(null)
    setArcaShot(null)
    setArcaPasos([])
    setArcaCampos(null)
    setArcaCargando(true)
    try {
      const backend = import.meta.env.VITE_BACKEND_URL
      if (!backend) throw new Error('Falta VITE_BACKEND_URL en el frontend')
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('No hay sesión activa')

      const datosPrueba = {
        concepto: 'Productos',
        condicionIva: 'Consumidor Final',
        condicionesVenta: ['Contado'],
        producto: 'PRUEBA - Servicio de Taxi',
        precio: '100',
      }
      const r = await fetch(`${backend}/arca/factura-generar`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ datos: datosPrueba, confirmar: false }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Error del backend')
      setArcaPasos(j.pasos || [])
      setArcaShot(j.screenshot || null)
      setArcaCampos(j.campos || null)
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

  async function inspeccionarNC() {
    setArcaMsg(null)
    setArcaError(null)
    setArcaShot(null)
    setArcaPasos([])
    setArcaCampos(null)
    setArcaCargando(true)
    try {
      const backend = import.meta.env.VITE_BACKEND_URL
      if (!backend) throw new Error('Falta VITE_BACKEND_URL en el frontend')
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('No hay sesión activa')

      const r = await fetch(`${backend}/arca/inspeccionar-nc`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Error del backend')
      setArcaPasos(j.pasos || [])
      setArcaShot(j.screenshot || null)
      setArcaCampos(j.campos || null)
      setArcaMsg(`${j.ok ? 'OK' : 'Aviso'} — ${j.url || '-'}`)
      if (!j.ok && j.error) setArcaError(j.error)
    } catch (e) {
      setArcaError(e.message ?? String(e))
    } finally {
      setArcaCargando(false)
    }
  }

  async function inspeccionarWSASS() {
    setArcaMsg(null)
    setArcaError(null)
    setArcaShot(null)
    setArcaPasos([])
    setArcaCampos(null)
    setArcaCargando(true)
    try {
      const backend = import.meta.env.VITE_BACKEND_URL
      if (!backend) throw new Error('Falta VITE_BACKEND_URL en el frontend')
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('No hay sesión activa')

      const r = await fetch(`${backend}/arca/setup-inspeccionar`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Error del backend')
      setArcaPasos(j.pasos || [])
      setArcaShot(j.screenshot || null)
      setArcaCampos({ aliasExistentes: j.aliasExistentes, nav: j.nav, campos: j.campos })
      setArcaMsg(`${j.ok ? 'OK' : 'Aviso'} — ${j.url || '-'}`)
      if (!j.ok && j.error) setArcaError(j.error)
    } catch (e) {
      setArcaError(e.message ?? String(e))
    } finally {
      setArcaCargando(false)
    }
  }

  async function inspeccionarRel() {
    setArcaMsg(null)
    setArcaError(null)
    setArcaShot(null)
    setArcaPasos([])
    setArcaCampos(null)
    setArcaCargando(true)
    try {
      const backend = import.meta.env.VITE_BACKEND_URL
      if (!backend) throw new Error('Falta VITE_BACKEND_URL en el frontend')
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('No hay sesión activa')
      const r = await fetch(`${backend}/arca/setup-relaciones`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Error del backend')
      setArcaPasos(j.pasos || [])
      setArcaShot(j.screenshot || null)
      setArcaCampos({ diag: j.diag, nav: j.nav, campos: j.campos })
      setArcaMsg(`${j.ok ? 'OK' : 'Aviso'} — ${j.url || '-'}`)
      if (!j.ok && j.error) setArcaError(j.error)
    } catch (e) {
      setArcaError(e.message ?? String(e))
    } finally {
      setArcaCargando(false)
    }
  }

  async function crearCertAuto() {
    setArcaMsg(null)
    setArcaError(null)
    setArcaShot(null)
    setArcaPasos([])
    setArcaCampos(null)
    setArcaCargando(true)
    try {
      const backend = import.meta.env.VITE_BACKEND_URL
      if (!backend) throw new Error('Falta VITE_BACKEND_URL en el frontend')
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('No hay sesión activa')

      const r = await fetch(`${backend}/arca/setup-crear-cert`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Error del backend')
      setArcaPasos(j.pasos || [])
      setArcaShot(j.screenshot || null)
      setArcaCampos({ ok: j.ok, alias: j.alias, via: j.via, certPem: j.certPem, diag: j.diag })
      setArcaMsg(`${j.ok ? 'Certificado creado ✓' : 'Aviso'} — ${j.url || '-'}`)
      if (!j.ok && j.error) setArcaError(j.error)
    } catch (e) {
      setArcaError(e.message ?? String(e))
    } finally {
      setArcaCargando(false)
    }
  }

  async function configurarWsfe() {
    setArcaMsg(null)
    setArcaError(null)
    setArcaShot(null)
    setArcaPasos([])
    setArcaCampos(null)
    setArcaCargando(true)
    try {
      const backend = import.meta.env.VITE_BACKEND_URL
      if (!backend) throw new Error('Falta VITE_BACKEND_URL en el frontend')
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('No hay sesión activa')

      const r = await fetch(`${backend}/arca/setup-wsfe`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Error del backend')
      setArcaPasos(j.pasos || [])
      setArcaShot(j.screenshot || null)
      setArcaCampos({
        ok: j.ok,
        alias: j.alias,
        autorizado: j.autorizado,
        guardado: j.guardado,
        etapa: j.etapa,
        puntoVentaWsSeteado: j.puntoVentaWsSeteado,
        faltaPuntoVentaWS: j.faltaPuntoVentaWS,
        puntosVentaWS: j.puntosVentaWS,
        diag: j.diag,
      })
      const estado = j.autorizado
        ? 'wsfe autorizado ✓'
        : j.ok
        ? 'Cert creado (autorización a revisar)'
        : 'Aviso'
      const pv = j.puntoVentaWsSeteado
        ? ` · PV WS ${j.puntoVentaWsSeteado} ✓`
        : j.faltaPuntoVentaWS
        ? ' · falta punto de venta WS'
        : ''
      setArcaMsg(`${estado}${j.guardado ? ' · guardado ✓' : ''}${pv} — ${j.url || '-'}`)
      if (j.error) setArcaError(j.error)
    } catch (e) {
      setArcaError(e.message ?? String(e))
    } finally {
      setArcaCargando(false)
    }
  }

  async function verPuntosVentaWs() {
    setArcaMsg(null)
    setArcaError(null)
    setArcaShot(null)
    setArcaPasos([])
    setArcaCampos(null)
    setArcaCargando(true)
    try {
      const backend = import.meta.env.VITE_BACKEND_URL
      if (!backend) throw new Error('Falta VITE_BACKEND_URL en el frontend')
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('No hay sesión activa')

      const r = await fetch(`${backend}/arca/ws/puntos-venta`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Error del backend')
      setArcaCampos(j)
      const n = (j.puntos || []).length
      setArcaMsg(
        n > 0
          ? `${n} punto(s) de venta WS habilitado(s). Actual configurado: ${j.punto_venta_ws_actual || '-'}`
          : 'No tenés ningún punto de venta habilitado para Web Service.'
      )
    } catch (e) {
      setArcaError(e.message ?? String(e))
    } finally {
      setArcaCargando(false)
    }
  }

  async function inspeccionarPtosVenta() {
    setArcaMsg(null)
    setArcaError(null)
    setArcaShot(null)
    setArcaPasos([])
    setArcaCampos(null)
    setArcaCargando(true)
    try {
      const backend = import.meta.env.VITE_BACKEND_URL
      if (!backend) throw new Error('Falta VITE_BACKEND_URL en el frontend')
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('No hay sesión activa')

      const r = await fetch(`${backend}/arca/setup-puntos-venta-inspect`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Error del backend')
      setArcaPasos(j.pasos || [])
      setArcaShot(j.screenshot || null)
      // etapas sin los screenshots (base64) para que el dump sea legible
      const etapas = (j.etapas || []).map(({ screenshot, ...e }) => e)
      setArcaCampos({ ok: j.ok, url: j.url, etapas })
      setArcaMsg(`${j.ok ? 'OK' : 'Aviso'} — ${(j.etapas || []).length} etapa(s) — ${j.url || '-'}`)
      if (!j.ok && j.error) setArcaError(j.error)
    } catch (e) {
      setArcaError(e.message ?? String(e))
    } finally {
      setArcaCargando(false)
    }
  }

  async function crearPvDryRun() {
    setArcaMsg(null)
    setArcaError(null)
    setArcaShot(null)
    setArcaPasos([])
    setArcaCampos(null)
    setArcaCargando(true)
    try {
      const backend = import.meta.env.VITE_BACKEND_URL
      if (!backend) throw new Error('Falta VITE_BACKEND_URL en el frontend')
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('No hay sesión activa')

      const r = await fetch(`${backend}/arca/setup-crear-pv`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Error del backend')
      setArcaPasos(j.pasos || [])
      setArcaShot(j.screenshot || null)
      setArcaCampos({
        ok: j.ok,
        dryRun: j.dryRun,
        numeroPropuesto: j.numeroPropuesto,
        diag: j.diag,
      })
      setArcaMsg(`${j.ok ? 'Dry-run OK' : 'Aviso'} — nº propuesto: ${j.numeroPropuesto ?? '-'}`)
      if (!j.ok && j.error) setArcaError(j.error)
    } catch (e) {
      setArcaError(e.message ?? String(e))
    } finally {
      setArcaCargando(false)
    }
  }

  async function crearPvReal() {
    const ok = window.confirm(
      'Esto CREA un punto de venta de Web Service REAL en ARCA (no se puede deshacer con un clic). ¿Continuar?'
    )
    if (!ok) return
    setArcaMsg(null)
    setArcaError(null)
    setArcaShot(null)
    setArcaPasos([])
    setArcaCampos(null)
    setArcaCargando(true)
    try {
      const backend = import.meta.env.VITE_BACKEND_URL
      if (!backend) throw new Error('Falta VITE_BACKEND_URL en el frontend')
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('No hay sesión activa')

      const r = await fetch(`${backend}/arca/setup-crear-pv?real=1`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Error del backend')
      setArcaPasos(j.pasos || [])
      setArcaShot(j.screenshot || null)
      setArcaCampos({ ok: j.ok, creado: j.creado, numero: j.numero, diag: j.diag })
      setArcaMsg(
        j.creado
          ? `Punto de venta ${j.numero} creado ✓`
          : `No confirmado (nº ${j.numero ?? '-'}) — revisá la captura`
      )
      if (!j.ok && j.error) setArcaError(j.error)
    } catch (e) {
      setArcaError(e.message ?? String(e))
    } finally {
      setArcaCargando(false)
    }
  }

  async function emitirWsPrueba() {
    // Emite una Factura C REAL en producción con el cert propio. Confirmamos
    // primero porque genera un comprobante fiscal verdadero (se anula con NC).
    const ok = window.confirm(
      'Esto emite una Factura C REAL en producción ($100, Consumidor Final) usando tu certificado. ¿Continuar?'
    )
    if (!ok) return
    setArcaMsg(null)
    setArcaError(null)
    setArcaShot(null)
    setArcaPasos([])
    setArcaCampos(null)
    setArcaCargando(true)
    try {
      const backend = import.meta.env.VITE_BACKEND_URL
      if (!backend) throw new Error('Falta VITE_BACKEND_URL en el frontend')
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('No hay sesión activa')

      const r = await fetch(`${backend}/arca/ws/factura-generar`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          producto: 'Prueba WS (desarrollo)',
          precio: 100,
          cantidad: 1,
          concepto: 'Productos',
          condicionIva: 'Consumidor Final',
          condicionesVenta: ['Contado'],
        }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Error del backend')
      setArcaCampos(j)
      if (j.ok) {
        setArcaMsg(
          `Factura ${j.numero} emitida ✓ — CAE ${j.cae} (vto ${j.caeVto})${
            j.guardado ? ' · guardada' : ''
          }`
        )
      } else {
        setArcaMsg(`Rechazada (${j.resultado || '-'})`)
        setArcaError(JSON.stringify(j.observaciones || j.error || j))
      }
    } catch (e) {
      setArcaError(e.message ?? String(e))
    } finally {
      setArcaCargando(false)
    }
  }

  async function probarPadron() {
    setArcaMsg(null); setArcaError(null); setArcaShot(null); setArcaPasos([]); setArcaCampos(null)
    setArcaCargando(true)
    try {
      const backend = import.meta.env.VITE_BACKEND_URL
      if (!backend) throw new Error('Falta VITE_BACKEND_URL en el frontend')
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('No hay sesión activa')
      const r = await fetch(`${backend}/arca/padron-test`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Error del backend')
      setArcaCampos(j)
      setArcaMsg('Padrón consultado ✓')
    } catch (e) {
      setArcaError(e.message ?? String(e))
    } finally {
      setArcaCargando(false)
    }
  }

  async function autorizarPadron() {
    setArcaMsg(null); setArcaError(null); setArcaShot(null); setArcaPasos([]); setArcaCampos(null)
    setArcaCargando(true)
    try {
      const backend = import.meta.env.VITE_BACKEND_URL
      if (!backend) throw new Error('Falta VITE_BACKEND_URL en el frontend')
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('No hay sesión activa')
      const r = await fetch(`${backend}/arca/sincronizar-padron`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Error del backend')
      setArcaCampos(j)
      setArcaMsg(
        j.razonSocial
          ? `Datos guardados ✓ — ${j.razonSocial}` +
              (j.regeneradas ? ` · Facturas regeneradas: ${j.regeneradas.regeneradas}/${j.regeneradas.total}` : '')
          : 'No se pudieron traer los datos (revisá el detalle)'
      )
    } catch (e) {
      setArcaError(e.message ?? String(e))
    } finally {
      setArcaCargando(false)
    }
  }

  async function regenerarMisFacturas() {
    setArcaMsg(null); setArcaError(null); setArcaShot(null); setArcaPasos([]); setArcaCampos(null)
    setArcaCargando(true)
    try {
      const backend = import.meta.env.VITE_BACKEND_URL
      if (!backend) throw new Error('Falta VITE_BACKEND_URL en el frontend')
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('No hay sesión activa')
      const r = await fetch(`${backend}/arca/regenerar-mis`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Error del backend')
      if (j.ok === false) {
        setArcaMsg(`No se regeneró: ${j.motivo || 'sin datos'}`)
      } else {
        setArcaMsg(`Facturas regeneradas ✓ — ${j.regeneradas}/${j.total}`)
      }
    } catch (e) {
      setArcaError(e.message ?? String(e))
    } finally {
      setArcaCargando(false)
    }
  }

  async function diagPortalPadron() {
    setArcaMsg(null); setArcaError(null); setArcaShot(null); setArcaPasos([]); setArcaCampos(null)
    setDebugUrl(null)
    setArcaCargando(true)
    try {
      const backend = import.meta.env.VITE_BACKEND_URL
      if (!backend) throw new Error('Falta VITE_BACKEND_URL en el frontend')
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('No hay sesión activa')
      const r = await fetch(`${backend}/arca/padron-debug`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Error del backend')
      setDebugUrl(j.shotUrl || null)
      setArcaMsg(`Portal: ${j.url || '?'} — captura ${j.shotUrl ? 'lista ✓' : 'no disponible'}`)
    } catch (e) {
      setArcaError(e.message ?? String(e))
    } finally {
      setArcaCargando(false)
    }
  }

  async function detectarEmpresas() {
    setEmpresaMsg(null)
    setEmpresaError(null)
    setEmpresas([])
    setDetectando(true)
    try {
      const backend = import.meta.env.VITE_BACKEND_URL
      if (!backend) throw new Error('Falta VITE_BACKEND_URL en el frontend')
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('No hay sesión activa')

      const r = await fetch(`${backend}/arca/empresas`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Error del backend')
      setArcaShot(j.screenshot || null)
      if (!j.ok) throw new Error(j.error || 'No se pudo entrar a RCEL')

      setEmpresas(j.empresas || [])
      setEmpresaSel(credencial?.empresa_representada || (j.empresas?.[0] ?? ''))
      if (!j.empresas || j.empresas.length === 0) {
        setEmpresaMsg('No se detectaron empresas (revisá la captura de abajo).')
      }
    } catch (e) {
      setEmpresaError(e.message ?? String(e))
    } finally {
      setDetectando(false)
    }
  }

  async function detectarOpciones() {
    setOpcMsg(null)
    setOpcError(null)
    setPvOpciones([])
    setTipoOpciones([])
    setDetectandoOpc(true)
    try {
      const backend = import.meta.env.VITE_BACKEND_URL
      if (!backend) throw new Error('Falta VITE_BACKEND_URL en el frontend')
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('No hay sesión activa')

      const r = await fetch(`${backend}/arca/opciones-comprobante`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const j = await r.json()
      setArcaShot(j.screenshot || null)
      if (!r.ok) throw new Error(j.error || 'Error del backend')
      if (!j.ok) throw new Error(j.error || 'No se pudieron leer las opciones')

      setPvOpciones(j.puntosVenta || [])
      setTipoOpciones(j.tiposComprobante || [])
      setPvSel(credencial?.punto_venta || (j.puntosVenta?.[0] ?? ''))
      const tipoDefault =
        (j.tiposComprobante || []).find((t) => /factura c/i.test(t)) ||
        (j.tiposComprobante?.[0] ?? '')
      setTipoSel(credencial?.tipo_comprobante || tipoDefault)
      if (!j.puntosVenta?.length) {
        setOpcMsg('No se detectaron puntos de venta (revisá la captura).')
      }
    } catch (e) {
      setOpcError(e.message ?? String(e))
    } finally {
      setDetectandoOpc(false)
    }
  }

  async function guardarOpciones() {
    setOpcMsg(null)
    setOpcError(null)
    if (!pvSel || !tipoSel) {
      setOpcError('Elegí punto de venta y tipo de comprobante')
      return
    }
    const { error } = await supabase
      .from('credenciales_arca')
      .update({ punto_venta: pvSel, tipo_comprobante: tipoSel })
      .eq('user_id', user.id)
    if (error) {
      setOpcError(error.message)
      return
    }
    setOpcMsg('Punto de venta y tipo guardados ✓')
    setPvOpciones([])
    setTipoOpciones([])
    cargarCredencial()
  }

  async function guardarEmpresa() {
    setEmpresaMsg(null)
    setEmpresaError(null)
    if (!empresaSel) {
      setEmpresaError('Elegí una empresa primero')
      return
    }
    const { error } = await supabase
      .from('credenciales_arca')
      .update({ empresa_representada: empresaSel })
      .eq('user_id', user.id)
    if (error) {
      setEmpresaError(error.message)
      return
    }
    setEmpresaMsg('Empresa guardada ✓')
    setEmpresas([])
    cargarCredencial()
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
      if (/LIMITE_PRODUCTOS_GRATIS/.test(error.message || '')) {
        setProdError('El plan Gratis permite hasta 3 productos. Pasá a Pro para guardar ilimitados.')
      } else {
        setProdError(error.message)
      }
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

  // Elimina la cuenta: verifica la contraseña (si el registro fue con email) y
  // llama al backend, que borra todos los datos y el usuario de acceso.
  async function eliminarCuenta() {
    setDelError(null)
    setDelCargando(true)
    try {
      const backend = import.meta.env.VITE_BACKEND_URL
      if (!backend) throw new Error('Falta VITE_BACKEND_URL en el frontend')

      // Si tiene contraseña, la verificamos del lado del cliente antes de borrar
      // (así la contraseña nunca pasa por nuestro servidor).
      if (tienePassword) {
        if (!delPass) throw new Error('Ingresá tu contraseña')
        const { error: reauthErr } = await supabase.auth.signInWithPassword({
          email: user.email,
          password: delPass,
        })
        if (reauthErr) throw new Error('Contraseña incorrecta')
      }

      const {
        data: { session },
      } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('No hay sesión activa')

      const r = await fetch(`${backend}/cuenta/eliminar`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'No se pudo eliminar la cuenta')

      // Listo: cerramos sesión y salimos a la landing.
      await signOut()
      window.location.href = '/'
    } catch (e) {
      setDelError(e.message ?? String(e))
      setDelCargando(false)
    }
  }

  // ---- Plan / suscripción Pro ----
  async function cargarPro() {
    try {
      const backend = import.meta.env.VITE_BACKEND_URL
      if (!backend) return
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) return
      const r = await fetch(`${backend}/pro/estado`, { headers: { Authorization: `Bearer ${token}` } })
      const j = await r.json().catch(() => ({}))
      if (r.ok) setProEstado(j)
    } catch {
      /* silencioso */
    }
  }

  async function suscribirPro() {
    setProError(null)
    setProMsg(null)
    setProAccion(true)
    try {
      const backend = import.meta.env.VITE_BACKEND_URL
      if (!backend) throw new Error('Falta VITE_BACKEND_URL')
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('No hay sesión activa')
      const r = await fetch(`${backend}/pro/suscribir`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ origin: window.location.origin }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'No se pudo iniciar la suscripción')
      if (j.initPoint) window.location.href = j.initPoint
      else throw new Error('No se recibió el link de pago')
    } catch (e) {
      setProError(e.message ?? String(e))
      setProAccion(false)
    }
  }

  async function cancelarPro() {
    if (!window.confirm('¿Cancelar la suscripción Pro? Seguís con Pro hasta la fecha de vencimiento y después pasás a Gratis.')) return
    setProError(null)
    setProMsg(null)
    setProAccion(true)
    try {
      const backend = import.meta.env.VITE_BACKEND_URL
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const token = session?.access_token
      const r = await fetch(`${backend}/pro/cancelar`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'No se pudo cancelar')
      setProMsg('Suscripción cancelada. Mantenés Pro hasta el vencimiento.')
      await cargarPro()
    } catch (e) {
      setProError(e.message ?? String(e))
    } finally {
      setProAccion(false)
    }
  }

  useEffect(() => {
    if (!supabase) return
    cargarPro()
    const p = new URLSearchParams(window.location.search).get('pro')
    if (p === 'ok') {
      setProMsg('¡Gracias! Tu suscripción se está activando. Puede tardar unos minutos en confirmarse.')
      const url = new URL(window.location.href)
      url.searchParams.delete('pro')
      window.history.replaceState({}, '', url.toString())
      setTimeout(() => {
        refrescarPlan?.()
        cargarPro()
      }, 4000)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Los botones de desarrollo se ocultan para clientes. Se muestran solo en
  // local (vite dev) o si agregás ?dev a la URL (puerta trasera para vos).
  const mostrarDev =
    import.meta.env.DEV ||
    (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('dev'))

  // Estado del onboarding para el badge y el contenido de "Conexión con ARCA".
  const cEstado = credencial?.ws_setup_estado
  const cProgreso = SETUP_EN_PROGRESO.includes(cEstado)
  // "Listo" (badge verde) SOLO cuando terminó la configuración. Mientras está en
  // progreso, nunca mostramos el ✓ verde aunque ya tenga certificado/PV.
  const cListo = credencial && !cProgreso
    ? cEstado === 'listo' || (!cEstado && !!(credencial.ws_cert_alias && credencial.punto_venta_ws))
    : false

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Configuración</h1><div className="sub">Tu conexión con ARCA y tus productos</div></div>
      </div>

      {/* ---------------- Plan ---------------- */}
      <section className="seccion">
        <div className="sec-head">
          <h2>Tu plan</h2>
          <span className={`badge ${esPro ? 'badge-ok' : ''}`}>{esPro ? 'Pro' : 'Gratis'}</span>
        </div>

        {esPro ? (
          <>
            <p className="sub">
              Tenés el plan <strong>Pro</strong> activo
              {proEstado?.vence && <> · vence el {new Date(proEstado.vence).toLocaleDateString('es-AR')}</>}.
            </p>
            {proEstado?.mpEstado === 'authorized' && (
              <div className="fila-botones">
                <button type="button" className="peligro" onClick={cancelarPro} disabled={proAccion}>
                  {proAccion ? 'Procesando…' : 'Cancelar suscripción'}
                </button>
              </div>
            )}
            {proEstado?.mpEstado === 'cancelled' && (
              <p className="sub">Suscripción cancelada: no se renueva. Mantenés Pro hasta el vencimiento.</p>
            )}
          </>
        ) : (
          <>
            <p className="sub">
              Estás en el plan <strong>Gratis</strong>. Con <strong>Pro</strong> desbloqueás productos
              ilimitados y toda la integración con Mercado Pago.
            </p>
            {proEstado && !proEstado.configurado ? (
              <p className="sub">El pago del plan Pro todavía no está habilitado.</p>
            ) : (
              <div className="fila-botones">
                <button type="button" onClick={suscribirPro} disabled={proAccion || !proEstado}>
                  {proAccion
                    ? 'Abriendo pago…'
                    : `Suscribirme a Pro${proEstado?.precio ? ` ($${new Intl.NumberFormat('es-AR').format(proEstado.precio)}/mes)` : ''}`}
                </button>
              </div>
            )}
          </>
        )}
        {proMsg && <p className="ok">{proMsg}</p>}
        {proError && <p className="error">{proError}</p>}
      </section>

      {/* ---------------- Credencial ARCA ---------------- */}
      <section className="seccion">
        <div className="sec-head">
          <h2>Conexión con ARCA</h2>
          {credencial && !editandoCred && (
            cListo ? (
              <span className="badge badge-ok">Credencial ✓</span>
            ) : cProgreso ? (
              <span className="badge badge-load"><span className="spinner-inline" />Configurando…</span>
            ) : cEstado === 'error' ? (
              <span className="badge badge-error">Error</span>
            ) : cEstado === 'falta_pv' ? (
              <span className="badge badge-warn">Falta punto de venta</span>
            ) : null
          )}
        </div>

        {credencial && !editandoCred ? (
          <div className="cred-cargada">
            <p>CUIT: <strong>{credencial.cuit}</strong></p>

            {cListo && (
              <p>Punto de venta: <strong>{credencial.punto_venta_ws}</strong></p>
            )}

            {!cListo && cProgreso && (
              <p className="sub">
                <span className="spinner-inline" />
                {credencial.ws_setup_paso || 'Configurando tu facturación electrónica…'} Puede tardar unos minutos.
              </p>
            )}

            {!cListo && cEstado === 'falta_pv' && (
              <div className="setup-box setup-aviso">
                <p>Ya casi: falta habilitar un punto de venta para facturación electrónica.</p>
                <button type="button" className="secundario" onClick={() => iniciarSetupWsfe(true)}>
                  Reintentar
                </button>
              </div>
            )}

            {!cListo && cEstado === 'error' && (
              <div className="setup-box setup-error">
                <p className="error">No pudimos completar la configuración automática.</p>
                {credencial.ws_setup_error && <p className="sub">{credencial.ws_setup_error}</p>}
                <button type="button" onClick={() => iniciarSetupWsfe(true)}>
                  Reintentar configuración
                </button>
              </div>
            )}

            {!cListo && !cProgreso && !cEstado && (
              <div className="setup-box">
                <p className="sub">Todavía no configuraste la facturación electrónica.</p>
                <button type="button" onClick={() => iniciarSetupWsfe(false)}>
                  Configurar facturación electrónica
                </button>
              </div>
            )}

            <p className="sub">
              Actualizada: {new Date(credencial.updated_at).toLocaleString('es-AR')}
            </p>
            <div className="fila-botones">
              <button type="button" className="peligro" onClick={desconectar}>
                Desconectar
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={guardarCredencial} className="form">
            <input
              type="text"
              inputMode="numeric"
              placeholder="CUIT (ej: 20-12345678-9)"
              value={cuit}
              onChange={(e) => setCuit(e.target.value.replace(/[^\d-]/g, '').slice(0, 13))}
              maxLength={13}
              required
            />
            <input
              type="password"
              placeholder="Clave Fiscal (Nivel 3)"
              value={clave}
              onChange={(e) => setClave(e.target.value)}
              required
              maxLength={64}
              autoComplete="new-password"
            />
            <p className="sub">
              La Clave Fiscal se guarda cifrada. No se vuelve a mostrar.
            </p>
            {credencial && credencial.activa === false && (
              <p className="sub">
                Ya configuraste esta cuenta antes. Al reconectar reutilizamos tu
                certificado: no se crean certificados nuevos.
              </p>
            )}
            <div className="fila-botones">
              <button type="submit" disabled={guardandoCred}>
                {guardandoCred ? 'Conectando…' : 'Conectar'}
              </button>
            </div>
          </form>
        )}
        {credMsg && <p className="msg-prog">{credMsg}</p>}
        {credError && <p className="error">{credError}</p>}

        {mostrarDev && (
          <div className="verif">
            <button type="button" className="secundario" onClick={verificarConexion} disabled={verificando}>
              {verificando ? 'Verificando…' : 'Verificar conexión con el backend'}
            </button>
            {verifMsg && <p className="ok">{verifMsg}</p>}
            {verifError && <p className="error">{verifError}</p>}
          </div>
        )}
      </section>

      {/* Secciones "Empresa a representar" y "Punto de venta y comprobante"
          removidas: eran del flujo viejo por RPA. Ahora, al guardar la
          credencial, el onboarding detecta o crea el punto de venta WS solo. */}

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
                maxLength={80}
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

        {!esPro && (
          <p className="sub">
            Plan Gratis: hasta 3 productos ({productos.length}/3). Con Pro guardás ilimitados.
          </p>
        )}
        <form onSubmit={agregarProducto} className="agregar">
          <input
            type="text"
            placeholder="Nuevo producto / servicio"
            value={nuevoProducto}
            onChange={(e) => setNuevoProducto(e.target.value)}
            maxLength={80}
            disabled={!esPro && productos.length >= 3}
          />
          <button type="submit" disabled={!esPro && productos.length >= 3}>
            Agregar
          </button>
        </form>
        {prodError && <p className="error">{prodError}</p>}
      </section>

      {/* ---------------- Eliminar cuenta ---------------- */}
      <section className="seccion zona-peligro">
        <h2>Eliminar cuenta</h2>
        {!delAbierto ? (
          <>
            <p className="sub">
              Borra de forma permanente todos los datos que YaFact usa de tu cuenta.
            </p>
            <div className="fila-botones">
              <button type="button" className="peligro" onClick={() => setDelAbierto(true)}>
                Eliminar mi cuenta
              </button>
            </div>
          </>
        ) : (
          <div className="del-box">
            <p>
              Al eliminar tu cuenta se borra <strong>toda</strong> la información que YaFact
              guarda de vos: facturas emitidas, credenciales de ARCA, cobros y cuentas de
              Mercado Pago, productos guardados, tu perfil y los PDF.
            </p>
            <p className="del-legal">
              Importante: las facturas que ya emitiste <strong>quedan registradas legalmente
              en ARCA</strong>. Este borrado <strong>no</strong> las anula ni las elimina ante
              ARCA — solo elimina los datos que usa YaFact.
            </p>
            <p className="sub">Esta acción no se puede deshacer.</p>
            <label className="del-label">
              <span>
                Para continuar, escribí <strong>ELIMINAR</strong>:
              </span>
              <input
                type="text"
                value={delTexto}
                onChange={(e) => setDelTexto(e.target.value)}
                placeholder="ELIMINAR"
                autoComplete="off"
                maxLength={16}
              />
            </label>
            <div className="fila-botones">
              <button
                type="button"
                className="secundario"
                onClick={() => {
                  setDelAbierto(false)
                  setDelTexto('')
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="peligro"
                disabled={delTexto.trim().toUpperCase() !== 'ELIMINAR'}
                onClick={() => {
                  setDelError(null)
                  setDelPass('')
                  setDelModal(true)
                }}
              >
                Eliminar
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Modal: segunda confirmación */}
      {delModal && (
        <div className="modal-overlay" onClick={() => !delCargando && setDelModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3>¿Estás seguro?</h3>
            <p>
              ¿Estás consciente de que esto va a eliminar <strong>toda tu información y tu
              cuenta de YaFact</strong>? Esta acción no se puede deshacer.
            </p>
            {tienePassword ? (
              <label className="del-label">
                <span>Confirmá con tu contraseña:</span>
                <input
                  type="password"
                  value={delPass}
                  onChange={(e) => setDelPass(e.target.value)}
                  placeholder="Tu contraseña"
                  autoComplete="current-password"
                  maxLength={72}
                />
              </label>
            ) : (
              <p className="sub">
                Iniciaste sesión con Google, así que no hay contraseña que ingresar. Al
                confirmar se elimina tu cuenta y se corta el vínculo con Google.
              </p>
            )}
            {delError && <p className="error">{delError}</p>}
            <div className="fila-botones">
              <button
                type="button"
                className="secundario"
                onClick={() => setDelModal(false)}
                disabled={delCargando}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="peligro"
                onClick={eliminarCuenta}
                disabled={delCargando || (tienePassword && !delPass)}
              >
                {delCargando ? 'Eliminando…' : 'Eliminar todo y mi cuenta'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sección de desarrollo: oculta para clientes (visible en local o con ?dev). */}
      {mostrarDev && (
      <section className="seccion">
        <h2>Prueba de conexión ARCA (desarrollo)</h2>
        <p className="sub">
          Hace login en ARCA con tu credencial y devuelve una captura de dónde
          llegó. No emite ni toca ningún comprobante.
        </p>
        <div className="fila-botones">
          <button type="button" onClick={probarArca} disabled={arcaCargando}>
            {arcaCargando ? 'Probando…' : 'Probar login ARCA'}
          </button>
          <button type="button" onClick={probarPadron} disabled={arcaCargando}>
            {arcaCargando ? 'Consultando…' : 'Probar Padrón (datos del emisor)'}
          </button>
          <button type="button" onClick={autorizarPadron} disabled={arcaCargando}>
            {arcaCargando ? 'Sincronizando…' : 'Sincronizar datos emisor (Padrón)'}
          </button>
          <button type="button" onClick={regenerarMisFacturas} disabled={arcaCargando}>
            {arcaCargando ? 'Regenerando…' : 'Regenerar mis facturas (formato nuevo)'}
          </button>
          <button type="button" onClick={diagPortalPadron} disabled={arcaCargando}>
            {arcaCargando ? 'Capturando…' : 'Diagnóstico portal padrón (captura)'}
          </button>
          <button
            type="button"
            className="secundario"
            onClick={probarFormularioFactura}
            disabled={arcaCargando}
          >
            {arcaCargando ? 'Llenando…' : 'Probar llenado hasta resumen (3D)'}
          </button>
          <button
            type="button"
            className="secundario"
            onClick={inspeccionarNC}
            disabled={arcaCargando}
          >
            {arcaCargando ? 'Inspeccionando…' : 'Inspeccionar Nota de Crédito (4C)'}
          </button>
          <button
            type="button"
            className="secundario"
            onClick={inspeccionarWSASS}
            disabled={arcaCargando}
          >
            {arcaCargando ? 'Inspeccionando…' : 'Inspeccionar WSASS (certificados)'}
          </button>
          <button
            type="button"
            className="secundario"
            onClick={crearCertAuto}
            disabled={arcaCargando}
          >
            {arcaCargando ? 'Creando…' : 'Crear certificado de prueba (auto)'}
          </button>
          <button
            type="button"
            className="secundario"
            onClick={inspeccionarRel}
            disabled={arcaCargando}
          >
            {arcaCargando ? 'Inspeccionando…' : 'Inspeccionar Administrador de Relaciones'}
          </button>
          <button
            type="button"
            onClick={configurarWsfe}
            disabled={arcaCargando}
          >
            {arcaCargando ? 'Configurando…' : 'Configurar wsfe (crear cert + autorizar)'}
          </button>
          <button
            type="button"
            className="secundario"
            onClick={verPuntosVentaWs}
            disabled={arcaCargando}
          >
            {arcaCargando ? 'Consultando…' : 'Ver puntos de venta WS'}
          </button>
          <button
            type="button"
            className="secundario"
            onClick={inspeccionarPtosVenta}
            disabled={arcaCargando}
          >
            {arcaCargando ? 'Inspeccionando…' : 'Inspeccionar ABM Puntos de Venta'}
          </button>
          <button
            type="button"
            className="secundario"
            onClick={crearPvDryRun}
            disabled={arcaCargando}
          >
            {arcaCargando ? 'Probando…' : 'Crear PV WS (dry-run)'}
          </button>
          <button
            type="button"
            onClick={crearPvReal}
            disabled={arcaCargando}
          >
            {arcaCargando ? 'Creando…' : 'Crear PV WS (REAL)'}
          </button>
          <button
            type="button"
            onClick={emitirWsPrueba}
            disabled={arcaCargando}
          >
            {arcaCargando ? 'Emitiendo…' : 'Emitir Factura C real (WS producción)'}
          </button>
        </div>
        {arcaMsg && <p className="ok">{arcaMsg}</p>}
        {debugUrl && (
          <p className="sub">
            Captura del portal: <a href={debugUrl} target="_blank" rel="noreferrer">abrir imagen</a>
          </p>
        )}
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
        {arcaCampos && (
          <pre className="campos-dump">{JSON.stringify(arcaCampos, null, 1)}</pre>
        )}
      </section>
      )}
    </div>
  )
}

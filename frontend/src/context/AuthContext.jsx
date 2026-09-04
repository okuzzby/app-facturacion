import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'

const AuthContext = createContext({ session: null, user: null, loading: true })

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [perfilNombre, setPerfilNombre] = useState('')
  const [esAdmin, setEsAdmin] = useState(false)
  const [esPro, setEsPro] = useState(false)
  const [planCargado, setPlanCargado] = useState(false)

  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const userId = session?.user?.id

  // Carga el nombre del perfil (para el saludo "Hola, {Nombre}").
  const cargarPerfil = useCallback(async () => {
    if (!supabase || !userId) {
      setPerfilNombre('')
      return
    }
    const { data } = await supabase
      .from('perfiles')
      .select('nombre')
      .eq('id', userId)
      .maybeSingle()
    setPerfilNombre(data?.nombre || '')
  }, [userId])

  useEffect(() => {
    cargarPerfil()
  }, [cargarPerfil])

  // Plan del usuario (para mostrar/ocultar funciones Pro en la UI). El control
  // real está en el backend/base; esto es solo para la interfaz.
  const cargarPlan = useCallback(async () => {
    if (!supabase || !userId) {
      setEsPro(false)
      setPlanCargado(true)
      return
    }
    const { data } = await supabase
      .from('suscripciones')
      .select('plan, vence')
      .eq('user_id', userId)
      .maybeSingle()
    const pro = data?.plan === 'pro' && (!data.vence || new Date(data.vence).getTime() > Date.now())
    setEsPro(Boolean(pro))
    setPlanCargado(true)
  }, [userId])

  useEffect(() => {
    cargarPlan()
  }, [cargarPlan])

  // ¿La cuenta actual es admin? Lo decide el backend (lista de correos).
  useEffect(() => {
    let vivo = true
    ;(async () => {
      if (!supabase || !userId) {
        setEsAdmin(false)
        return
      }
      try {
        const backend = import.meta.env.VITE_BACKEND_URL
        if (!backend) return
        const {
          data: { session: s },
        } = await supabase.auth.getSession()
        const token = s?.access_token
        if (!token) return
        const r = await fetch(`${backend}/admin/soy-admin`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        const j = await r.json().catch(() => ({}))
        if (vivo) setEsAdmin(Boolean(j?.admin))
      } catch {
        if (vivo) setEsAdmin(false)
      }
    })()
    return () => {
      vivo = false
    }
  }, [userId])

  const value = {
    session,
    user: session?.user ?? null,
    loading,
    perfilNombre,
    esAdmin,
    esPro,
    planCargado,
    refrescarPerfil: cargarPerfil,
    refrescarPlan: cargarPlan,
    signOut: () => supabase?.auth.signOut(),
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}

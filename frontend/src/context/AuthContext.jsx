import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'

const AuthContext = createContext({ session: null, user: null, loading: true })

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [perfilNombre, setPerfilNombre] = useState('')

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

  const value = {
    session,
    user: session?.user ?? null,
    loading,
    perfilNombre,
    refrescarPerfil: cargarPerfil,
    signOut: () => supabase?.auth.signOut(),
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}

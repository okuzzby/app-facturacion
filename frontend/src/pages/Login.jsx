import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

export default function Login() {
  const navigate = useNavigate()
  const [modo, setModo] = useState('login') // 'login' | 'registro'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mensaje, setMensaje] = useState(null)
  const [error, setError] = useState(null)
  const [cargando, setCargando] = useState(false)

  if (!supabase) {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <div className="auth-brand"><span className="glyph">◆</span> App</div>
          <p className="error">
            Falta configurar Supabase (variables VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY).
          </p>
        </div>
      </div>
    )
  }

  async function manejarSubmit(e) {
    e.preventDefault()
    setError(null)
    setMensaje(null)
    setCargando(true)
    try {
      if (modo === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        navigate('/')
      } else {
        const { error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        setMensaje(
          'Cuenta creada. Si tu proyecto pide confirmar el email, revisá tu casilla; si no, ya podés iniciar sesión.'
        )
        setModo('login')
      }
    } catch (err) {
      setError(err.message ?? 'Ocurrió un error')
    } finally {
      setCargando(false)
    }
  }

  async function ingresarConGoogle() {
    setError(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
    if (error) setError(error.message)
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-brand"><span className="glyph">◆</span> App</div>
        <div>
          <h1>{modo === 'login' ? 'Iniciá sesión' : 'Creá tu cuenta'}</h1>
          <p className="lead">Facturá como monotributista, sin vueltas.</p>
        </div>

        <form onSubmit={manejarSubmit} className="form">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
          <input
            type="password"
            placeholder="Contraseña"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            autoComplete={modo === 'login' ? 'current-password' : 'new-password'}
          />
          <button type="submit" disabled={cargando}>
            {cargando ? 'Procesando…' : modo === 'login' ? 'Entrar' : 'Registrarme'}
          </button>
        </form>

        <div className="sep">o</div>

        <button className="google" onClick={ingresarConGoogle} type="button">
          Continuar con Google
        </button>

        <p className="switch">
          {modo === 'login' ? '¿No tenés cuenta?' : '¿Ya tenés cuenta?'}{' '}
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault()
              setError(null)
              setMensaje(null)
              setModo(modo === 'login' ? 'registro' : 'login')
            }}
          >
            {modo === 'login' ? 'Registrate' : 'Iniciá sesión'}
          </a>
        </p>

        {mensaje && <p className="ok">{mensaje}</p>}
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  )
}

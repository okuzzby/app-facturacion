import { useAuth } from '../context/AuthContext'

export default function Home() {
  const { user, signOut } = useAuth()

  return (
    <div className="card">
      <h1>App Facturación</h1>
      <p>Sesión iniciada como:</p>
      <p className="email-actual">{user?.email}</p>
      <p className="status">
        Fase 1 lista. La pantalla de Configuración y el botón Facturar llegan en
        la Fase 2.
      </p>
      <button className="secundario" onClick={signOut} type="button">
        Cerrar sesión
      </button>
    </div>
  )
}

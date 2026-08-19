import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Home() {
  const { user, signOut } = useAuth()

  return (
    <div className="card">
      <h1>App Facturación</h1>
      <p>Sesión iniciada como:</p>
      <p className="email-actual">{user?.email}</p>
      <p className="status">
        El botón Facturar llega en la Fase 3. Por ahora podés dejar lista tu
        Configuración.
      </p>

      <Link to="/configuracion" className="boton-link">
        Configuración
      </Link>

      <button className="secundario" onClick={signOut} type="button">
        Cerrar sesión
      </button>
    </div>
  )
}

import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Home() {
  const { user, signOut } = useAuth()

  return (
    <div className="card">
      <h1>App Facturación</h1>
      <p className="email-actual">{user?.email}</p>

      <Link to="/facturar" className="boton-facturar">Facturar</Link>

      <Link to="/historial" className="boton-link secundario-link">
        Historial
      </Link>

      <Link to="/configuracion" className="boton-link secundario-link">
        Configuración
      </Link>

      <button className="secundario" onClick={signOut} type="button">
        Cerrar sesión
      </button>
    </div>
  )
}

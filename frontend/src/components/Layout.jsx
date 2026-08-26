import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const IconInicio = () => (
  <svg viewBox="0 0 24 24"><path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" /></svg>
)
const IconFacturar = () => (
  <svg viewBox="0 0 24 24"><path d="M4 4h16v16H4z" /><path d="M8 9h8M8 13h5" /></svg>
)
const IconHistorial = () => (
  <svg viewBox="0 0 24 24"><path d="M4 5h16M4 12h16M4 19h10" /></svg>
)
const IconConfig = () => (
  <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3" /></svg>
)

export default function Layout() {
  const { user, signOut } = useAuth()
  const inicial = (user?.email || '?').trim().charAt(0).toUpperCase()

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          <span className="glyph">◆</span> App
        </div>
        <nav className="nav">
          <NavLink to="/" end>
            <IconInicio /> <span>Inicio</span>
          </NavLink>
          <NavLink to="/facturar">
            <IconFacturar /> <span>Facturar</span>
          </NavLink>
          <NavLink to="/historial">
            <IconHistorial /> <span>Historial</span>
          </NavLink>
          <NavLink to="/configuracion">
            <IconConfig /> <span>Configuración</span>
          </NavLink>
        </nav>

        <div className="side-foot">
          <div className="side-user">
            <span className="avatar">{inicial}</span>
            <span className="em">{user?.email}</span>
          </div>
          <button type="button" className="side-logout" onClick={signOut}>
            Cerrar sesión
          </button>
        </div>
      </aside>

      <main className="content">
        <Outlet />
      </main>
    </div>
  )
}

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

const NAV = [
  { to: '/', end: true, label: 'Inicio', short: 'Inicio', Icon: IconInicio },
  { to: '/facturar', label: 'Facturar', short: 'Facturar', Icon: IconFacturar },
  { to: '/historial', label: 'Historial', short: 'Historial', Icon: IconHistorial },
  { to: '/configuracion', label: 'Configuración', short: 'Config', Icon: IconConfig },
]

export default function Layout() {
  const { user, signOut } = useAuth()
  const inicial = (user?.email || '?').trim().charAt(0).toUpperCase()

  return (
    <div className="shell">
      {/* Menú lateral (escritorio) */}
      <aside className="side">
        <div className="brand">
          <span className="glyph">◆</span> App
        </div>
        <nav className="nav">
          {NAV.map(({ to, end, label, Icon }) => (
            <NavLink key={to} to={to} end={end}>
              <Icon /> <span>{label}</span>
            </NavLink>
          ))}
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

      {/* Barra superior (celular) */}
      <header className="mtop">
        <div className="brand"><span className="glyph">◆</span> App</div>
        <button type="button" className="mtop-logout" onClick={signOut} aria-label="Cerrar sesión">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9">
            <path d="M16 17l5-5-5-5M21 12H9M12 19H5V5h7" />
          </svg>
        </button>
      </header>

      <main className="content">
        <Outlet />
      </main>

      {/* Barra de navegación inferior (celular) — Facturar como botón central */}
      <nav className="bottomnav">
        <div className="bn-group">
          <NavLink to="/" end><IconInicio /><span>Inicio</span></NavLink>
          <NavLink to="/historial"><IconHistorial /><span>Historial</span></NavLink>
        </div>

        <NavLink to="/facturar" className="bn-fab">
          <span className="bn-fab-circle"><IconFacturar /></span>
          <span className="bn-fab-label">Facturar</span>
        </NavLink>

        <div className="bn-group">
          <NavLink to="/configuracion"><IconConfig /><span>Config</span></NavLink>
        </div>
      </nav>
    </div>
  )
}

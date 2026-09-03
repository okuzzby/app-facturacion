import { useState, useEffect } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Logo from './Logo'

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
const IconMenu = () => (
  <svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
)
const IconIntegraciones = () => (
  <svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><path d="M17.5 14v3.5M14 17.5h7" /></svg>
)

const NAV = [
  { to: '/', end: true, label: 'Inicio', Icon: IconInicio },
  { to: '/facturar', label: 'Facturar', Icon: IconFacturar },
  { to: '/historial', label: 'Historial', Icon: IconHistorial },
  { to: '/configuracion', label: 'Configuración', Icon: IconConfig },
  { to: '/integraciones', label: 'Integraciones', Icon: IconIntegraciones },
]

const primerNombre = (n) => {
  if (!n) return ''
  const w = String(n).trim().split(/\s+/)[0]
  return w ? w.charAt(0).toUpperCase() + w.slice(1) : ''
}

export default function Layout() {
  const { user, perfilNombre, signOut } = useAuth()
  const inicial = (perfilNombre || user?.email || '?').trim().charAt(0).toUpperCase()
  const nombre = primerNombre(perfilNombre)
  const [menuAbierto, setMenuAbierto] = useState(false)

  // Cerrar el menú con Escape y bloquear el scroll de fondo mientras está abierto.
  useEffect(() => {
    if (!menuAbierto) return
    const onKey = (e) => e.key === 'Escape' && setMenuAbierto(false)
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [menuAbierto])

  const cerrar = () => setMenuAbierto(false)

  return (
    <div className="shell">
      {/* Menú lateral (escritorio) */}
      <aside className="side">
        <div className="brand">
          <Logo size={22} /> YaFact
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
        <div className="mtop-saludo">
          {nombre ? `Hola, ${nombre}` : <span className="mtop-brand"><Logo size={22} /> YaFact</span>}
        </div>
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
          <button type="button" className="bn-tab" onClick={() => setMenuAbierto(true)}>
            <IconMenu /><span>Menú</span>
          </button>
        </div>
      </nav>

      {/* Menú a pantalla completa (celular) */}
      {menuAbierto && (
        <div className="menu-overlay">
          <div className="menu-head">
            <div className="brand"><Logo size={22} /> YaFact</div>
            <button type="button" className="menu-close" onClick={cerrar} aria-label="Cerrar menú">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>

          <nav className="menu-list">
            {NAV.map(({ to, end, label, Icon }) => (
              <NavLink key={to} to={to} end={end} onClick={cerrar}>
                <Icon /> <span>{label}</span>
              </NavLink>
            ))}
          </nav>

          <div className="menu-foot">
            <div className="side-user">
              <span className="avatar">{inicial}</span>
              <span className="em">{user?.email}</span>
            </div>
            <button type="button" className="side-logout" onClick={signOut}>
              Cerrar sesión
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

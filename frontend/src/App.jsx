import { Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import Layout from './components/Layout'
import Landing from './pages/Landing'
import Admin from './pages/Admin'
import Login from './pages/Login'
import Home from './pages/Home'
import Configuracion from './pages/Configuracion'
import Facturar from './pages/Facturar'
import Historial from './pages/Historial'
import Integraciones from './pages/Integraciones'
import MercadoPago from './pages/MercadoPago'
import Privacidad from './pages/Privacidad'
import Terminos from './pages/Terminos'

// Puerta de la raíz "/" y del resto de las páginas de la app.
//  - Sin sesión: en "/" mostramos la landing pública; en cualquier ruta más
//    profunda mandamos al login.
//  - Con sesión: renderizamos el Layout con menú; las páginas salen por <Outlet/>.
function RootGate() {
  const { session, loading } = useAuth()
  const { pathname } = useLocation()

  if (loading) {
    return (
      <div className="card">
        <p>Cargando…</p>
      </div>
    )
  }

  if (!session) {
    if (pathname === '/') return <Landing />
    return <Navigate to="/login" replace />
  }

  return <Layout />
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      {/* Páginas legales públicas (accesibles sin iniciar sesión) */}
      <Route path="/privacidad" element={<Privacidad />} />
      <Route path="/terminos" element={<Terminos />} />

      {/* Raíz: landing pública si no hay sesión, app si la hay.
          Las páginas autenticadas cuelgan de acá y comparten el Layout. */}
      <Route path="/" element={<RootGate />}>
        <Route index element={<Home />} />
        <Route path="facturar" element={<Facturar />} />
        <Route path="historial" element={<Historial />} />
        <Route path="configuracion" element={<Configuracion />} />
        <Route path="integraciones" element={<Integraciones />} />
        <Route path="mercadopago" element={<MercadoPago />} />
        <Route path="admin" element={<Admin />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

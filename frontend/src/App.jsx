import { Routes, Route, Navigate } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'
import Login from './pages/Login'
import Home from './pages/Home'
import Configuracion from './pages/Configuracion'
import Facturar from './pages/Facturar'
import Historial from './pages/Historial'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      {/* Páginas autenticadas: comparten el Layout con menú lateral */}
      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<Home />} />
        <Route path="/facturar" element={<Facturar />} />
        <Route path="/historial" element={<Historial />} />
        <Route path="/configuracion" element={<Configuracion />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

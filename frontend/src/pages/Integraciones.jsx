import { useNavigate } from 'react-router-dom'

const IconAtras = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
    <path d="M15 18l-6-6 6-6" />
  </svg>
)

export default function Integraciones() {
  const navigate = useNavigate()
  return (
    <div className="page">
      <div className="page-head page-head-back">
        <button type="button" className="icon-btn" onClick={() => navigate(-1)} aria-label="Atrás">
          <IconAtras />
        </button>
        <h1>Integraciones</h1>
      </div>
    </div>
  )
}

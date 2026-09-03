// Página pública de bienvenida (marketing). Se muestra en "/" cuando el
// visitante NO tiene sesión iniciada. Se sirve el HTML estático /landing.html
// dentro de un iframe a pantalla completa para aislar por completo sus estilos
// de los de la app (evita colisiones de clases como .btn, .brand, .nav).
export default function Landing() {
  return (
    <iframe
      title="YaFact"
      src="/landing.html"
      style={{
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100%',
        border: 0,
        display: 'block',
      }}
    />
  )
}

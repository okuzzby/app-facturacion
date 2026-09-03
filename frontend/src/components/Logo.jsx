// Isotipo de YaFact: hoja de factura (esquinas alternadas) + líneas de
// comprobante + rayo. Colores sólidos de la marca (naranja / amarillo).
export default function Logo({ size = 28, className }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 120 120"
      role="img"
      aria-label="YaFact"
    >
      <path
        d="M26,14 L74,14 A20,20 0 0 1 94,34 L94,106 L46,106 A20,20 0 0 1 26,86 Z"
        fill="#F26A1B"
      />
      <g fill="#ffffff" opacity="0.92">
        <rect x="40" y="42" width="40" height="5" rx="2.5" />
        <rect x="40" y="54" width="40" height="5" rx="2.5" />
        <rect x="40" y="66" width="40" height="5" rx="2.5" />
        <rect x="40" y="78" width="26" height="5" rx="2.5" />
      </g>
      <path
        d="M70,22 L40,66 L56,66 L48,100 L84,50 L66,50 L74,22 Z"
        fill="#FFD23F"
        stroke="#F26A1B"
        strokeWidth="3"
        strokeLinejoin="round"
      />
    </svg>
  )
}

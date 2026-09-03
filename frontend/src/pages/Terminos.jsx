import { Link } from 'react-router-dom'

// Página pública de Términos y Condiciones. El nombre del responsable queda
// como placeholder para completar más adelante.
const CONTACTO = 'yafact.ar@gmail.com'
const ACTUALIZADO = '3 de septiembre de 2026'

export default function Terminos() {
  return (
    <div className="legal">
      <div className="legal-card">
        <Link to="/login" className="legal-volver">← Volver</Link>
        <h1>Términos y Condiciones</h1>
        <p className="legal-fecha">Última actualización: {ACTUALIZADO}</p>

        <p>
          Estos Términos regulan el uso de YaFact, una aplicación de facturación
          para monotributistas (“la App”). Al crear una cuenta o usar la App,
          aceptás estos Términos.
        </p>

        <h2>1. Qué es la App</h2>
        <p>
          La App te permite emitir Facturas C y Notas de Crédito ante ARCA (AFIP)
          por Web Service, gestionar tus comprobantes y, opcionalmente, facturar
          tus cobros de Mercado Pago. Está pensada para contribuyentes inscriptos
          en el Régimen Simplificado (Monotributo).
        </p>

        <h2>2. Requisitos y cuenta</h2>
        <ul>
          <li>Necesitás una cuenta propia y datos de acceso a ARCA (Clave Fiscal).</li>
          <li>Sos responsable de mantener la confidencialidad de tu cuenta.</li>
          <li>Los datos que cargues deben ser verídicos y estar actualizados.</li>
        </ul>

        <h2>3. Uso correcto</h2>
        <p>
          Te comprometés a usar la App conforme a la ley y a las normas de ARCA.
          Los comprobantes que emitas tienen validez fiscal y son de tu exclusiva
          responsabilidad: la App actúa como una herramienta que emite en tu
          nombre a partir de la información y las órdenes que vos indicás.
        </p>

        <h2>4. Responsabilidad</h2>
        <p>
          La App se ofrece “tal cual”, sin garantías de disponibilidad
          ininterrumpida. No nos responsabilizamos por errores en los datos que
          cargues, por decisiones fiscales que tomes, ni por interrupciones o
          cambios en los servicios de terceros (ARCA, Mercado Pago, proveedores de
          infraestructura). En la máxima medida permitida por la ley, nuestra
          responsabilidad se limita a lo estrictamente necesario.
        </p>

        <h2>5. Servicios de terceros</h2>
        <p>
          La App se integra con ARCA, Mercado Pago y Google. El uso de esos
          servicios se rige también por sus propios términos y políticas.
        </p>

        <h2>6. Baja y suspensión</h2>
        <p>
          Podés dar de baja tu cuenta cuando quieras. Podemos suspender o dar de
          baja cuentas que incumplan estos Términos o hagan un uso indebido de la
          App.
        </p>

        <h2>7. Cambios</h2>
        <p>
          Podemos modificar la App y estos Términos. Publicaremos la versión
          vigente en esta página con su fecha de última actualización.
        </p>

        <h2>8. Ley aplicable</h2>
        <p>
          Estos Términos se rigen por las leyes de la República Argentina.
        </p>

        <h2>9. Contacto</h2>
        <p>
          Por consultas, escribinos a <a href={`mailto:${CONTACTO}`}>{CONTACTO}</a>.
        </p>

        <p className="legal-foot">
          <Link to="/privacidad">Política de Privacidad</Link> · <Link to="/login">Iniciar sesión</Link>
        </p>
      </div>
    </div>
  )
}

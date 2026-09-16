import { Link, useNavigate } from 'react-router-dom'

// Página pública de Seguridad de la Información: explica en criollo cómo YaFact
// protege los datos del usuario. Contenido real (no promesas vacías).
const CONTACTO = 'yafact.ar@gmail.com'
const ACTUALIZADO = '16 de septiembre de 2026'

export default function Seguridad() {
  const navigate = useNavigate()
  return (
    <div className="legal">
      <div className="legal-card">
        <button type="button" className="legal-volver" onClick={() => navigate(-1)}>← Volver</button>
        <h1>Seguridad de la información</h1>
        <p className="legal-fecha">Última actualización: {ACTUALIZADO}</p>

        <p>
          En YaFact nos tomamos en serio el cuidado de tus datos. Acá te contamos, en
          criollo, qué medidas concretas aplicamos para proteger tu información.
        </p>

        <h2>1. Tus credenciales, cifradas</h2>
        <p>
          Tu <strong>Clave Fiscal</strong> y los tokens de <strong>Mercado Pago</strong> se
          guardan <strong>cifrados</strong>. No quedan escritos “en texto plano” en ninguna
          parte, y no se vuelven a mostrar una vez cargados. Se usan únicamente para operar
          tu facturación en tu nombre ante ARCA y para leer tus cobros si conectás Mercado Pago.
        </p>

        <h2>2. Conexión segura</h2>
        <p>
          Toda la comunicación entre la app, nuestros servidores y ARCA viaja por
          <strong> HTTPS</strong> (conexión cifrada de punta a punta). Nadie en el medio puede
          leer lo que se transmite.
        </p>

        <h2>3. Cada uno ve solo lo suyo</h2>
        <p>
          El acceso a los datos está restringido por usuario: con tu sesión solo podés ver y
          manejar <strong>tu propia información</strong>. Aplicamos reglas de acceso a nivel de
          base de datos para que los datos de una cuenta no sean accesibles desde otra.
        </p>

        <h2>4. Dónde se alojan</h2>
        <p>
          Tus datos se guardan en proveedores de infraestructura reconocidos que actúan como
          procesadores por cuenta nuestra —<strong>Supabase</strong> (base de datos,
          autenticación y archivos), <strong>Vercel</strong> y <strong>Render</strong>
          (alojamiento de la app y del servidor)— con estándares de seguridad de la industria.
          Los PDF de tus comprobantes se almacenan en un espacio privado, accesible solo con
          tu sesión.
        </p>

        <h2>5. Lo que podés hacer vos</h2>
        <ul>
          <li>No compartas tu contraseña ni tu Clave Fiscal con nadie.</li>
          <li>Cerrá sesión si usás un dispositivo prestado o público.</li>
          <li>Podés desconectar ARCA o eliminar tu cuenta cuando quieras desde Configuración.</li>
        </ul>

        <h2>6. Si detectás algo raro</h2>
        <p>
          Ningún sistema es 100% infalible, pero trabajamos para resguardar tus datos y mejorar
          continuamente. Si notás algo inusual en tu cuenta, escribinos cuanto antes a{' '}
          <a href={`mailto:${CONTACTO}`}>{CONTACTO}</a>.
        </p>

        <p className="legal-foot">
          <Link to="/terminos">Términos y Condiciones</Link> ·{' '}
          <Link to="/privacidad">Política de Privacidad</Link> ·{' '}
          <Link to="/aviso-legal">Aviso Legal</Link>
        </p>
      </div>
    </div>
  )
}

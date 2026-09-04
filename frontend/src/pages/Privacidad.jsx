import { Link } from 'react-router-dom'

// Página pública de Política de Privacidad (requisito para publicar el login
// con Google en producción). El nombre del responsable queda como placeholder
// para completar más adelante.
const RESPONSABLE = 'YaFact'
const CONTACTO = 'yafact.ar@gmail.com'
const ACTUALIZADO = '4 de septiembre de 2026'

export default function Privacidad() {
  return (
    <div className="legal">
      <div className="legal-card">
        <Link to="/login" className="legal-volver">← Volver</Link>
        <h1>Política de Privacidad</h1>
        <p className="legal-fecha">Última actualización: {ACTUALIZADO}</p>

        <p>
          Esta Política de Privacidad describe cómo {RESPONSABLE} (“nosotros”)
          recopila, usa y protege tu información cuando usás esta aplicación de
          facturación para monotributistas (“la App”).
        </p>

        <h2>1. Qué datos recopilamos</h2>
        <ul>
          <li><strong>Datos de tu cuenta:</strong> tu dirección de correo electrónico.</li>
          <li>
            <strong>Datos de inicio de sesión con Google:</strong> si entrás con
            Google, recibimos tu correo electrónico y tu nombre de perfil. No
            accedemos a tus contraseñas ni a tu contenido de Google.
          </li>
          <li>
            <strong>Datos fiscales de ARCA (AFIP):</strong> al conectar tu cuenta,
            obtenemos de ARCA tu razón social/nombre, CUIT, domicilio fiscal y
            fecha de inicio de actividades, para completar tus comprobantes.
          </li>
          <li>
            <strong>Clave Fiscal:</strong> se almacena cifrada y se usa
            únicamente para configurar y operar tu facturación electrónica ante
            ARCA en tu nombre.
          </li>
          <li>
            <strong>Mercado Pago (opcional):</strong> si conectás tu cuenta,
            guardamos de forma cifrada los tokens de acceso para leer tus cobros
            entrantes y poder facturarlos.
          </li>
          <li>
            <strong>Comprobantes:</strong> los datos y PDF de las facturas y notas
            de crédito que emitís desde la App.
          </li>
        </ul>

        <h2>2. Para qué usamos tus datos</h2>
        <ul>
          <li>Crear y administrar tu cuenta.</li>
          <li>Emitir tus Facturas C y Notas de Crédito ante ARCA por Web Service.</li>
          <li>Traer tus datos fiscales para que los comprobantes salgan completos.</li>
          <li>Leer tus cobros de Mercado Pago para facturarlos (si lo activás).</li>
          <li>Brindar soporte y mejorar el funcionamiento de la App.</li>
        </ul>
        <p>
          No vendemos tus datos ni los usamos con fines publicitarios.
        </p>

        <h2>3. Dónde se guardan</h2>
        <p>
          Tus datos se alojan en servicios de terceros que actúan como procesadores
          de datos por cuenta nuestra: <strong>Supabase</strong> (base de datos,
          autenticación y almacenamiento de archivos) y <strong>Vercel</strong> y{' '}
          <strong>Render</strong> (alojamiento de la App y del servidor), con
          estándares de seguridad de la industria. Los datos sensibles, como la
          Clave Fiscal y los tokens de Mercado Pago, se guardan cifrados.
        </p>

        <h2>4. Con quién se comparten</h2>
        <p>Compartimos información únicamente cuando es necesario para prestar el servicio:</p>
        <ul>
          <li><strong>ARCA (AFIP):</strong> para emitir y consultar tus comprobantes.</li>
          <li><strong>Mercado Pago:</strong> si conectás tu cuenta, para leer tus cobros.</li>
          <li><strong>Google:</strong> si elegís iniciar sesión con Google.</li>
          <li>
            <strong>Supabase, Vercel y Render:</strong> proveedores de
            infraestructura (base de datos, almacenamiento y alojamiento) que
            actúan como procesadores de datos por cuenta nuestra, bajo obligaciones
            de confidencialidad.
          </li>
        </ul>

        <h2>5. Conservación de los datos</h2>
        <p>
          Conservamos tus datos mientras tengas una cuenta activa y durante el
          tiempo que exijan las obligaciones legales e impositivas. Podés pedir la
          baja de tu cuenta en cualquier momento.
        </p>

        <h2>6. Tus derechos</h2>
        <p>
          Podés solicitar acceder, rectificar o eliminar tus datos personales, o
          dar de baja tu cuenta, escribiéndonos a {CONTACTO}. En el caso de la
          conexión con Google, también podés revocar el acceso desde la
          configuración de tu cuenta de Google.
        </p>

        <h2>7. Seguridad</h2>
        <p>
          Aplicamos medidas razonables para proteger tu información, incluyendo el
          cifrado de credenciales sensibles. Ningún sistema es 100% infalible,
          pero trabajamos para resguardar tus datos.
        </p>

        <h2>8. Cambios</h2>
        <p>
          Podemos actualizar esta política. Publicaremos la versión vigente en esta
          misma página con su fecha de última actualización.
        </p>

        <h2>9. Contacto</h2>
        <p>
          Por cualquier consulta sobre esta política o tus datos, escribinos a{' '}
          <a href={`mailto:${CONTACTO}`}>{CONTACTO}</a>.
        </p>

        <p className="legal-foot">
          <Link to="/terminos">Términos y Condiciones</Link> · <Link to="/login">Iniciar sesión</Link>
        </p>
      </div>
    </div>
  )
}

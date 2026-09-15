import { Link, useNavigate } from 'react-router-dom'

// Página pública de Aviso Legal. Deja en claro que YaFact es una herramienta
// privada e independiente, que NO es ARCA ni un organismo oficial.
const CONTACTO = 'yafact.ar@gmail.com'
const ACTUALIZADO = '15 de septiembre de 2026'

export default function AvisoLegal() {
  const navigate = useNavigate()
  return (
    <div className="legal">
      <div className="legal-card">
        <button type="button" className="legal-volver" onClick={() => navigate(-1)}>
          ← Volver
        </button>
        <h1>Aviso Legal</h1>
        <p className="legal-fecha">Última actualización: {ACTUALIZADO}</p>

        <h2>Sobre YaFact y ARCA</h2>
        <p>
          YaFact es una aplicación desarrollada de forma independiente.{' '}
          <strong>NO representa, NO está afiliada y NO actúa en nombre de ARCA</strong>{' '}
          (ex-AFIP) ni de ningún organismo del Gobierno de la República Argentina.
        </p>

        <h2>Fuente oficial</h2>
        <p>
          La información oficial sobre monotributo, categorías, vencimientos, deudas
          y trámites debe consultarse directamente en el sitio oficial de ARCA:{' '}
          <a href="https://www.arca.gob.ar" target="_blank" rel="noreferrer noopener">
            arca.gob.ar
          </a>
          . YaFact facilita la emisión y gestión de tus comprobantes, pero no origina
          ni modifica esa información.
        </p>

        <h2>Alcance del servicio</h2>
        <p>
          YaFact ofrece herramientas para que los monotributistas emitan sus Facturas
          C y gestionen sus comprobantes, conectándose a los Web Services de ARCA con
          la Clave Fiscal que vos autorizás. Los comprobantes que emitas tienen validez
          fiscal y son de tu exclusiva responsabilidad. Cualquier trámite oficial debe
          verificarse y, en su caso, completarse por los canales oficiales del organismo.
        </p>

        <h2>Marcas</h2>
        <p>
          “ARCA”, “AFIP”, “Mercado Pago” y demás marcas mencionadas pertenecen a sus
          respectivos titulares; su mención es solo a fines descriptivos de la
          interoperabilidad y no implica vínculo, patrocinio ni respaldo alguno.
        </p>

        <h2>Contacto</h2>
        <p>
          Por consultas, escribinos a <a href={`mailto:${CONTACTO}`}>{CONTACTO}</a>.
        </p>

        <p className="legal-foot">
          <Link to="/terminos">Términos y Condiciones</Link> ·{' '}
          <Link to="/privacidad">Política de Privacidad</Link>
        </p>
      </div>
    </div>
  )
}

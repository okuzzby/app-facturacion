// Genera el "Duplicado Electrónico" de un comprobante en el formato exacto de
// ARCA (RG 1361): un ZIP con dos archivos de texto de ancho fijo, CABECERA.txt y
// DETALLE.txt. Es el mismo archivo que ARCA ofrece en "Exportar Duplicados
// Electrónicos (ZIP)" desde Comprobantes en Línea. Reconstruido y verificado
// byte por byte contra archivos reales de ARCA.
//
// Los importes van SIN coma, multiplicados por 100 (dos decimales implícitos).
// El texto se codifica en latin-1 (igual que ARCA).

import { COND_IVA_RECEPTOR } from './validaciones.js'

const soloDigitos = (v) => String(v ?? '').replace(/\D/g, '')

// Cualquier fecha → YYYYMMDD. Acepta ISO (YYYY-MM-DD), YYYYMMDD y DD/MM/YYYY.
function aYYYYMMDD(v) {
  const s = String(v ?? '').trim()
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return m[1] + m[2] + m[3]
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (m) return m[1] + m[2] + m[3]
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (m) return m[3] + m[2] + m[1]
  return soloDigitos(s).slice(0, 8).padEnd(8, '0')
}

// "0001-00000818" → { pv:'0001', nro:'00000818' }. Con fallback al punto de venta.
function partirNumero(numero, pvFallback) {
  const partes = String(numero || '').split('-')
  let pv, nro
  if (partes.length >= 2) {
    pv = soloDigitos(partes[0])
    nro = soloDigitos(partes[1])
  } else {
    pv = soloDigitos(pvFallback)
    nro = soloDigitos(partes[0] || '')
  }
  return { pv: pv.padStart(4, '0').slice(-4), nro: nro.padStart(8, '0').slice(-8) }
}

// Código de tipo de comprobante para el archivo. Factura C = 11, Nota de Crédito C = 13.
function codTipoComprobante(tipo) {
  return /nota de cr/i.test(tipo || '') ? '13' : '11'
}

// Importe × 100 (dos decimales), relleno con ceros a la izquierda hasta `len`.
function imp(x, len) {
  const cents = Math.round(Number(x || 0) * 100)
  return String(cents).padStart(len, '0')
}

// Arma las dos líneas de la CABECERA (registro tipo 1 y tipo 2).
function armarCabecera(d) {
  const total = Number(d.total || 0)
  const r1 =
    '1' +
    d.fecha +
    d.tipo.padStart(2, '0') +
    ' ' +
    d.pv.padStart(4, '0') +
    d.nro.padStart(8, '0') +
    d.nro.padStart(8, '0') +
    '001' +
    d.docTipo.padStart(2, '0') +
    d.docNro.padStart(11, '0') +
    d.razon.slice(0, 30).padEnd(30, ' ') +
    imp(total, 15) +
    '0'.repeat(15) +
    imp(total, 15) +
    '0'.repeat(15) +
    '0'.repeat(105) +
    d.condIva.padStart(2, '0') +
    'PES' +
    '00010000001' +
    ' ' +
    d.cae.padStart(14, '0').slice(-14) +
    d.fchVto +
    ' '.repeat(8)
  const r2 =
    '2' +
    d.fecha.slice(0, 6) +
    ' '.repeat(13) +
    '00000001' +
    ' '.repeat(17) +
    d.cuit.padStart(11, '0') +
    ' '.repeat(22) +
    imp(total, 15) +
    '0'.repeat(15) +
    imp(total, 15) +
    '0'.repeat(105) +
    ' '.repeat(62)
  return r1 + '\r\n' + r2
}

// Arma el DETALLE (una línea por ítem).
function armarDetalle(d, items) {
  return (
    items
      .map((it) => {
        const cant = Number(it.cantidad || 1)
        const pu = Number(it.precioUnit || 0)
        const sub = Math.round(pu * cant * 100) / 100
        return (
          '1' +
          '1' +
          ' ' +
          d.fecha +
          d.pv.padStart(4, '0') +
          d.nro.padStart(8, '0') +
          d.nro.padStart(8, '0') +
          String(cant).padStart(7, '0') +
          '0000007' + // unidad de medida = unidades
          imp(pu, 15) +
          '0'.repeat(15) +
          '0'.repeat(15) +
          imp(sub, 17) +
          '00000' +
          '  ' +
          String(it.descripcion || '').slice(0, 75).padEnd(75, ' ')
        )
      })
      .join('\r\n') + '\r\n'
  )
}

// --- ZIP mínimo (método STORE, sin compresión) sin dependencias externas ---
const CRC_TABLE = (() => {
  const t = new Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function u16(n) {
  const b = Buffer.alloc(2)
  b.writeUInt16LE(n >>> 0, 0)
  return b
}
function u32(n) {
  const b = Buffer.alloc(4)
  b.writeUInt32LE(n >>> 0, 0)
  return b
}

// entries: [{ name, content(string latin1) }]
function crearZip(entries) {
  const files = entries.map((e) => ({ name: Buffer.from(e.name, 'latin1'), data: Buffer.from(e.content, 'latin1') }))
  const locals = []
  const centrals = []
  let offset = 0
  // Fecha/hora DOS fija y válida (2020-01-01 00:00) para salida determinística.
  const dosTime = u16(0)
  const dosDate = u16(((2020 - 1980) << 9) | (1 << 5) | 1)

  for (const f of files) {
    const crc = crc32(f.data)
    const lh = Buffer.concat([
      u32(0x04034b50), // firma local file header
      u16(20), // versión necesaria
      u16(0), // flags
      u16(0), // método = STORE
      dosTime,
      dosDate,
      u32(crc),
      u32(f.data.length), // comprimido
      u32(f.data.length), // sin comprimir
      u16(f.name.length),
      u16(0), // extra len
      f.name,
      f.data,
    ])
    locals.push(lh)
    const cd = Buffer.concat([
      u32(0x02014b50), // firma central directory
      u16(20), // versión que creó
      u16(20), // versión necesaria
      u16(0), // flags
      u16(0), // método
      dosTime,
      dosDate,
      u32(crc),
      u32(f.data.length),
      u32(f.data.length),
      u16(f.name.length),
      u16(0), // extra
      u16(0), // comentario
      u16(0), // disco
      u16(0), // atributos internos
      u32(0), // atributos externos
      u32(offset),
      f.name,
    ])
    centrals.push(cd)
    offset += lh.length
  }

  const centralBuf = Buffer.concat(centrals)
  const localBuf = Buffer.concat(locals)
  const eocd = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralBuf.length),
    u32(localBuf.length),
    u16(0),
  ])
  return Buffer.concat([localBuf, centralBuf, eocd])
}

// Genera el ZIP de duplicado electrónico de una factura ya emitida.
// factura = fila de facturas_emitidas; cred = credenciales_arca del usuario.
// Devuelve { filename, buffer }.
export function generarDuplicadoZip({ factura, cred }) {
  const cuit = soloDigitos(cred.cuit)
  const { pv, nro } = partirNumero(factura.numero, factura.punto_venta)
  const tipo = codTipoComprobante(factura.tipo)

  const docTipo = factura.receptor_doc_tipo ? String(factura.receptor_doc_tipo) : factura.receptor_cuit ? '80' : '99'
  const docNro = factura.receptor_cuit ? soloDigitos(factura.receptor_cuit) : '0'
  const razon = factura.receptor_nombre || 'CONSUMIDOR FINAL'
  const condIva = String(COND_IVA_RECEPTOR[factura.condicion_iva] ?? 5)

  const items =
    Array.isArray(factura.items) && factura.items.length
      ? factura.items
      : [{ descripcion: factura.producto || '', cantidad: factura.cantidad || 1, precioUnit: factura.precio }]

  const d = {
    cuit,
    fecha: aYYYYMMDD(factura.fecha),
    tipo,
    pv,
    nro,
    docTipo,
    docNro,
    razon,
    condIva,
    cae: soloDigitos(factura.cae),
    fchVto: aYYYYMMDD(factura.cae_vto),
    total: Number(factura.importe_total || 0),
  }

  const base = `${cuit}_${tipo.padStart(2, '0')}_${pv.padStart(4, '0')}_${nro.padStart(8, '0')}`
  const cabecera = armarCabecera(d)
  const detalle = armarDetalle(d, items)

  const buffer = crearZip([
    { name: `${base}_CABECERA.txt`, content: cabecera },
    { name: `${base}_DETALLE.txt`, content: detalle },
  ])

  // El nombre del ZIP usa tipo de 3 dígitos y punto de venta de 5 (igual que ARCA).
  const filename = `${cuit}_${tipo.padStart(3, '0')}_${pv.padStart(5, '0')}_${nro.padStart(8, '0')}_DUPLICADOS.zip`
  return { filename, buffer }
}

// Exportado para tests de reproducción byte-a-byte.
export const _internos = { armarCabecera, armarDetalle, crearZip }

// Cifrado en reposo de la clave privada del certificado (AES-256-GCM).
// La clave privada NUNCA se guarda en texto plano ni se devuelve al frontend.
// El secreto está en la env var WS_KEY_ENC_SECRET (32 bytes en base64).
import crypto from 'crypto'

const PREFIJO = 'v1.' // versión del formato, por si rotamos el esquema

// Deriva una clave AES de 32 bytes desde WS_KEY_ENC_SECRET.
// Acepta: base64 (32 bytes), hex (64 chars) o cualquier string (se hashea).
function claveAES() {
  const secret = process.env.WS_KEY_ENC_SECRET
  if (!secret || !String(secret).trim()) {
    throw new Error('Falta WS_KEY_ENC_SECRET en el backend')
  }
  const s = String(secret).trim()
  // ¿base64 que decodifica a 32 bytes exactos?
  try {
    const b = Buffer.from(s, 'base64')
    if (b.length === 32) return b
  } catch {}
  // ¿hex de 64 chars (32 bytes)?
  if (/^[0-9a-fA-F]{64}$/.test(s)) return Buffer.from(s, 'hex')
  // Fallback: derivar 32 bytes determinísticos con SHA-256.
  return crypto.createHash('sha256').update(s, 'utf8').digest()
}

// Cifra un texto (la clave privada PEM). Devuelve un string portable.
// Formato: "v1." + base64( iv(12) | tag(16) | ciphertext ).
export function cifrar(textoPlano) {
  if (textoPlano == null) return null
  const key = claveAES()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(String(textoPlano), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return PREFIJO + Buffer.concat([iv, tag, ct]).toString('base64')
}

// Descifra lo que produjo cifrar(). Devuelve el texto original.
export function descifrar(encApplied) {
  if (encApplied == null) return null
  const s = String(encApplied)
  if (!s.startsWith(PREFIJO)) {
    throw new Error('Formato de clave cifrada desconocido')
  }
  const key = claveAES()
  const raw = Buffer.from(s.slice(PREFIJO.length), 'base64')
  const iv = raw.subarray(0, 12)
  const tag = raw.subarray(12, 28)
  const ct = raw.subarray(28)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
}

// Chequeo rápido de que el secreto está bien configurado (para /health o tests).
export function cryptoWsOk() {
  try {
    const t = 'test-' + 'x'.repeat(40)
    return descifrar(cifrar(t)) === t
  } catch {
    return false
  }
}

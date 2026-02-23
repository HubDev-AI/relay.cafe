import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'

export interface EncryptResult {
  ciphertext: string  // base64(authTag + encrypted)
  iv: string          // base64, 12 bytes
  key: Buffer         // raw 32-byte key (wrap with KMS before storing)
}

export async function encryptMessage(plaintext: string): Promise<EncryptResult> {
  const key = randomBytes(32)
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, key, iv)

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()

  // Store: authTag (16) + encrypted in ciphertext field
  const ciphertext = Buffer.concat([authTag, encrypted]).toString('base64')

  return { ciphertext, iv: iv.toString('base64'), key }
}

export async function decryptMessage(
  ciphertext: string,
  ivBase64: string,
  key: Buffer,
): Promise<string> {
  const iv = Buffer.from(ivBase64, 'base64')
  const data = Buffer.from(ciphertext, 'base64')
  const authTag = data.subarray(0, 16)
  const encrypted = data.subarray(16)

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)

  return Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]).toString('utf8')
}

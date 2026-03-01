import { test, expect, describe } from 'bun:test'
import { wrapKey, unwrapKey } from '../../src/lib/kms'
import { randomBytes } from 'node:crypto'

describe('KMS wrap/unwrap (real GCP KMS)', () => {
  test('round-trip: wrap then unwrap returns identical key', async () => {
    const rawKey = randomBytes(32)
    const { encryptedKey, keyVersion } = await wrapKey(rawKey)
    const decryptedKey = await unwrapKey(encryptedKey, keyVersion)
    expect(Buffer.compare(rawKey, decryptedKey)).toBe(0)
  })

  test('encryptedKey is valid base64', async () => {
    const rawKey = randomBytes(32)
    const { encryptedKey } = await wrapKey(rawKey)
    expect(() => Buffer.from(encryptedKey, 'base64')).not.toThrow()
    expect(Buffer.from(encryptedKey, 'base64').length).toBeGreaterThan(0)
  })

  test('keyVersion contains the KMS key path', async () => {
    const rawKey = randomBytes(32)
    const { keyVersion } = await wrapKey(rawKey)
    expect(keyVersion).toContain('projects/')
    expect(keyVersion).toContain('cryptoKeys/')
  })

  test('different raw keys produce different encrypted keys', async () => {
    const keyA = randomBytes(32)
    const keyB = randomBytes(32)
    const resultA = await wrapKey(keyA)
    const resultB = await wrapKey(keyB)
    expect(resultA.encryptedKey).not.toBe(resultB.encryptedKey)
  })

  test('tampered encrypted key fails unwrap', async () => {
    const rawKey = randomBytes(32)
    const { encryptedKey, keyVersion } = await wrapKey(rawKey)
    const tampered = Buffer.from(encryptedKey, 'base64')
    tampered[10] = tampered[10]! ^ 0xff
    const tamperedB64 = tampered.toString('base64')
    await expect(unwrapKey(tamperedB64, keyVersion)).rejects.toThrow()
  })

  test('full encrypt → wrap → unwrap → decrypt chain', async () => {
    const { encryptMessage, decryptMessage } = await import('../../src/lib/crypto')
    const plaintext = 'KMS end-to-end test'
    const { ciphertext, iv, key } = await encryptMessage(plaintext)
    const { encryptedKey, keyVersion } = await wrapKey(key)
    const unwrapped = await unwrapKey(encryptedKey, keyVersion)
    const decrypted = await decryptMessage(ciphertext, iv, unwrapped)
    expect(decrypted).toBe(plaintext)
  })
})

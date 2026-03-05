import { test, expect, describe } from 'bun:test'
import { encryptMessage, decryptMessage } from '../../src/lib/crypto'
import { randomBytes } from 'node:crypto'

describe('encryptMessage + decryptMessage', () => {
  test('round-trip produces identical plaintext', async () => {
    const plaintext = 'Hello from the relay.'
    const { ciphertext, iv, key } = await encryptMessage(plaintext)
    const result = await decryptMessage(ciphertext, iv, key)
    expect(result).toBe(plaintext)
  })

  test('round-trip with emoji and unicode', async () => {
    const plaintext = '你好世界 🌍 مرحبا'
    const { ciphertext, iv, key } = await encryptMessage(plaintext)
    const result = await decryptMessage(ciphertext, iv, key)
    expect(result).toBe(plaintext)
  })

  test('round-trip with max-length 1000 character message', async () => {
    const plaintext = 'x'.repeat(1000)
    const { ciphertext, iv, key } = await encryptMessage(plaintext)
    const result = await decryptMessage(ciphertext, iv, key)
    expect(result).toBe(plaintext)
  })

  test('round-trip with single character', async () => {
    const plaintext = ' '
    const { ciphertext, iv, key } = await encryptMessage(plaintext)
    const result = await decryptMessage(ciphertext, iv, key)
    expect(result).toBe(plaintext)
  })

  test('different plaintexts produce different ciphertexts', async () => {
    const a = await encryptMessage('message one')
    const b = await encryptMessage('message two')
    expect(a.ciphertext).not.toBe(b.ciphertext)
  })

  test('same plaintext encrypted twice produces different ciphertexts (random IV)', async () => {
    const a = await encryptMessage('identical')
    const b = await encryptMessage('identical')
    expect(a.ciphertext).not.toBe(b.ciphertext)
    expect(a.iv).not.toBe(b.iv)
  })

  test('wrong key fails decryption', async () => {
    const { ciphertext, iv } = await encryptMessage('secret')
    const wrongKey = randomBytes(32)
    await expect(decryptMessage(ciphertext, iv, wrongKey)).rejects.toThrow()
  })

  test('tampered ciphertext fails decryption', async () => {
    const { ciphertext, iv, key } = await encryptMessage('secret')
    const tampered = Buffer.from(ciphertext, 'base64')
    tampered[20] = tampered[20]! ^ 0xff
    const tamperedB64 = tampered.toString('base64')
    await expect(decryptMessage(tamperedB64, iv, key)).rejects.toThrow()
  })

  test('ciphertext is valid base64', async () => {
    const { ciphertext, iv } = await encryptMessage('test')
    expect(() => Buffer.from(ciphertext, 'base64')).not.toThrow()
    expect(() => Buffer.from(iv, 'base64')).not.toThrow()
  })

  test('key is 32 bytes', async () => {
    const { key } = await encryptMessage('test')
    expect(key.length).toBe(32)
  })

  test('IV is 12 bytes (base64-decoded)', async () => {
    const { iv } = await encryptMessage('test')
    expect(Buffer.from(iv, 'base64').length).toBe(12)
  })
})

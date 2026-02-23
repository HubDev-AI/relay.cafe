import { describe, it, expect } from 'bun:test'
import { encryptMessage, decryptMessage } from '../src/lib/crypto'

describe('encryptMessage / decryptMessage', () => {
  it('roundtrips plaintext', async () => {
    const plaintext = 'hello relay'
    const { ciphertext, iv, key } = await encryptMessage(plaintext)
    expect(ciphertext).not.toBe(plaintext)
    const result = await decryptMessage(ciphertext, iv, key)
    expect(result).toBe(plaintext)
  })

  it('produces different ciphertext each time (unique IV)', async () => {
    const { ciphertext: a } = await encryptMessage('same')
    const { ciphertext: b } = await encryptMessage('same')
    expect(a).not.toBe(b)
  })
})

import { describe, it, expect } from 'bun:test'
import { generateToken, hashToken } from '../../src/lib/sessionToken'

describe('Session token helpers', () => {
  it('generateToken returns a 64-char hex string', () => {
    const token = generateToken()
    expect(token).toMatch(/^[0-9a-f]{64}$/)
  })

  it('generateToken returns unique tokens', () => {
    const a = generateToken()
    const b = generateToken()
    expect(a).not.toBe(b)
  })

  it('hashToken returns consistent hash for same input', () => {
    const hash1 = hashToken('abc123')
    const hash2 = hashToken('abc123')
    expect(hash1).toBe(hash2)
  })

  it('hashToken returns different hashes for different inputs', () => {
    const hash1 = hashToken('token-a')
    const hash2 = hashToken('token-b')
    expect(hash1).not.toBe(hash2)
  })

  it('hashToken returns a 64-char hex string', () => {
    const hash = hashToken('any-token')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })
})

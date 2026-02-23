import { describe, it, expect, mock, beforeAll } from 'bun:test'
import { app } from '../src/app'

// Mock Apple verification so tests don't hit external JWKS
mock.module('../src/lib/appleAuth', () => ({
  verifyAppleToken: async (token: string) => {
    if (token === 'valid-token') return { sub: 'apple-user-123' }
    throw new Error('invalid token')
  },
}))

describe('POST /auth/apple', () => {
  it('returns 400 if identityToken missing', async () => {
    const res = await app.request('/auth/apple', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it('returns 401 for invalid Apple token', async () => {
    const res = await app.request('/auth/apple', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identityToken: 'bad-token', deviceFingerprint: 'fp' }),
    })
    expect(res.status).toBe(401)
  })
})

import { test, expect, describe, beforeAll, mock } from 'bun:test'
import { resetDB, createAuthenticatedUser } from '../helpers/db'
import { request, requestJSON, uniqueIP } from '../helpers/http'

// Mock Apple JWT verification before importing app routes
mock.module('../../src/lib/appleAuth', () => ({
  verifyAppleToken: async (token: string) => {
    if (token === 'INVALID') throw new Error('Invalid token')
    // Use the token value as the Apple sub ID for deterministic testing
    return { sub: `apple-${token}`, email: `${token}@test.com` }
  },
}))

describe('POST /v1/auth/apple', () => {
  beforeAll(async () => {
    await resetDB()
  })

  test('valid token creates user and session', async () => {
    const { status, json } = await requestJSON<{ sessionToken: string; expiresAt: number }>('/v1/auth/apple', {
      method: 'POST',
      body: { identityToken: 'user-one' },
    })
    expect(status).toBe(200)
    expect(json!.sessionToken).toMatch(/^[0-9a-f]{64}$/)
    expect(json!.expiresAt).toBeTruthy()
  })

  test('same Apple sub returns same user (upsert)', async () => {
    const r1 = await requestJSON<{ sessionToken: string }>('/v1/auth/apple', {
      method: 'POST',
      body: { identityToken: 'same-user' },
    })
    const r2 = await requestJSON<{ sessionToken: string }>('/v1/auth/apple', {
      method: 'POST',
      body: { identityToken: 'same-user' },
    })
    expect(r1.status).toBe(200)
    expect(r2.status).toBe(200)
    // Different sessions, but the session tokens are different (new session each login)
    expect(r1.json!.sessionToken).not.toBe(r2.json!.sessionToken)
  })

  test('invalid token returns 401', async () => {
    const { status, json } = await requestJSON('/v1/auth/apple', {
      method: 'POST',
      body: { identityToken: 'INVALID' },
    })
    expect(status).toBe(401)
    expect(json).toHaveProperty('error')
  })

  test('missing identityToken returns 400', async () => {
    const { status } = await requestJSON('/v1/auth/apple', {
      method: 'POST',
      body: {},
    })
    expect(status).toBe(400)
  })

  test('non-string identityToken returns 400', async () => {
    const { status } = await requestJSON('/v1/auth/apple', {
      method: 'POST',
      body: { identityToken: 12345 },
    })
    expect(status).toBe(400)
  })

  test('expiresAt is epoch ms ~30 days in the future', async () => {
    const { json } = await requestJSON<{ expiresAt: number }>('/v1/auth/apple', {
      method: 'POST',
      body: { identityToken: 'expiry-check' },
    })
    expect(typeof json!.expiresAt).toBe('number')
    const now = Date.now()
    const thirtyDays = 30 * 24 * 60 * 60 * 1000
    // Allow 5 seconds of clock skew
    expect(json!.expiresAt).toBeGreaterThan(now + thirtyDays - 5000)
    expect(json!.expiresAt).toBeLessThan(now + thirtyDays + 5000)
  })

  test('deviceFingerprint is stored if provided', async () => {
    const { status, json } = await requestJSON<{ sessionToken: string }>('/v1/auth/apple', {
      method: 'POST',
      body: { identityToken: 'fingerprint-user', deviceFingerprint: 'iPhone16,1-18.0-1.0' },
    })
    expect(status).toBe(200)
    expect(json!.sessionToken).toBeTruthy()
  })
})

describe('DELETE /v1/auth/session', () => {
  test('valid session is deleted', async () => {
    await resetDB()
    const auth = await createAuthenticatedUser()
    const res = await request('/v1/auth/session', { method: 'DELETE', token: auth.token })
    expect(res.status).toBe(204)
  })

  test('deleted session no longer authenticates', async () => {
    await resetDB()
    const auth = await createAuthenticatedUser()
    await request('/v1/auth/session', { method: 'DELETE', token: auth.token })
    const { status } = await requestJSON('/v1/me/status', { token: auth.token })
    expect(status).toBe(401)
  })

  test('no auth returns 401', async () => {
    const res = await request('/v1/auth/session', { method: 'DELETE' })
    expect(res.status).toBe(401)
  })
})

describe('POST /v1/auth/apple rate limiting', () => {
  beforeAll(async () => {
    await resetDB()
  })

  test('allows 5 requests from same IP', async () => {
    const ip = uniqueIP()
    for (let i = 0; i < 5; i++) {
      const { status } = await requestJSON('/v1/auth/apple', {
        method: 'POST',
        body: { identityToken: `rate-test-${i}` },
        ip,
      })
      expect(status).toBe(200)
    }
  })

  test('6th request from same IP returns 429', async () => {
    const ip = uniqueIP()
    for (let i = 0; i < 5; i++) {
      await request('/v1/auth/apple', {
        method: 'POST',
        body: { identityToken: `rate-block-${i}` },
        ip,
      })
    }
    const { status } = await requestJSON('/v1/auth/apple', {
      method: 'POST',
      body: { identityToken: 'rate-block-6' },
      ip,
    })
    expect(status).toBe(429)
  })

  test('different IPs are not affected by each other', async () => {
    const ipA = uniqueIP()
    const ipB = uniqueIP()
    // Exhaust IP A
    for (let i = 0; i < 5; i++) {
      await request('/v1/auth/apple', { method: 'POST', body: { identityToken: `a-${i}` }, ip: ipA })
    }
    // IP B should still work
    const { status } = await requestJSON('/v1/auth/apple', {
      method: 'POST',
      body: { identityToken: 'b-1' },
      ip: ipB,
    })
    expect(status).toBe(200)
  })
})

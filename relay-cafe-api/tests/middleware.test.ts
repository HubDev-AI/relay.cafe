import { describe, it, expect } from 'bun:test'
import { Hono } from 'hono'

// We test that protected routes reject missing/invalid tokens.
// The middleware reads Bearer token from Authorization header,
// looks it up in sessions table, attaches userId to context.

describe('auth middleware', () => {
  it('returns 401 with no Authorization header', async () => {
    const { authMiddleware } = await import('../src/middleware/auth')
    const app = new Hono()
    app.use('*', authMiddleware)
    app.get('/protected', (c) => c.json({ ok: true }))

    const res = await app.request('/protected')
    expect(res.status).toBe(401)
  })
})

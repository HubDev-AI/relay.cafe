import { describe, it, expect } from 'bun:test'
import { Hono } from 'hono'

describe('IP rate limit', () => {
  it('returns 429 after 5 attempts from same IP', async () => {
    const { ipRateLimit } = await import('../src/middleware/rateLimit')
    const app = new Hono()
    app.use('*', ipRateLimit({ maxRequests: 5, windowMs: 60_000 }))
    app.post('/test', (c) => c.json({ ok: true }))

    for (let i = 0; i < 5; i++) {
      await app.request('/test', { method: 'POST', headers: { 'X-Forwarded-For': '1.2.3.4' } })
    }

    const res = await app.request('/test', {
      method: 'POST',
      headers: { 'X-Forwarded-For': '1.2.3.4' },
    })
    expect(res.status).toBe(429)
  })
})

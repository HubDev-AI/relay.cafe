import { describe, it, expect } from 'bun:test'
import { Hono } from 'hono'
import { createRateLimitMiddleware } from '../../src/middleware/rateLimit'
import { InMemoryRateLimiter } from '../../src/lib/adapters/inMemoryRateLimiter'
import type { IRateLimiter, RateLimitResult, RateLimitTier } from '../../src/lib/interfaces/rateLimiter'

describe('Rate limit middleware', () => {
  it('passes requests under the limit', async () => {
    const limiter = new InMemoryRateLimiter()
    const app = new Hono()
    app.use('*', createRateLimitMiddleware(limiter, 'global'))
    app.get('/test', (c) => c.json({ ok: true }))

    const res = await app.request('/test', {
      headers: { 'X-Forwarded-For': '1.2.3.4' },
    })
    expect(res.status).toBe(200)
  })

  it('returns 429 with Retry-After header when limit exceeded', async () => {
    const limiter = new InMemoryRateLimiter()
    const app = new Hono()
    app.use('*', createRateLimitMiddleware(limiter, 'global'))
    app.get('/test', (c) => c.json({ ok: true }))

    for (let i = 0; i < 60; i++) {
      await app.request('/test', {
        headers: { 'X-Forwarded-For': '1.2.3.4' },
      })
    }

    const res = await app.request('/test', {
      headers: { 'X-Forwarded-For': '1.2.3.4' },
    })
    expect(res.status).toBe(429)
    const body = await res.json()
    expect(body.error).toBe('Please try again later.')
    expect(res.headers.get('Retry-After')).toBeTruthy()
  })

  it('returns 429 after 5 auth-tier requests', async () => {
    const limiter = new InMemoryRateLimiter()
    const app = new Hono()
    app.use('*', createRateLimitMiddleware(limiter, 'auth'))
    app.post('/test', (c) => c.json({ ok: true }))

    for (let i = 0; i < 5; i++) {
      await app.request('/test', {
        method: 'POST',
        headers: { 'X-Forwarded-For': '1.2.3.4' },
      })
    }

    const res = await app.request('/test', {
      method: 'POST',
      headers: { 'X-Forwarded-For': '1.2.3.4' },
    })
    expect(res.status).toBe(429)
  })

  it('fails open when limiter throws', async () => {
    const brokenLimiter: IRateLimiter = {
      check: async (): Promise<RateLimitResult> => {
        throw new Error('Redis connection refused')
      },
    }
    const app = new Hono()
    app.use('*', createRateLimitMiddleware(brokenLimiter, 'global'))
    app.get('/test', (c) => c.json({ ok: true }))

    const res = await app.request('/test', {
      headers: { 'X-Forwarded-For': '1.2.3.4' },
    })
    expect(res.status).toBe(200)
  })
})

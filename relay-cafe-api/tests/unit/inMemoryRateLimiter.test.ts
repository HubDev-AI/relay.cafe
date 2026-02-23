import { describe, it, expect } from 'bun:test'
import { InMemoryRateLimiter } from '../../src/lib/adapters/inMemoryRateLimiter'

describe('InMemoryRateLimiter', () => {
  it('allows requests under the global limit', async () => {
    const limiter = new InMemoryRateLimiter()
    const result = await limiter.check('ip-1', 'global')
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBeGreaterThan(0)
  })

  it('blocks requests over the global limit', async () => {
    const limiter = new InMemoryRateLimiter()
    for (let i = 0; i < 60; i++) {
      await limiter.check('ip-1', 'global')
    }
    const result = await limiter.check('ip-1', 'global')
    expect(result.allowed).toBe(false)
    expect(result.remaining).toBe(0)
  })

  it('applies stricter auth tier limits', async () => {
    const limiter = new InMemoryRateLimiter()
    for (let i = 0; i < 5; i++) {
      await limiter.check('ip-1', 'auth')
    }
    const result = await limiter.check('ip-1', 'auth')
    expect(result.allowed).toBe(false)
  })

  it('applies messages tier limits', async () => {
    const limiter = new InMemoryRateLimiter()
    for (let i = 0; i < 20; i++) {
      await limiter.check('ip-1', 'messages')
    }
    const result = await limiter.check('ip-1', 'messages')
    expect(result.allowed).toBe(false)
  })

  it('tracks different keys independently', async () => {
    const limiter = new InMemoryRateLimiter()
    for (let i = 0; i < 60; i++) {
      await limiter.check('ip-1', 'global')
    }
    const result = await limiter.check('ip-2', 'global')
    expect(result.allowed).toBe(true)
  })

  it('provides resetAt in the future', async () => {
    const limiter = new InMemoryRateLimiter()
    const result = await limiter.check('ip-1', 'global')
    expect(result.resetAt).toBeGreaterThan(Date.now())
  })
})

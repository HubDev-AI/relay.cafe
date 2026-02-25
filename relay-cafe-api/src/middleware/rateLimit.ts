import type { Context, Next } from 'hono'
import { createHash } from 'node:crypto'
import type { IRateLimiter, RateLimitTier } from '../lib/interfaces/rateLimiter'
import { captureError } from '../lib/logger'

export function createRateLimitMiddleware(limiter: IRateLimiter, tier: RateLimitTier) {
  return async (c: Context, next: Next) => {
    const ip = c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ?? 'unknown'
    const key = createHash('sha256').update(ip).digest('hex')

    try {
      const result = await limiter.check(key, tier)

      if (!result.allowed) {
        const retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000)
        c.header('Retry-After', String(Math.max(retryAfter, 1)))
        return c.json({ error: 'Please try again later.' }, 429)
      }
    } catch (err) {
      // Fail open: if Redis is down or slow, let the request through
      captureError(err, { source: 'rate-limiter', tier })
    }

    return next()
  }
}

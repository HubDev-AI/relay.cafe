import type { IRateLimiter } from './interfaces/rateLimiter'
import { InMemoryRateLimiter } from './adapters/inMemoryRateLimiter'
import { UpstashRateLimiter } from './adapters/upstashRateLimiter'

export const rateLimiter: IRateLimiter = process.env.UPSTASH_REDIS_REST_URL
  ? new UpstashRateLimiter()
  : (() => {
      if (process.env.NODE_ENV === 'production') {
        console.warn('[container] UPSTASH_REDIS_REST_URL not set — using in-memory rate limiter')
      }
      return new InMemoryRateLimiter()
    })()

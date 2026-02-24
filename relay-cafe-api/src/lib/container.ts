import type { IRateLimiter } from './interfaces/rateLimiter'
import { InMemoryRateLimiter } from './adapters/inMemoryRateLimiter'
import { RedisRateLimiter } from './adapters/redisRateLimiter'

export const rateLimiter: IRateLimiter = process.env.REDIS_URL
  ? new RedisRateLimiter(process.env.REDIS_URL)
  : (() => {
      if (process.env.NODE_ENV === 'production') {
        console.warn('[container] REDIS_URL not set — using in-memory rate limiter')
      }
      return new InMemoryRateLimiter()
    })()

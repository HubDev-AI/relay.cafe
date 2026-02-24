import type { IRateLimiter, RateLimitResult, RateLimitTier } from '../interfaces/rateLimiter'

const TIER_CONFIG: Record<RateLimitTier, { maxRequests: number; windowMs: number }> = {
  global: { maxRequests: 60, windowMs: 60_000 },
  auth: { maxRequests: 5, windowMs: 3_600_000 },
  messages: { maxRequests: 20, windowMs: 60_000 },
}

export class RedisRateLimiter implements IRateLimiter {
  private redis: import('bun').RedisClient

  constructor(redisUrl: string) {
    this.redis = new Bun.RedisClient(redisUrl)
  }

  async check(key: string, tier: RateLimitTier): Promise<RateLimitResult> {
    const { maxRequests, windowMs } = TIER_CONFIG[tier]
    const redisKey = `rl:${tier}:${key}`
    const now = Date.now()
    const windowStart = now - windowMs
    const member = `${now}:${Math.random().toString(36).slice(2, 8)}`

    // Sorted set sliding window: remove old, add new, count
    await this.redis.send('ZREMRANGEBYSCORE', [redisKey, '0', String(windowStart)])
    await this.redis.send('ZADD', [redisKey, String(now), member])
    await this.redis.send('PEXPIRE', [redisKey, String(windowMs)])
    const count = Number(await this.redis.send('ZCARD', [redisKey]))

    if (count > maxRequests) {
      // Over limit — remove the entry we just added
      await this.redis.send('ZREM', [redisKey, member])
      return { allowed: false, remaining: 0, resetAt: now + windowMs }
    }

    return {
      allowed: true,
      remaining: maxRequests - count,
      resetAt: now + windowMs,
    }
  }
}

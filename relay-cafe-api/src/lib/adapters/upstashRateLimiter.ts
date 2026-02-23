import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import type { IRateLimiter, RateLimitResult, RateLimitTier } from '../interfaces/rateLimiter'

export class UpstashRateLimiter implements IRateLimiter {
  private limiters: Record<RateLimitTier, Ratelimit>

  constructor() {
    const redis = Redis.fromEnv()
    this.limiters = {
      global: new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(60, '60 s'),
        prefix: 'rl:global',
      }),
      auth: new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(5, '3600 s'),
        prefix: 'rl:auth',
      }),
      messages: new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(20, '60 s'),
        prefix: 'rl:messages',
      }),
    }
  }

  async check(key: string, tier: RateLimitTier): Promise<RateLimitResult> {
    const result = await this.limiters[tier].limit(key)
    return {
      allowed: result.success,
      remaining: result.remaining,
      resetAt: result.reset,
    }
  }
}

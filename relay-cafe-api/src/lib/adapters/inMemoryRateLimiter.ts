import type { IRateLimiter, RateLimitResult, RateLimitTier } from '../interfaces/rateLimiter'

const TIER_CONFIG: Record<RateLimitTier, { maxRequests: number; windowMs: number }> = {
  global: { maxRequests: 60, windowMs: 60_000 },
  auth: { maxRequests: 5, windowMs: 3_600_000 },
  messages: { maxRequests: 20, windowMs: 60_000 },
}

export class InMemoryRateLimiter implements IRateLimiter {
  private store = new Map<string, number[]>()
  private cleanupInterval: ReturnType<typeof setInterval>

  constructor() {
    this.cleanupInterval = setInterval(() => this.cleanup(), 120_000)
    this.cleanupInterval.unref()
  }

  private cleanup() {
    const now = Date.now()
    for (const [key, timestamps] of this.store) {
      const valid = timestamps.filter((t) => now - t < 3_600_000)
      if (valid.length === 0) {
        this.store.delete(key)
      } else {
        this.store.set(key, valid)
      }
    }
  }

  async check(key: string, tier: RateLimitTier): Promise<RateLimitResult> {
    const { maxRequests, windowMs } = TIER_CONFIG[tier]
    const compositeKey = `${tier}:${key}`
    const now = Date.now()
    const timestamps = (this.store.get(compositeKey) ?? []).filter((t) => now - t < windowMs)

    if (timestamps.length >= maxRequests) {
      const resetAt = timestamps[0] + windowMs
      return { allowed: false, remaining: 0, resetAt }
    }

    timestamps.push(now)
    this.store.set(compositeKey, timestamps)

    return {
      allowed: true,
      remaining: maxRequests - timestamps.length,
      resetAt: now + windowMs,
    }
  }
}

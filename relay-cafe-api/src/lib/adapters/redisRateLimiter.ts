import type { IRateLimiter, RateLimitResult, RateLimitTier } from '../interfaces/rateLimiter'

const TIER_CONFIG: Record<RateLimitTier, { maxRequests: number; windowMs: number }> = {
  global: { maxRequests: 60, windowMs: 60_000 },
  auth: { maxRequests: 5, windowMs: 3_600_000 },
  messages: { maxRequests: 20, windowMs: 60_000 },
}

// Single Lua script = single Redis round trip instead of 4-5 sequential calls
const RATE_LIMIT_SCRIPT = `
local key = KEYS[1]
local window_start = tonumber(ARGV[1])
local now = tonumber(ARGV[2])
local window_ms = tonumber(ARGV[3])
local max_requests = tonumber(ARGV[4])
local member = ARGV[5]

redis.call('ZREMRANGEBYSCORE', key, '0', window_start)
redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, window_ms)
local count = redis.call('ZCARD', key)

if count > max_requests then
  redis.call('ZREM', key, member)
  return -1
end

return max_requests - count
`

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

    const remaining = Number(
      await this.redis.send('EVAL', [
        RATE_LIMIT_SCRIPT,
        '1',
        redisKey,
        String(windowStart),
        String(now),
        String(windowMs),
        String(maxRequests),
        member,
      ]),
    )

    if (remaining < 0) {
      return { allowed: false, remaining: 0, resetAt: now + windowMs }
    }

    return { allowed: true, remaining, resetAt: now + windowMs }
  }
}

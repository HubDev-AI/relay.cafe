# Redis Switch: Upstash to Railway Redis Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace Upstash Redis (REST-based) with Railway Redis (TCP-based) using Bun's built-in Redis client.

**Architecture:** New `RedisRateLimiter` adapter using `Bun.RedisClient` with sorted-set sliding window. Swaps into existing `IRateLimiter` interface. InMemory fallback kept for local dev without Redis.

**Tech Stack:** Bun.RedisClient (built-in), Redis sorted sets for sliding window

---

### Task 1: Create RedisRateLimiter adapter

**Files:**
- Create: `src/lib/adapters/redisRateLimiter.ts`

**Step 1: Write the adapter**

```ts
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
```

### Task 2: Update container.ts

**Files:**
- Modify: `src/lib/container.ts`

Switch from `UPSTASH_REDIS_REST_URL` to `REDIS_URL`:

```ts
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
```

### Task 3: Delete Upstash adapter and remove dependencies

**Files:**
- Delete: `src/lib/adapters/upstashRateLimiter.ts`
- Modify: `package.json` — remove `@upstash/ratelimit` and `@upstash/redis`

### Task 4: Update env config files

**Files:**
- Modify: `.env.example` — replace Upstash vars with `REDIS_URL`
- Modify: `docker-compose.yml` — update API service env vars

### Task 5: Commit and push

```bash
git add -A && git commit -m "feat: switch from Upstash Redis to Bun.RedisClient for rate limiting"
```

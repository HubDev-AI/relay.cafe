# Rate Limiting, Session Token Security & Cleanup — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace in-memory rate limiting with Upstash Redis (sliding window, 3 tiers), harden session tokens with HMAC-SHA256 hashed storage, and clean up dead code.

**Architecture:** Interface-based rate limiter (`IRateLimiter`) with Upstash production adapter and in-memory dev fallback, wired via DI container. Session tokens become opaque random hex strings; only their HMAC hash is stored in the DB. Dead `ip_events` table dropped.

**Tech Stack:** `@upstash/ratelimit`, `@upstash/redis`, `node:crypto` (HMAC-SHA256, randomBytes), Hono middleware, Drizzle ORM, `bun test`, Docker Compose (local Redis)

---

### Task 1: Install Dependencies

**Files:**
- Modify: `relay-cafe-api/package.json`

**Step 1: Install Upstash packages**

```bash
cd relay-cafe-api && bun add @upstash/ratelimit @upstash/redis
```

**Step 2: Verify installation**

```bash
cd relay-cafe-api && bun run -e "import { Ratelimit } from '@upstash/ratelimit'; import { Redis } from '@upstash/redis'; console.log('OK')"
```

Expected: `OK`

**Step 3: Commit**

```bash
git add relay-cafe-api/package.json relay-cafe-api/bun.lock
git commit -m "deps: add @upstash/ratelimit and @upstash/redis"
```

---

### Task 2: Create IRateLimiter Interface

**Files:**
- Create: `relay-cafe-api/src/lib/interfaces/rateLimiter.ts`

**Step 1: Write the interface**

```typescript
// relay-cafe-api/src/lib/interfaces/rateLimiter.ts
export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: number // epoch ms
}

export type RateLimitTier = 'global' | 'auth' | 'messages'

export interface IRateLimiter {
  check(key: string, tier: RateLimitTier): Promise<RateLimitResult>
}
```

**Step 2: Commit**

```bash
git add relay-cafe-api/src/lib/interfaces/rateLimiter.ts
git commit -m "feat: add IRateLimiter interface with tier support"
```

---

### Task 3: Create InMemoryRateLimiter Adapter

**Files:**
- Create: `relay-cafe-api/src/lib/adapters/inMemoryRateLimiter.ts`
- Create: `relay-cafe-api/tests/unit/inMemoryRateLimiter.test.ts`

**Step 1: Write the failing tests**

```typescript
// relay-cafe-api/tests/unit/inMemoryRateLimiter.test.ts
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
```

**Step 2: Run tests to verify they fail**

```bash
cd relay-cafe-api && bun test tests/unit/inMemoryRateLimiter.test.ts
```

Expected: FAIL — module not found

**Step 3: Write the implementation**

```typescript
// relay-cafe-api/src/lib/adapters/inMemoryRateLimiter.ts
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
      // Use the longest window (auth = 1hr) for cleanup
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
```

**Step 4: Run tests to verify they pass**

```bash
cd relay-cafe-api && bun test tests/unit/inMemoryRateLimiter.test.ts
```

Expected: All 6 tests PASS

**Step 5: Commit**

```bash
git add relay-cafe-api/src/lib/adapters/inMemoryRateLimiter.ts relay-cafe-api/tests/unit/inMemoryRateLimiter.test.ts
git commit -m "feat: add InMemoryRateLimiter with sliding window and tier support"
```

---

### Task 4: Create UpstashRateLimiter Adapter

**Files:**
- Create: `relay-cafe-api/src/lib/adapters/upstashRateLimiter.ts`

**Step 1: Write the implementation**

```typescript
// relay-cafe-api/src/lib/adapters/upstashRateLimiter.ts
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
```

**Step 2: Commit**

```bash
git add relay-cafe-api/src/lib/adapters/upstashRateLimiter.ts
git commit -m "feat: add UpstashRateLimiter adapter with 3-tier sliding window"
```

Note: No unit test for Upstash adapter — it wraps the `@upstash/ratelimit` library directly. Tested via integration when docker-compose is running.

---

### Task 5: Create DI Container

**Files:**
- Create: `relay-cafe-api/src/lib/container.ts`

**Step 1: Write the container**

```typescript
// relay-cafe-api/src/lib/container.ts
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
```

**Step 2: Commit**

```bash
git add relay-cafe-api/src/lib/container.ts
git commit -m "feat: add DI container with Upstash/in-memory rate limiter selection"
```

---

### Task 6: Rewrite Rate Limit Middleware

**Files:**
- Modify: `relay-cafe-api/src/middleware/rateLimit.ts` (replace entirely)
- Create: `relay-cafe-api/tests/unit/rateLimitMiddleware.test.ts`

**Step 1: Write the failing tests**

```typescript
// relay-cafe-api/tests/unit/rateLimitMiddleware.test.ts
import { describe, it, expect } from 'bun:test'
import { Hono } from 'hono'
import { createRateLimitMiddleware } from '../../src/middleware/rateLimit'
import { InMemoryRateLimiter } from '../../src/lib/adapters/inMemoryRateLimiter'

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
})
```

**Step 2: Run tests to verify they fail**

```bash
cd relay-cafe-api && bun test tests/unit/rateLimitMiddleware.test.ts
```

Expected: FAIL — `createRateLimitMiddleware` not found

**Step 3: Replace the middleware**

Replace the entire contents of `relay-cafe-api/src/middleware/rateLimit.ts`:

```typescript
// relay-cafe-api/src/middleware/rateLimit.ts
import type { Context, Next } from 'hono'
import { createHash } from 'node:crypto'
import type { IRateLimiter, RateLimitTier } from '../lib/interfaces/rateLimiter'

export function createRateLimitMiddleware(limiter: IRateLimiter, tier: RateLimitTier) {
  return async (c: Context, next: Next) => {
    const ip = c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ?? 'unknown'
    const key = createHash('sha256').update(ip).digest('hex')

    const result = await limiter.check(key, tier)

    if (!result.allowed) {
      const retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000)
      c.header('Retry-After', String(Math.max(retryAfter, 1)))
      return c.json({ error: 'Please try again later.' }, 429)
    }

    return next()
  }
}
```

**Step 4: Run tests to verify they pass**

```bash
cd relay-cafe-api && bun test tests/unit/rateLimitMiddleware.test.ts
```

Expected: All 3 tests PASS

**Step 5: Commit**

```bash
git add relay-cafe-api/src/middleware/rateLimit.ts relay-cafe-api/tests/unit/rateLimitMiddleware.test.ts
git commit -m "feat: rewrite rate limit middleware to use IRateLimiter interface"
```

---

### Task 7: Wire Rate Limiting Into App

**Files:**
- Modify: `relay-cafe-api/src/app.ts:1-42`
- Modify: `relay-cafe-api/src/routes/auth.ts:8,20`
- Modify: `relay-cafe-api/src/routes/messages.ts:1-12`

**Step 1: Add global rate limit to app.ts**

In `relay-cafe-api/src/app.ts`, add imports and global middleware after the security headers middleware (after line 27):

```typescript
// Add to imports (top of file):
import { createRateLimitMiddleware } from './middleware/rateLimit'
import { rateLimiter } from './lib/container'

// Add after the security headers middleware (after line 27):
app.use('*', createRateLimitMiddleware(rateLimiter, 'global'))
```

**Step 2: Update auth.ts to use new middleware**

In `relay-cafe-api/src/routes/auth.ts`:

Replace line 8:
```typescript
import { ipRateLimit } from '../middleware/rateLimit'
```
with:
```typescript
import { createRateLimitMiddleware } from '../middleware/rateLimit'
import { rateLimiter } from '../lib/container'
```

Replace line 20:
```typescript
  ipRateLimit({ maxRequests: 5, windowMs: 60 * 60 * 1000 }),
```
with:
```typescript
  createRateLimitMiddleware(rateLimiter, 'auth'),
```

**Step 3: Add messages tier rate limit**

In `relay-cafe-api/src/routes/messages.ts`, add imports after line 8:

```typescript
import { createRateLimitMiddleware } from '../middleware/rateLimit'
import { rateLimiter } from '../lib/container'
```

Add middleware before the route handler on line 13. Change:
```typescript
messagesRouter.post('/', async (c) => {
```
to:
```typescript
messagesRouter.post('/', createRateLimitMiddleware(rateLimiter, 'messages'), async (c) => {
```

And change (around line 87):
```typescript
messagesRouter.get('/today', async (c) => {
```
to:
```typescript
messagesRouter.get('/today', createRateLimitMiddleware(rateLimiter, 'messages'), async (c) => {
```

**Step 4: Run existing tests to verify nothing broke**

```bash
cd relay-cafe-api && bun test tests/unit/
```

Expected: All unit tests PASS

**Step 5: Delete old rate limit test**

The old `tests/rateLimit.test.ts` tests the removed `ipRateLimit` function. Delete it — the new tests in `tests/unit/rateLimitMiddleware.test.ts` replace it.

```bash
rm relay-cafe-api/tests/rateLimit.test.ts
```

**Step 6: Commit**

```bash
git add relay-cafe-api/src/app.ts relay-cafe-api/src/routes/auth.ts relay-cafe-api/src/routes/messages.ts
git add -u relay-cafe-api/tests/rateLimit.test.ts
git commit -m "feat: wire Upstash rate limiting into all routes with 3 tiers"
```

---

### Task 8: Add docker-compose.yml for Local Redis

**Files:**
- Create: `relay-cafe-api/docker-compose.yml`

**Step 1: Write docker-compose.yml**

```yaml
# relay-cafe-api/docker-compose.yml
# Local Redis with Upstash-compatible REST proxy.
# Usage: docker compose up -d
# Then add to .env:
#   UPSTASH_REDIS_REST_URL=http://localhost:8079
#   UPSTASH_REDIS_REST_TOKEN=local-token
services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
  redis-rest:
    image: hiett/serverless-redis-http:latest
    ports:
      - "8079:80"
    environment:
      SRH_MODE: env
      SRH_TOKEN: local-token
      REDIS_URL: redis://redis:6379
    depends_on:
      - redis
```

**Step 2: Update .env.example**

Add to the end of `relay-cafe-api/.env.example`:

```
# Upstash Redis for rate limiting. Leave empty to use in-memory fallback.
# For local testing with docker-compose: UPSTASH_REDIS_REST_URL=http://localhost:8079
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

**Step 3: Commit**

```bash
git add relay-cafe-api/docker-compose.yml relay-cafe-api/.env.example
git commit -m "feat: add docker-compose for local Redis + update .env.example"
```

---

### Task 9: Drop ip_events Dead Code

**Files:**
- Modify: `relay-cafe-api/src/db/schema.ts:36-45` (remove ipEvents table)
- Modify: `relay-cafe-api/tests/integration/cleanup-sql.test.ts` (if it references ipEvents)

**Step 1: Check what references ipEvents**

Search for `ipEvents` or `ip_events` in tests and application code. The schema export and any test cleanup code that does `DELETE FROM ip_events` need to be updated.

**Step 2: Remove ipEvents from schema.ts**

Delete lines 36-45 of `relay-cafe-api/src/db/schema.ts` (the entire `ipEvents` table definition and its TODO comment). Also remove the `index` import from line 1 if it's only used by ipEvents.

After removal, line 1 should be:
```typescript
import { pgTable, uuid, text, bigint, boolean, timestamp, primaryKey } from 'drizzle-orm/pg-core'
```

(Remove `index` from the import since it's no longer used.)

**Step 3: Generate and apply migration**

```bash
cd relay-cafe-api && bunx drizzle-kit generate --name drop-ip-events
```

Review the generated SQL — it should contain `DROP TABLE ip_events` and `DROP INDEX ip_events_ip_hash_event_type_created_at_idx`. If Drizzle doesn't generate a DROP (it may not for table removals), create a manual migration file with:

```sql
DROP TABLE IF EXISTS ip_events;
```

**Step 4: Run tests**

```bash
cd relay-cafe-api && bun test tests/unit/
```

Expected: PASS

**Step 5: Commit**

```bash
git add relay-cafe-api/src/db/schema.ts relay-cafe-api/drizzle/
git commit -m "chore: drop unused ip_events table and generate migration"
```

---

### Task 10: Add token_hash Column to Sessions Schema

**Files:**
- Modify: `relay-cafe-api/src/db/schema.ts:9-15`

**Step 1: Update sessions table schema**

In `relay-cafe-api/src/db/schema.ts`, replace the sessions table definition:

```typescript
export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  deviceFingerprint: text('device_fingerprint'),
})
```

The key change: added `tokenHash: text('token_hash').notNull().unique()`.

**Step 2: Generate migration**

```bash
cd relay-cafe-api && bunx drizzle-kit generate --name add-session-token-hash
```

Review the generated SQL — it should contain `ALTER TABLE sessions ADD COLUMN token_hash TEXT NOT NULL UNIQUE`. Since there are no live users, this is safe.

**Step 3: Commit**

```bash
git add relay-cafe-api/src/db/schema.ts relay-cafe-api/drizzle/
git commit -m "feat: add token_hash column to sessions for HMAC-based auth"
```

---

### Task 11: Create Session Token Helper

**Files:**
- Create: `relay-cafe-api/src/lib/sessionToken.ts`
- Create: `relay-cafe-api/tests/unit/sessionToken.test.ts`

**Step 1: Write the failing tests**

```typescript
// relay-cafe-api/tests/unit/sessionToken.test.ts
import { describe, it, expect } from 'bun:test'

describe('Session token helpers', () => {
  it('generateToken returns a 64-char hex string', async () => {
    const { generateToken } = await import('../../src/lib/sessionToken')
    const token = generateToken()
    expect(token).toMatch(/^[0-9a-f]{64}$/)
  })

  it('generateToken returns unique tokens', async () => {
    const { generateToken } = await import('../../src/lib/sessionToken')
    const a = generateToken()
    const b = generateToken()
    expect(a).not.toBe(b)
  })

  it('hashToken returns consistent hash for same input', async () => {
    const { hashToken } = await import('../../src/lib/sessionToken')
    const hash1 = hashToken('abc123')
    const hash2 = hashToken('abc123')
    expect(hash1).toBe(hash2)
  })

  it('hashToken returns different hashes for different inputs', async () => {
    const { hashToken } = await import('../../src/lib/sessionToken')
    const hash1 = hashToken('token-a')
    const hash2 = hashToken('token-b')
    expect(hash1).not.toBe(hash2)
  })

  it('hashToken returns a 64-char hex string', async () => {
    const { hashToken } = await import('../../src/lib/sessionToken')
    const hash = hashToken('any-token')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })
})
```

**Step 2: Run tests to verify they fail**

```bash
cd relay-cafe-api && bun test tests/unit/sessionToken.test.ts
```

Expected: FAIL — module not found

**Step 3: Write the implementation**

```typescript
// relay-cafe-api/src/lib/sessionToken.ts
import { randomBytes, createHmac } from 'node:crypto'

const SESSION_SALT = process.env.SESSION_SALT
if (!SESSION_SALT) {
  throw new Error('SESSION_SALT environment variable is required')
}

export function generateToken(): string {
  return randomBytes(32).toString('hex')
}

export function hashToken(rawToken: string): string {
  return createHmac('sha256', SESSION_SALT).update(rawToken).digest('hex')
}
```

**Step 4: Run tests to verify they pass**

```bash
cd relay-cafe-api && bun test tests/unit/sessionToken.test.ts
```

Expected: All 5 tests PASS (SESSION_SALT is loaded from .env by Bun automatically)

**Step 5: Commit**

```bash
git add relay-cafe-api/src/lib/sessionToken.ts relay-cafe-api/tests/unit/sessionToken.test.ts
git commit -m "feat: add session token generation and HMAC hashing helpers"
```

---

### Task 12: Update Auth Route to Use Hashed Tokens

**Files:**
- Modify: `relay-cafe-api/src/routes/auth.ts:1-73`

**Step 1: Update the auth route**

In `relay-cafe-api/src/routes/auth.ts`:

Add import at top:
```typescript
import { generateToken, hashToken } from '../lib/sessionToken'
```

In the `/apple` handler, replace the session creation block (lines 48-58):

Old:
```typescript
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      const [session] = await tx
        .insert(sessions)
        .values({
          userId: user.id,
          expiresAt,
          deviceFingerprint: body.deviceFingerprint ?? null,
        })
        .returning()
      if (!session) return null

      return { sessionToken: session.id, expiresAt: expiresAt.getTime() }
```

New:
```typescript
      const rawToken = generateToken()
      const tokenHash = hashToken(rawToken)
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      const [session] = await tx
        .insert(sessions)
        .values({
          userId: user.id,
          tokenHash,
          expiresAt,
          deviceFingerprint: body.deviceFingerprint ?? null,
        })
        .returning()
      if (!session) return null

      return { sessionToken: rawToken, expiresAt: expiresAt.getTime() }
```

In the `DELETE /session` handler (lines 69-73), replace:

Old:
```typescript
authRouter.delete('/session', authMiddleware, async (c) => {
  const sessionId = c.req.header('Authorization')!.slice(7)
  await db.delete(sessions).where(eq(sessions.id, sessionId))
  return c.body(null, 204)
})
```

New:
```typescript
authRouter.delete('/session', authMiddleware, async (c) => {
  const rawToken = c.req.header('Authorization')!.slice(7)
  const tokenHash = hashToken(rawToken)
  await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash))
  return c.body(null, 204)
})
```

**Step 2: Commit**

```bash
git add relay-cafe-api/src/routes/auth.ts
git commit -m "feat: generate opaque session tokens with HMAC hash storage"
```

---

### Task 13: Update Auth Middleware to Use Hashed Lookup

**Files:**
- Modify: `relay-cafe-api/src/middleware/auth.ts:1-35`

**Step 1: Rewrite auth middleware**

Replace entire contents of `relay-cafe-api/src/middleware/auth.ts`:

```typescript
import type { Context, Next } from 'hono'
import { db } from '../db'
import { sessions } from '../db/schema'
import { eq } from 'drizzle-orm'
import { hashToken } from '../lib/sessionToken'

const HEX_64_RE = /^[0-9a-f]{64}$/

export async function authMiddleware(c: Context, next: Next) {
  const header = c.req.header('Authorization')
  if (!header?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const rawToken = header.slice(7)

  // Validate hex format before hashing to reject obvious junk early
  if (!HEX_64_RE.test(rawToken)) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const tokenHash = hashToken(rawToken)

  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.tokenHash, tokenHash))
    .limit(1)

  if (!session || session.expiresAt < new Date()) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  c.set('userId', session.userId)
  await next()
}
```

**Step 2: Run all unit tests**

```bash
cd relay-cafe-api && bun test tests/unit/
```

Expected: All PASS

**Step 3: Commit**

```bash
git add relay-cafe-api/src/middleware/auth.ts
git commit -m "feat: auth middleware uses HMAC hash lookup instead of UUID"
```

---

### Task 14: Update Integration Tests

**Files:**
- Modify: Integration tests that create sessions directly or use UUID tokens

**Step 1: Check which integration tests interact with sessions**

Read these test files to identify what needs updating:
- `tests/integration/auth.test.ts`
- `tests/integration/me.test.ts`
- `tests/integration/messages-send.test.ts`
- `tests/integration/messages-receive.test.ts`
- `tests/integration/messages-concurrent.test.ts`
- `tests/integration/time-boundaries.test.ts`
- `tests/integration/cleanup-sql.test.ts`

Any test that:
1. Creates a session via `POST /auth/apple` — should work unchanged (returns new token format)
2. Creates sessions directly via DB insert — needs to include `tokenHash` column
3. Uses the session token for authenticated requests — needs to store and use the raw token from the auth response

Update each test helper or setup function to work with the new token format. The key changes:
- Session tokens are now 64-char hex (not UUIDs)
- Any direct session DB inserts need a `tokenHash` field
- Any cleanup SQL referencing `ip_events` should be removed

**Step 2: Run all integration tests**

```bash
cd relay-cafe-api && bun test tests/integration/
```

Fix any failures. Common fixes:
- Replace UUID regex validation in test assertions with hex-64 validation
- Add `tokenHash` to direct session inserts in test helpers
- Remove `ip_events` cleanup from test teardown

**Step 3: Commit**

```bash
git add relay-cafe-api/tests/
git commit -m "test: update integration tests for HMAC session tokens and ip_events removal"
```

---

### Task 15: Apply Migrations to Local DB

**Step 1: Push schema changes to local database**

```bash
cd relay-cafe-api && bunx drizzle-kit push
```

This applies both migrations (drop ip_events + add token_hash).

**Step 2: Verify tables**

```bash
cd relay-cafe-api && bun run -e "
import { db } from './src/db';
import { sql } from 'drizzle-orm';
const cols = await db.execute(sql\`SELECT column_name FROM information_schema.columns WHERE table_name = 'sessions' ORDER BY ordinal_position\`);
console.log('sessions columns:', cols.map(r => r.column_name));
const tables = await db.execute(sql\`SELECT tablename FROM pg_tables WHERE schemaname = 'public'\`);
console.log('tables:', tables.map(r => r.tablename));
"
```

Expected:
- `sessions columns` includes `token_hash`
- `tables` does NOT include `ip_events`

**Step 3: Run full test suite**

```bash
cd relay-cafe-api && bun test
```

Expected: All tests PASS

**Step 4: Commit (if any test fixture changes were needed)**

```bash
git add -A relay-cafe-api/
git commit -m "chore: apply migrations and fix remaining test issues"
```

---

### Task 16: Final Verification

**Step 1: Run all tests**

```bash
cd relay-cafe-api && bun test
```

Expected: All PASS

**Step 2: Start the server and smoke test**

```bash
cd relay-cafe-api && bun run src/index.ts &
sleep 2

# Health check
curl -s http://localhost:3000/health | jq .

# Hit global rate limit (should work for first 60)
for i in $(seq 1 61); do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/health)
  if [ "$STATUS" = "429" ]; then echo "Rate limited at request $i"; break; fi
done

kill %1
```

Expected: `{"ok":true}` from health, rate limited at request 61.

**Step 3: Commit any final fixes**

If any issues found, fix and commit.

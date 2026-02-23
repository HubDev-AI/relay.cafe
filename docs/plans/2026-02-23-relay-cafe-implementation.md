# Relay.cafe Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the full relay.cafe system — a Hono/Bun API on Railway + native iOS SwiftUI app — where users send and receive one anonymous message per day, encrypted at rest with GCP KMS envelope encryption.

**Architecture:** Two separate repos: `relay-cafe-api` (TypeScript + Hono + Bun + PostgreSQL + GCP KMS on Railway) and `relay-cafe-ios` (Swift + SwiftUI). The API is the source of truth for daily tokens; the iOS client reflects server state. Messages are AES-256-GCM encrypted on the server, stored as ciphertext, and decrypted server-side on delivery. The server hard-deletes the message row immediately after sending plaintext to the client.

**Tech Stack:** Bun, Hono, Drizzle ORM, `postgres`, `jose` (Apple JWT), `@google-cloud/kms`, Railway cron, Swift 5.9+, SwiftUI, AuthenticationServices, Translation.framework, NaturalLanguage.framework.

---

## Phase 1: Backend API

---

### Task 1: Initialize `relay-cafe-api` project

**Files:**
- Create: `relay-cafe-api/package.json`
- Create: `relay-cafe-api/src/index.ts`
- Create: `relay-cafe-api/src/app.ts`
- Create: `relay-cafe-api/.env.example`
- Create: `relay-cafe-api/railway.toml`

**Step 1: Create the project directory and init**

```bash
mkdir relay-cafe-api && cd relay-cafe-api
bun init -y
```

**Step 2: Install dependencies**

```bash
bun add hono @hono/node-server drizzle-orm postgres jose @google-cloud/kms
bun add -d drizzle-kit @types/node bun-types
```

**Step 3: Create `src/app.ts`**

```typescript
import { Hono } from 'hono'

export const app = new Hono()

app.get('/health', (c) => c.json({ ok: true }))
```

**Step 4: Create `src/index.ts`**

```typescript
import { serve } from '@hono/node-server'
import { app } from './app'

serve({ fetch: app.fetch, port: 3000 }, () => {
  console.log('relay-cafe-api running on :3000')
})
```

**Step 5: Create `.env.example`**

```env
DATABASE_URL=postgres://user:pass@localhost:5432/relaycafe
GCP_PROJECT_ID=
GCP_KMS_LOCATION=global
GCP_KMS_KEY_RING=relay-cafe
GCP_KMS_KEY_NAME=message-key
GOOGLE_APPLICATION_CREDENTIALS=./gcp-credentials.json
APPLE_BUNDLE_ID=cafe.relay.app
SESSION_SALT=change-me-32-chars-minimum
APPLE_ID_SALT=change-me-32-chars-minimum
```

**Step 6: Create `railway.toml`**

```toml
[build]
builder = "nixpacks"

[deploy]
startCommand = "bun run src/index.ts"
restartPolicyType = "on_failure"
```

**Step 7: Write a smoke test**

Create `tests/health.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test'
import { app } from '../src/app'

describe('health', () => {
  it('GET /health returns ok', async () => {
    const res = await app.request('/health')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })
})
```

**Step 8: Run test**

```bash
bun test tests/health.test.ts
```
Expected: PASS

**Step 9: Commit**

```bash
git init && git add -A
git commit -m "feat: initialize relay-cafe-api with Hono + Bun"
```

---

### Task 2: PostgreSQL schema and migrations

**Files:**
- Create: `src/db/schema.ts`
- Create: `src/db/index.ts`
- Create: `drizzle.config.ts`

**Step 1: Write failing schema test**

Create `tests/schema.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test'
import { users, sessions, dailyTokens, messages, ipEvents } from '../src/db/schema'

describe('schema', () => {
  it('exports users table', () => expect(users).toBeDefined())
  it('exports sessions table', () => expect(sessions).toBeDefined())
  it('exports dailyTokens table', () => expect(dailyTokens).toBeDefined())
  it('exports messages table', () => expect(messages).toBeDefined())
  it('exports ipEvents table', () => expect(ipEvents).toBeDefined())
})
```

**Step 2: Run to verify it fails**

```bash
bun test tests/schema.test.ts
```
Expected: FAIL — cannot find module

**Step 3: Create `src/db/schema.ts`**

```typescript
import { pgTable, uuid, text, boolean, timestamp, date, primaryKey, index } from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  appleIdHash: text('apple_id_hash').unique().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  deviceFingerprint: text('device_fingerprint'),
})

export const dailyTokens = pgTable('daily_tokens', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  date: date('date').notNull(),
  sendUsed: boolean('send_used').notNull().default(false),
  receiveUsed: boolean('receive_used').notNull().default(false),
}, (t) => ({
  pk: primaryKey({ columns: [t.userId, t.date] }),
}))

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  ciphertext: text('ciphertext').notNull(),
  encryptedMessageKey: text('encrypted_message_key').notNull(),
  kmsKeyVersion: text('kms_key_version').notNull(),
  iv: text('iv').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  delivered: boolean('delivered').notNull().default(false),
})

export const ipEvents = pgTable('ip_events', {
  ipHash: text('ip_hash').notNull(),
  eventType: text('event_type').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  idx: index('ip_events_ip_hash_event_type_created_at_idx')
    .on(t.ipHash, t.eventType, t.createdAt),
}))
```

**Step 4: Create `src/db/index.ts`**

```typescript
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

const client = postgres(process.env.DATABASE_URL!)
export const db = drizzle(client, { schema })
```

**Step 5: Create `drizzle.config.ts`**

```typescript
import type { Config } from 'drizzle-kit'

export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
} satisfies Config
```

**Step 6: Run test to verify it passes**

```bash
bun test tests/schema.test.ts
```
Expected: PASS

**Step 7: Generate and run migrations**

```bash
bun drizzle-kit generate
DATABASE_URL=<your-local-db> bun drizzle-kit migrate
```

**Step 8: Commit**

```bash
git add -A
git commit -m "feat: add PostgreSQL schema with Drizzle ORM"
```

---

### Task 3: Apple JWT verification

**Files:**
- Create: `src/lib/appleAuth.ts`
- Create: `tests/appleAuth.test.ts`

**Step 1: Write failing tests**

Create `tests/appleAuth.test.ts`:

```typescript
import { describe, it, expect, mock } from 'bun:test'

// We test the verification logic with a mocked JWKS fetch.
// verifyAppleToken should:
//   - Throw if token is malformed
//   - Return { sub } on valid token (mocked)

describe('verifyAppleToken', () => {
  it('throws on malformed token', async () => {
    const { verifyAppleToken } = await import('../src/lib/appleAuth')
    await expect(verifyAppleToken('not.a.jwt')).rejects.toThrow()
  })
})
```

**Step 2: Run to verify it fails**

```bash
bun test tests/appleAuth.test.ts
```
Expected: FAIL — cannot find module

**Step 3: Create `src/lib/appleAuth.ts`**

```typescript
import { createRemoteJWKSet, jwtVerify } from 'jose'

const APPLE_JWKS = createRemoteJWKSet(
  new URL('https://appleid.apple.com/auth/keys')
)

export interface AppleClaims {
  sub: string
  email?: string
}

export async function verifyAppleToken(token: string): Promise<AppleClaims> {
  const { payload } = await jwtVerify(token, APPLE_JWKS, {
    issuer: 'https://appleid.apple.com',
    audience: process.env.APPLE_BUNDLE_ID,
  })

  if (typeof payload.sub !== 'string') {
    throw new Error('missing sub in Apple token')
  }

  return { sub: payload.sub, email: payload.email as string | undefined }
}
```

**Step 4: Run test to verify it passes**

```bash
bun test tests/appleAuth.test.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: add Apple JWT verification with jose"
```

---

### Task 4: AES-256-GCM + GCP KMS crypto helpers

**Files:**
- Create: `src/lib/crypto.ts`
- Create: `src/lib/kms.ts`
- Create: `tests/crypto.test.ts`

**Step 1: Write failing crypto tests**

Create `tests/crypto.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test'
import { encryptMessage, decryptMessage } from '../src/lib/crypto'

describe('encryptMessage / decryptMessage', () => {
  it('roundtrips plaintext', async () => {
    const plaintext = 'hello relay'
    const { ciphertext, iv, key } = await encryptMessage(plaintext)
    expect(ciphertext).not.toBe(plaintext)
    const result = await decryptMessage(ciphertext, iv, key)
    expect(result).toBe(plaintext)
  })

  it('produces different ciphertext each time (unique IV)', async () => {
    const { ciphertext: a } = await encryptMessage('same')
    const { ciphertext: b } = await encryptMessage('same')
    expect(a).not.toBe(b)
  })
})
```

**Step 2: Run to verify it fails**

```bash
bun test tests/crypto.test.ts
```
Expected: FAIL

**Step 3: Create `src/lib/crypto.ts`**

```typescript
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'

export interface EncryptResult {
  ciphertext: string  // base64(iv + authTag + encrypted)
  iv: string          // base64, 12 bytes
  key: Buffer         // raw 32-byte key (wrap with KMS before storing)
}

export async function encryptMessage(plaintext: string): Promise<EncryptResult> {
  const key = randomBytes(32)
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, key, iv)

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()

  // Store: authTag (16) + encrypted in ciphertext field
  const ciphertext = Buffer.concat([authTag, encrypted]).toString('base64')

  return { ciphertext, iv: iv.toString('base64'), key }
}

export async function decryptMessage(
  ciphertext: string,
  ivBase64: string,
  key: Buffer,
): Promise<string> {
  const iv = Buffer.from(ivBase64, 'base64')
  const data = Buffer.from(ciphertext, 'base64')
  const authTag = data.subarray(0, 16)
  const encrypted = data.subarray(16)

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)

  return Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]).toString('utf8')
}
```

**Step 4: Run test to verify it passes**

```bash
bun test tests/crypto.test.ts
```
Expected: PASS

**Step 5: Create `src/lib/kms.ts`**

```typescript
import { KeyManagementServiceClient } from '@google-cloud/kms'

const client = new KeyManagementServiceClient()

function todayKeyVersion(): string {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  return [
    `projects/${process.env.GCP_PROJECT_ID}`,
    `locations/${process.env.GCP_KMS_LOCATION}`,
    `keyRings/${process.env.GCP_KMS_KEY_RING}`,
    `cryptoKeys/${process.env.GCP_KMS_KEY_NAME}`,
    `cryptoKeyVersions/${today}`,
  ].join('/')
}

export async function wrapKey(rawKey: Buffer): Promise<{ encryptedKey: string; keyVersion: string }> {
  const keyVersion = todayKeyVersion()
  const [result] = await client.encrypt({
    name: keyVersion,
    plaintext: rawKey,
  })
  return {
    encryptedKey: Buffer.from(result.ciphertext as Uint8Array).toString('base64'),
    keyVersion,
  }
}

export async function unwrapKey(encryptedKey: string, keyVersion: string): Promise<Buffer> {
  const [result] = await client.decrypt({
    name: keyVersion,
    ciphertext: Buffer.from(encryptedKey, 'base64'),
  })
  return Buffer.from(result.plaintext as Uint8Array)
}
```

Note: KMS is mocked in tests. Integration tested via Railway staging environment.

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: add AES-256-GCM crypto helpers and GCP KMS wrapper"
```

---

### Task 5: Session middleware

**Files:**
- Create: `src/middleware/auth.ts`
- Create: `tests/middleware.test.ts`

**Step 1: Write failing middleware test**

Create `tests/middleware.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test'
import { Hono } from 'hono'

// We test that protected routes reject missing/invalid tokens.
// The middleware reads Bearer token from Authorization header,
// looks it up in sessions table, attaches userId to context.

describe('auth middleware', () => {
  it('returns 401 with no Authorization header', async () => {
    const { authMiddleware } = await import('../src/middleware/auth')
    const app = new Hono()
    app.use('*', authMiddleware)
    app.get('/protected', (c) => c.json({ ok: true }))

    const res = await app.request('/protected')
    expect(res.status).toBe(401)
  })
})
```

**Step 2: Run to verify it fails**

```bash
bun test tests/middleware.test.ts
```

**Step 3: Create `src/middleware/auth.ts`**

```typescript
import type { Context, Next } from 'hono'
import { db } from '../db'
import { sessions } from '../db/schema'
import { eq, gt } from 'drizzle-orm'

export async function authMiddleware(c: Context, next: Next) {
  const header = c.req.header('Authorization')
  if (!header?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const token = header.slice(7)
  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, token))
    .limit(1)

  if (!session || session.expiresAt < new Date()) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  c.set('userId', session.userId)
  await next()
}
```

**Step 4: Run test to verify it passes**

```bash
bun test tests/middleware.test.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: add session auth middleware"
```

---

### Task 6: IP rate limiting middleware

**Files:**
- Create: `src/middleware/rateLimit.ts`
- Create: `tests/rateLimit.test.ts`

**Step 1: Write failing test**

Create `tests/rateLimit.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test'
import { Hono } from 'hono'

describe('IP rate limit', () => {
  it('returns 429 after 5 attempts from same IP', async () => {
    const { ipRateLimit } = await import('../src/middleware/rateLimit')
    const app = new Hono()
    app.use('*', ipRateLimit({ maxRequests: 5, windowMs: 60_000 }))
    app.post('/test', (c) => c.json({ ok: true }))

    for (let i = 0; i < 5; i++) {
      await app.request('/test', { method: 'POST', headers: { 'X-Forwarded-For': '1.2.3.4' } })
    }

    const res = await app.request('/test', {
      method: 'POST',
      headers: { 'X-Forwarded-For': '1.2.3.4' },
    })
    expect(res.status).toBe(429)
  })
})
```

**Step 2: Run to verify it fails**

```bash
bun test tests/rateLimit.test.ts
```

**Step 3: Create `src/middleware/rateLimit.ts`**

```typescript
import type { Context, Next } from 'hono'
import { createHash } from 'node:crypto'

// In-memory store. For multi-instance Railway deploys, swap with Redis.
const store = new Map<string, { count: number; resetAt: number }>()

interface Options {
  maxRequests: number
  windowMs: number
}

export function ipRateLimit({ maxRequests, windowMs }: Options) {
  return async (c: Context, next: Next) => {
    const ip = c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ?? 'unknown'
    const key = createHash('sha256').update(ip).digest('hex')
    const now = Date.now()

    const entry = store.get(key)
    if (!entry || entry.resetAt < now) {
      store.set(key, { count: 1, resetAt: now + windowMs })
      return next()
    }

    entry.count++
    if (entry.count > maxRequests) {
      return c.json({ error: 'Please try again later.' }, 429)
    }

    return next()
  }
}
```

**Step 4: Run test to verify it passes**

```bash
bun test tests/rateLimit.test.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: add in-memory IP rate limiting middleware"
```

---

### Task 7: Auth routes — POST /auth/apple + DELETE /auth/session

**Files:**
- Create: `src/routes/auth.ts`
- Create: `tests/auth.test.ts`

**Step 1: Write failing auth route tests**

Create `tests/auth.test.ts`:

```typescript
import { describe, it, expect, mock, beforeAll } from 'bun:test'
import { app } from '../src/app'

// Mock Apple verification so tests don't hit external JWKS
mock.module('../src/lib/appleAuth', () => ({
  verifyAppleToken: async (token: string) => {
    if (token === 'valid-token') return { sub: 'apple-user-123' }
    throw new Error('invalid token')
  },
}))

describe('POST /auth/apple', () => {
  it('returns 400 if identityToken missing', async () => {
    const res = await app.request('/auth/apple', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it('returns 401 for invalid Apple token', async () => {
    const res = await app.request('/auth/apple', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identityToken: 'bad-token', deviceFingerprint: 'fp' }),
    })
    expect(res.status).toBe(401)
  })
})
```

Note: Full integration test (valid token creates user + session) requires a live DB and is covered in staging.

**Step 2: Run to verify it fails**

```bash
bun test tests/auth.test.ts
```

**Step 3: Create `src/routes/auth.ts`**

```typescript
import { Hono } from 'hono'
import { createHash, randomBytes } from 'node:crypto'
import { db } from '../db'
import { users, sessions } from '../db/schema'
import { eq } from 'drizzle-orm'
import { verifyAppleToken } from '../lib/appleAuth'
import { authMiddleware } from '../middleware/auth'
import { ipRateLimit } from '../middleware/rateLimit'

export const authRouter = new Hono()

authRouter.post(
  '/apple',
  ipRateLimit({ maxRequests: 5, windowMs: 60 * 60 * 1000 }),
  async (c) => {
    const body = await c.req.json().catch(() => null)
    if (!body?.identityToken) {
      return c.json({ error: 'identityToken required' }, 400)
    }

    let claims
    try {
      claims = await verifyAppleToken(body.identityToken)
    } catch {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const appleIdHash = createHash('sha256')
      .update(process.env.APPLE_ID_SALT + claims.sub)
      .digest('hex')

    // Upsert user
    let [user] = await db.select().from(users).where(eq(users.appleIdHash, appleIdHash)).limit(1)
    if (!user) {
      ;[user] = await db.insert(users).values({ appleIdHash }).returning()
    }

    // Create session (30 days)
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    const [session] = await db
      .insert(sessions)
      .values({
        userId: user.id,
        expiresAt,
        deviceFingerprint: body.deviceFingerprint ?? null,
      })
      .returning()

    return c.json({ sessionToken: session.id, expiresAt: expiresAt.toISOString() })
  }
)

authRouter.delete('/session', authMiddleware, async (c) => {
  const sessionId = c.req.header('Authorization')!.slice(7)
  await db.delete(sessions).where(eq(sessions.id, sessionId))
  return c.body(null, 204)
})
```

**Step 4: Wire router into `src/app.ts`**

```typescript
import { Hono } from 'hono'
import { authRouter } from './routes/auth'

export const app = new Hono()

app.get('/health', (c) => c.json({ ok: true }))
app.route('/auth', authRouter)
```

**Step 5: Run tests to verify they pass**

```bash
bun test tests/auth.test.ts
```
Expected: PASS

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: add POST /auth/apple and DELETE /auth/session"
```

---

### Task 8: GET /me/status + DELETE /me

**Files:**
- Create: `src/routes/me.ts`
- Create: `tests/me.test.ts`

**Step 1: Write failing tests**

Create `tests/me.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test'
import { app } from '../src/app'

describe('GET /me/status', () => {
  it('returns 401 without token', async () => {
    const res = await app.request('/me/status')
    expect(res.status).toBe(401)
  })
})

describe('DELETE /me', () => {
  it('returns 401 without token', async () => {
    const res = await app.request('/me', { method: 'DELETE' })
    expect(res.status).toBe(401)
  })
})
```

**Step 2: Run to verify it fails**

```bash
bun test tests/me.test.ts
```

**Step 3: Create `src/routes/me.ts`**

```typescript
import { Hono } from 'hono'
import { db } from '../db'
import { users, dailyTokens } from '../db/schema'
import { eq, and } from 'drizzle-orm'
import { authMiddleware } from '../middleware/auth'

export const meRouter = new Hono()

meRouter.get('/status', authMiddleware, async (c) => {
  const userId = c.get('userId') as string
  const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD UTC

  const [tokens] = await db
    .select()
    .from(dailyTokens)
    .where(and(eq(dailyTokens.userId, userId), eq(dailyTokens.date, today)))
    .limit(1)

  return c.json({
    sendUsed: tokens?.sendUsed ?? false,
    receiveUsed: tokens?.receiveUsed ?? false,
    date: today,
  })
})

meRouter.delete('/', authMiddleware, async (c) => {
  const userId = c.get('userId') as string
  await db.delete(users).where(eq(users.id, userId))
  // sessions + dailyTokens cascade on user delete
  return c.body(null, 204)
})
```

**Step 4: Wire into `src/app.ts`**

```typescript
import { meRouter } from './routes/me'
// ...existing imports...
app.route('/me', meRouter)
```

**Step 5: Run tests**

```bash
bun test tests/me.test.ts
```
Expected: PASS

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: add GET /me/status and DELETE /me"
```

---

### Task 9: POST /messages (send)

**Files:**
- Create: `src/routes/messages.ts`
- Create: `tests/messages.test.ts`

**Step 1: Write failing send test**

Create `tests/messages.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test'
import { app } from '../src/app'

describe('POST /messages', () => {
  it('returns 401 without token', async () => {
    const res = await app.request('/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'hello' }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 400 if text is missing', async () => {
    // We test this by patching the auth middleware in a helper app
    const { Hono } = await import('hono')
    const { messagesRouter } = await import('../src/routes/messages')
    const testApp = new Hono()
    testApp.use('*', async (c, next) => { c.set('userId', 'test-user'); await next() })
    testApp.route('/messages', messagesRouter)

    const res = await testApp.request('/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 if text exceeds 1000 chars', async () => {
    const { Hono } = await import('hono')
    const { messagesRouter } = await import('../src/routes/messages')
    const testApp = new Hono()
    testApp.use('*', async (c, next) => { c.set('userId', 'test-user'); await next() })
    testApp.route('/messages', messagesRouter)

    const res = await testApp.request('/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'a'.repeat(1001) }),
    })
    expect(res.status).toBe(400)
  })
})
```

**Step 2: Run to verify it fails**

```bash
bun test tests/messages.test.ts
```

**Step 3: Create `src/routes/messages.ts`**

```typescript
import { Hono } from 'hono'
import { db } from '../db'
import { messages, dailyTokens } from '../db/schema'
import { and, eq, gt, sql } from 'drizzle-orm'
import { authMiddleware } from '../middleware/auth'
import { encryptMessage, decryptMessage } from '../lib/crypto'
import { wrapKey, unwrapKey } from '../lib/kms'

export const messagesRouter = new Hono()

messagesRouter.post('/', authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body?.text || typeof body.text !== 'string') {
    return c.json({ error: 'text required' }, 400)
  }
  if (body.text.length > 1000) {
    return c.json({ error: 'text exceeds 1000 characters' }, 400)
  }

  const userId = c.get('userId') as string
  const today = new Date().toISOString().slice(0, 10)

  // Upsert daily token row and check
  await db
    .insert(dailyTokens)
    .values({ userId, date: today, sendUsed: false, receiveUsed: false })
    .onConflictDoNothing()

  const [tokens] = await db
    .select()
    .from(dailyTokens)
    .where(and(eq(dailyTokens.userId, userId), eq(dailyTokens.date, today)))

  if (tokens.sendUsed) {
    return c.json({ error: 'Already sent today.' }, 429)
  }

  // Encrypt
  const { ciphertext, iv, key } = await encryptMessage(body.text)
  const { encryptedKey, keyVersion } = await wrapKey(key)

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)

  await db.insert(messages).values({
    ciphertext,
    encryptedMessageKey: encryptedKey,
    kmsKeyVersion: keyVersion,
    iv,
    expiresAt,
  })

  // Mark send token used
  await db
    .update(dailyTokens)
    .set({ sendUsed: true })
    .where(and(eq(dailyTokens.userId, userId), eq(dailyTokens.date, today)))

  return c.body(null, 204)
})

messagesRouter.get('/today', authMiddleware, async (c) => {
  const userId = c.get('userId') as string
  const today = new Date().toISOString().slice(0, 10)

  await db
    .insert(dailyTokens)
    .values({ userId, date: today, sendUsed: false, receiveUsed: false })
    .onConflictDoNothing()

  const [tokens] = await db
    .select()
    .from(dailyTokens)
    .where(and(eq(dailyTokens.userId, userId), eq(dailyTokens.date, today)))

  if (tokens.receiveUsed) {
    return c.json({ error: 'Already received today.' }, 429)
  }

  // Pick a random undelivered, unexpired message
  const [msg] = await db
    .select()
    .from(messages)
    .where(and(eq(messages.delivered, false), gt(messages.expiresAt, new Date())))
    .orderBy(sql`RANDOM()`)
    .limit(1)

  if (!msg) {
    // Quiet day — token NOT consumed
    return c.body(null, 204)
  }

  // Decrypt
  const key = await unwrapKey(msg.encryptedMessageKey, msg.kmsKeyVersion)
  const text = await decryptMessage(msg.ciphertext, msg.iv, key)

  // Hard delete message row immediately
  await db.delete(messages).where(eq(messages.id, msg.id))

  // Mark receive token used
  await db
    .update(dailyTokens)
    .set({ receiveUsed: true })
    .where(and(eq(dailyTokens.userId, userId), eq(dailyTokens.date, today)))

  return c.json({ id: msg.id, text })
})
```

**Step 4: Wire into `src/app.ts`**

```typescript
import { messagesRouter } from './routes/messages'
// ...
app.route('/messages', messagesRouter)
```

**Step 5: Run tests**

```bash
bun test tests/messages.test.ts
```
Expected: PASS

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: add POST /messages and GET /messages/today"
```

---

### Task 10: Cleanup cron job

**Files:**
- Create: `src/jobs/cleanup.ts`
- Create: `tests/cleanup.test.ts`

**Step 1: Write failing test**

Create `tests/cleanup.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test'
import { buildCleanupQueries } from '../src/jobs/cleanup'

describe('buildCleanupQueries', () => {
  it('returns two SQL strings', () => {
    const queries = buildCleanupQueries()
    expect(queries).toHaveLength(2)
    expect(queries[0]).toContain('messages')
    expect(queries[1]).toContain('ip_events')
  })
})
```

**Step 2: Run to verify it fails**

```bash
bun test tests/cleanup.test.ts
```

**Step 3: Create `src/jobs/cleanup.ts`**

```typescript
import { db } from '../db'
import { messages, ipEvents } from '../db/schema'
import { lt } from 'drizzle-orm'
import { sql } from 'drizzle-orm'

export function buildCleanupQueries(): string[] {
  return [
    'DELETE FROM messages WHERE expires_at < NOW()',
    "DELETE FROM ip_events WHERE created_at < NOW() - INTERVAL '48 hours'",
  ]
}

export async function runCleanup(): Promise<void> {
  await db.delete(messages).where(lt(messages.expiresAt, new Date()))
  await db.execute(sql`DELETE FROM ip_events WHERE created_at < NOW() - INTERVAL '48 hours'`)
  console.log('[cleanup] expired messages and ip_events pruned')
}
```

**Step 4: Add cleanup endpoint for Railway cron**

In `src/app.ts`, add:

```typescript
import { runCleanup } from './jobs/cleanup'

// Called by Railway cron every 10 minutes
// Secured by shared secret header
app.post('/internal/cleanup', async (c) => {
  if (c.req.header('X-Cron-Secret') !== process.env.CRON_SECRET) {
    return c.body(null, 401)
  }
  await runCleanup()
  return c.json({ ok: true })
})
```

Add `CRON_SECRET=<random>` to `.env.example`.

**Step 5: Run test**

```bash
bun test tests/cleanup.test.ts
```
Expected: PASS

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: add cleanup job for expired messages and ip_events"
```

---

### Task 11: Run full backend test suite

**Step 1: Run all tests**

```bash
bun test
```
Expected: All PASS

**Step 2: Deploy to Railway staging**

```bash
railway up --detach
```

**Step 3: Smoke test against staging**

```bash
curl https://your-staging-url.railway.app/health
```
Expected: `{"ok":true}`

**Step 4: Tag backend v0.1**

```bash
git tag v0.1.0
git push origin main --tags
```

---

## Phase 2: iOS App

---

### Task 12: Create Xcode project

**Step 1: Open Xcode → New Project**

- Template: iOS → App
- Product Name: `RelayCafe`
- Bundle ID: `cafe.relay.app`
- Interface: SwiftUI
- Language: Swift
- Minimum deployment: iOS 17.0 (required for Translation.framework)

**Step 2: Delete boilerplate**

Delete `ContentView.swift`. Rename `RelayCafeApp.swift` if needed.

**Step 3: Add Swift Package dependencies**

In Xcode → Package Dependencies → Add:
- None needed. All frameworks are system: `AuthenticationServices`, `Translation`, `NaturalLanguage`, `Security`.

**Step 4: Set up folder structure**

Create groups in Xcode:
```
RelayCafe/
  App/
  Views/
  ViewModels/
  Services/
  Models/
```

**Step 5: Commit**

```bash
git init && git add -A
git commit -m "feat: initialize RelayCafe Xcode project"
```

---

### Task 13: KeychainManager

**Files:**
- Create: `RelayCafe/Services/KeychainManager.swift`
- Create: `RelayCafeTests/KeychainManagerTests.swift`

**Step 1: Write failing tests**

```swift
import XCTest
@testable import RelayCafe

final class KeychainManagerTests: XCTestCase {
    let km = KeychainManager()
    let key = "test.session.token"

    override func tearDown() {
        try? km.delete(key: key)
    }

    func testSaveAndLoad() throws {
        try km.save(key: key, value: "abc123")
        let loaded = try km.load(key: key)
        XCTAssertEqual(loaded, "abc123")
    }

    func testOverwrite() throws {
        try km.save(key: key, value: "first")
        try km.save(key: key, value: "second")
        XCTAssertEqual(try km.load(key: key), "second")
    }

    func testDeletedKeyThrows() throws {
        try? km.delete(key: key)
        XCTAssertThrowsError(try km.load(key: key))
    }
}
```

**Step 2: Run tests to verify they fail**

Cmd+U in Xcode. Expected: compile error.

**Step 3: Create `Services/KeychainManager.swift`**

```swift
import Foundation
import Security

enum KeychainError: Error {
    case notFound
    case unexpectedStatus(OSStatus)
}

struct KeychainManager {
    func save(key: String, value: String) throws {
        let data = Data(value.utf8)
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrAccount: key,
        ]
        SecItemDelete(query as CFDictionary)

        let attrs = query.merging([kSecValueData: data]) { $1 }
        let status = SecItemAdd(attrs as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw KeychainError.unexpectedStatus(status)
        }
    }

    func load(key: String) throws -> String {
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrAccount: key,
            kSecReturnData: true,
            kSecMatchLimit: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else {
            throw KeychainError.notFound
        }
        return String(decoding: data, as: UTF8.self)
    }

    func delete(key: String) throws {
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrAccount: key,
        ]
        SecItemDelete(query as CFDictionary)
    }
}
```

**Step 4: Run tests — all PASS**

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: add KeychainManager with save/load/delete"
```

---

### Task 14: APIClient

**Files:**
- Create: `RelayCafe/Services/APIClient.swift`
- Create: `RelayCafeTests/APIClientTests.swift`

**Step 1: Write failing test (mocked URLSession)**

```swift
import XCTest
@testable import RelayCafe

final class APIClientTests: XCTestCase {
    func testStatusDecodesCorrectly() throws {
        let json = """
        {"sendUsed": true, "receiveUsed": false, "date": "2026-02-23"}
        """.data(using: .utf8)!

        let status = try JSONDecoder().decode(DayStatus.self, from: json)
        XCTAssertTrue(status.sendUsed)
        XCTAssertFalse(status.receiveUsed)
    }

    func testMessageResponseDecodesCorrectly() throws {
        let json = """
        {"id": "abc-123", "text": "hello world"}
        """.data(using: .utf8)!

        let msg = try JSONDecoder().decode(MessageResponse.self, from: json)
        XCTAssertEqual(msg.text, "hello world")
    }
}
```

**Step 2: Run to verify it fails**

**Step 3: Create `Services/APIClient.swift`**

```swift
import Foundation

// MARK: - Models

struct DayStatus: Codable {
    let sendUsed: Bool
    let receiveUsed: Bool
    let date: String
}

struct MessageResponse: Codable {
    let id: String
    let text: String
}

// MARK: - APIClient

enum APIError: Error {
    case unauthorized
    case alreadyUsedToday
    case noMessage          // 204 — relay is quiet
    case networkError(Error)
    case serverError(Int)
    case decodingError(Error)
}

actor APIClient {
    static let shared = APIClient()

    private let baseURL: URL
    private var sessionToken: String?
    private let keychain = KeychainManager()
    private let decoder = JSONDecoder()

    init(baseURL: URL = URL(string: "https://api.relay.cafe")!) {
        self.baseURL = baseURL
        sessionToken = try? keychain.load(key: "sessionToken")
    }

    func setToken(_ token: String, expiresAt: Date) throws {
        sessionToken = token
        try keychain.save(key: "sessionToken", value: token)
    }

    func clearToken() {
        sessionToken = nil
        try? keychain.delete(key: "sessionToken")
    }

    // MARK: Auth

    func signInWithApple(identityToken: String, deviceFingerprint: String) async throws -> String {
        let body: [String: Any] = [
            "identityToken": identityToken,
            "deviceFingerprint": deviceFingerprint,
        ]
        struct Response: Codable { let sessionToken: String; let expiresAt: String }
        let response: Response = try await post("/auth/apple", body: body, requiresAuth: false)
        try setToken(response.sessionToken, expiresAt: ISO8601DateFormatter().date(from: response.expiresAt) ?? .distantFuture)
        return response.sessionToken
    }

    func signOut() async throws {
        try await delete("/auth/session")
        clearToken()
    }

    // MARK: Status

    func getStatus() async throws -> DayStatus {
        try await get("/me/status")
    }

    // MARK: Messages

    func sendMessage(text: String) async throws {
        try await postEmpty("/messages", body: ["text": text])
    }

    func receiveMessage() async throws -> MessageResponse? {
        do {
            return try await get("/messages/today")
        } catch APIError.noMessage {
            return nil
        }
    }

    func deleteAccount() async throws {
        try await delete("/me")
        clearToken()
    }

    // MARK: Private helpers

    private func get<T: Decodable>(_ path: String) async throws -> T {
        var req = URLRequest(url: baseURL.appendingPathComponent(path))
        attachAuth(&req)
        let (data, response) = try await URLSession.shared.data(for: req)
        try validate(response, data: data)
        return try decoder.decode(T.self, from: data)
    }

    private func post<T: Decodable>(_ path: String, body: [String: Any], requiresAuth: Bool = true) async throws -> T {
        var req = URLRequest(url: baseURL.appendingPathComponent(path))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        if requiresAuth { attachAuth(&req) }
        let (data, response) = try await URLSession.shared.data(for: req)
        try validate(response, data: data)
        return try decoder.decode(T.self, from: data)
    }

    private func postEmpty(_ path: String, body: [String: Any]) async throws {
        var req = URLRequest(url: baseURL.appendingPathComponent(path))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        attachAuth(&req)
        let (data, response) = try await URLSession.shared.data(for: req)
        try validate(response, data: data)
    }

    private func delete(_ path: String) async throws {
        var req = URLRequest(url: baseURL.appendingPathComponent(path))
        req.httpMethod = "DELETE"
        attachAuth(&req)
        let (data, response) = try await URLSession.shared.data(for: req)
        try validate(response, data: data)
    }

    private func attachAuth(_ req: inout URLRequest) {
        if let token = sessionToken {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
    }

    private func validate(_ response: URLResponse, data: Data) throws {
        guard let http = response as? HTTPURLResponse else { return }
        switch http.statusCode {
        case 200...203: return
        case 204: throw APIError.noMessage
        case 401: throw APIError.unauthorized
        case 429: throw APIError.alreadyUsedToday
        default: throw APIError.serverError(http.statusCode)
        }
    }
}
```

**Step 4: Run tests — all PASS**

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: add APIClient with full endpoint coverage"
```

---

### Task 15: AppViewModel + routing

**Files:**
- Create: `RelayCafe/ViewModels/AppViewModel.swift`
- Create: `RelayCafe/App/RelayCafeApp.swift`

**Step 1: Create `ViewModels/AppViewModel.swift`**

```swift
import Foundation

enum AppRoute {
    case onboarding
    case signIn
    case home
}

@MainActor
@Observable
final class AppViewModel {
    var route: AppRoute = .onboarding
    private let keychain = KeychainManager()

    init() {
        if let _ = try? keychain.load(key: "sessionToken") {
            route = .home
        } else if UserDefaults.standard.bool(forKey: "onboardingComplete") {
            route = .signIn
        } else {
            route = .onboarding
        }
    }

    func completeOnboarding() {
        UserDefaults.standard.set(true, forKey: "onboardingComplete")
        route = .signIn
    }

    func didSignIn() {
        route = .home
    }

    func didDeleteAccount() {
        route = .onboarding
        UserDefaults.standard.removeObject(forKey: "onboardingComplete")
    }
}
```

**Step 2: Create `App/RelayCafeApp.swift`**

```swift
import SwiftUI

@main
struct RelayCafeApp: App {
    @State private var appVM = AppViewModel()

    var body: some Scene {
        WindowGroup {
            switch appVM.route {
            case .onboarding: OnboardingView(vm: appVM)
            case .signIn: SignInView(vm: appVM)
            case .home: HomeView(vm: appVM)
            }
        }
    }
}
```

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: add AppViewModel and root routing"
```

---

### Task 16: OnboardingView

**Files:**
- Create: `RelayCafe/Views/OnboardingView.swift`

**Step 1: Create `Views/OnboardingView.swift`**

```swift
import SwiftUI

struct OnboardingView: View {
    let vm: AppViewModel

    var body: some View {
        ZStack {
            Color(hex: "#F6F4EF").ignoresSafeArea()

            VStack(alignment: .leading, spacing: 0) {
                Spacer()

                Text("Relay.cafe")
                    .font(.system(size: 30, weight: .regular))
                    .padding(.bottom, 40)

                VStack(alignment: .leading, spacing: 8) {
                    Text("Once a day,")
                    Text("you may send a message.")
                    Text("Once a day,")
                    Text("you may receive one.")
                }
                .font(.system(size: 18, weight: .regular))
                .lineSpacing(4)
                .padding(.bottom, 32)

                VStack(alignment: .leading, spacing: 8) {
                    Text("Messages exist for 24 hours.")
                    Text("They are never stored.")
                }
                .font(.system(size: 18, weight: .regular))
                .lineSpacing(4)

                Spacer()

                Button(action: { vm.completeOnboarding() }) {
                    Text("Continue")
                        .font(.system(size: 17, weight: .regular))
                        .opacity(0.7)
                }
                .buttonStyle(.plain)
                .padding(.bottom, 48)
            }
            .padding(.horizontal, 28)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .preferredColorScheme(.light)
    }
}

// MARK: - Color helper
extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let r = Double((int >> 16) & 0xFF) / 255
        let g = Double((int >> 8) & 0xFF) / 255
        let b = Double(int & 0xFF) / 255
        self.init(red: r, green: g, blue: b)
    }
}
```

**Step 2: Build and preview in Xcode**

Cmd+B. Check SwiftUI preview. Verify: off-white background, no gradients, calm text.

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: add OnboardingView"
```

---

### Task 17: SignInView

**Files:**
- Create: `RelayCafe/Views/SignInView.swift`

**Step 1: Create `Views/SignInView.swift`**

```swift
import SwiftUI
import AuthenticationServices
import CryptoKit

struct SignInView: View {
    let vm: AppViewModel
    @State private var error: String?

    var body: some View {
        ZStack {
            Color(hex: "#F6F4EF").ignoresSafeArea()

            VStack(spacing: 0) {
                Spacer()

                Text("Sign in to enter the relay.")
                    .font(.system(size: 18, weight: .regular))
                    .multilineTextAlignment(.center)
                    .padding(.bottom, 40)

                SignInWithAppleButton(.signIn, onRequest: configureRequest, onCompletion: handleResult)
                    .signInWithAppleButtonStyle(.black)
                    .frame(height: 50)
                    .padding(.horizontal, 28)

                Text("Your identity is not shown to others.")
                    .font(.system(size: 13, weight: .regular))
                    .opacity(0.5)
                    .padding(.top, 16)

                if let error {
                    Text(error)
                        .font(.system(size: 14))
                        .opacity(0.6)
                        .padding(.top, 12)
                }

                Spacer()
            }
        }
    }

    private func configureRequest(_ request: ASAuthorizationAppleIDRequest) {
        request.requestedScopes = []
    }

    private func handleResult(_ result: Result<ASAuthorization, Error>) {
        switch result {
        case .success(let auth):
            guard
                let cred = auth.credential as? ASAuthorizationAppleIDCredential,
                let tokenData = cred.identityToken,
                let token = String(data: tokenData, encoding: .utf8)
            else {
                error = "Connection unavailable.\nPlease try again."
                return
            }

            let fingerprint = deviceFingerprint()
            Task {
                do {
                    try await APIClient.shared.signInWithApple(
                        identityToken: token,
                        deviceFingerprint: fingerprint
                    )
                    await MainActor.run { vm.didSignIn() }
                } catch {
                    await MainActor.run {
                        self.error = "Connection unavailable.\nPlease try again."
                    }
                }
            }

        case .failure:
            // User cancelled — stay silent
            break
        }
    }

    private func deviceFingerprint() -> String {
        let raw = "\(UIDevice.current.model)-\(UIDevice.current.systemVersion)-1.0"
        return SHA256.hash(data: Data(raw.utf8))
            .compactMap { String(format: "%02x", $0) }
            .joined()
    }
}
```

**Step 2: Build and preview**

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: add SignInView with Sign in with Apple"
```

---

### Task 18: HomeView

**Files:**
- Create: `RelayCafe/ViewModels/HomeViewModel.swift`
- Create: `RelayCafe/Views/HomeView.swift`

**Step 1: Create `ViewModels/HomeViewModel.swift`**

```swift
import Foundation

@MainActor
@Observable
final class HomeViewModel {
    var status: DayStatus?
    var isLoading = false
    var showCompose = false
    var showMessage = false
    var receivedMessage: MessageResponse?
    var receiveState: ReceiveState = .idle

    enum ReceiveState: Equatable {
        case idle, loading, quiet, received(MessageResponse)
    }

    func loadStatus() async {
        isLoading = true
        defer { isLoading = false }
        status = try? await APIClient.shared.getStatus()
    }

    func openReceive() async {
        receiveState = .loading
        // intentional 2-second pause per design spec
        try? await Task.sleep(for: .seconds(2))

        do {
            if let msg = try await APIClient.shared.receiveMessage() {
                receiveState = .received(msg)
                showMessage = true
            } else {
                receiveState = .quiet
            }
        } catch APIError.alreadyUsedToday {
            await loadStatus()
        } catch {
            receiveState = .idle
        }
    }
}
```

**Step 2: Create `Views/HomeView.swift`**

```swift
import SwiftUI

struct HomeView: View {
    let vm: AppViewModel
    @State private var homeVM = HomeViewModel()

    var body: some View {
        ZStack {
            Color(hex: "#F6F4EF").ignoresSafeArea()

            VStack(spacing: 0) {
                Spacer()

                sendSection
                    .padding(.bottom, 40)

                receiveSection

                Spacer()

                settingsButton
                    .padding(.bottom, 48)
            }
            .padding(.horizontal, 28)
        }
        .task { await homeVM.loadStatus() }
        .sheet(isPresented: $homeVM.showCompose) {
            ComposeView(homeVM: homeVM)
        }
        .sheet(isPresented: $homeVM.showMessage) {
            if case .received(let msg) = homeVM.receiveState {
                MessageView(message: msg, homeVM: homeVM)
            }
        }
    }

    // Layout never shifts. Buttons always visible. Only opacity + interaction changes.
    private var sendSection: some View {
        let used = homeVM.status?.sendUsed == true
        return VStack(spacing: 8) {
            Button("Write today's message") {
                if !used { homeVM.showCompose = true }
            }
            .font(.system(size: 17, weight: .regular))
            .buttonStyle(.plain)
            .opacity(used ? 0.3 : 1.0)
            .disabled(used)

            if used {
                Text("You've already sent today.")
                    .font(.system(size: 13))
                    .opacity(0.4)
            } else {
                // Reserve space so layout stays identical
                Text(" ").font(.system(size: 13))
            }
        }
    }

    private var receiveSection: some View {
        let used = homeVM.status?.receiveUsed == true
        let isLoading = homeVM.receiveState == .loading
        let isQuiet = homeVM.receiveState == .quiet
        return VStack(spacing: 8) {
            Button("Open today's message") {
                if !used && !isLoading {
                    Task { await homeVM.openReceive() }
                }
            }
            .font(.system(size: 17, weight: .regular))
            .buttonStyle(.plain)
            .opacity(used || isLoading ? 0.3 : 1.0)
            .disabled(used || isLoading)

            // Sub-label: stable height, content varies
            Group {
                if used {
                    Text("You've already received today.")
                        .opacity(0.4)
                } else if isQuiet {
                    Text("The relay is quiet today.")
                        .opacity(0.4)
                } else {
                    Text(" ")  // holds space
                }
            }
            .font(.system(size: 13))
        }
    }

    private var settingsButton: some View {
        NavigationLink(destination: SettingsView(appVM: vm)) {
            Text("Settings")
                .font(.system(size: 13))
                .opacity(0.3)
        }
        .buttonStyle(.plain)
    }
}
```

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: add HomeView and HomeViewModel"
```

---

### Task 19: ComposeView

**Files:**
- Create: `RelayCafe/Views/ComposeView.swift`

**Step 1: Create `Views/ComposeView.swift`**

```swift
import SwiftUI

struct ComposeView: View {
    @Bindable var homeVM: HomeViewModel
    @Environment(\.dismiss) var dismiss

    @State private var text = ""
    @State private var phase: Phase = .composing
    @FocusState private var focused: Bool

    enum Phase { case composing, sending, sent }

    var body: some View {
        ZStack {
            Color(hex: "#F6F4EF").ignoresSafeArea()

            switch phase {
            case .composing:
                composingView
            case .sending:
                Color.clear  // blank during transition
            case .sent:
                sentView
            }
        }
        .onAppear { focused = true }
    }

    private var composingView: some View {
        VStack(alignment: .leading, spacing: 0) {
            Spacer()

            VStack(alignment: .leading, spacing: 12) {
                Text("It may be read once.")
                    .font(.system(size: 14))
                    .opacity(0.4)
                Text("Or not at all.")
                    .font(.system(size: 14))
                    .opacity(0.4)
            }
            .padding(.bottom, 20)

            TextEditor(text: $text)
                .font(.system(size: 18))
                .focused($focused)
                .frame(minHeight: 120)
                .scrollContentBackground(.hidden)
                .background(Color.clear)
                .onChange(of: text) {
                    if text.count > 1000 { text = String(text.prefix(1000)) }
                }

            Spacer()

            HStack {
                Spacer()
                Button("Send") { send() }
                    .font(.system(size: 17))
                    .opacity(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? 0.3 : 0.8)
                    .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .buttonStyle(.plain)
            }
            .padding(.bottom, 48)
        }
        .padding(.horizontal, 28)
    }

    private var sentView: some View {
        Text("Sent.")
            .font(.system(size: 24, weight: .regular))
            .transition(.opacity)
    }

    private func send() {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        Task {
            withAnimation(.easeInOut(duration: 0.4)) { phase = .sent }
            try? await APIClient.shared.sendMessage(text: trimmed)
            await homeVM.loadStatus()

            try? await Task.sleep(for: .seconds(1.5))
            withAnimation(.easeInOut(duration: 0.3)) { dismiss() }
        }
    }
}
```

**Step 2: Build and preview**

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: add ComposeView with send flow and Sent. animation"
```

---

### Task 20: MessageView + Translation

**Files:**
- Create: `RelayCafe/Services/TranslationService.swift`
- Create: `RelayCafe/Views/MessageView.swift`

**Step 1: Create `Services/TranslationService.swift`**

```swift
import Foundation
import NaturalLanguage
import Translation

struct TranslationResult {
    let text: String
    let originalLanguage: String?
}

@MainActor
func translateIfNeeded(_ text: String) async -> TranslationResult {
    // Detect language
    let recognizer = NLLanguageRecognizer()
    recognizer.processString(text)
    let detected = recognizer.dominantLanguage

    // Skip translation if already in user's preferred language
    let preferred = Locale.preferredLanguages.first.flatMap { NLLanguage(rawValue: $0) }
    guard let detected, detected != preferred, detected != .undetermined else {
        return TranslationResult(text: text, originalLanguage: nil)
    }

    // Attempt on-device translation (iOS 17.4+)
    if #available(iOS 17.4, *) {
        do {
            let session = TranslationSession.Configuration(source: Locale.Language(identifier: detected.rawValue))
            let response = try await text.translated(to: Locale.current.language, using: session)
            let langName = Locale.current.localizedString(forLanguageCode: detected.rawValue) ?? detected.rawValue
            return TranslationResult(text: response.targetText, originalLanguage: langName)
        } catch {
            // Fall through to show original
        }
    }

    return TranslationResult(text: text, originalLanguage: nil)
}
```

**Step 2: Create `Views/MessageView.swift`**

```swift
import SwiftUI

struct MessageView: View {
    let message: MessageResponse
    @Bindable var homeVM: HomeViewModel
    @Environment(\.dismiss) var dismiss

    @State private var translation: TranslationResult?
    @State private var appeared = false

    var body: some View {
        ZStack {
            Color(hex: "#F6F4EF").ignoresSafeArea()

            VStack(alignment: .leading, spacing: 0) {
                Spacer()

                VStack(alignment: .leading, spacing: 20) {
                    Text(translation?.text ?? message.text)
                        .font(.system(size: 19, weight: .regular))
                        .lineSpacing(8)
                        .textSelection(.disabled)
                        .opacity(appeared ? 1 : 0)
                        .animation(.easeInOut(duration: 0.6), value: appeared)

                    if let lang = translation?.originalLanguage {
                        Text("Originally written in \(lang).")
                            .font(.system(size: 14))
                            .opacity(0.4)
                    } else if translation == nil {
                        // Still loading translation — placeholder
                        Color.clear.frame(height: 14)
                    }
                }

                Spacer()

                Button("Close") { close() }
                    .font(.system(size: 17))
                    .opacity(0.5)
                    .buttonStyle(.plain)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.bottom, 48)
            }
            .padding(.horizontal, 28)
        }
        .onAppear {
            withAnimation { appeared = true }
            Task {
                translation = await translateIfNeeded(message.text)
                if translation?.originalLanguage == nil {
                    translation = TranslationResult(text: message.text, originalLanguage: nil)
                }
            }
        }
        .interactiveDismissDisabled()  // prevent swipe-to-dismiss, user must tap Close
    }

    private func close() {
        withAnimation(.easeInOut(duration: 0.3)) { appeared = false }
        Task {
            try? await Task.sleep(for: .milliseconds(300))
            await homeVM.loadStatus()
            dismiss()
        }
    }
}
```

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: add MessageView with on-device translation"
```

---

### Task 21: SettingsView + account deletion

**Files:**
- Create: `RelayCafe/Views/SettingsView.swift`

**Step 1: Create `Views/SettingsView.swift`**

```swift
import SwiftUI

struct SettingsView: View {
    let appVM: AppViewModel
    @State private var showDeleteConfirm = false
    @State private var isDeleting = false

    var body: some View {
        ZStack {
            Color(hex: "#F6F4EF").ignoresSafeArea()

            VStack {
                Spacer()

                if showDeleteConfirm {
                    deleteConfirmView
                } else {
                    Button("Delete account") {
                        showDeleteConfirm = true
                    }
                    .font(.system(size: 17))
                    .opacity(0.5)
                    .buttonStyle(.plain)
                }

                Spacer()
            }
            .padding(.horizontal, 28)
        }
        .navigationBarTitleDisplayMode(.inline)
    }

    private var deleteConfirmView: some View {
        VStack(spacing: 24) {
            VStack(spacing: 12) {
                Text("Your account will be permanently removed.")
                    .font(.system(size: 17))
                    .multilineTextAlignment(.center)
                Text("This cannot be undone.")
                    .font(.system(size: 17))
                    .multilineTextAlignment(.center)
            }
            .opacity(0.7)

            HStack(spacing: 40) {
                Button("Cancel") {
                    showDeleteConfirm = false
                }
                .font(.system(size: 17))
                .opacity(0.5)
                .buttonStyle(.plain)

                Button("Delete account") {
                    Task { await deleteAccount() }
                }
                .font(.system(size: 17))
                .opacity(isDeleting ? 0.3 : 0.7)
                .disabled(isDeleting)
                .buttonStyle(.plain)
            }
        }
    }

    private func deleteAccount() async {
        isDeleting = true
        try? await APIClient.shared.deleteAccount()
        await MainActor.run {
            appVM.didDeleteAccount()
        }
    }
}
```

Add a "You've left the relay." transition to `AppViewModel.didDeleteAccount()`:

```swift
// In AppViewModel:
func didDeleteAccount() {
    // Brief display before returning to onboarding
    route = .onboarding
    UserDefaults.standard.removeObject(forKey: "onboardingComplete")
}
```

Show "You've left the relay." in OnboardingView if coming from deletion — pass a `fromDeletion: Bool` flag or handle in the view transition.

**Step 2: Commit**

```bash
git add -A
git commit -m "feat: add SettingsView with account deletion"
```

---

### Task 22: Dark mode + final polish

**Step 1: Add dark mode colors to all views**

In each view, replace `Color(hex: "#F6F4EF")` with:

```swift
extension Color {
    static var relayBackground: Color {
        Color(UIColor { trait in
            trait.userInterfaceStyle == .dark
                ? UIColor(red: 0.11, green: 0.11, blue: 0.11, alpha: 1)  // #1C1C1C
                : UIColor(red: 0.965, green: 0.957, blue: 0.937, alpha: 1)  // #F6F4EF
        })
    }
}
```

**Step 2: Disable text selection in MessageView**

Already set `.textSelection(.disabled)`.

**Step 3: Disable copy/share context menu**

Add `.contextMenu {}` (empty) to message text in MessageView to override default iOS context menu.

**Step 4: Final build and test on device**

Run on physical iPhone. Verify:
- Sign in with Apple works
- Send/receive flow end-to-end
- Translation fires on non-English messages
- Dark mode renders correctly
- Animations feel right (no bounce, no spring)

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: add dark mode support and final polish"
```

---

## Done

Backend v0.1 is on Railway. iOS app is ready for TestFlight.

**Verification checklist:**
- [ ] `GET /health` returns 200 on Railway
- [ ] Sign in with Apple creates user + session in DB
- [ ] Send message: encrypts, stores ciphertext, marks `send_used`
- [ ] Receive message: decrypts, deletes row, marks `receive_used`
- [ ] Second send same day: 429
- [ ] Message expires after 24h: cleanup job deletes it
- [ ] Delete account: hard-deletes user, cascades sessions + tokens
- [ ] iOS onboarding renders correctly on light + dark
- [ ] "Sent." animates and dismisses quietly
- [ ] 2-second blank pause before message appears
- [ ] Translation caption shows for non-English messages
- [ ] "The relay is quiet today." when pool empty

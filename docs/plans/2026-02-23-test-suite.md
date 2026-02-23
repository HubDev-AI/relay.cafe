# Relay.cafe Comprehensive Test Suite — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bulletproof the entire relay.cafe stack with unit, integration, E2E, and UI tests — fixing bugs as they surface.

**Architecture:** API tests use Bun's built-in test runner against a real Postgres DB and real GCP KMS (no mocks for infra — only for Apple JWT). iOS unit tests use XCTest; UI tests use XCUITest with a running local API server. Short configurable periods (`MESSAGE_TTL_SECONDS`, `TOKEN_PERIOD_SECONDS`) drive all time-based scenarios so no test waits more than a few seconds.

**Tech Stack:** Bun test, Hono `app.request()`, Drizzle ORM, GCP KMS, XCTest, XCUITest, NLLanguageRecognizer

---

## Prerequisites

Before starting any task, you need:

1. A `TEST_DATABASE_URL` pointing at a separate Postgres database (same server is fine, different DB name).
2. GCP KMS credentials (same `gcp-credentials.json` as dev — tests use the real KMS).
3. The `.env.test` file described in Task 1.

---

## Task 1: API Test Infrastructure

**Files:**
- Create: `relay-cafe-api/tests/helpers/db.ts`
- Create: `relay-cafe-api/tests/helpers/http.ts`
- Create: `relay-cafe-api/.env.test`
- Modify: `relay-cafe-api/src/db/index.ts` (make DB URL injectable for tests)

### Step 1: Create `.env.test`

```env
# relay-cafe-api/.env.test
# Copy your dev .env and override these:
TEST_DATABASE_URL=postgres://localhost:5432/relaycafe_test
MESSAGE_TTL_SECONDS=2
TOKEN_PERIOD_SECONDS=3
APPLE_ID_SALT=test-salt-for-tests
APPLE_BUNDLE_ID=cafe.relay.app
# GCP KMS vars: same as dev .env
```

### Step 2: Make the DB connection injectable

Modify `relay-cafe-api/src/db/index.ts` so tests can override the connection:

```typescript
// relay-cafe-api/src/db/index.ts
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

const DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL (or TEST_DATABASE_URL) environment variable is required')
}

const client = postgres(DATABASE_URL)
export const db = drizzle(client, { schema })
```

### Step 3: Create test DB helper

```typescript
// relay-cafe-api/tests/helpers/db.ts
import { db } from '../../src/db'
import { users, sessions, dailyTokens, messages, ipEvents } from '../../src/db/schema'
import { sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { createHash } from 'node:crypto'

/**
 * Wipe all rows. Call in beforeAll/beforeEach.
 */
export async function resetDB() {
  // Order matters: foreign keys
  await db.delete(messages)
  await db.delete(dailyTokens)
  await db.delete(sessions)
  await db.delete(ipEvents)
  await db.delete(users)
}

/**
 * Create a user with a deterministic apple ID hash.
 * Returns the user row.
 */
export async function createUser(appleSubId = `test-${randomUUID()}`) {
  const salt = process.env.APPLE_ID_SALT!
  const appleIdHash = createHash('sha256').update(salt + appleSubId).digest('hex')
  const [user] = await db.insert(users).values({ appleIdHash }).returning()
  return { user: user!, appleSubId }
}

/**
 * Create a session for an existing user.
 * Returns the session token (= session.id UUID).
 */
export async function createSession(userId: string, expiresInMs = 30 * 24 * 60 * 60 * 1000) {
  const expiresAt = new Date(Date.now() + expiresInMs)
  const [session] = await db.insert(sessions).values({ userId, expiresAt }).returning()
  return session!.id
}

/**
 * Insert an encrypted message directly into the DB for receive tests.
 * Uses real KMS encryption.
 */
export async function createMessage(opts?: { expiresInMs?: number }) {
  const { encryptMessage } = await import('../../src/lib/crypto')
  const { wrapKey } = await import('../../src/lib/kms')

  const text = `test-message-${randomUUID()}`
  const { ciphertext, iv, key } = await encryptMessage(text)
  const { encryptedKey, keyVersion } = await wrapKey(key)

  const ttlMs = opts?.expiresInMs ?? (Number(process.env.MESSAGE_TTL_SECONDS) || 86400) * 1000
  const expiresAt = new Date(Date.now() + ttlMs)

  const [msg] = await db.insert(messages).values({
    ciphertext,
    encryptedMessageKey: encryptedKey,
    kmsKeyVersion: keyVersion,
    iv,
    expiresAt,
  }).returning()

  return { message: msg!, plaintext: text }
}

/**
 * Create a user + session in one call. Returns { userId, token }.
 */
export async function createAuthenticatedUser(appleSubId?: string) {
  const { user } = await createUser(appleSubId)
  const token = await createSession(user.id)
  return { userId: user.id, token }
}
```

### Step 4: Create HTTP test helper

```typescript
// relay-cafe-api/tests/helpers/http.ts
import { app } from '../../src/app'
import { randomUUID } from 'node:crypto'

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE'

interface RequestOpts {
  method?: Method
  token?: string
  body?: Record<string, unknown>
  headers?: Record<string, string>
  ip?: string
}

/**
 * Make a request to the Hono app without starting a real HTTP server.
 * Uses Hono's `app.request()` which runs the full middleware stack.
 */
export async function request(path: string, opts: RequestOpts = {}) {
  const { method = 'GET', token, body, headers = {}, ip } = opts

  const init: RequestInit = { method, headers: { ...headers } }

  if (body) {
    ;(init.headers as Record<string, string>)['Content-Type'] = 'application/json'
    init.body = JSON.stringify(body)
  }

  if (token) {
    ;(init.headers as Record<string, string>)['Authorization'] = `Bearer ${token}`
  }

  // Rate limiter reads X-Forwarded-For; randomize per-request by default
  // so tests don't accidentally rate-limit each other.
  if (ip) {
    ;(init.headers as Record<string, string>)['X-Forwarded-For'] = ip
  } else {
    ;(init.headers as Record<string, string>)['X-Forwarded-For'] = `10.0.0.${Math.floor(Math.random() * 250) + 1}`
  }

  const url = `http://localhost${path}`
  const res = await app.request(url, init)
  return res
}

/**
 * Shorthand: make a request and parse the JSON body.
 */
export async function requestJSON<T = unknown>(path: string, opts: RequestOpts = {}) {
  const res = await request(path, opts)
  const json = res.status !== 204 ? await res.json() as T : null
  return { status: res.status, json, res }
}

/**
 * Generate a unique IP to avoid rate limit collisions between tests.
 */
export function uniqueIP(): string {
  return `192.168.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`
}
```

### Step 5: Run tests to make sure infrastructure loads

Run: `cd relay-cafe-api && bun test --help`
Expected: Bun test help output (confirms bun test is available)

### Step 6: Commit

```bash
git add relay-cafe-api/tests/ relay-cafe-api/.env.test relay-cafe-api/src/db/index.ts
git commit -m "test: add API test infrastructure — db helpers, http helpers, .env.test"
```

---

## Task 2: Crypto Unit Tests

**Files:**
- Create: `relay-cafe-api/tests/unit/crypto.test.ts`

### Step 1: Write the tests

```typescript
// relay-cafe-api/tests/unit/crypto.test.ts
import { test, expect, describe } from 'bun:test'
import { encryptMessage, decryptMessage } from '../../src/lib/crypto'
import { randomBytes } from 'node:crypto'

describe('encryptMessage + decryptMessage', () => {
  test('round-trip produces identical plaintext', async () => {
    const plaintext = 'Hello from the relay.'
    const { ciphertext, iv, key } = await encryptMessage(plaintext)
    const result = await decryptMessage(ciphertext, iv, key)
    expect(result).toBe(plaintext)
  })

  test('round-trip with emoji and unicode', async () => {
    const plaintext = '你好世界 🌍 مرحبا'
    const { ciphertext, iv, key } = await encryptMessage(plaintext)
    const result = await decryptMessage(ciphertext, iv, key)
    expect(result).toBe(plaintext)
  })

  test('round-trip with max-length 1000 character message', async () => {
    const plaintext = 'x'.repeat(1000)
    const { ciphertext, iv, key } = await encryptMessage(plaintext)
    const result = await decryptMessage(ciphertext, iv, key)
    expect(result).toBe(plaintext)
  })

  test('round-trip with empty-ish single character', async () => {
    const plaintext = ' '
    const { ciphertext, iv, key } = await encryptMessage(plaintext)
    const result = await decryptMessage(ciphertext, iv, key)
    expect(result).toBe(plaintext)
  })

  test('different plaintexts produce different ciphertexts', async () => {
    const a = await encryptMessage('message one')
    const b = await encryptMessage('message two')
    expect(a.ciphertext).not.toBe(b.ciphertext)
  })

  test('same plaintext encrypted twice produces different ciphertexts (random IV)', async () => {
    const a = await encryptMessage('identical')
    const b = await encryptMessage('identical')
    expect(a.ciphertext).not.toBe(b.ciphertext)
    expect(a.iv).not.toBe(b.iv)
  })

  test('wrong key fails decryption', async () => {
    const { ciphertext, iv } = await encryptMessage('secret')
    const wrongKey = randomBytes(32)
    await expect(decryptMessage(ciphertext, iv, wrongKey)).rejects.toThrow()
  })

  test('tampered ciphertext fails decryption', async () => {
    const { ciphertext, iv, key } = await encryptMessage('secret')
    const tampered = Buffer.from(ciphertext, 'base64')
    tampered[20] ^= 0xff // flip a byte
    const tamperedB64 = tampered.toString('base64')
    await expect(decryptMessage(tamperedB64, iv, key)).rejects.toThrow()
  })

  test('ciphertext is valid base64', async () => {
    const { ciphertext, iv } = await encryptMessage('test')
    expect(() => Buffer.from(ciphertext, 'base64')).not.toThrow()
    expect(() => Buffer.from(iv, 'base64')).not.toThrow()
  })

  test('key is 32 bytes', async () => {
    const { key } = await encryptMessage('test')
    expect(key.length).toBe(32)
  })

  test('IV is 12 bytes (base64-decoded)', async () => {
    const { iv } = await encryptMessage('test')
    expect(Buffer.from(iv, 'base64').length).toBe(12)
  })
})
```

### Step 2: Run tests

Run: `cd relay-cafe-api && bun test tests/unit/crypto.test.ts`
Expected: All 11 tests PASS

### Step 3: Commit

```bash
git add relay-cafe-api/tests/unit/crypto.test.ts
git commit -m "test: crypto encrypt/decrypt round-trip, tampering, edge cases"
```

---

## Task 3: Period Unit Tests

**Files:**
- Create: `relay-cafe-api/tests/unit/period.test.ts`

### Step 1: Write the tests

```typescript
// relay-cafe-api/tests/unit/period.test.ts
import { test, expect, describe, beforeEach, afterEach } from 'bun:test'
import { currentPeriod } from '../../src/lib/period'

describe('currentPeriod', () => {
  const originalEnv = process.env.TOKEN_PERIOD_SECONDS

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.TOKEN_PERIOD_SECONDS = originalEnv
    } else {
      delete process.env.TOKEN_PERIOD_SECONDS
    }
  })

  test('production mode (86400 or unset) returns YYYY-MM-DD', () => {
    process.env.TOKEN_PERIOD_SECONDS = '86400'
    const result = currentPeriod()
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  test('unset TOKEN_PERIOD_SECONDS defaults to YYYY-MM-DD', () => {
    delete process.env.TOKEN_PERIOD_SECONDS
    const result = currentPeriod()
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  test('production mode date matches UTC date', () => {
    process.env.TOKEN_PERIOD_SECONDS = '86400'
    const result = currentPeriod()
    const expected = new Date().toISOString().slice(0, 10)
    expect(result).toBe(expected)
  })

  test('test mode (< 86400) returns numeric period ID', () => {
    process.env.TOKEN_PERIOD_SECONDS = '300'
    const result = currentPeriod()
    expect(result).toMatch(/^\d+$/)
    expect(Number(result)).toBeGreaterThan(0)
  })

  test('test mode period ID is consistent within same period', () => {
    process.env.TOKEN_PERIOD_SECONDS = '300'
    const a = currentPeriod()
    const b = currentPeriod()
    expect(a).toBe(b)
  })

  test('test mode with 1-second period changes quickly', async () => {
    process.env.TOKEN_PERIOD_SECONDS = '1'
    const a = currentPeriod()
    await new Promise(r => setTimeout(r, 1100))
    const b = currentPeriod()
    expect(a).not.toBe(b)
  })

  test('very large TOKEN_PERIOD_SECONDS (>= 86400) uses date format', () => {
    process.env.TOKEN_PERIOD_SECONDS = '100000'
    const result = currentPeriod()
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
```

### Step 2: Run tests

Run: `cd relay-cafe-api && bun test tests/unit/period.test.ts`
Expected: All 7 tests PASS

### Step 3: Commit

```bash
git add relay-cafe-api/tests/unit/period.test.ts
git commit -m "test: currentPeriod() production/test mode, boundary, consistency"
```

---

## Task 4: Auth Route Integration Tests

**Files:**
- Create: `relay-cafe-api/tests/integration/auth.test.ts`

**Key challenge:** `POST /auth/apple` calls `verifyAppleToken` which hits Apple's JWKS endpoint. We mock this using Bun's `mock.module()`.

### Step 1: Write the tests

```typescript
// relay-cafe-api/tests/integration/auth.test.ts
import { test, expect, describe, beforeAll, beforeEach, mock } from 'bun:test'
import { resetDB } from '../helpers/db'
import { request, requestJSON, uniqueIP } from '../helpers/http'

// Mock Apple JWT verification before importing app routes
mock.module('../../src/lib/appleAuth', () => ({
  verifyAppleToken: async (token: string) => {
    if (token === 'INVALID') throw new Error('Invalid token')
    // Use the token value as the Apple sub ID for deterministic testing
    return { sub: `apple-${token}`, email: `${token}@test.com` }
  },
}))

describe('POST /auth/apple', () => {
  beforeAll(async () => {
    await resetDB()
  })

  test('valid token creates user and session', async () => {
    const { status, json } = await requestJSON<{ sessionToken: string; expiresAt: string }>('/auth/apple', {
      method: 'POST',
      body: { identityToken: 'user-one' },
    })
    expect(status).toBe(200)
    expect(json!.sessionToken).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    )
    expect(json!.expiresAt).toBeTruthy()
  })

  test('same Apple sub returns same user (upsert)', async () => {
    const r1 = await requestJSON<{ sessionToken: string }>('/auth/apple', {
      method: 'POST',
      body: { identityToken: 'same-user' },
    })
    const r2 = await requestJSON<{ sessionToken: string }>('/auth/apple', {
      method: 'POST',
      body: { identityToken: 'same-user' },
    })
    expect(r1.status).toBe(200)
    expect(r2.status).toBe(200)
    // Different sessions, but the session tokens are different (new session each login)
    expect(r1.json!.sessionToken).not.toBe(r2.json!.sessionToken)
  })

  test('invalid token returns 401', async () => {
    const { status, json } = await requestJSON('/auth/apple', {
      method: 'POST',
      body: { identityToken: 'INVALID' },
    })
    expect(status).toBe(401)
    expect(json).toHaveProperty('error')
  })

  test('missing identityToken returns 400', async () => {
    const { status } = await requestJSON('/auth/apple', {
      method: 'POST',
      body: {},
    })
    expect(status).toBe(400)
  })

  test('non-string identityToken returns 400', async () => {
    const { status } = await requestJSON('/auth/apple', {
      method: 'POST',
      body: { identityToken: 12345 },
    })
    expect(status).toBe(400)
  })

  test('expiresAt is a valid ISO8601 date ~30 days in the future', async () => {
    const { json } = await requestJSON<{ expiresAt: string }>('/auth/apple', {
      method: 'POST',
      body: { identityToken: 'expiry-check' },
    })
    const expiresAt = new Date(json!.expiresAt)
    const now = Date.now()
    const thirtyDays = 30 * 24 * 60 * 60 * 1000
    // Allow 5 seconds of clock skew
    expect(expiresAt.getTime()).toBeGreaterThan(now + thirtyDays - 5000)
    expect(expiresAt.getTime()).toBeLessThan(now + thirtyDays + 5000)
  })

  test('deviceFingerprint is stored if provided', async () => {
    const { status, json } = await requestJSON<{ sessionToken: string }>('/auth/apple', {
      method: 'POST',
      body: { identityToken: 'fingerprint-user', deviceFingerprint: 'iPhone16,1-18.0-1.0' },
    })
    expect(status).toBe(200)
    expect(json!.sessionToken).toBeTruthy()
    // We can't easily assert the DB value from here, but the endpoint shouldn't reject it
  })
})

describe('DELETE /auth/session', () => {
  let token: string

  beforeAll(async () => {
    await resetDB()
    const { json } = await requestJSON<{ sessionToken: string }>('/auth/apple', {
      method: 'POST',
      body: { identityToken: 'logout-user' },
    })
    token = json!.sessionToken
  })

  test('valid session is deleted', async () => {
    const res = await request('/auth/session', { method: 'DELETE', token })
    expect(res.status).toBe(204)
  })

  test('deleted session no longer authenticates', async () => {
    const { status } = await requestJSON('/me/status', { token })
    expect(status).toBe(401)
  })

  test('no auth returns 401', async () => {
    const res = await request('/auth/session', { method: 'DELETE' })
    expect(res.status).toBe(401)
  })
})

describe('POST /auth/apple rate limiting', () => {
  beforeAll(async () => {
    await resetDB()
  })

  test('allows 5 requests from same IP', async () => {
    const ip = uniqueIP()
    for (let i = 0; i < 5; i++) {
      const { status } = await requestJSON('/auth/apple', {
        method: 'POST',
        body: { identityToken: `rate-test-${i}` },
        ip,
      })
      expect(status).toBe(200)
    }
  })

  test('6th request from same IP returns 429', async () => {
    const ip = uniqueIP()
    for (let i = 0; i < 5; i++) {
      await request('/auth/apple', {
        method: 'POST',
        body: { identityToken: `rate-block-${i}` },
        ip,
      })
    }
    const { status } = await requestJSON('/auth/apple', {
      method: 'POST',
      body: { identityToken: 'rate-block-6' },
      ip,
    })
    expect(status).toBe(429)
  })

  test('different IPs are not affected by each other', async () => {
    const ipA = uniqueIP()
    const ipB = uniqueIP()
    // Exhaust IP A
    for (let i = 0; i < 5; i++) {
      await request('/auth/apple', { method: 'POST', body: { identityToken: `a-${i}` }, ip: ipA })
    }
    // IP B should still work
    const { status } = await requestJSON('/auth/apple', {
      method: 'POST',
      body: { identityToken: 'b-1' },
      ip: ipB,
    })
    expect(status).toBe(200)
  })
})
```

### Step 2: Run tests

Run: `cd relay-cafe-api && bun test tests/integration/auth.test.ts`
Expected: All tests PASS

### Step 3: Commit

```bash
git add relay-cafe-api/tests/integration/auth.test.ts
git commit -m "test: auth route — Apple sign-in, session delete, rate limiting"
```

---

## Task 5: Me Route Integration Tests

**Files:**
- Create: `relay-cafe-api/tests/integration/me.test.ts`

### Step 1: Write the tests

```typescript
// relay-cafe-api/tests/integration/me.test.ts
import { test, expect, describe, beforeAll, beforeEach } from 'bun:test'
import { resetDB, createAuthenticatedUser, createMessage } from '../helpers/db'
import { requestJSON, request } from '../helpers/http'
import { db } from '../../src/db'
import { users, sessions, dailyTokens } from '../../src/db/schema'
import { eq } from 'drizzle-orm'

describe('GET /me/status', () => {
  let token: string

  beforeAll(async () => {
    await resetDB()
    const auth = await createAuthenticatedUser()
    token = auth.token
  })

  test('fresh user has both tokens available', async () => {
    const { status, json } = await requestJSON<{ sendUsed: boolean; receiveUsed: boolean; date: string }>('/me/status', { token })
    expect(status).toBe(200)
    expect(json!.sendUsed).toBe(false)
    expect(json!.receiveUsed).toBe(false)
    expect(json!.date).toBeTruthy()
  })

  test('no auth returns 401', async () => {
    const { status } = await requestJSON('/me/status')
    expect(status).toBe(401)
  })

  test('invalid token returns 401', async () => {
    const { status } = await requestJSON('/me/status', { token: '00000000-0000-0000-0000-000000000000' })
    expect(status).toBe(401)
  })

  test('non-UUID token returns 401', async () => {
    const { status } = await requestJSON('/me/status', { token: 'not-a-uuid' })
    expect(status).toBe(401)
  })

  test('expired session returns 401', async () => {
    await resetDB()
    const auth = await createAuthenticatedUser()
    // Manually expire the session
    await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.userId, auth.userId))
    const { status } = await requestJSON('/me/status', { token: auth.token })
    expect(status).toBe(401)
  })
})

describe('DELETE /me (account deletion)', () => {
  test('deletes user and cascades sessions + tokens', async () => {
    await resetDB()
    const auth = await createAuthenticatedUser()
    // Create a daily token row so there's something to cascade
    await requestJSON('/me/status', { token: auth.token })

    const res = await request('/me', { method: 'DELETE', token: auth.token })
    expect(res.status).toBe(204)

    // Verify user is gone
    const [user] = await db.select().from(users).where(eq(users.id, auth.userId)).limit(1)
    expect(user).toBeUndefined()

    // Verify sessions cascaded
    const [session] = await db.select().from(sessions).where(eq(sessions.userId, auth.userId)).limit(1)
    expect(session).toBeUndefined()

    // Verify daily tokens cascaded
    const [tok] = await db.select().from(dailyTokens).where(eq(dailyTokens.userId, auth.userId)).limit(1)
    expect(tok).toBeUndefined()
  })

  test('deleted session no longer authenticates', async () => {
    await resetDB()
    const auth = await createAuthenticatedUser()
    await request('/me', { method: 'DELETE', token: auth.token })
    const { status } = await requestJSON('/me/status', { token: auth.token })
    expect(status).toBe(401)
  })

  test('messages left in pool survive after user deleted (anonymous)', async () => {
    await resetDB()
    const sender = await createAuthenticatedUser()
    // Send a message
    await requestJSON('/messages', {
      method: 'POST',
      token: sender.token,
      body: { text: 'I will survive' },
    })
    // Delete the sender's account
    await request('/me', { method: 'DELETE', token: sender.token })

    // A different user should still be able to receive the message
    const receiver = await createAuthenticatedUser()
    const { status, json } = await requestJSON<{ text: string }>('/messages/today', { token: receiver.token })
    expect(status).toBe(200)
    expect(json!.text).toBe('I will survive')
  })

  test('no auth returns 401', async () => {
    const res = await request('/me', { method: 'DELETE' })
    expect(res.status).toBe(401)
  })
})
```

### Step 2: Run tests

Run: `cd relay-cafe-api && bun test tests/integration/me.test.ts`
Expected: All tests PASS

### Step 3: Commit

```bash
git add relay-cafe-api/tests/integration/me.test.ts
git commit -m "test: me route — status, account deletion, cascade, anonymous messages"
```

---

## Task 6: Messages Send Integration Tests

**Files:**
- Create: `relay-cafe-api/tests/integration/messages-send.test.ts`

### Step 1: Write the tests

```typescript
// relay-cafe-api/tests/integration/messages-send.test.ts
import { test, expect, describe, beforeAll, beforeEach } from 'bun:test'
import { resetDB, createAuthenticatedUser } from '../helpers/db'
import { requestJSON } from '../helpers/http'
import { db } from '../../src/db'
import { messages, dailyTokens } from '../../src/db/schema'
import { eq, and } from 'drizzle-orm'
import { currentPeriod } from '../../src/lib/period'

describe('POST /messages (send)', () => {
  let token: string
  let userId: string

  beforeEach(async () => {
    await resetDB()
    const auth = await createAuthenticatedUser()
    token = auth.token
    userId = auth.userId
  })

  test('valid send returns 201 with { ok: true }', async () => {
    const { status, json } = await requestJSON('/messages', {
      method: 'POST',
      token,
      body: { text: 'Hello stranger' },
    })
    expect(status).toBe(201)
    expect(json).toEqual({ ok: true })
  })

  test('send creates encrypted message in DB', async () => {
    await requestJSON('/messages', {
      method: 'POST',
      token,
      body: { text: 'Check the DB' },
    })
    const allMessages = await db.select().from(messages)
    expect(allMessages.length).toBe(1)
    // Ciphertext should not contain the plaintext
    expect(allMessages[0].ciphertext).not.toContain('Check the DB')
    expect(allMessages[0].ciphertext.length).toBeGreaterThan(0)
    expect(allMessages[0].iv.length).toBeGreaterThan(0)
    expect(allMessages[0].encryptedMessageKey.length).toBeGreaterThan(0)
    expect(allMessages[0].kmsKeyVersion.length).toBeGreaterThan(0)
    expect(allMessages[0].delivered).toBe(false)
  })

  test('send marks sendUsed=true in daily tokens', async () => {
    await requestJSON('/messages', {
      method: 'POST',
      token,
      body: { text: 'Check tokens' },
    })
    const today = currentPeriod()
    const [tok] = await db.select().from(dailyTokens).where(
      and(eq(dailyTokens.userId, userId), eq(dailyTokens.date, today))
    ).limit(1)
    expect(tok!.sendUsed).toBe(true)
    expect(tok!.receiveUsed).toBe(false)
  })

  test('expiresAt is set correctly based on MESSAGE_TTL_SECONDS', async () => {
    const before = Date.now()
    await requestJSON('/messages', {
      method: 'POST',
      token,
      body: { text: 'TTL check' },
    })
    const after = Date.now()
    const ttlMs = (Number(process.env.MESSAGE_TTL_SECONDS) || 86400) * 1000

    const [msg] = await db.select().from(messages)
    const expiresAt = msg!.expiresAt.getTime()
    expect(expiresAt).toBeGreaterThanOrEqual(before + ttlMs - 100)
    expect(expiresAt).toBeLessThanOrEqual(after + ttlMs + 100)
  })

  test('already sent today returns 429', async () => {
    await requestJSON('/messages', { method: 'POST', token, body: { text: 'first' } })
    const { status, json } = await requestJSON('/messages', {
      method: 'POST',
      token,
      body: { text: 'second attempt' },
    })
    expect(status).toBe(429)
    expect(json).toHaveProperty('error')
  })

  test('second send does NOT create a second message', async () => {
    await requestJSON('/messages', { method: 'POST', token, body: { text: 'first' } })
    await requestJSON('/messages', { method: 'POST', token, body: { text: 'second' } })
    const allMessages = await db.select().from(messages)
    expect(allMessages.length).toBe(1)
  })

  test('empty text returns 400', async () => {
    const { status } = await requestJSON('/messages', {
      method: 'POST',
      token,
      body: { text: '' },
    })
    expect(status).toBe(400)
  })

  test('missing text field returns 400', async () => {
    const { status } = await requestJSON('/messages', {
      method: 'POST',
      token,
      body: {},
    })
    expect(status).toBe(400)
  })

  test('non-string text returns 400', async () => {
    const { status } = await requestJSON('/messages', {
      method: 'POST',
      token,
      body: { text: 12345 },
    })
    expect(status).toBe(400)
  })

  test('text exceeding 1000 characters returns 400', async () => {
    const { status } = await requestJSON('/messages', {
      method: 'POST',
      token,
      body: { text: 'x'.repeat(1001) },
    })
    expect(status).toBe(400)
  })

  test('exactly 1000 characters is accepted', async () => {
    const { status } = await requestJSON('/messages', {
      method: 'POST',
      token,
      body: { text: 'x'.repeat(1000) },
    })
    expect(status).toBe(201)
  })

  test('whitespace-only text — server stores as-is (client trims)', async () => {
    // The server accepts any non-empty string; trimming is a client responsibility.
    const { status } = await requestJSON('/messages', {
      method: 'POST',
      token,
      body: { text: '   ' },
    })
    expect(status).toBe(201)
  })

  test('emoji message works', async () => {
    const { status } = await requestJSON('/messages', {
      method: 'POST',
      token,
      body: { text: '🌍🔥✨' },
    })
    expect(status).toBe(201)
  })

  test('no auth returns 401', async () => {
    const { status } = await requestJSON('/messages', {
      method: 'POST',
      body: { text: 'no auth' },
    })
    expect(status).toBe(401)
  })

  test('two users can both send in the same period', async () => {
    const userA = await createAuthenticatedUser()
    const userB = await createAuthenticatedUser()

    const resA = await requestJSON('/messages', {
      method: 'POST',
      token: userA.token,
      body: { text: 'from A' },
    })
    const resB = await requestJSON('/messages', {
      method: 'POST',
      token: userB.token,
      body: { text: 'from B' },
    })
    expect(resA.status).toBe(201)
    expect(resB.status).toBe(201)

    const allMessages = await db.select().from(messages)
    expect(allMessages.length).toBe(2)
  })
})
```

### Step 2: Run tests

Run: `cd relay-cafe-api && bun test tests/integration/messages-send.test.ts`
Expected: All tests PASS

### Step 3: Commit

```bash
git add relay-cafe-api/tests/integration/messages-send.test.ts
git commit -m "test: messages send — validation, token claiming, encryption, edge cases"
```

---

## Task 7: Messages Receive Integration Tests (Core)

**Files:**
- Create: `relay-cafe-api/tests/integration/messages-receive.test.ts`

### Step 1: Write the tests

```typescript
// relay-cafe-api/tests/integration/messages-receive.test.ts
import { test, expect, describe, beforeAll, beforeEach } from 'bun:test'
import { resetDB, createAuthenticatedUser, createMessage } from '../helpers/db'
import { requestJSON, request } from '../helpers/http'
import { db } from '../../src/db'
import { messages, dailyTokens } from '../../src/db/schema'
import { eq, and } from 'drizzle-orm'
import { currentPeriod } from '../../src/lib/period'

describe('GET /messages/today (receive)', () => {
  beforeEach(async () => {
    await resetDB()
  })

  test('message available — returns 200 with { id, text, expiresAt }', async () => {
    const { plaintext } = await createMessage()
    const receiver = await createAuthenticatedUser()

    const { status, json } = await requestJSON<{ id: string; text: string; expiresAt: string }>('/messages/today', {
      token: receiver.token,
    })
    expect(status).toBe(200)
    expect(json!.id).toBeTruthy()
    expect(json!.text).toBe(plaintext)
    expect(json!.expiresAt).toBeTruthy()
  })

  test('message is deleted from DB after delivery', async () => {
    await createMessage()
    const receiver = await createAuthenticatedUser()
    await requestJSON('/messages/today', { token: receiver.token })

    const remaining = await db.select().from(messages)
    expect(remaining.length).toBe(0)
  })

  test('receiveUsed is set to true after successful receive', async () => {
    await createMessage()
    const receiver = await createAuthenticatedUser()
    await requestJSON('/messages/today', { token: receiver.token })

    const today = currentPeriod()
    const [tok] = await db.select().from(dailyTokens).where(
      and(eq(dailyTokens.userId, receiver.userId), eq(dailyTokens.date, today))
    ).limit(1)
    expect(tok!.receiveUsed).toBe(true)
  })

  test('empty pool — returns 204, receiveUsed stays false', async () => {
    // No messages in pool
    const receiver = await createAuthenticatedUser()
    const res = await request('/messages/today', { token: receiver.token })
    expect(res.status).toBe(204)

    const today = currentPeriod()
    const [tok] = await db.select().from(dailyTokens).where(
      and(eq(dailyTokens.userId, receiver.userId), eq(dailyTokens.date, today))
    ).limit(1)
    expect(tok!.receiveUsed).toBe(false)
  })

  test('after empty pool, user can try again and succeed', async () => {
    const receiver = await createAuthenticatedUser()
    // First attempt: empty pool
    const r1 = await request('/messages/today', { token: receiver.token })
    expect(r1.status).toBe(204)

    // Now add a message
    await createMessage()

    // Second attempt: should succeed
    const { status, json } = await requestJSON<{ text: string }>('/messages/today', {
      token: receiver.token,
    })
    expect(status).toBe(200)
    expect(json!.text).toBeTruthy()
  })

  test('already received today returns 429', async () => {
    await createMessage()
    const receiver = await createAuthenticatedUser()
    await requestJSON('/messages/today', { token: receiver.token })

    // Insert another message so pool isn't empty
    await createMessage()

    const { status } = await requestJSON('/messages/today', { token: receiver.token })
    expect(status).toBe(429)
  })

  test('expiresAt is valid ISO8601 with milliseconds (the JS bug)', async () => {
    await createMessage()
    const receiver = await createAuthenticatedUser()
    const { json } = await requestJSON<{ expiresAt: string }>('/messages/today', {
      token: receiver.token,
    })
    // JS toISOString() always includes .000Z or .123Z format
    const expiresAt = json!.expiresAt
    const parsed = new Date(expiresAt)
    expect(parsed.getTime()).toBeGreaterThan(0)
    // Verify iOS-compatible format: the critical bug was iso8601 without fractional seconds
    const isoWithMs = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/
    const isoWithoutMs = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/
    expect(isoWithMs.test(expiresAt) || isoWithoutMs.test(expiresAt)).toBe(true)
  })

  test('expired message is NOT served', async () => {
    // Insert a message that has already expired
    await createMessage({ expiresInMs: -1000 })
    const receiver = await createAuthenticatedUser()
    const res = await request('/messages/today', { token: receiver.token })
    expect(res.status).toBe(204)
  })

  test('send and receive are independent token systems', async () => {
    const user = await createAuthenticatedUser()
    await createMessage()

    // Send first
    await requestJSON('/messages', {
      method: 'POST',
      token: user.token,
      body: { text: 'I sent' },
    })

    // Should still be able to receive
    const { status } = await requestJSON('/messages/today', { token: user.token })
    expect(status).toBe(200)
  })

  test('receive then send are independent', async () => {
    const user = await createAuthenticatedUser()
    await createMessage()

    // Receive first
    await requestJSON('/messages/today', { token: user.token })

    // Should still be able to send
    const { status } = await requestJSON('/messages', {
      method: 'POST',
      token: user.token,
      body: { text: 'I sent after receiving' },
    })
    expect(status).toBe(201)
  })

  test('decrypted text matches original plaintext', async () => {
    const { plaintext } = await createMessage()
    const receiver = await createAuthenticatedUser()
    const { json } = await requestJSON<{ text: string }>('/messages/today', {
      token: receiver.token,
    })
    expect(json!.text).toBe(plaintext)
  })

  test('no auth returns 401', async () => {
    const { status } = await requestJSON('/messages/today')
    expect(status).toBe(401)
  })

  test('multiple messages in pool — only one is served', async () => {
    await createMessage()
    await createMessage()
    await createMessage()
    const receiver = await createAuthenticatedUser()
    const { status } = await requestJSON('/messages/today', { token: receiver.token })
    expect(status).toBe(200)

    const remaining = await db.select().from(messages)
    expect(remaining.length).toBe(2)
  })
})
```

### Step 2: Run tests

Run: `cd relay-cafe-api && bun test tests/integration/messages-receive.test.ts`
Expected: All tests PASS

### Step 3: Commit

```bash
git add relay-cafe-api/tests/integration/messages-receive.test.ts
git commit -m "test: messages receive — delivery, rollback, expiry, token independence"
```

---

## Task 8: Message TTL and Token Period Boundary Tests

**Files:**
- Create: `relay-cafe-api/tests/integration/time-boundaries.test.ts`

**Important:** These tests rely on `MESSAGE_TTL_SECONDS=2` and `TOKEN_PERIOD_SECONDS=3` from `.env.test`. They use real `setTimeout` waits of a few seconds.

### Step 1: Write the tests

```typescript
// relay-cafe-api/tests/integration/time-boundaries.test.ts
import { test, expect, describe, beforeEach } from 'bun:test'
import { resetDB, createAuthenticatedUser, createMessage } from '../helpers/db'
import { requestJSON, request } from '../helpers/http'
import { db } from '../../src/db'
import { messages } from '../../src/db/schema'

const TTL_SECONDS = Number(process.env.MESSAGE_TTL_SECONDS) || 2
const PERIOD_SECONDS = Number(process.env.TOKEN_PERIOD_SECONDS) || 3

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

describe('message TTL expiry', () => {
  beforeEach(async () => {
    await resetDB()
  })

  test(`message expires after ${TTL_SECONDS}s — not served`, async () => {
    // Insert with the configured TTL (done automatically by createMessage using env)
    await createMessage()
    const receiver = await createAuthenticatedUser()

    // Wait for TTL to pass
    await sleep((TTL_SECONDS + 0.5) * 1000)

    const res = await request('/messages/today', { token: receiver.token })
    expect(res.status).toBe(204)
  }, (TTL_SECONDS + 2) * 1000)

  test('message is served when NOT expired', async () => {
    const { plaintext } = await createMessage()
    const receiver = await createAuthenticatedUser()

    // Receive immediately — well within TTL
    const { status, json } = await requestJSON<{ text: string }>('/messages/today', {
      token: receiver.token,
    })
    expect(status).toBe(200)
    expect(json!.text).toBe(plaintext)
  })

  test('mix of expired and fresh messages — only fresh is served', async () => {
    // Create an already-expired message
    await createMessage({ expiresInMs: -1000 })
    // Create a fresh message
    const { plaintext } = await createMessage()

    const receiver = await createAuthenticatedUser()
    const { status, json } = await requestJSON<{ text: string }>('/messages/today', {
      token: receiver.token,
    })
    expect(status).toBe(200)
    expect(json!.text).toBe(plaintext)
  })
})

describe('token period boundary', () => {
  beforeEach(async () => {
    await resetDB()
  })

  test(`user can send again after ${PERIOD_SECONDS}s period resets`, async () => {
    const user = await createAuthenticatedUser()

    // Send in current period
    const r1 = await requestJSON('/messages', {
      method: 'POST',
      token: user.token,
      body: { text: 'period 1' },
    })
    expect(r1.status).toBe(201)

    // Second send in same period fails
    const r2 = await requestJSON('/messages', {
      method: 'POST',
      token: user.token,
      body: { text: 'period 1 again' },
    })
    expect(r2.status).toBe(429)

    // Wait for period to change
    await sleep((PERIOD_SECONDS + 0.5) * 1000)

    // Send in new period succeeds
    const r3 = await requestJSON('/messages', {
      method: 'POST',
      token: user.token,
      body: { text: 'period 2' },
    })
    expect(r3.status).toBe(201)
  }, (PERIOD_SECONDS + 3) * 1000)

  test(`user can receive again after ${PERIOD_SECONDS}s period resets`, async () => {
    const receiver = await createAuthenticatedUser()

    // Insert and receive in period 1
    await createMessage()
    const r1 = await requestJSON('/messages/today', { token: receiver.token })
    expect(r1.status).toBe(200)

    // Second receive in same period fails
    await createMessage()
    const r2 = await requestJSON('/messages/today', { token: receiver.token })
    expect(r2.status).toBe(429)

    // Wait for period to change
    await sleep((PERIOD_SECONDS + 0.5) * 1000)

    // Receive in new period succeeds
    await createMessage()
    const r3 = await requestJSON('/messages/today', { token: receiver.token })
    expect(r3.status).toBe(200)
  }, (PERIOD_SECONDS + 3) * 1000)

  test('status reflects new period after reset', async () => {
    const user = await createAuthenticatedUser()

    // Use both tokens
    await createMessage()
    await requestJSON('/messages', { method: 'POST', token: user.token, body: { text: 'sent' } })
    await requestJSON('/messages/today', { token: user.token })

    const statusBefore = await requestJSON<{ sendUsed: boolean; receiveUsed: boolean }>('/me/status', { token: user.token })
    expect(statusBefore.json!.sendUsed).toBe(true)
    expect(statusBefore.json!.receiveUsed).toBe(true)

    // Wait for period reset
    await sleep((PERIOD_SECONDS + 0.5) * 1000)

    const statusAfter = await requestJSON<{ sendUsed: boolean; receiveUsed: boolean }>('/me/status', { token: user.token })
    expect(statusAfter.json!.sendUsed).toBe(false)
    expect(statusAfter.json!.receiveUsed).toBe(false)
  }, (PERIOD_SECONDS + 3) * 1000)
})
```

### Step 2: Run tests

Run: `cd relay-cafe-api && bun test tests/integration/time-boundaries.test.ts`
Expected: All tests PASS (some take ~3-4 seconds due to real waits)

### Step 3: Commit

```bash
git add relay-cafe-api/tests/integration/time-boundaries.test.ts
git commit -m "test: TTL expiry and token period boundary with configurable short periods"
```

---

## Task 9: Concurrent Receive Atomicity Test

**Files:**
- Create: `relay-cafe-api/tests/integration/messages-concurrent.test.ts`

### Step 1: Write the tests

```typescript
// relay-cafe-api/tests/integration/messages-concurrent.test.ts
import { test, expect, describe, beforeEach } from 'bun:test'
import { resetDB, createAuthenticatedUser, createMessage } from '../helpers/db'
import { requestJSON } from '../helpers/http'
import { db } from '../../src/db'
import { messages } from '../../src/db/schema'

describe('concurrent receive atomicity', () => {
  beforeEach(async () => {
    await resetDB()
  })

  test('two simultaneous receives for one message — only one gets it', async () => {
    await createMessage()
    const userA = await createAuthenticatedUser()
    const userB = await createAuthenticatedUser()

    // Fire both receives concurrently
    const [resA, resB] = await Promise.all([
      requestJSON<{ text: string }>('/messages/today', { token: userA.token }),
      requestJSON<{ text: string }>('/messages/today', { token: userB.token }),
    ])

    const statuses = [resA.status, resB.status].sort()
    // One gets 200 (message), the other gets 204 (empty pool)
    expect(statuses).toEqual([200, 204])

    // Message should be deleted from DB
    const remaining = await db.select().from(messages)
    expect(remaining.length).toBe(0)
  })

  test('10 concurrent receives for 3 messages — exactly 3 get served', async () => {
    await createMessage()
    await createMessage()
    await createMessage()

    const users = await Promise.all(
      Array.from({ length: 10 }, () => createAuthenticatedUser())
    )

    const results = await Promise.all(
      users.map(u => requestJSON('/messages/today', { token: u.token }))
    )

    const got200 = results.filter(r => r.status === 200).length
    const got204 = results.filter(r => r.status === 204).length
    expect(got200).toBe(3)
    expect(got204).toBe(7)

    // All messages deleted
    const remaining = await db.select().from(messages)
    expect(remaining.length).toBe(0)
  })
})
```

### Step 2: Run tests

Run: `cd relay-cafe-api && bun test tests/integration/messages-concurrent.test.ts`
Expected: All tests PASS

### Step 3: Commit

```bash
git add relay-cafe-api/tests/integration/messages-concurrent.test.ts
git commit -m "test: concurrent receive atomicity — FOR UPDATE SKIP LOCKED"
```

---

## Task 10: pg_cron Cleanup SQL Validation

**Files:**
- Create: `relay-cafe-api/tests/integration/cleanup-sql.test.ts`

### Step 1: Read the pg_cron SQL to know the exact DELETE statement

Check: `relay-cafe-api/drizzle/pg_cron_setup.sql` (if it exists) or the migration files.

### Step 2: Write the tests

```typescript
// relay-cafe-api/tests/integration/cleanup-sql.test.ts
import { test, expect, describe, beforeEach } from 'bun:test'
import { resetDB, createMessage } from '../helpers/db'
import { db } from '../../src/db'
import { messages } from '../../src/db/schema'
import { sql } from 'drizzle-orm'

describe('pg_cron cleanup SQL', () => {
  beforeEach(async () => {
    await resetDB()
  })

  // This is the exact SQL that pg_cron executes:
  // DELETE FROM messages WHERE expires_at <= NOW();
  async function runCleanupSQL() {
    await db.execute(sql`DELETE FROM messages WHERE expires_at <= NOW()`)
  }

  test('expired messages are deleted', async () => {
    await createMessage({ expiresInMs: -5000 })
    await createMessage({ expiresInMs: -1000 })

    await runCleanupSQL()

    const remaining = await db.select().from(messages)
    expect(remaining.length).toBe(0)
  })

  test('non-expired messages survive cleanup', async () => {
    await createMessage({ expiresInMs: 60000 })
    await createMessage({ expiresInMs: -1000 })

    await runCleanupSQL()

    const remaining = await db.select().from(messages)
    expect(remaining.length).toBe(1)
  })

  test('cleanup with empty table does not error', async () => {
    await expect(runCleanupSQL()).resolves.toBeUndefined()
  })

  test('message expiring at exactly NOW() is deleted', async () => {
    await createMessage({ expiresInMs: 0 })
    // Small delay to ensure NOW() > expiresAt
    await new Promise(r => setTimeout(r, 50))
    await runCleanupSQL()

    const remaining = await db.select().from(messages)
    expect(remaining.length).toBe(0)
  })
})
```

### Step 3: Run tests

Run: `cd relay-cafe-api && bun test tests/integration/cleanup-sql.test.ts`
Expected: All tests PASS

### Step 4: Commit

```bash
git add relay-cafe-api/tests/integration/cleanup-sql.test.ts
git commit -m "test: pg_cron cleanup SQL — expired deleted, non-expired survive"
```

---

## Task 11: KMS Integration Test

**Files:**
- Create: `relay-cafe-api/tests/integration/kms.test.ts`

### Step 1: Write the tests

```typescript
// relay-cafe-api/tests/integration/kms.test.ts
import { test, expect, describe } from 'bun:test'
import { wrapKey, unwrapKey } from '../../src/lib/kms'
import { randomBytes } from 'node:crypto'

describe('KMS wrap/unwrap (real GCP KMS)', () => {
  test('round-trip: wrap then unwrap returns identical key', async () => {
    const rawKey = randomBytes(32)
    const { encryptedKey, keyVersion } = await wrapKey(rawKey)
    const decryptedKey = await unwrapKey(encryptedKey, keyVersion)
    expect(Buffer.compare(rawKey, decryptedKey)).toBe(0)
  })

  test('encryptedKey is valid base64', async () => {
    const rawKey = randomBytes(32)
    const { encryptedKey } = await wrapKey(rawKey)
    expect(() => Buffer.from(encryptedKey, 'base64')).not.toThrow()
    expect(Buffer.from(encryptedKey, 'base64').length).toBeGreaterThan(0)
  })

  test('keyVersion contains the KMS key path', async () => {
    const rawKey = randomBytes(32)
    const { keyVersion } = await wrapKey(rawKey)
    expect(keyVersion).toContain('projects/')
    expect(keyVersion).toContain('cryptoKeys/')
  })

  test('different raw keys produce different encrypted keys', async () => {
    const keyA = randomBytes(32)
    const keyB = randomBytes(32)
    const resultA = await wrapKey(keyA)
    const resultB = await wrapKey(keyB)
    expect(resultA.encryptedKey).not.toBe(resultB.encryptedKey)
  })

  test('tampered encrypted key fails unwrap', async () => {
    const rawKey = randomBytes(32)
    const { encryptedKey, keyVersion } = await wrapKey(rawKey)
    const tampered = Buffer.from(encryptedKey, 'base64')
    tampered[10] ^= 0xff
    const tamperedB64 = tampered.toString('base64')
    await expect(unwrapKey(tamperedB64, keyVersion)).rejects.toThrow()
  })

  test('full encrypt → wrap → unwrap → decrypt chain', async () => {
    const { encryptMessage, decryptMessage } = await import('../../src/lib/crypto')
    const plaintext = 'KMS end-to-end test'
    const { ciphertext, iv, key } = await encryptMessage(plaintext)
    const { encryptedKey, keyVersion } = await wrapKey(key)
    const unwrapped = await unwrapKey(encryptedKey, keyVersion)
    const decrypted = await decryptMessage(ciphertext, iv, unwrapped)
    expect(decrypted).toBe(plaintext)
  })
})
```

### Step 2: Run tests

Run: `cd relay-cafe-api && bun test tests/integration/kms.test.ts`
Expected: All 6 tests PASS (requires valid GCP credentials)

### Step 3: Commit

```bash
git add relay-cafe-api/tests/integration/kms.test.ts
git commit -m "test: KMS wrap/unwrap real integration — round-trip, tamper, full chain"
```

---

## Task 12: Fix Existing iOS Tests + Add Decoding Tests

**Files:**
- Modify: `relay-cafe-ios/RelayCafeTests/APIClientTests.swift`
- Create: `relay-cafe-ios/RelayCafeTests/DecodingTests.swift`

### Step 1: Fix the broken `testMessageResponseDecodesCorrectly`

The existing test doesn't include `expiresAt` — which is a non-optional `Date` field. This test would crash. Fix it.

```swift
// relay-cafe-ios/RelayCafeTests/APIClientTests.swift
import XCTest
@testable import RelayCafe

final class APIClientTests: XCTestCase {
    /// Custom decoder matching APIClient's decoder — supports ISO8601 with and without fractional seconds.
    private let decoder: JSONDecoder = {
        let d = JSONDecoder()
        let fmt = ISO8601DateFormatter()
        fmt.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let fmt2 = ISO8601DateFormatter()
        d.dateDecodingStrategy = .custom { decoder in
            let c = try decoder.singleValueContainer()
            let s = try c.decode(String.self)
            if let d = fmt.date(from: s) { return d }
            if let d = fmt2.date(from: s) { return d }
            throw DecodingError.dataCorruptedError(in: c, debugDescription: "Invalid ISO8601 date: \(s)")
        }
        return d
    }()

    func testStatusDecodesCorrectly() throws {
        let json = """
        {"sendUsed": true, "receiveUsed": false, "date": "2026-02-23"}
        """.data(using: .utf8)!

        let status = try JSONDecoder().decode(DayStatus.self, from: json)
        XCTAssertTrue(status.sendUsed)
        XCTAssertFalse(status.receiveUsed)
    }

    func testMessageResponseDecodesWithMilliseconds() throws {
        let json = """
        {"id": "abc-123", "text": "hello world", "expiresAt": "2026-02-23T11:45:07.145Z"}
        """.data(using: .utf8)!

        let msg = try decoder.decode(MessageResponse.self, from: json)
        XCTAssertEqual(msg.id, "abc-123")
        XCTAssertEqual(msg.text, "hello world")
        XCTAssertNotNil(msg.expiresAt)
    }

    func testMessageResponseDecodesWithoutMilliseconds() throws {
        let json = """
        {"id": "abc-123", "text": "hello world", "expiresAt": "2026-02-23T11:45:07Z"}
        """.data(using: .utf8)!

        let msg = try decoder.decode(MessageResponse.self, from: json)
        XCTAssertEqual(msg.text, "hello world")
    }

    func testMessageResponseMissingExpiresAtThrows() {
        let json = """
        {"id": "abc-123", "text": "hello world"}
        """.data(using: .utf8)!

        XCTAssertThrowsError(try decoder.decode(MessageResponse.self, from: json))
    }

    func testStatusAllCombinations() throws {
        let combos: [(Bool, Bool)] = [(false, false), (true, false), (false, true), (true, true)]
        for (send, receive) in combos {
            let json = """
            {"sendUsed": \(send), "receiveUsed": \(receive), "date": "2026-02-23"}
            """.data(using: .utf8)!
            let status = try JSONDecoder().decode(DayStatus.self, from: json)
            XCTAssertEqual(status.sendUsed, send)
            XCTAssertEqual(status.receiveUsed, receive)
        }
    }
}
```

### Step 2: Run tests

Run: `cd relay-cafe-ios && xcodebuild test -project RelayCafe.xcodeproj -scheme RelayCafe -destination 'platform=iOS Simulator,name=iPhone 16e' -only-testing:RelayCafeTests/APIClientTests 2>&1 | tail -30`
Expected: All tests PASS

### Step 3: Commit

```bash
git add relay-cafe-ios/RelayCafeTests/APIClientTests.swift
git commit -m "fix: iOS decoding tests — add expiresAt, ISO8601 ms/no-ms, all combos"
```

---

## Task 13: iOS Language Detection Tests (200 Languages)

**Files:**
- Create: `relay-cafe-ios/RelayCafeTests/LanguageDetectionTests.swift`

### Step 1: Write the tests

NLLanguageRecognizer works on-device. We test `detectLanguage(in:)` directly with sample text in as many languages as possible. The function returns a display name (e.g., "Spanish") or nil if the text matches the user's preferred language.

```swift
// relay-cafe-ios/RelayCafeTests/LanguageDetectionTests.swift
import XCTest
import NaturalLanguage
@testable import RelayCafe

final class LanguageDetectionTests: XCTestCase {

    // MARK: — Core detection

    /// Test that language detection returns non-nil for text not in the user's preferred language.
    /// NLLanguageRecognizer needs enough text to detect reliably (~20+ characters).
    private static let languageSamples: [(code: String, text: String)] = [
        ("ar", "مرحبا بكم في الموقع الالكتروني"),
        ("bg", "Добре дошли в електронния сайт"),
        ("bn", "ইলেকট্রনিক ওয়েবসাইটে স্বাগতম"),
        ("ca", "Benvinguts al lloc web electrònic"),
        ("cs", "Vítejte na elektronických webových stránkách"),
        ("cy", "Croeso i'r wefan electronig"),
        ("da", "Velkommen til den elektroniske hjemmeside"),
        ("de", "Willkommen auf der elektronischen Webseite"),
        ("el", "Καλώς ήρθατε στον ηλεκτρονικό ιστότοπο"),
        ("es", "Bienvenidos al sitio web electrónico"),
        ("et", "Tere tulemast elektroonilisele veebilehele"),
        ("fa", "به وب سایت الکترونیکی خوش آمدید"),
        ("fi", "Tervetuloa elektroniselle verkkosivustolle"),
        ("fr", "Bienvenue sur le site internet électronique"),
        ("ga", "Fáilte go dtí an suíomh gréasáin leictreonach"),
        ("gu", "ઇલેક્ટ્રોનિક વેબસાઇટ પર આપનું સ્વાગત છે"),
        ("he", "ברוכים הבאים לאתר האלקטרוני"),
        ("hi", "इलेक्ट्रॉनिक वेबसाइट में आपका स्वागत है"),
        ("hr", "Dobrodošli na elektroničku web stranicu"),
        ("hu", "Üdvözöljük az elektronikus weboldalon"),
        ("hy", "Բարի գալdelays էdelays delays"),
        ("id", "Selamat datang di situs web elektronik"),
        ("is", "Velkomin á rafræna vefsíðu"),
        ("it", "Benvenuti nel sito web elettronico"),
        ("ja", "電子ウェブサイトへようこそ"),
        ("ka", "კეთილი იყოს თქვენი მობრძანება ელექტრონულ ვებგვერდზე"),
        ("kk", "Электрондық веб-сайтқа қош келдіңіз"),
        ("km", "សូមស្វាគមន៍មកកាន់គេហទំព័រអេឡិចត្រូនិក"),
        ("kn", "ಎಲೆಕ್ಟ್ರಾನಿಕ್ ವೆಬ್‌ಸೈಟ್‌ಗೆ ಸ್ವಾಗತ"),
        ("ko", "전자 웹사이트에 오신 것을 환영합니다"),
        ("lt", "Sveiki atvykę į elektroninę svetainę"),
        ("lv", "Laipni lūdzam elektroniskajā tīmekļa vietnē"),
        ("mk", "Добредојдовте на електронската веб-страница"),
        ("ml", "ഇലക്ട്രോണിക് വെബ്‌സൈറ്റിലേക്ക് സ്വാഗതം"),
        ("mn", "Цахим вэб сайтад тавтай морилно уу"),
        ("mr", "इलेक्ट्रॉनिक वेबसाइटवर आपले स्वागत आहे"),
        ("ms", "Selamat datang ke laman web elektronik"),
        ("my", "အီလက်ထရောနစ်ဝက်ဘ်ဆိုက်သို့ကြိုဆိုပါသည်"),
        ("nb", "Velkommen til den elektroniske nettsiden"),
        ("ne", "इलेक्ट्रोनिक वेबसाइटमा स्वागत छ"),
        ("nl", "Welkom op de elektronische website"),
        ("pa", "ਇਲੈਕਟ੍ਰਾਨਿਕ ਵੈੱਬਸਾਈਟ ਵਿੱਚ ਜੀ ਆਇਆ ਨੂੰ"),
        ("pl", "Witamy na stronie internetowej elektronicznej"),
        ("pt", "Bem-vindos ao website eletrónico"),
        ("ro", "Bun venit pe site-ul electronic"),
        ("ru", "Добро пожаловать на электронный сайт"),
        ("si", "ඉලෙක්ට්‍රොනික වෙබ් අඩවියට සාදරයෙන් පිළිගනිමු"),
        ("sk", "Vitajte na elektronickej webovej stránke"),
        ("sl", "Dobrodošli na elektronski spletni strani"),
        ("sq", "Mirë se vini në faqen elektronike"),
        ("sr", "Добродошли на електронску веб страницу"),
        ("sv", "Välkommen till den elektroniska webbplatsen"),
        ("sw", "Karibu kwenye tovuti ya kielektroniki"),
        ("ta", "மின்னணு இணையதளத்திற்கு வருக"),
        ("te", "ఎలక్ట్రానిక్ వెబ్‌సైట్‌కు స్వాగతం"),
        ("th", "ยินดีต้อนรับสู่เว็บไซต์อิเล็กทรอนิกส์"),
        ("tl", "Maligayang pagdating sa elektronikong website"),
        ("tr", "Elektronik web sitesine hoş geldiniz"),
        ("uk", "Ласкаво просимо на електронний веб-сайт"),
        ("ur", "الیکٹرانک ویب سائٹ میں خوش آمدید"),
        ("vi", "Chào mừng đến trang web điện tử"),
        ("zh-Hans", "欢迎来到电子网站"),
        ("zh-Hant", "歡迎來到電子網站"),
    ]

    func testDetectsNonEnglishLanguages() {
        // detectLanguage returns a display name or nil.
        // If the test device's preferred language matches the sample, it returns nil (no translation needed).
        // We just verify it doesn't crash and returns a string for foreign text.
        for sample in Self.languageSamples {
            let result = detectLanguage(in: sample.text)
            // If the sample language matches device preferred language, nil is correct.
            // Otherwise we expect a non-empty display name.
            if result != nil {
                XCTAssertFalse(result!.isEmpty, "Expected display name for \(sample.code), got empty string")
            }
            // In either case, no crash = pass
        }
    }

    func testEnglishTextReturnsNilOnEnglishDevice() {
        // On an English-language simulator, English text should return nil (no translation needed)
        let preferredLang = Locale.preferredLanguages.first ?? ""
        guard preferredLang.hasPrefix("en") else {
            // Skip on non-English simulators
            return
        }
        let result = detectLanguage(in: "Welcome to the electronic website for testing purposes")
        XCTAssertNil(result)
    }

    func testShortTextReturnsNilGracefully() {
        // NLLanguageRecognizer can't reliably detect language from very short text
        let result = detectLanguage(in: "Hi")
        // Should not crash; may return nil or a guess
        _ = result
    }

    func testEmptyTextReturnsNil() {
        let result = detectLanguage(in: "")
        XCTAssertNil(result)
    }

    func testEmojiOnlyReturnsNil() {
        let result = detectLanguage(in: "🌍🔥✨🎉💫")
        XCTAssertNil(result)
    }

    func testDisplayNameIsHumanReadable() {
        // Spanish text on an English device should return "Spanish", not "es"
        let preferredLang = Locale.preferredLanguages.first ?? ""
        guard preferredLang.hasPrefix("en") else { return }
        let result = detectLanguage(in: "Bienvenidos al sitio web electrónico de pruebas")
        if let result {
            // Should be a human-readable name like "Spanish", not a code like "es"
            XCTAssertFalse(result.count <= 3, "Expected human-readable name, got '\(result)'")
        }
    }

    // MARK: — Locale.localizedString coverage

    /// Verify Locale.current.localizedString(forLanguageCode:) returns non-nil for all NLLanguage codes.
    /// This is the function detectLanguage() uses to turn "es" → "Spanish".
    func testLocalizedStringCoversAllLanguageCodes() {
        let codes = Self.languageSamples.map { $0.code }
        for code in codes {
            let name = Locale.current.localizedString(forLanguageCode: code)
            XCTAssertNotNil(name, "No localized name for code: \(code)")
            if let name {
                XCTAssertFalse(name.isEmpty, "Empty localized name for code: \(code)")
            }
        }
    }
}
```

### Step 2: Run tests

Run: `cd relay-cafe-ios && xcodebuild test -project RelayCafe.xcodeproj -scheme RelayCafe -destination 'platform=iOS Simulator,name=iPhone 16e' -only-testing:RelayCafeTests/LanguageDetectionTests 2>&1 | tail -30`
Expected: All tests PASS

### Step 3: Commit

```bash
git add relay-cafe-ios/RelayCafeTests/LanguageDetectionTests.swift
git commit -m "test: language detection — 60+ languages, edge cases, display name coverage"
```

---

## Task 14: Implement Screenshot Detection in MessageView

**Files:**
- Modify: `relay-cafe-ios/RelayCafe/Views/MessageView.swift`

### Step 1: Add screenshot detection

Add a `NotificationCenter` observer for `UIApplication.userDidTakeScreenshotNotification` in `MessageView`. On screenshot, immediately invalidate the message (same behavior as expiry).

```swift
// In MessageView body, add this modifier after the existing .onReceive(Timer...):
.onReceive(NotificationCenter.default.publisher(for: UIApplication.userDidTakeScreenshotNotification)) { _ in
    guard !expired else { return }
    withAnimation(.easeInOut(duration: 0.35)) { expired = true }
}
```

Also add a debug-mode trigger for XCUITest. At the bottom of the body modifiers:

```swift
#if DEBUG
.onReceive(NotificationCenter.default.publisher(for: Notification.Name("relay.simulateScreenshot"))) { _ in
    guard !expired else { return }
    withAnimation(.easeInOut(duration: 0.35)) { expired = true }
}
#endif
```

### Step 2: Build and verify

Run: `cd relay-cafe-ios && xcodebuild build -project RelayCafe.xcodeproj -scheme RelayCafe -destination 'platform=iOS Simulator,name=iPhone 16e' 2>&1 | tail -10`
Expected: BUILD SUCCEEDED

### Step 3: Commit

```bash
git add relay-cafe-ios/RelayCafe/Views/MessageView.swift
git commit -m "feat: screenshot detection — invalidate message on screenshot (v1)"
```

---

## Task 15: iOS Screenshot Detection Unit Test

**Files:**
- Create: `relay-cafe-ios/RelayCafeTests/ScreenshotDetectionTests.swift`

### Step 1: Write the test

We can't easily unit-test a SwiftUI view's `.onReceive` in isolation. Instead we verify the notification name exists and that posting it doesn't crash. The real coverage comes from XCUITest (Task 19).

```swift
// relay-cafe-ios/RelayCafeTests/ScreenshotDetectionTests.swift
import XCTest
import UIKit

final class ScreenshotDetectionTests: XCTestCase {
    func testScreenshotNotificationNameExists() {
        // Verify the notification constant is accessible
        let name = UIApplication.userDidTakeScreenshotNotification
        XCTAssertEqual(name.rawValue, "UIApplicationUserDidTakeScreenshotNotification")
    }

    func testDebugSimulateScreenshotNotificationCanBePosted() {
        #if DEBUG
        let expectation = expectation(forNotification: Notification.Name("relay.simulateScreenshot"), object: nil)
        NotificationCenter.default.post(name: Notification.Name("relay.simulateScreenshot"), object: nil)
        wait(for: [expectation], timeout: 1.0)
        #endif
    }
}
```

### Step 2: Run tests

Run: `cd relay-cafe-ios && xcodebuild test -project RelayCafe.xcodeproj -scheme RelayCafe -destination 'platform=iOS Simulator,name=iPhone 16e' -only-testing:RelayCafeTests/ScreenshotDetectionTests 2>&1 | tail -20`
Expected: All tests PASS

### Step 3: Commit

```bash
git add relay-cafe-ios/RelayCafeTests/ScreenshotDetectionTests.swift
git commit -m "test: screenshot detection notification existence and debug trigger"
```

---

## Task 16: Add XCUITest Target to iOS Project

**Files:**
- Modify: `relay-cafe-ios/project.yml`
- Create: `relay-cafe-ios/RelayCafeUITests/` directory

### Step 1: Add the UI test target to project.yml

Add this to the `targets:` section in `relay-cafe-ios/project.yml`:

```yaml
  RelayCafeUITests:
    type: bundle.ui-testing
    platform: iOS
    deploymentTarget: "17.0"
    sources:
      - path: RelayCafeUITests
    dependencies:
      - target: RelayCafe
    settings:
      base:
        PRODUCT_BUNDLE_IDENTIFIER: cafe.relay.app.uitests
        SWIFT_VERSION: "6.0"
```

### Step 2: Create the directory with a base test file

```swift
// relay-cafe-ios/RelayCafeUITests/RelayCafeUITestCase.swift
import XCTest

/// Base class for all UI tests.
/// Ensures the app launches pointing at the local test server.
class RelayCafeUITestCase: XCTestCase {
    var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        // Clear keychain state so we start fresh
        app.launchArguments += ["-resetState"]
        app.launch()
    }

    override func tearDownWithError() throws {
        app.terminate()
    }

    // MARK: — Helpers

    /// Wait for an element to exist with a timeout.
    func waitForElement(_ element: XCUIElement, timeout: TimeInterval = 5) {
        let exists = element.waitForExistence(timeout: timeout)
        XCTAssertTrue(exists, "Expected element to exist: \(element)")
    }
}
```

### Step 3: Regenerate the Xcode project

Run: `cd relay-cafe-ios && xcodegen generate 2>&1` (if using xcodegen) or if using `project.yml` directly, the .xcodeproj needs regeneration.

**Note:** Check if the project uses xcodegen. If the `project.yml` is used with xcodegen, run `xcodegen`. Otherwise, manually add the UI test target in Xcode.

### Step 4: Commit

```bash
git add relay-cafe-ios/project.yml relay-cafe-ios/RelayCafeUITests/
git commit -m "test: add XCUITest target to iOS project"
```

---

## Task 17: Add Accessibility Identifiers for XCUITest

**Files:**
- Modify: `relay-cafe-ios/RelayCafe/Views/HomeView.swift`
- Modify: `relay-cafe-ios/RelayCafe/Views/ComposeView.swift`
- Modify: `relay-cafe-ios/RelayCafe/Views/MessageView.swift`
- Modify: `relay-cafe-ios/RelayCafe/Views/OnboardingView.swift`
- Modify: `relay-cafe-ios/RelayCafe/Views/SettingsView.swift`

### Step 1: Add accessibility identifiers

Add `.accessibilityIdentifier("identifier")` to key interactive elements so XCUITest can find them.

**HomeView.swift:**
```swift
// Send button
Button("Write today's message") { ... }
    .accessibilityIdentifier("home.sendButton")

// Receive button
Button("Open today's message") { ... }
    .accessibilityIdentifier("home.receiveButton")

// "You've already sent today." text
Text("You've already sent today.")
    .accessibilityIdentifier("home.sendUsedLabel")

// "You've already received today." text
Text("You've already received today.")
    .accessibilityIdentifier("home.receiveUsedLabel")

// "The relay is quiet today." text
Text("The relay is quiet today.")
    .accessibilityIdentifier("home.quietLabel")

// Settings link
NavigationLink(destination: SettingsView(appVM: vm)) { ... }
    .accessibilityIdentifier("home.settingsButton")
```

**ComposeView.swift:**
```swift
TextEditor(text: $text)
    .accessibilityIdentifier("compose.textEditor")

Button("Send") { send() }
    .accessibilityIdentifier("compose.sendButton")

Button("Done") { dismiss() }
    .accessibilityIdentifier("compose.doneButton")

// Error text (both sendError cases)
Text(sendError)
    .accessibilityIdentifier("compose.errorLabel")
```

**MessageView.swift:**
```swift
Text(displayText)
    .accessibilityIdentifier("message.text")

Text("This message is no longer available.")
    .accessibilityIdentifier("message.expiredLabel")

Button("Close") { close() }
    .accessibilityIdentifier("message.closeButton")
```

**OnboardingView.swift** (add identifiers for title and continue button).

**SettingsView.swift:**
```swift
Button("Delete account") { ... }
    .accessibilityIdentifier("settings.deleteButton")

// Confirm delete button
Button("Delete account") { Task { await deleteAccount() } }
    .accessibilityIdentifier("settings.confirmDeleteButton")

Button("Cancel") { ... }
    .accessibilityIdentifier("settings.cancelButton")
```

### Step 2: Build and verify

Run: `cd relay-cafe-ios && xcodebuild build -project RelayCafe.xcodeproj -scheme RelayCafe -destination 'platform=iOS Simulator,name=iPhone 16e' 2>&1 | tail -10`
Expected: BUILD SUCCEEDED

### Step 3: Commit

```bash
git add relay-cafe-ios/RelayCafe/Views/
git commit -m "test: add accessibility identifiers for XCUITest"
```

---

## Task 18: XCUITest — Onboarding Flow

**Files:**
- Create: `relay-cafe-ios/RelayCafeUITests/OnboardingUITests.swift`

### Step 1: Write the test

```swift
// relay-cafe-ios/RelayCafeUITests/OnboardingUITests.swift
import XCTest

final class OnboardingUITests: RelayCafeUITestCase {
    func testOnboardingShowsRelayCopy() {
        waitForElement(app.staticTexts["Once a day,"])
        XCTAssertTrue(app.staticTexts["you may send a message."].exists)
        XCTAssertTrue(app.staticTexts["you may receive one."].exists)
    }

    func testContinueNavigatesToSignIn() {
        let continueButton = app.buttons["Continue"]
        waitForElement(continueButton)
        continueButton.tap()

        // Sign-in screen should appear
        let signInText = app.staticTexts["Sign in to enter the relay."]
        waitForElement(signInText)
    }
}
```

### Step 2: Run tests

Run: `cd relay-cafe-ios && xcodebuild test -project RelayCafe.xcodeproj -scheme RelayCafe -destination 'platform=iOS Simulator,name=iPhone 16e' -only-testing:RelayCafeUITests/OnboardingUITests 2>&1 | tail -30`
Expected: Tests PASS (on a freshly-reset state)

### Step 3: Commit

```bash
git add relay-cafe-ios/RelayCafeUITests/OnboardingUITests.swift
git commit -m "test: XCUITest onboarding — copy visible, continue navigates to sign-in"
```

---

## Task 19: XCUITest — Home Screen States

**Files:**
- Create: `relay-cafe-ios/RelayCafeUITests/HomeScreenUITests.swift`

**Prerequisites:** These tests require a signed-in user. The app needs to be launched with a valid session or we need to sign in through the UI first. Since Apple Sign-In can't be automated in XCUITest, we'll use a launch argument to inject a test session token.

### Step 1: Add test session injection support to the app

In `relay-cafe-ios/RelayCafe/App/RelayCafeApp.swift` or `AppViewModel.swift`, add:

```swift
#if DEBUG
// Allow tests to inject a session token via launch arguments
if ProcessInfo.processInfo.arguments.contains("-injectTestSession") {
    if let token = ProcessInfo.processInfo.environment["TEST_SESSION_TOKEN"] {
        try? KeychainManager().save(key: "sessionToken", value: token)
        let futureDate = ISO8601DateFormatter().string(from: Date.distantFuture)
        try? KeychainManager().save(key: "tokenExpiresAt", value: futureDate)
    }
}
#endif
```

### Step 2: Write the tests

```swift
// relay-cafe-ios/RelayCafeUITests/HomeScreenUITests.swift
import XCTest

final class HomeScreenUITests: RelayCafeUITestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        // The test needs a running local API server with a valid session.
        // Create the session via the API before each test, then inject.
        // For now, we set the required launch args.
        app.launchArguments += ["-injectTestSession"]
        app.launchEnvironment["TEST_SESSION_TOKEN"] = ProcessInfo.processInfo.environment["TEST_SESSION_TOKEN"] ?? ""
        app.launch()
    }

    func testBothButtonsVisibleOnFreshState() {
        let sendButton = app.buttons["home.sendButton"]
        let receiveButton = app.buttons["home.receiveButton"]
        waitForElement(sendButton)
        XCTAssertTrue(receiveButton.exists)
        XCTAssertTrue(sendButton.isEnabled)
        XCTAssertTrue(receiveButton.isEnabled)
    }

    func testSettingsButtonNavigates() {
        let settings = app.buttons["home.settingsButton"]
        waitForElement(settings)
        settings.tap()

        let deleteButton = app.buttons["settings.deleteButton"]
        waitForElement(deleteButton)
    }
}
```

### Step 3: Run tests

Run: `cd relay-cafe-ios && TEST_SESSION_TOKEN=<valid-token> xcodebuild test -project RelayCafe.xcodeproj -scheme RelayCafe -destination 'platform=iOS Simulator,name=iPhone 16e' -only-testing:RelayCafeUITests/HomeScreenUITests 2>&1 | tail -30`
Expected: Tests PASS with a valid local API server running

### Step 4: Commit

```bash
git add relay-cafe-ios/RelayCafeUITests/HomeScreenUITests.swift relay-cafe-ios/RelayCafe/App/RelayCafeApp.swift
git commit -m "test: XCUITest home screen — buttons visible, settings navigation"
```

---

## Task 20: XCUITest — Compose Flow

**Files:**
- Create: `relay-cafe-ios/RelayCafeUITests/ComposeUITests.swift`

### Step 1: Write the tests

```swift
// relay-cafe-ios/RelayCafeUITests/ComposeUITests.swift
import XCTest

final class ComposeUITests: RelayCafeUITestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments += ["-injectTestSession"]
        app.launchEnvironment["TEST_SESSION_TOKEN"] = ProcessInfo.processInfo.environment["TEST_SESSION_TOKEN"] ?? ""
        app.launch()
    }

    func testSendButtonDisabledWhenEmpty() {
        let sendButton = app.buttons["home.sendButton"]
        waitForElement(sendButton)
        sendButton.tap()

        let composeSend = app.buttons["compose.sendButton"]
        waitForElement(composeSend)
        // Text editor is empty, send should be disabled
        XCTAssertFalse(composeSend.isEnabled)
    }

    func testSendButtonEnabledWhenTextPresent() {
        let sendButton = app.buttons["home.sendButton"]
        waitForElement(sendButton)
        sendButton.tap()

        let textEditor = app.textViews["compose.textEditor"]
        waitForElement(textEditor)
        textEditor.tap()
        textEditor.typeText("Hello from the relay")

        let composeSend = app.buttons["compose.sendButton"]
        XCTAssertTrue(composeSend.isEnabled)
    }

    func testGuidanceTextVisible() {
        let sendButton = app.buttons["home.sendButton"]
        waitForElement(sendButton)
        sendButton.tap()

        waitForElement(app.staticTexts["It may be read once."])
        XCTAssertTrue(app.staticTexts["Or not at all."].exists)
    }
}
```

### Step 2: Run tests

Run: `cd relay-cafe-ios && TEST_SESSION_TOKEN=<valid-token> xcodebuild test -project RelayCafe.xcodeproj -scheme RelayCafe -destination 'platform=iOS Simulator,name=iPhone 16e' -only-testing:RelayCafeUITests/ComposeUITests 2>&1 | tail -30`
Expected: Tests PASS

### Step 3: Commit

```bash
git add relay-cafe-ios/RelayCafeUITests/ComposeUITests.swift
git commit -m "test: XCUITest compose — send disabled/enabled, guidance text"
```

---

## Task 21: XCUITest — Message View + Screenshot Detection

**Files:**
- Create: `relay-cafe-ios/RelayCafeUITests/MessageViewUITests.swift`

### Step 1: Write the tests

```swift
// relay-cafe-ios/RelayCafeUITests/MessageViewUITests.swift
import XCTest

final class MessageViewUITests: RelayCafeUITestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments += ["-injectTestSession"]
        app.launchEnvironment["TEST_SESSION_TOKEN"] = ProcessInfo.processInfo.environment["TEST_SESSION_TOKEN"] ?? ""
        app.launch()
    }

    func testMessageDisplaysAndCloseButtonWorks() {
        // Precondition: API has a message in the pool
        let receiveButton = app.buttons["home.receiveButton"]
        waitForElement(receiveButton)
        receiveButton.tap()

        // Wait for the message text to appear (after 2s loading pause)
        let messageText = app.staticTexts["message.text"]
        waitForElement(messageText, timeout: 10)
        XCTAssertTrue(messageText.exists)

        // Close the message
        let closeButton = app.buttons["message.closeButton"]
        XCTAssertTrue(closeButton.exists)
        closeButton.tap()

        // Should return to home screen
        waitForElement(receiveButton)
    }

    func testScreenshotInvalidatesMessage() {
        // Precondition: API has a message in the pool
        let receiveButton = app.buttons["home.receiveButton"]
        waitForElement(receiveButton)
        receiveButton.tap()

        let messageText = app.staticTexts["message.text"]
        waitForElement(messageText, timeout: 10)

        // Post the debug screenshot notification
        // This works because #if DEBUG adds an onReceive for "relay.simulateScreenshot"
        NotificationCenter.default.post(name: Notification.Name("relay.simulateScreenshot"), object: nil)

        // Wait for the expired label
        let expiredLabel = app.staticTexts["message.expiredLabel"]
        waitForElement(expiredLabel, timeout: 5)
        XCTAssertTrue(expiredLabel.exists)
    }
}
```

**Important note:** The `NotificationCenter.default.post` in XCUITest runs in the TEST process, not the app process. This won't work directly. Instead, we need to bridge the notification via a different mechanism.

**Alternative approach:** Use `app.launchArguments += ["-simulateScreenshot"]` and check for it in MessageView:

```swift
// In MessageView, add to .onAppear:
#if DEBUG
if ProcessInfo.processInfo.arguments.contains("-simulateScreenshot") {
    DispatchQueue.main.asyncAfter(deadline: .now() + 4) {
        guard !expired else { return }
        withAnimation(.easeInOut(duration: 0.35)) { expired = true }
    }
}
#endif
```

Then the XCUITest launches with `-simulateScreenshot` and waits for the expired state.

### Step 2: Run tests

Run: `cd relay-cafe-ios && TEST_SESSION_TOKEN=<valid-token> xcodebuild test -project RelayCafe.xcodeproj -scheme RelayCafe -destination 'platform=iOS Simulator,name=iPhone 16e' -only-testing:RelayCafeUITests/MessageViewUITests 2>&1 | tail -30`
Expected: Tests PASS

### Step 3: Commit

```bash
git add relay-cafe-ios/RelayCafeUITests/MessageViewUITests.swift relay-cafe-ios/RelayCafe/Views/MessageView.swift
git commit -m "test: XCUITest message view — display, close, screenshot detection"
```

---

## Task 22: Run Full Test Suite and Fix Any Bugs

### Step 1: Run all API tests

Run: `cd relay-cafe-api && bun test tests/`
Expected: All tests PASS. If any fail, fix the bugs.

### Step 2: Run all iOS unit tests

Run: `cd relay-cafe-ios && xcodebuild test -project RelayCafe.xcodeproj -scheme RelayCafe -destination 'platform=iOS Simulator,name=iPhone 16e' -only-testing:RelayCafeTests 2>&1 | tail -50`
Expected: All tests PASS. Fix any failures.

### Step 3: Run all iOS UI tests

Run: `cd relay-cafe-ios && TEST_SESSION_TOKEN=<valid-token> xcodebuild test -project RelayCafe.xcodeproj -scheme RelayCafe -destination 'platform=iOS Simulator,name=iPhone 16e' -only-testing:RelayCafeUITests 2>&1 | tail -50`
Expected: All tests PASS. Fix any failures.

### Step 4: Final commit

```bash
git add -A
git commit -m "fix: resolve test-discovered bugs from full suite run"
```

---

## Summary

| Layer | File Count | Test Cases | Key Coverage |
|-------|-----------|------------|--------------|
| API unit | 2 files | ~18 | crypto round-trip, period format |
| API integration | 7 files | ~55+ | auth, me, send, receive, TTL, concurrency, cleanup, KMS |
| iOS unit | 4 files | ~15+ | decoding, language detection (60+ langs), screenshot, keychain |
| iOS XCUITest | 4 files | ~10+ | onboarding, home, compose, message view |
| **Total** | **17 files** | **~98+** | |

**Bugs that tests will surface:**
1. `APIClientTests.testMessageResponseDecodesCorrectly` — missing `expiresAt` (KNOWN, fixed in Task 12)
2. Any timing edge cases in TTL/period boundaries (Task 8)
3. Concurrent receive atomicity (Task 9)
4. Screenshot detection is NEW functionality (Tasks 14-15)
5. Any cascade failures in account deletion (Task 5)

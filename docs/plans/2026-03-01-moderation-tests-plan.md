# Moderation Test Suite + TS Fixes — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all TypeScript errors, fix existing broken tests, and add comprehensive unit/integration/E2E tests for the App Store 1.2 moderation system.

**Architecture:** Extend existing Bun test infrastructure (real DB, real KMS, Hono `app.request()`). Fix TS strict mode errors. Add XCUITest E2E tests for iOS moderation UI pointed at local API.

**Tech Stack:** Bun test runner (`bun:test`), Drizzle ORM, Hono, XCUITest, xcodegen

---

### Task 1: Fix TypeScript Errors in Source Files

**Files:**
- Modify: `relay-cafe-api/src/routes/messages.ts`
- Modify: `relay-cafe-api/src/routes/me.ts`
- Modify: `relay-cafe-api/src/lib/sessionToken.ts`
- Modify: `relay-cafe-api/src/lib/adapters/inMemoryRateLimiter.ts`

**Step 1: Fix Hono context typing in messages.ts**

The `c.get('userId')` calls fail because the router's `Variables` type isn't declared. Add the type parameter:

```typescript
// relay-cafe-api/src/routes/messages.ts line 14
// BEFORE:
export const messagesRouter = new Hono()

// AFTER:
export const messagesRouter = new Hono<{ Variables: { userId: string } }>()
```

This fixes all 4 `c.get('userId')` errors in this file. Remove the `as string` casts since the type is now known.

**Step 2: Fix Hono context typing in me.ts**

```typescript
// relay-cafe-api/src/routes/me.ts line 9
// BEFORE:
export const meRouter = new Hono()

// AFTER:
export const meRouter = new Hono<{ Variables: { userId: string } }>()
```

Remove `as string` casts from `c.get('userId')` on lines 15 and 32.

**Step 3: Fix SESSION_SALT in sessionToken.ts**

The `SESSION_SALT` is `string | undefined` but guarded by a throw on line 4-6. The `createHmac` call on line 13 fails because TS doesn't narrow module-level `const` after the guard. Fix:

```typescript
// relay-cafe-api/src/lib/sessionToken.ts line 3
// BEFORE:
const SESSION_SALT = process.env.SESSION_SALT
if (!SESSION_SALT) {
  throw new Error('SESSION_SALT environment variable is required')
}

// AFTER:
const SESSION_SALT = process.env.SESSION_SALT
if (!SESSION_SALT) {
  throw new Error('SESSION_SALT environment variable is required')
}
const salt: string = SESSION_SALT
```

Then use `salt` instead of `SESSION_SALT` in `hashToken`:

```typescript
export function hashToken(rawToken: string): string {
  return createHmac('sha256', salt).update(rawToken).digest('hex')
}
```

**Step 4: Fix timestamps[0] in inMemoryRateLimiter.ts**

Line 37: `timestamps[0]` is `number | undefined` due to `noUncheckedIndexedAccess`. The `length >= maxRequests` guard ensures the array is non-empty, but TS can't infer that.

```typescript
// relay-cafe-api/src/lib/adapters/inMemoryRateLimiter.ts line 37
// BEFORE:
const resetAt = timestamps[0] + windowMs

// AFTER:
const resetAt = timestamps[0]! + windowMs
```

**Step 5: Run type check**

Run: `cd relay-cafe-api && npx tsc --noEmit 2>&1 | grep -c 'error TS'`
Expected: Only test file errors remain (helpers/db.ts, integration tests, unit tests)

**Step 6: Commit**

```bash
git add relay-cafe-api/src/routes/messages.ts relay-cafe-api/src/routes/me.ts relay-cafe-api/src/lib/sessionToken.ts relay-cafe-api/src/lib/adapters/inMemoryRateLimiter.ts
git commit -m "fix: resolve TypeScript strict mode errors in source files"
```

---

### Task 2: Fix Test Helpers and Broken Tests

**Files:**
- Modify: `relay-cafe-api/tests/helpers/db.ts`
- Modify: `relay-cafe-api/tests/integration/messages-receive.test.ts:200-218`
- Modify: `relay-cafe-api/tests/integration/messages-send.test.ts`
- Modify: `relay-cafe-api/tests/integration/kms.test.ts`
- Modify: `relay-cafe-api/tests/unit/crypto.test.ts`
- Modify: `relay-cafe-api/tests/unit/rateLimitMiddleware.test.ts`

**Step 1: Fix resetDB() — add moderation tables**

The `resetDB()` function doesn't clean `deliveryLog`, `reports`, or `blockedSenders`. Deleting `users` will CASCADE to these tables now (thanks to the FK fixes in PR #62), but `messages` must be deleted before `users` since messages reference users.

```typescript
// relay-cafe-api/tests/helpers/db.ts
// BEFORE (lines 1-16):
import { db } from '../../src/db'
import { users, sessions, dailyTokens, messages } from '../../src/db/schema'
import { sql } from 'drizzle-orm'
import { randomUUID, createHash } from 'node:crypto'
import { generateToken, hashToken } from '../../src/lib/sessionToken'

export async function resetDB() {
  // Order matters: foreign keys
  await db.delete(messages)
  await db.delete(dailyTokens)
  await db.delete(sessions)
  await db.delete(users)
}

// AFTER:
import { db } from '../../src/db'
import { users, sessions, dailyTokens, messages, deliveryLog, reports, blockedSenders } from '../../src/db/schema'
import { sql } from 'drizzle-orm'
import { randomUUID, createHash } from 'node:crypto'
import { generateToken, hashToken } from '../../src/lib/sessionToken'

export async function resetDB() {
  // Order matters: FK dependencies (children before parents)
  await db.delete(reports)
  await db.delete(deliveryLog)
  await db.delete(blockedSenders)
  await db.delete(messages)
  await db.delete(dailyTokens)
  await db.delete(sessions)
  await db.delete(users)
}
```

**Step 2: Fix createMessage() — add senderUserId**

The `messages` table now requires `senderUserId`. The helper must accept it or create a sender.

```typescript
// relay-cafe-api/tests/helpers/db.ts
// BEFORE (lines 45-65):
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

// AFTER:
export async function createMessage(opts?: { expiresInMs?: number; senderUserId?: string }) {
  const { encryptMessage } = await import('../../src/lib/crypto')
  const { wrapKey } = await import('../../src/lib/kms')

  // Use provided sender or create one
  let senderUserId = opts?.senderUserId
  if (!senderUserId) {
    const { user } = await createUser()
    senderUserId = user.id
  }

  const text = `test-message-${randomUUID()}`
  const { ciphertext, iv, key } = await encryptMessage(text)
  const { encryptedKey, keyVersion } = await wrapKey(key)

  const ttlMs = opts?.expiresInMs ?? (Number(process.env.MESSAGE_TTL_SECONDS) || 86400) * 1000
  const expiresAt = new Date(Date.now() + ttlMs)

  const [msg] = await db.insert(messages).values({
    senderUserId,
    ciphertext,
    encryptedMessageKey: encryptedKey,
    kmsKeyVersion: keyVersion,
    iv,
    expiresAt,
  }).returning()

  return { message: msg!, plaintext: text, senderUserId }
}
```

**Step 3: Fix self-receive test**

The test at `messages-receive.test.ts:200-218` now expects self-receive to succeed, but the moderation system blocks it. Fix:

```typescript
// relay-cafe-api/tests/integration/messages-receive.test.ts
// REPLACE the test "send then receive own message (single user)" (lines 200-218) with:
  test('self-receive is prevented — user cannot receive own message', async () => {
    const user = await createAuthenticatedUser()

    await requestJSON('/v1/messages', {
      method: 'POST',
      token: user.token,
      body: { text: 'self-loop-' + Date.now() },
    })

    const res = await request('/v1/messages/today', {
      token: user.token,
    })
    // 204 = no messages available (own message is excluded)
    expect(res.status).toBe(204)

    // Message is still in DB (not delivered, not deleted)
    const remaining = await db.select().from(messages)
    expect(remaining.length).toBe(1)
  })
```

**Step 4: Fix noUncheckedIndexedAccess errors in test files**

`messages-send.test.ts` lines 39-43 — array access on `allMessages[0]`:

```typescript
// relay-cafe-api/tests/integration/messages-send.test.ts lines 38-44
// BEFORE:
    expect(allMessages[0].ciphertext).not.toContain('Check the DB')
    expect(allMessages[0].ciphertext.length).toBeGreaterThan(0)
    expect(allMessages[0].iv.length).toBeGreaterThan(0)
    expect(allMessages[0].encryptedMessageKey.length).toBeGreaterThan(0)
    expect(allMessages[0].kmsKeyVersion.length).toBeGreaterThan(0)

// AFTER:
    const msg = allMessages[0]!
    expect(msg.ciphertext).not.toContain('Check the DB')
    expect(msg.ciphertext.length).toBeGreaterThan(0)
    expect(msg.iv.length).toBeGreaterThan(0)
    expect(msg.encryptedMessageKey.length).toBeGreaterThan(0)
    expect(msg.kmsKeyVersion.length).toBeGreaterThan(0)
```

`kms.test.ts` line 39 — `tampered[10]`:

```typescript
// relay-cafe-api/tests/integration/kms.test.ts line 39
// BEFORE:
    tampered[10] ^= 0xff

// AFTER:
    tampered[10] = tampered[10]! ^ 0xff
```

`crypto.test.ts` line 56 — same pattern:

```typescript
// relay-cafe-api/tests/unit/crypto.test.ts line 56
// BEFORE:
    tampered[20] ^= 0xff

// AFTER:
    tampered[20] = tampered[20]! ^ 0xff
```

`rateLimitMiddleware.test.ts` line 36-37 — `body` is `unknown`:

```typescript
// relay-cafe-api/tests/unit/rateLimitMiddleware.test.ts line 36-37
// BEFORE:
    const body = await res.json()
    expect(body.error).toBe('Please try again later.')

// AFTER:
    const body = await res.json() as { error: string }
    expect(body.error).toBe('Please try again later.')
```

**Step 5: Run type check**

Run: `cd relay-cafe-api && npx tsc --noEmit`
Expected: 0 errors

**Step 6: Run existing tests**

Run: `cd relay-cafe-api && bun test`
Expected: All existing tests pass (including the fixed self-receive test)

**Step 7: Commit**

```bash
git add relay-cafe-api/tests/ relay-cafe-api/src/
git commit -m "fix: repair broken tests and resolve remaining TS errors"
```

---

### Task 3: Content Filter Unit Tests

**Files:**
- Create: `relay-cafe-api/tests/unit/contentFilter.test.ts`

**Step 1: Write the tests**

```typescript
import { describe, test, expect } from 'bun:test'
import { checkContent } from '../../src/lib/contentFilter'

describe('checkContent', () => {
  // Category 1: Severe slurs
  test('blocks severe racial slurs', () => {
    expect(checkContent('you are a nigger').blocked).toBe(true)
    expect(checkContent('hey nigga').blocked).toBe(true)
  })

  test('blocks homophobic slurs', () => {
    expect(checkContent('you faggot').blocked).toBe(true)
    expect(checkContent('shut up fag').blocked).toBe(true)
  })

  test('blocks ethnic slurs', () => {
    expect(checkContent('stupid chink').blocked).toBe(true)
    expect(checkContent('go back wetback').blocked).toBe(true)
  })

  // Category 2+3: Sexual / CSAM
  test('blocks child exploitation terms', () => {
    expect(checkContent('looking for child porn').blocked).toBe(true)
    expect(checkContent('preteen sex content').blocked).toBe(true)
    expect(checkContent('looking for underage').blocked).toBe(true)
  })

  // Category 4: Violent threats
  test('blocks explicit violent threats', () => {
    expect(checkContent('i will kill you').blocked).toBe(true)
    expect(checkContent('im going to murder you').blocked).toBe(true)
    expect(checkContent('kill yourself').blocked).toBe(true)
    expect(checkContent('kys').blocked).toBe(true)
  })

  // Category 5: Extreme harassment
  test('blocks extreme harassment', () => {
    expect(checkContent('i hope you die').blocked).toBe(true)
    expect(checkContent('go die already').blocked).toBe(true)
    expect(checkContent('drink bleach').blocked).toBe(true)
  })

  // Word boundary — no false positives
  test('does not block words containing blocked substrings', () => {
    expect(checkContent('I flagged the issue').blocked).toBe(false)
    expect(checkContent('She has a classic style').blocked).toBe(false)
    expect(checkContent('The dyke was built to hold water').blocked).toBe(false)
  })

  // Normalization: punctuation stripping
  test('catches evasion with punctuation (k.i.l.l, f*ck)', () => {
    expect(checkContent('k.i.l.l yourself').blocked).toBe(true)
    expect(checkContent('i will k-i-l-l you').blocked).toBe(true)
  })

  // Normalization: case insensitive
  test('catches mixed case', () => {
    expect(checkContent('KILL YOURSELF').blocked).toBe(true)
    expect(checkContent('Kill Yourself').blocked).toBe(true)
  })

  // Normalization: zero-width chars
  test('catches zero-width character evasion', () => {
    expect(checkContent('kill\u200Byourself').blocked).toBe(true)
    expect(checkContent('k\u200Dys').blocked).toBe(true)
  })

  // Clean messages pass
  test('allows normal messages', () => {
    expect(checkContent('Hello, how are you?').blocked).toBe(false)
    expect(checkContent('Have a wonderful day!').blocked).toBe(false)
    expect(checkContent('The weather is nice today').blocked).toBe(false)
    expect(checkContent('I love coding in TypeScript').blocked).toBe(false)
  })

  // Edge cases
  test('handles empty string', () => {
    expect(checkContent('').blocked).toBe(false)
  })

  test('handles whitespace-only', () => {
    expect(checkContent('   ').blocked).toBe(false)
  })

  test('handles single character', () => {
    expect(checkContent('a').blocked).toBe(false)
  })

  test('handles max length clean message', () => {
    expect(checkContent('x'.repeat(1000)).blocked).toBe(false)
  })
})
```

**Step 2: Run tests**

Run: `cd relay-cafe-api && bun test tests/unit/contentFilter.test.ts`
Expected: All tests pass

**Step 3: Commit**

```bash
git add relay-cafe-api/tests/unit/contentFilter.test.ts
git commit -m "test: add content filter unit tests"
```

---

### Task 4: Moderation Integration Tests

**Files:**
- Create: `relay-cafe-api/tests/integration/moderation.test.ts`

**Step 1: Write the tests**

```typescript
import { test, expect, describe, beforeEach } from 'bun:test'
import { resetDB, createAuthenticatedUser, createMessage, createUser, createSession } from '../helpers/db'
import { requestJSON, request } from '../helpers/http'
import { db } from '../../src/db'
import { messages, users, deliveryLog, reports, blockedSenders } from '../../src/db/schema'
import { eq, sql } from 'drizzle-orm'

describe('Moderation', () => {
  beforeEach(async () => {
    await resetDB()
  })

  // ── Self-receive prevention ──────────────────────────────

  describe('self-receive prevention', () => {
    test('user cannot receive their own message', async () => {
      const sender = await createAuthenticatedUser()

      // Send a message
      await requestJSON('/v1/messages', {
        method: 'POST',
        token: sender.token,
        body: { text: 'hello from me' },
      })

      // Try to receive — should get 204 (no messages, own excluded)
      const res = await request('/v1/messages/today', { token: sender.token })
      expect(res.status).toBe(204)
    })

    test('user A can receive user B message', async () => {
      const sender = await createAuthenticatedUser()
      const receiver = await createAuthenticatedUser()

      await requestJSON('/v1/messages', {
        method: 'POST',
        token: sender.token,
        body: { text: 'cross-user message' },
      })

      const { status, json } = await requestJSON<{ text: string }>('/v1/messages/today', {
        token: receiver.token,
      })
      expect(status).toBe(200)
      expect(json!.text).toBe('cross-user message')
    })
  })

  // ── Content filter ───────────────────────────────────────

  describe('content filter on send', () => {
    test('blocked content returns 400', async () => {
      const user = await createAuthenticatedUser()
      const { status, json } = await requestJSON('/v1/messages', {
        method: 'POST',
        token: user.token,
        body: { text: 'kill yourself' },
      })
      expect(status).toBe(400)
      expect((json as { error: string }).error).toContain('community guidelines')
    })

    test('blocked content does not consume send token', async () => {
      const user = await createAuthenticatedUser()

      // Attempt blocked content
      await requestJSON('/v1/messages', {
        method: 'POST',
        token: user.token,
        body: { text: 'kill yourself' },
      })

      // Should still be able to send clean content
      const { status } = await requestJSON('/v1/messages', {
        method: 'POST',
        token: user.token,
        body: { text: 'Have a nice day' },
      })
      expect(status).toBe(201)
    })

    test('blocked content is not stored in DB', async () => {
      const user = await createAuthenticatedUser()
      await requestJSON('/v1/messages', {
        method: 'POST',
        token: user.token,
        body: { text: 'i will kill you' },
      })

      const allMessages = await db.select().from(messages)
      expect(allMessages.length).toBe(0)
    })
  })

  // ── Suspension ───────────────────────────────────────────

  describe('suspension check on send', () => {
    test('suspended user gets 403', async () => {
      const user = await createAuthenticatedUser()

      // Manually suspend
      await db.update(users).set({ suspended: true }).where(eq(users.id, user.userId))

      const { status, json } = await requestJSON('/v1/messages', {
        method: 'POST',
        token: user.token,
        body: { text: 'I am suspended' },
      })
      expect(status).toBe(403)
      expect((json as { error: string }).error).toContain('suspended')
    })

    test('suspended user does not consume send token', async () => {
      const user = await createAuthenticatedUser()
      await db.update(users).set({ suspended: true }).where(eq(users.id, user.userId))

      await requestJSON('/v1/messages', {
        method: 'POST',
        token: user.token,
        body: { text: 'test' },
      })

      // No messages created
      const allMessages = await db.select().from(messages)
      expect(allMessages.length).toBe(0)
    })
  })

  // ── Report flow ──────────────────────────────────────────

  describe('report', () => {
    async function sendAndReceive() {
      const sender = await createAuthenticatedUser()
      const receiver = await createAuthenticatedUser()

      await requestJSON('/v1/messages', {
        method: 'POST',
        token: sender.token,
        body: { text: 'reportable message' },
      })

      const { json } = await requestJSON<{ id: string }>('/v1/messages/today', {
        token: receiver.token,
      })

      return { sender, receiver, messageId: json!.id }
    }

    test('report returns 200 and increments strike', async () => {
      const { sender, receiver, messageId } = await sendAndReceive()

      const { status } = await requestJSON(`/v1/messages/${messageId}/report`, {
        method: 'POST',
        token: receiver.token,
        body: {},
      })
      expect(status).toBe(200)

      // Verify strike incremented
      const [user] = await db.select().from(users).where(eq(users.id, sender.userId))
      expect(user!.strikeCount).toBe(1)
    })

    test('duplicate report is idempotent — no double strike', async () => {
      const { sender, receiver, messageId } = await sendAndReceive()

      await requestJSON(`/v1/messages/${messageId}/report`, {
        method: 'POST',
        token: receiver.token,
        body: {},
      })
      await requestJSON(`/v1/messages/${messageId}/report`, {
        method: 'POST',
        token: receiver.token,
        body: {},
      })

      const [user] = await db.select().from(users).where(eq(users.id, sender.userId))
      expect(user!.strikeCount).toBe(1)
    })

    test('report without delivery log returns 404', async () => {
      const user = await createAuthenticatedUser()
      const fakeId = '00000000-0000-0000-0000-000000000000'

      const { status } = await requestJSON(`/v1/messages/${fakeId}/report`, {
        method: 'POST',
        token: user.token,
        body: {},
      })
      expect(status).toBe(404)
    })

    test('3 strikes auto-suspends', async () => {
      const sender = await createAuthenticatedUser()

      // Generate 3 reports from different receivers
      for (let i = 0; i < 3; i++) {
        const receiver = await createAuthenticatedUser()

        await requestJSON('/v1/messages', {
          method: 'POST',
          token: sender.token,
          body: { text: `message ${i}` },
        })

        const { json } = await requestJSON<{ id: string }>('/v1/messages/today', {
          token: receiver.token,
        })

        await requestJSON(`/v1/messages/${json!.id}/report`, {
          method: 'POST',
          token: receiver.token,
          body: {},
        })

        // Reset send token for next iteration (new period trick not needed —
        // we reset sendUsed directly)
        await db.execute(sql`UPDATE daily_tokens SET send_used = false WHERE user_id = ${sender.userId}`)
      }

      // Verify suspended
      const [user] = await db.select().from(users).where(eq(users.id, sender.userId))
      expect(user!.suspended).toBe(true)
      expect(user!.strikeCount).toBe(3)

      // Verify can't send
      await db.execute(sql`UPDATE daily_tokens SET send_used = false WHERE user_id = ${sender.userId}`)
      const { status } = await requestJSON('/v1/messages', {
        method: 'POST',
        token: sender.token,
        body: { text: 'I am suspended now' },
      })
      expect(status).toBe(403)
    })

    test('report creates report record', async () => {
      const { receiver, messageId } = await sendAndReceive()

      await requestJSON(`/v1/messages/${messageId}/report`, {
        method: 'POST',
        token: receiver.token,
        body: {},
      })

      const allReports = await db.select().from(reports)
      expect(allReports.length).toBe(1)
      expect(allReports[0]!.messageId).toBe(messageId)
      expect(allReports[0]!.reporterUserId).toBe(receiver.userId)
      expect(allReports[0]!.actionTaken).toBe('removed')
    })
  })

  // ── Block flow ───────────────────────────────────────────

  describe('block', () => {
    test('block sender returns 200', async () => {
      const sender = await createAuthenticatedUser()
      const receiver = await createAuthenticatedUser()

      await requestJSON('/v1/messages', {
        method: 'POST',
        token: sender.token,
        body: { text: 'block test' },
      })

      const { json } = await requestJSON<{ id: string }>('/v1/messages/today', {
        token: receiver.token,
      })

      const { status } = await requestJSON(`/v1/messages/${json!.id}/block`, {
        method: 'POST',
        token: receiver.token,
        body: {},
      })
      expect(status).toBe(200)
    })

    test('block is idempotent', async () => {
      const sender = await createAuthenticatedUser()
      const receiver = await createAuthenticatedUser()

      await requestJSON('/v1/messages', {
        method: 'POST',
        token: sender.token,
        body: { text: 'block test' },
      })

      const { json } = await requestJSON<{ id: string }>('/v1/messages/today', {
        token: receiver.token,
      })

      // Block twice
      await requestJSON(`/v1/messages/${json!.id}/block`, {
        method: 'POST', token: receiver.token, body: {},
      })
      await requestJSON(`/v1/messages/${json!.id}/block`, {
        method: 'POST', token: receiver.token, body: {},
      })

      const blocks = await db.select().from(blockedSenders)
      expect(blocks.length).toBe(1)
    })

    test('blocked sender messages are excluded from receive pool', async () => {
      const sender = await createAuthenticatedUser()
      const receiver = await createAuthenticatedUser()

      // Send + receive + block
      await requestJSON('/v1/messages', {
        method: 'POST',
        token: sender.token,
        body: { text: 'first message' },
      })
      const { json: msg1 } = await requestJSON<{ id: string }>('/v1/messages/today', {
        token: receiver.token,
      })
      await requestJSON(`/v1/messages/${msg1!.id}/block`, {
        method: 'POST', token: receiver.token, body: {},
      })

      // Reset receive token
      await db.execute(sql`UPDATE daily_tokens SET receive_used = false WHERE user_id = ${receiver.userId}`)

      // Sender sends another message
      await db.execute(sql`UPDATE daily_tokens SET send_used = false WHERE user_id = ${sender.userId}`)
      await requestJSON('/v1/messages', {
        method: 'POST',
        token: sender.token,
        body: { text: 'second message after block' },
      })

      // Receiver should not get it
      const res = await request('/v1/messages/today', { token: receiver.token })
      expect(res.status).toBe(204)
    })

    test('block persists across account deletion and recreation', async () => {
      const { user: senderUser, appleSubId: senderAppleSub } = await createUser()
      const senderToken = await createSession(senderUser.id)
      const receiver = await createAuthenticatedUser()

      // Send + receive + block
      await requestJSON('/v1/messages', {
        method: 'POST',
        token: senderToken,
        body: { text: 'before deletion' },
      })
      const { json: msg } = await requestJSON<{ id: string }>('/v1/messages/today', {
        token: receiver.token,
      })
      await requestJSON(`/v1/messages/${msg!.id}/block`, {
        method: 'POST', token: receiver.token, body: {},
      })

      // Sender deletes account
      await requestJSON('/v1/me', {
        method: 'DELETE',
        token: senderToken,
      })

      // Clear cooldown so sender can recreate
      await db.execute(sql`DELETE FROM deleted_accounts`)

      // Sender recreates with same Apple ID
      const { user: newSenderUser } = await createUser(senderAppleSub)
      const newSenderToken = await createSession(newSenderUser.id)

      // New sender sends a message
      await requestJSON('/v1/messages', {
        method: 'POST',
        token: newSenderToken,
        body: { text: 'after recreation' },
      })

      // Reset receiver token
      await db.execute(sql`UPDATE daily_tokens SET receive_used = false WHERE user_id = ${receiver.userId}`)

      // Receiver should NOT get the message (block persists via apple_id_hash)
      const res = await request('/v1/messages/today', { token: receiver.token })
      expect(res.status).toBe(204)
    })
  })

  // ── Delivery log ─────────────────────────────────────────

  describe('delivery log', () => {
    test('receive creates delivery_log entry', async () => {
      const sender = await createAuthenticatedUser()
      const receiver = await createAuthenticatedUser()

      await requestJSON('/v1/messages', {
        method: 'POST',
        token: sender.token,
        body: { text: 'delivery log test' },
      })

      const { json } = await requestJSON<{ id: string }>('/v1/messages/today', {
        token: receiver.token,
      })

      const logs = await db.select().from(deliveryLog)
      expect(logs.length).toBe(1)
      expect(logs[0]!.messageId).toBe(json!.id)
      expect(logs[0]!.senderUserId).toBe(sender.userId)
      expect(logs[0]!.recipientUserId).toBe(receiver.userId)
    })
  })

  // ── Account deletion cascades ────────────────────────────

  describe('account deletion with moderation data', () => {
    test('user with messages in pool can delete account', async () => {
      const user = await createAuthenticatedUser()
      await requestJSON('/v1/messages', {
        method: 'POST',
        token: user.token,
        body: { text: 'pre-deletion message' },
      })

      const res = await request('/v1/me', { method: 'DELETE', token: user.token })
      expect(res.status).toBe(204)

      // Message should be cascade-deleted
      const remaining = await db.select().from(messages)
      expect(remaining.length).toBe(0)
    })

    test('user with delivery log and reports can delete account', async () => {
      const sender = await createAuthenticatedUser()
      const receiver = await createAuthenticatedUser()

      // Send, receive, report
      await requestJSON('/v1/messages', {
        method: 'POST',
        token: sender.token,
        body: { text: 'will be reported' },
      })
      const { json } = await requestJSON<{ id: string }>('/v1/messages/today', {
        token: receiver.token,
      })
      await requestJSON(`/v1/messages/${json!.id}/report`, {
        method: 'POST', token: receiver.token, body: {},
      })

      // Receiver can delete account (has delivery_log and report records)
      const res = await request('/v1/me', { method: 'DELETE', token: receiver.token })
      expect(res.status).toBe(204)
    })
  })

  // ── API response privacy ─────────────────────────────────

  describe('API response privacy', () => {
    test('receive response does not contain sender_user_id', async () => {
      const sender = await createAuthenticatedUser()
      const receiver = await createAuthenticatedUser()

      await requestJSON('/v1/messages', {
        method: 'POST',
        token: sender.token,
        body: { text: 'privacy check' },
      })

      const { json } = await requestJSON('/v1/messages/today', {
        token: receiver.token,
      })

      const keys = Object.keys(json as object)
      expect(keys).not.toContain('sender_user_id')
      expect(keys).not.toContain('senderUserId')
      expect(keys).not.toContain('apple_id_hash')
      expect(keys).not.toContain('appleIdHash')
      // Only expected keys
      expect(keys.sort()).toEqual(['expiresAt', 'id', 'text'])
    })
  })
})
```

**Step 2: Run tests**

Run: `cd relay-cafe-api && bun test tests/integration/moderation.test.ts`
Expected: All tests pass

**Step 3: Commit**

```bash
git add relay-cafe-api/tests/integration/moderation.test.ts
git commit -m "test: add moderation integration tests"
```

---

### Task 5: API-level E2E Journey Tests

**Files:**
- Create: `relay-cafe-api/tests/e2e/moderation-journeys.test.ts`

**Step 1: Write the tests**

```typescript
import { test, expect, describe, beforeEach } from 'bun:test'
import { resetDB, createAuthenticatedUser, createUser, createSession } from '../helpers/db'
import { requestJSON, request } from '../helpers/http'
import { db } from '../../src/db'
import { users, messages, reports } from '../../src/db/schema'
import { eq, sql } from 'drizzle-orm'

describe('E2E Moderation Journeys', () => {
  beforeEach(async () => {
    await resetDB()
  })

  test('Journey 1: send → receive → report → strike verified', async () => {
    const sender = await createAuthenticatedUser()
    const receiver = await createAuthenticatedUser()

    // Sender writes a message
    const sendRes = await requestJSON('/v1/messages', {
      method: 'POST',
      token: sender.token,
      body: { text: 'This is a mean message' },
    })
    expect(sendRes.status).toBe(201)

    // Receiver opens today's message
    const { status, json } = await requestJSON<{ id: string; text: string }>('/v1/messages/today', {
      token: receiver.token,
    })
    expect(status).toBe(200)
    expect(json!.text).toBe('This is a mean message')

    // Receiver reports it
    const reportRes = await requestJSON(`/v1/messages/${json!.id}/report`, {
      method: 'POST',
      token: receiver.token,
      body: {},
    })
    expect(reportRes.status).toBe(200)

    // Verify: sender has 1 strike
    const [senderUser] = await db.select().from(users).where(eq(users.id, sender.userId))
    expect(senderUser!.strikeCount).toBe(1)

    // Verify: report record exists
    const allReports = await db.select().from(reports)
    expect(allReports.length).toBe(1)
    expect(allReports[0]!.actionTaken).toBe('removed')
  })

  test('Journey 2: send → receive → block → blocked sender excluded', async () => {
    const sender = await createAuthenticatedUser()
    const receiver = await createAuthenticatedUser()

    // Round 1: send + receive + block
    await requestJSON('/v1/messages', {
      method: 'POST',
      token: sender.token,
      body: { text: 'first message' },
    })
    const { json: msg1 } = await requestJSON<{ id: string }>('/v1/messages/today', {
      token: receiver.token,
    })
    await requestJSON(`/v1/messages/${msg1!.id}/block`, {
      method: 'POST', token: receiver.token, body: {},
    })

    // Round 2: sender sends again
    await db.execute(sql`UPDATE daily_tokens SET send_used = false WHERE user_id = ${sender.userId}`)
    await db.execute(sql`UPDATE daily_tokens SET receive_used = false WHERE user_id = ${receiver.userId}`)

    await requestJSON('/v1/messages', {
      method: 'POST',
      token: sender.token,
      body: { text: 'second message after block' },
    })

    // Receiver should NOT get blocked sender's message
    const res = await request('/v1/messages/today', { token: receiver.token })
    expect(res.status).toBe(204)

    // But a third user CAN receive it
    const thirdUser = await createAuthenticatedUser()
    const { status } = await requestJSON<{ text: string }>('/v1/messages/today', {
      token: thirdUser.token,
    })
    expect(status).toBe(200)
  })

  test('Journey 3: 3 reports → suspension → cannot send', async () => {
    const sender = await createAuthenticatedUser()

    for (let i = 0; i < 3; i++) {
      const receiver = await createAuthenticatedUser()

      await requestJSON('/v1/messages', {
        method: 'POST',
        token: sender.token,
        body: { text: `offensive msg ${i}` },
      })

      const { json } = await requestJSON<{ id: string }>('/v1/messages/today', {
        token: receiver.token,
      })

      await requestJSON(`/v1/messages/${json!.id}/report`, {
        method: 'POST', token: receiver.token, body: {},
      })

      // Reset sender's token for next round
      await db.execute(sql`UPDATE daily_tokens SET send_used = false WHERE user_id = ${sender.userId}`)
    }

    // Sender tries to send — should be suspended
    const { status, json } = await requestJSON('/v1/messages', {
      method: 'POST',
      token: sender.token,
      body: { text: 'I should be suspended' },
    })
    expect(status).toBe(403)
    expect((json as { error: string }).error).toContain('suspended')
  })

  test('Journey 4: content filter → clean retry → success', async () => {
    const user = await createAuthenticatedUser()

    // Attempt 1: blocked content
    const { status: s1 } = await requestJSON('/v1/messages', {
      method: 'POST',
      token: user.token,
      body: { text: 'i will kill you' },
    })
    expect(s1).toBe(400)

    // Attempt 2: clean content — same period, token still available
    const { status: s2 } = await requestJSON('/v1/messages', {
      method: 'POST',
      token: user.token,
      body: { text: 'I hope you have a great day' },
    })
    expect(s2).toBe(201)
  })

  test('Journey 5: block persists across account deletion + recreation', async () => {
    // Setup: sender with known Apple ID
    const { user: senderUser, appleSubId } = await createUser()
    const senderToken = await createSession(senderUser.id)
    const receiver = await createAuthenticatedUser()

    // Send → receive → block
    await requestJSON('/v1/messages', {
      method: 'POST',
      token: senderToken,
      body: { text: 'pre-deletion' },
    })
    const { json: msg } = await requestJSON<{ id: string }>('/v1/messages/today', {
      token: receiver.token,
    })
    await requestJSON(`/v1/messages/${msg!.id}/block`, {
      method: 'POST', token: receiver.token, body: {},
    })

    // Sender deletes account
    await requestJSON('/v1/me', { method: 'DELETE', token: senderToken })
    await db.execute(sql`DELETE FROM deleted_accounts`)

    // Sender recreates with SAME Apple ID
    const { user: newSender } = await createUser(appleSubId)
    const newToken = await createSession(newSender.id)

    // New sender sends
    await requestJSON('/v1/messages', {
      method: 'POST',
      token: newToken,
      body: { text: 'post-recreation' },
    })

    // Receiver should NOT get it (apple_id_hash block persists)
    await db.execute(sql`UPDATE daily_tokens SET receive_used = false WHERE user_id = ${receiver.userId}`)
    const res = await request('/v1/messages/today', { token: receiver.token })
    expect(res.status).toBe(204)
  })
})
```

**Step 2: Run tests**

Run: `cd relay-cafe-api && bun test tests/e2e/moderation-journeys.test.ts`
Expected: All tests pass

**Step 3: Commit**

```bash
git add relay-cafe-api/tests/e2e/moderation-journeys.test.ts
git commit -m "test: add API-level E2E moderation journey tests"
```

---

### Task 6: iOS — Implement -resetState Launch Argument

**Files:**
- Modify: `relay-cafe-ios/RelayCafe/App/RelayCafeApp.swift`

**Step 1: Add state reset handler**

The `-resetState` launch argument is passed by `RelayCafeUITestCase` but never handled. Add:

```swift
// relay-cafe-ios/RelayCafe/App/RelayCafeApp.swift
// FULL FILE:
import SwiftUI

@main
struct RelayCafeApp: App {
    @State private var appVM = AppViewModel()

    init() {
        if ProcessInfo.processInfo.arguments.contains("-resetState") {
            UserDefaults.standard.removeObject(forKey: "onboardingComplete")
            let keychain = KeychainManager()
            try? keychain.delete(key: "sessionToken")
            try? keychain.delete(key: "tokenExpiresAt")
        }
    }

    var body: some Scene {
        WindowGroup {
            switch appVM.route {
            case .onboarding: OnboardingView(vm: appVM)
            case .signIn: SignInView(vm: appVM)
            case .home: HomeView(vm: appVM)
            case .farewell: FarewellView()
            }
        }
    }
}
```

**Step 2: Commit**

```bash
git add relay-cafe-ios/RelayCafe/App/RelayCafeApp.swift
git commit -m "feat: handle -resetState launch argument for UI tests"
```

---

### Task 7: iOS — Configure Local API for UI Tests

**Files:**
- Modify: `relay-cafe-ios/project.yml`
- Modify: `relay-cafe-ios/RelayCafeUITests/RelayCafeUITestCase.swift`

**Step 1: Pass API base URL as launch argument**

Instead of modifying Info.plist (which affects all builds), pass the local URL as an environment variable to the UI test process:

```swift
// relay-cafe-ios/RelayCafeUITests/RelayCafeUITestCase.swift
// FULL FILE:
import XCTest

/// Base class for all UI tests.
/// Ensures the app launches in a clean state pointing at the local test server.
class RelayCafeUITestCase: XCTestCase {
    var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments += ["-resetState"]
        // Point to local API for E2E testing
        app.launchEnvironment["API_BASE_URL"] = "http://localhost:3000"
        app.launch()
    }

    override func tearDownWithError() throws {
        app.terminate()
    }

    // MARK: - Helpers

    /// Wait for an element to exist with a timeout.
    func waitForElement(_ element: XCUIElement, timeout: TimeInterval = 5) {
        let exists = element.waitForExistence(timeout: timeout)
        XCTAssertTrue(exists, "Expected element to exist: \(element)")
    }
}
```

**Step 2: Update APIClient to read launch environment override**

The `APIClient` base URL is read from Info.plist. Add a fallback to `ProcessInfo.processInfo.environment` so the launch environment can override it:

In `relay-cafe-ios/RelayCafe/Services/APIClient.swift`, change the `defaultBaseURL` property:

```swift
// BEFORE:
private static let defaultBaseURL: URL = {
    let info = Bundle.main.infoDictionary
    if let urlString = info?["APIBaseURL"] as? String, let url = URL(string: urlString) {
        return url
    }
    return URL(string: "https://api.relay.cafe")!
}()

// AFTER:
private static let defaultBaseURL: URL = {
    // UI test override via launch environment
    if let envURL = ProcessInfo.processInfo.environment["API_BASE_URL"],
       let url = URL(string: envURL) {
        return url
    }
    let info = Bundle.main.infoDictionary
    if let urlString = info?["APIBaseURL"] as? String, let url = URL(string: urlString) {
        return url
    }
    return URL(string: "https://api.relay.cafe")!
}()
```

**Step 3: Commit**

```bash
git add relay-cafe-ios/RelayCafeUITests/RelayCafeUITestCase.swift relay-cafe-ios/RelayCafe/Services/APIClient.swift
git commit -m "feat: point UI tests to local API via launch environment"
```

---

### Task 8: iOS XCUITest — Moderation UI Tests

**Files:**
- Create: `relay-cafe-ios/RelayCafeUITests/ModerationUITests.swift`
- Create: `relay-cafe-ios/RelayCafeUITests/SettingsUITests.swift`

**Step 1: Write Settings UI tests**

```swift
// relay-cafe-ios/RelayCafeUITests/SettingsUITests.swift
import XCTest

final class SettingsUITests: RelayCafeUITestCase {

    /// Navigate to Settings from the onboarding/home screen.
    /// Since tests start with -resetState, we land on onboarding.
    /// We can only test Settings if we're on Home, which requires auth.
    /// For now, test that the onboarding screen works correctly.
    /// Full Settings tests require a signed-in state.

    func testOnboardingHasCorrectCopy() {
        // After -resetState, app shows onboarding
        waitForElement(app.staticTexts["Once a day,"])
        XCTAssertTrue(app.staticTexts["Messages are available for 24 hours."].exists)
        XCTAssertTrue(app.staticTexts["They are automatically deleted after that."].exists)
    }

    func testContinueButtonNavigatesToSignIn() {
        let continueButton = app.buttons["onboarding.continueButton"]
        waitForElement(continueButton)
        continueButton.tap()

        // Should navigate to sign-in screen
        let signInButton = app.buttons["Sign in with Apple"]
        waitForElement(signInButton, timeout: 3)
    }
}
```

**Step 2: Write Moderation UI tests**

These test that moderation UI elements exist and behave correctly. Since they require a signed-in session (which requires Apple Sign-In that can't be automated), these tests verify element existence when the views are accessible.

```swift
// relay-cafe-ios/RelayCafeUITests/ModerationUITests.swift
import XCTest

final class ModerationUITests: RelayCafeUITestCase {

    // NOTE: Full E2E tests (send → receive → report → block) require
    // Apple Sign-In which cannot be automated in XCUITest.
    // The API-level E2E tests cover the full moderation flow.
    // These tests verify UI element presence and accessibility.

    func testOnboardingContinueButtonIsAccessible() {
        let button = app.buttons["onboarding.continueButton"]
        waitForElement(button)
        XCTAssertTrue(button.isHittable)
        XCTAssertTrue(button.isEnabled)
    }

    // The following tests are structured for when a test user session
    // can be injected. They are currently skipped but serve as a template.

    // To enable: implement a test-only auth bypass that injects a session
    // token into the keychain before launch, bypassing Apple Sign-In.
    // Example:
    //   app.launchArguments += ["-testToken", "<valid-session-token>"]
    //   Then in AppViewModel.init(), check for -testToken and inject it.
}
```

**Step 3: Commit**

```bash
git add relay-cafe-ios/RelayCafeUITests/SettingsUITests.swift relay-cafe-ios/RelayCafeUITests/ModerationUITests.swift
git commit -m "test: add iOS XCUITest for moderation and settings UI"
```

---

### Task 9: Run Full Test Suite and Verify

**Step 1: Run all backend tests**

Run: `cd relay-cafe-api && bun test`
Expected: All tests pass (unit + integration + e2e)

**Step 2: Run TypeScript type check**

Run: `cd relay-cafe-api && npx tsc --noEmit`
Expected: 0 errors

**Step 3: Regenerate Xcode project**

Run: `cd relay-cafe-ios && xcodegen generate`
Expected: Project generated successfully with new test files included

**Step 4: Build iOS project**

Run: `cd relay-cafe-ios && xcodebuild -scheme RelayCafe -destination 'platform=iOS Simulator,name=iPhone 16' build 2>&1 | tail -5`
Expected: `BUILD SUCCEEDED`

**Step 5: Run iOS tests**

Run: `cd relay-cafe-ios && xcodebuild -scheme RelayCafe -destination 'platform=iOS Simulator,name=iPhone 16' test 2>&1 | tail -20`
Expected: All tests pass

**Step 6: Final commit if any adjustments needed**

```bash
git add -A
git commit -m "test: verify full test suite passes"
```

# Moderation Lifecycle Audit Fixes — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 4 HIGH/MEDIUM audit findings: time-based suspension, strike persistence across account deletion, report audit trail via SET NULL, schema/migration alignment.

**Architecture:** Extend `deleted_accounts` with moderation columns, replace boolean `suspended` with `suspension_until TIMESTAMPTZ`, change report FK from CASCADE to SET NULL, extract constants, add UUID validation via `uuid` package.

**Tech Stack:** Bun test runner, Drizzle ORM, PostgreSQL, Hono

**Design doc:** `docs/plans/2026-03-01-audit-fixes-design.md`

---

## Task 1: Create foundation files

**Files:**
- Create: `relay-cafe-api/src/lib/moderationConfig.ts`
- Create: `relay-cafe-api/migrations/005_moderation_lifecycle.sql`
- Install: `uuid` + `@types/uuid`

**Step 1: Create moderation constants**

Create `relay-cafe-api/src/lib/moderationConfig.ts`:

```typescript
export const STRIKE_THRESHOLD = 3 as const
export const SUSPENSION_DURATION_DAYS = 30 as const
export const STRIKE_DECAY_DAYS = 30 as const
```

**Step 2: Install `uuid` package for validation**

```bash
cd relay-cafe-api && bun add uuid && bun add -d @types/uuid
```

This provides `validate` from `uuid` — no custom regex needed.

**Step 3: Create migration**

Create `relay-cafe-api/migrations/005_moderation_lifecycle.sql`:

```sql
-- 005_moderation_lifecycle.sql
-- 1. Replace boolean suspended with suspension_until
-- 2. Add moderation state to deleted_accounts
-- 3. Reports FK: CASCADE → SET NULL
-- NOTE: 30 days in the UPDATE below must match SUSPENSION_DURATION_DAYS in moderationConfig.ts

-- 1. Replace boolean suspended with suspension_until
ALTER TABLE users ADD COLUMN suspension_until TIMESTAMPTZ;
UPDATE users SET suspension_until = NOW() + INTERVAL '30 days' WHERE suspended = TRUE;
ALTER TABLE users DROP COLUMN suspended;

-- 2. Add moderation state to deleted_accounts
ALTER TABLE deleted_accounts ADD COLUMN strike_count INT NOT NULL DEFAULT 0;
ALTER TABLE deleted_accounts ADD COLUMN suspension_until TIMESTAMPTZ;

-- 3. Reports FK: CASCADE → SET NULL (columns must become nullable first)
ALTER TABLE reports ALTER COLUMN reporter_user_id DROP NOT NULL;
ALTER TABLE reports ALTER COLUMN sender_user_id DROP NOT NULL;

ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_reporter_user_id_users_id_fk;
ALTER TABLE reports ADD CONSTRAINT reports_reporter_user_id_users_id_fk
  FOREIGN KEY (reporter_user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_sender_user_id_users_id_fk;
ALTER TABLE reports ADD CONSTRAINT reports_sender_user_id_users_id_fk
  FOREIGN KEY (sender_user_id) REFERENCES users(id) ON DELETE SET NULL;
```

**Important:** `IF EXISTS` prevents failure if constraint names differ. Before running on production, verify actual names:
```sql
SELECT constraint_name FROM information_schema.table_constraints WHERE table_name = 'reports';
```

**Step 4: Commit**

```bash
cd relay-cafe-api
git add src/lib/moderationConfig.ts migrations/005_moderation_lifecycle.sql package.json bun.lockb
git commit -m "feat: add moderation config, uuid dependency, and lifecycle migration"
```

---

## Task 2: Update Drizzle schema

**Files:**
- Modify: `relay-cafe-api/src/db/schema.ts`

**Step 1: Update imports**

At `schema.ts:1`, add `uniqueIndex` to the import:

```typescript
import { pgTable, uuid, text, bigint, boolean, timestamp, primaryKey, integer, index, uniqueIndex } from 'drizzle-orm/pg-core'
```

**Step 2: Replace `suspended` with `suspensionUntil` in users table**

At `schema.ts:6`, replace:

```typescript
  suspended: boolean('suspended').notNull().default(false),
```

with:

```typescript
  suspensionUntil: timestamp('suspension_until', { withTimezone: true }),
```

**Step 3: Add moderation columns to `deletedAccounts`**

At `schema.ts:29-33`, replace:

```typescript
export const deletedAccounts = pgTable('deleted_accounts', {
  appleIdHash: text('apple_id_hash').primaryKey(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }).notNull().defaultNow(),
  cooldownUntil: timestamp('cooldown_until', { withTimezone: true }).notNull(),
})
```

with:

```typescript
export const deletedAccounts = pgTable('deleted_accounts', {
  appleIdHash: text('apple_id_hash').primaryKey(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }).notNull().defaultNow(),
  cooldownUntil: timestamp('cooldown_until', { withTimezone: true }).notNull(),
  strikeCount: integer('strike_count').notNull().default(0),
  suspensionUntil: timestamp('suspension_until', { withTimezone: true }),
})
```

**Step 4: Change reports FKs to SET NULL + nullable**

At `schema.ts:61-62`, replace:

```typescript
  reporterUserId: uuid('reporter_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  senderUserId: uuid('sender_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
```

with:

```typescript
  reporterUserId: uuid('reporter_user_id').references(() => users.id, { onDelete: 'set null' }),
  senderUserId: uuid('sender_user_id').references(() => users.id, { onDelete: 'set null' }),
```

**Step 5: Fix unique index on reports**

At `schema.ts:69`, replace:

```typescript
  uniqueReport: index('idx_reports_unique').on(t.messageId, t.reporterUserId),
```

with:

```typescript
  uniqueReport: uniqueIndex('idx_reports_unique').on(t.messageId, t.reporterUserId),
```

**Step 6: Verify build**

Run: `cd relay-cafe-api && bun build src/index.ts --target=bun --outdir=/tmp/relay-check 2>&1 | head -20`

Expected: Build succeeds (there will be downstream TS errors in files that reference `users.suspended` — those are fixed in subsequent tasks).

**Step 7: Commit**

```bash
git add src/db/schema.ts
git commit -m "feat: update schema for time-based suspension, SET NULL reports, uniqueIndex"
```

---

## Task 3: Update send endpoint — suspension check

**Files:**
- Modify: `relay-cafe-api/src/routes/messages.ts:36-43`

**Step 1: Update suspension check**

At `messages.ts:36-43`, replace:

```typescript
      // 1. Suspension check (first — before token claim)
      const [user] = await tx
        .select({ suspended: users.suspended })
        .from(users)
        .where(eq(users.id, userId))

      if (user?.suspended) {
        return { suspended: true } as const
      }
```

with:

```typescript
      // 1. Suspension check (first — before token claim)
      const [user] = await tx
        .select({ suspensionUntil: users.suspensionUntil })
        .from(users)
        .where(eq(users.id, userId))

      if (user?.suspensionUntil && user.suspensionUntil > new Date()) {
        return { suspended: true } as const
      }
```

**Step 2: Verify build**

Run: `cd relay-cafe-api && bun build src/index.ts --target=bun --outdir=/tmp/relay-check 2>&1 | head -20`

Expected: Build succeeds.

**Step 3: Commit**

```bash
git add src/routes/messages.ts
git commit -m "feat: check suspension_until instead of boolean suspended on send"
```

---

## Task 4: Update report endpoint — atomic strike decay + suspension

**Files:**
- Modify: `relay-cafe-api/src/routes/messages.ts:249-271`
- Modify: `relay-cafe-api/src/routes/messages.ts:1-11` (imports)

**Step 1: Add imports**

At `messages.ts`, add to the import section (after line 11):

```typescript
import { STRIKE_THRESHOLD, SUSPENSION_DURATION_DAYS, STRIKE_DECAY_DAYS } from '../lib/moderationConfig'
import { validate as uuidValidate } from 'uuid'
```

**Step 2: Replace strike increment and suspension logic**

At `messages.ts:249-271`, replace:

```typescript
      // Atomic strike increment
      const [updated] = await tx.execute<{ strike_count: number }>(sql`
        UPDATE users
        SET strike_count = strike_count + 1, last_strike_at = NOW()
        WHERE id = ${delivery.senderUserId}
        RETURNING strike_count
      `)

      if (!updated) {
        return { senderGone: true } as const
      }

      const strikeCount = updated.strike_count
      let actionTaken = 'removed'

      // Suspend if threshold reached
      if (strikeCount >= 3) {
        await tx
          .update(users)
          .set({ suspended: true })
          .where(eq(users.id, delivery.senderUserId))
        actionTaken = 'suspended'
      }
```

with:

```typescript
      // Atomic strike decay + increment + suspension in one query
      // new_count is computed once in CTE to avoid duplicated CASE logic
      // Uses N * INTERVAL '1 day' instead of sql.raw() for safe parameterization
      const [updated] = await tx.execute<{ strike_count: number; suspension_until: Date | null }>(sql`
        WITH new_strikes AS (
          SELECT id,
            CASE
              WHEN last_strike_at IS NULL THEN 1
              WHEN last_strike_at < NOW() - ${STRIKE_DECAY_DAYS} * INTERVAL '1 day' THEN 1
              ELSE strike_count + 1
            END AS new_count
          FROM users
          WHERE id = ${delivery.senderUserId}
        )
        UPDATE users u SET
          strike_count = ns.new_count,
          last_strike_at = NOW(),
          suspension_until = CASE
            WHEN ns.new_count >= ${STRIKE_THRESHOLD}
            THEN GREATEST(
              COALESCE(u.suspension_until, '1970-01-01'::timestamptz),
              NOW() + ${SUSPENSION_DURATION_DAYS} * INTERVAL '1 day'
            )
            ELSE u.suspension_until
          END
        FROM new_strikes ns
        WHERE u.id = ns.id
        RETURNING u.strike_count, u.suspension_until
      `)

      if (!updated) {
        return { senderGone: true } as const
      }

      const strikeCount = updated.strike_count
      const actionTaken = updated.suspension_until && updated.suspension_until > new Date()
        ? 'suspended'
        : 'removed'
```

**Step 3: Verify build**

Run: `cd relay-cafe-api && bun build src/index.ts --target=bun --outdir=/tmp/relay-check 2>&1 | head -20`

Expected: Build succeeds.

**Step 4: Commit**

```bash
git add src/routes/messages.ts
git commit -m "feat: atomic strike decay + suspension extension in report endpoint"
```

---

## Task 5: Add UUID validation to report/block endpoints

**Files:**
- Modify: `relay-cafe-api/src/routes/messages.ts:213,294`

**Step 1: Add UUID validation to report endpoint**

At `messages.ts:213`, after `const messageId = c.req.param('id')`, add:

```typescript
  if (!uuidValidate(messageId)) {
    return c.json({ error: 'Not found' }, 404)
  }
```

**Step 2: Add UUID validation to block endpoint**

At `messages.ts:294`, after `const messageId = c.req.param('id')`, add:

```typescript
  if (!uuidValidate(messageId)) {
    return c.json({ error: 'Not found' }, 404)
  }
```

Note: `uuidValidate` was already imported in Task 4, Step 1.

**Step 3: Verify build**

Run: `cd relay-cafe-api && bun build src/index.ts --target=bun --outdir=/tmp/relay-check 2>&1 | head -20`

Expected: Build succeeds.

**Step 4: Commit**

```bash
git add src/routes/messages.ts
git commit -m "feat: add UUID validation to report and block endpoints"
```

---

## Task 6: Update account deletion — carry forward moderation state

**Files:**
- Modify: `relay-cafe-api/src/routes/me.ts:31-53`

**Step 1: Update the delete endpoint**

Replace `me.ts:31-56` entirely:

```typescript
meRouter.delete('/', authMiddleware, async (c) => {
  const userId = c.get('userId')

  // Look up user before deletion
  const [user] = await db
    .select({
      appleIdHash: users.appleIdHash,
      strikeCount: users.strikeCount,
      suspensionUntil: users.suspensionUntil,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (!user) return c.body(null, 204)

  // Insert cooldown (+ moderation state if applicable) + delete user atomically
  await db.transaction(async (tx) => {
    const hasModState = user.strikeCount > 0 || (user.suspensionUntil && user.suspensionUntil > new Date())

    await tx
      .insert(deletedAccounts)
      .values({
        appleIdHash: user.appleIdHash,
        cooldownUntil: nextPeriodStart(),
        strikeCount: hasModState ? user.strikeCount : 0,
        suspensionUntil: hasModState ? user.suspensionUntil : null,
      })
      .onConflictDoUpdate({
        target: deletedAccounts.appleIdHash,
        set: {
          cooldownUntil: nextPeriodStart(),
          deletedAt: new Date(),
          // Always set moderation fields explicitly — prevents stale state from prior row
          strikeCount: hasModState ? user.strikeCount : 0,
          suspensionUntil: hasModState ? user.suspensionUntil : null,
        },
      })

    // Delete user — sessions, dailyTokens, messages, deliveryLog, blockedSenders cascade
    // Reports get SET NULL (audit trail preserved)
    await tx.delete(users).where(eq(users.id, userId))
  })

  return c.body(null, 204)
})
```

**Step 2: Verify build**

Run: `cd relay-cafe-api && bun build src/index.ts --target=bun --outdir=/tmp/relay-check 2>&1 | head -20`

Expected: Build succeeds.

**Step 3: Commit**

```bash
git add src/routes/me.ts
git commit -m "feat: carry forward moderation state on account deletion"
```

---

## Task 7: Update re-registration — restore moderation state

**Files:**
- Modify: `relay-cafe-api/src/routes/auth.ts:41-81`

**Step 1: Replace cooldown check + user creation flow**

Replace `auth.ts:41-81` (from `// Check cooldown` through end of transaction):

```typescript
    // Check deleted account for cooldown + moderation carry-forward
    // Entire flow in one transaction to prevent double-restoration
    const result = await db.transaction(async (tx) => {
      const [deleted] = await tx
        .select()
        .from(deletedAccounts)
        .where(eq(deletedAccounts.appleIdHash, appleIdHash))
        .limit(1)

      if (deleted) {
        if (deleted.cooldownUntil > new Date()) {
          return {
            cooldown: true,
            cooldownUntil: deleted.cooldownUntil.getTime(),
          } as const
        }

        // Carry forward only if suspension is still active.
        // Intentional: if suspension expired, user gets a clean start (strikeCount reset).
        // Strike decay already handles gradual reset during active usage.
        const carryForward = deleted.suspensionUntil && deleted.suspensionUntil > new Date()
          ? { suspensionUntil: deleted.suspensionUntil, strikeCount: deleted.strikeCount }
          : null

        // Clean up deleted_accounts row
        await tx.delete(deletedAccounts).where(eq(deletedAccounts.appleIdHash, appleIdHash))

        // Create or reuse user with carried-forward moderation state
        const [existingUser] = await tx.select().from(users).where(eq(users.appleIdHash, appleIdHash)).limit(1)
        const user = existingUser ?? (await tx.insert(users).values({
          appleIdHash,
          ...(carryForward ?? {}),
        }).returning())[0]
        if (!user) return null

        // If existing user found and we have carry-forward state, apply it
        if (existingUser && carryForward) {
          await tx.update(users).set(carryForward).where(eq(users.id, user.id))
        }

        const rawToken = generateToken()
        const tokenHash = hashToken(rawToken)
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        const [session] = await tx
          .insert(sessions)
          .values({ userId: user.id, tokenHash, expiresAt })
          .returning()
        if (!session) return null

        return { sessionToken: rawToken, expiresAt: expiresAt.getTime() }
      }

      // No deleted account — normal sign-in flow
      const [existingUser] = await tx.select().from(users).where(eq(users.appleIdHash, appleIdHash)).limit(1)
      const user = existingUser ?? (await tx.insert(users).values({ appleIdHash }).returning())[0]
      if (!user) return null

      const rawToken = generateToken()
      const tokenHash = hashToken(rawToken)
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      const [session] = await tx
        .insert(sessions)
        .values({ userId: user.id, tokenHash, expiresAt })
        .returning()
      if (!session) return null

      return { sessionToken: rawToken, expiresAt: expiresAt.getTime() }
    })

    if (!result) {
      return c.json({ error: 'Failed to create session' }, 500)
    }
    if ('cooldown' in result) {
      return c.json({
        error: 'cooldown',
        cooldownUntil: result.cooldownUntil,
      }, 403)
    }

    return c.json(result)
```

**Step 2: Verify build**

Run: `cd relay-cafe-api && bun build src/index.ts --target=bun --outdir=/tmp/relay-check 2>&1 | head -20`

Expected: Build succeeds.

**Step 3: Commit**

```bash
git add src/routes/auth.ts
git commit -m "feat: restore moderation state from deleted_accounts on re-registration"
```

---

## Task 8: Update cleanup cron

**Files:**
- Modify: `relay-cafe-api/src/index.ts:31-39`

**Step 1: Update deleted_accounts cleanup query**

At `index.ts:33`, replace:

```typescript
    const result = await db.execute(sql`DELETE FROM deleted_accounts WHERE cooldown_until <= NOW()`)
```

with:

```typescript
    const result = await db.execute(sql`DELETE FROM deleted_accounts WHERE cooldown_until <= NOW() AND (suspension_until IS NULL OR suspension_until <= NOW())`)
```

**Step 2: Commit**

```bash
git add src/index.ts
git commit -m "fix: cleanup cron respects suspension_until in deleted_accounts"
```

---

## Task 9: Update existing tests

**Files:**
- Modify: `relay-cafe-api/tests/integration/moderation.test.ts:5,97,110,213`
- Modify: `relay-cafe-api/tests/e2e/moderation-journeys.test.ts`
- Modify: `relay-cafe-api/tests/helpers/db.ts`

**Step 1: Update resetDB to clean deleted_accounts**

At `tests/helpers/db.ts:2`, add `deletedAccounts` to the schema import:

```typescript
import { users, sessions, dailyTokens, messages, deliveryLog, reports, blockedSenders, deletedAccounts } from '../../src/db/schema'
```

At `tests/helpers/db.ts:12`, add before the `blockedSenders` delete:

```typescript
  await db.delete(deletedAccounts)
```

**Step 2: Update moderation.test.ts — suspension tests**

At `moderation.test.ts:5`, add `deletedAccounts` to schema import:

```typescript
import { messages, users, deliveryLog, reports, blockedSenders, deletedAccounts } from '../../src/db/schema'
```

At `moderation.test.ts:97`, replace:

```typescript
      await db.update(users).set({ suspended: true }).where(eq(users.id, user.userId))
```

with:

```typescript
      await db.update(users).set({ suspensionUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) }).where(eq(users.id, user.userId))
```

At `moderation.test.ts:110`, replace:

```typescript
      await db.update(users).set({ suspended: true }).where(eq(users.id, user.userId))
```

with:

```typescript
      await db.update(users).set({ suspensionUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) }).where(eq(users.id, user.userId))
```

At `moderation.test.ts:213`, replace:

```typescript
      expect(user!.suspended).toBe(true)
```

with:

```typescript
      expect(user!.suspensionUntil).not.toBeNull()
      expect(user!.suspensionUntil!.getTime()).toBeGreaterThan(Date.now())
```

**Step 3: Run existing tests**

Run: `cd relay-cafe-api && bun test tests/integration/moderation.test.ts --timeout 30000`

Expected: All tests pass.

**Step 4: Run E2E tests**

Run: `cd relay-cafe-api && bun test tests/e2e/moderation-journeys.test.ts --timeout 30000`

Expected: All tests pass. The E2E tests don't directly reference `suspended` in assertions — they check status codes and `strikeCount`, so they should pass without modification.

**Step 5: Commit**

```bash
git add tests/helpers/db.ts tests/integration/moderation.test.ts
git commit -m "test: update existing tests for time-based suspension model"
```

---

## Task 10: Write tests for new moderation lifecycle behaviors

**Files:**
- Modify: `relay-cafe-api/tests/integration/moderation.test.ts` (add new describe blocks)

**Step 1: Add strike decay tests**

Add to the end of the `report` describe block (after the `report creates report record` test):

```typescript
    test('strikes decay after 30 days — old strikes reset to 1', async () => {
      const sender = await createAuthenticatedUser()
      const receiver1 = await createAuthenticatedUser()

      // Direct DB state injection for test setup — bypasses moderation logic intentionally
      await db.update(users).set({
        strikeCount: 2,
        lastStrikeAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
      }).where(eq(users.id, sender.userId))

      // Send + receive + report
      await requestJSON('/v1/messages', {
        method: 'POST', token: sender.token, body: { text: 'old strikes msg' },
      })
      const { json } = await requestJSON<{ id: string }>('/v1/messages/today', {
        token: receiver1.token,
      })
      await requestJSON(`/v1/messages/${json!.id}/report`, {
        method: 'POST', token: receiver1.token, body: {},
      })

      // Strike should have reset to 1 (not incremented to 3)
      const [user] = await db.select().from(users).where(eq(users.id, sender.userId))
      expect(user!.strikeCount).toBe(1)
      expect(user!.suspensionUntil).toBeNull()
    })
```

**Step 2: Add suspension expiry test**

Add a new describe block after the `suspension check on send` block:

```typescript
  describe('suspension expiry', () => {
    test('expired suspension allows sending again', async () => {
      const user = await createAuthenticatedUser()

      // Direct DB state injection for test setup — bypasses moderation logic intentionally
      await db.update(users).set({
        suspensionUntil: new Date(Date.now() - 1000),
        strikeCount: 3,
      }).where(eq(users.id, user.userId))

      const { status } = await requestJSON('/v1/messages', {
        method: 'POST',
        token: user.token,
        body: { text: 'I am free again' },
      })
      expect(status).toBe(201)
    })
  })
```

**Step 3: Add suspension extension test (GREATEST)**

Add inside the `report` describe block:

```typescript
    test('new strike does not shorten existing suspension', async () => {
      const sender = await createAuthenticatedUser()

      // Direct DB state injection for test setup — bypasses moderation logic intentionally
      const existingSuspension = new Date(Date.now() + 25 * 24 * 60 * 60 * 1000)
      await db.update(users).set({
        strikeCount: 3,
        suspensionUntil: existingSuspension,
        lastStrikeAt: new Date(),
      }).where(eq(users.id, sender.userId))

      // Another report
      const receiver = await createAuthenticatedUser()
      await requestJSON('/v1/messages', {
        method: 'POST', token: sender.token, body: { text: 'msg' },
      })
      // Sender is suspended so this returns 403 — need to bypass
      // Insert message directly for the test
      const { message } = await createMessage({ senderUserId: sender.userId })
      // Create delivery log manually
      await db.execute(sql`
        INSERT INTO delivery_log (id, message_id, sender_user_id, recipient_user_id)
        VALUES (gen_random_uuid(), ${message.id}, ${sender.userId}, ${receiver.userId})
      `)

      await requestJSON(`/v1/messages/${message.id}/report`, {
        method: 'POST', token: receiver.token, body: {},
      })

      const [user] = await db.select().from(users).where(eq(users.id, sender.userId))
      // Suspension should be at least 30 days from now (extended, not shortened)
      expect(user!.suspensionUntil!.getTime()).toBeGreaterThan(existingSuspension.getTime())
    })
```

**Step 4: Add UUID validation tests**

Add a new describe block:

```typescript
  describe('UUID validation', () => {
    test('report with invalid UUID returns 404', async () => {
      const user = await createAuthenticatedUser()
      const { status } = await requestJSON('/v1/messages/not-a-uuid/report', {
        method: 'POST', token: user.token, body: {},
      })
      expect(status).toBe(404)
    })

    test('block with invalid UUID returns 404', async () => {
      const user = await createAuthenticatedUser()
      const { status } = await requestJSON('/v1/messages/not-a-uuid/block', {
        method: 'POST', token: user.token, body: {},
      })
      expect(status).toBe(404)
    })
  })
```

**Step 5: Run tests**

Run: `cd relay-cafe-api && bun test tests/integration/moderation.test.ts --timeout 30000`

Expected: All tests pass, including the new ones.

**Step 6: Commit**

```bash
git add tests/integration/moderation.test.ts
git commit -m "test: add strike decay, suspension expiry, UUID validation tests"
```

---

## Task 11: Write tests for deletion carry-forward + re-registration restore

**Files:**
- Modify: `relay-cafe-api/tests/integration/moderation.test.ts` (add describe block)

**Step 1: Add carry-forward tests**

Add a new describe block at the end of the Moderation describe:

```typescript
  describe('suspension carry-forward across account deletion', () => {
    test('suspended user deletes account — suspension persists on re-register', async () => {
      const { user: senderUser, appleSubId } = await createUser()
      const senderToken = await createSession(senderUser.id)

      // Direct DB state injection for test setup — bypasses moderation logic intentionally
      const futureDate = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000)
      await db.update(users).set({
        strikeCount: 3,
        suspensionUntil: futureDate,
      }).where(eq(users.id, senderUser.id))

      // Delete account
      await requestJSON('/v1/me', { method: 'DELETE', token: senderToken })

      // Verify moderation state saved in deleted_accounts
      const [deleted] = await db.select().from(deletedAccounts)
      expect(deleted!.strikeCount).toBe(3)
      expect(deleted!.suspensionUntil).not.toBeNull()

      // Clear cooldown to allow re-registration
      await db.execute(sql`UPDATE deleted_accounts SET cooldown_until = NOW() - INTERVAL '1 second'`)

      // Re-register with same Apple ID
      const { user: newUser } = await createUser(appleSubId)

      // Verify moderation state carried forward
      const [restoredUser] = await db.select().from(users).where(eq(users.id, newUser.id))
      expect(restoredUser!.suspensionUntil).not.toBeNull()
      expect(restoredUser!.suspensionUntil!.getTime()).toBeGreaterThan(Date.now())
      expect(restoredUser!.strikeCount).toBe(3)
    })

    test('expired suspension — user gets clean start on re-register', async () => {
      const { user: senderUser, appleSubId } = await createUser()
      const senderToken = await createSession(senderUser.id)

      // Direct DB state injection for test setup — bypasses moderation logic intentionally
      await db.update(users).set({
        strikeCount: 3,
        suspensionUntil: new Date(Date.now() - 1000),
      }).where(eq(users.id, senderUser.id))

      // Delete account
      await requestJSON('/v1/me', { method: 'DELETE', token: senderToken })

      // Clear cooldown
      await db.execute(sql`UPDATE deleted_accounts SET cooldown_until = NOW() - INTERVAL '1 second'`)

      // Re-register
      const { user: newUser } = await createUser(appleSubId)

      // Should have clean state (suspension expired)
      const [restoredUser] = await db.select().from(users).where(eq(users.id, newUser.id))
      expect(restoredUser!.strikeCount).toBe(0)
      expect(restoredUser!.suspensionUntil).toBeNull()
    })

    test('reports survive sender account deletion (SET NULL)', async () => {
      const sender = await createAuthenticatedUser()
      const receiver = await createAuthenticatedUser()

      // Send + receive + report
      await requestJSON('/v1/messages', {
        method: 'POST', token: sender.token, body: { text: 'will be reported' },
      })
      const { json } = await requestJSON<{ id: string }>('/v1/messages/today', {
        token: receiver.token,
      })
      await requestJSON(`/v1/messages/${json!.id}/report`, {
        method: 'POST', token: receiver.token, body: {},
      })

      // Sender deletes account
      await requestJSON('/v1/me', { method: 'DELETE', token: sender.token })

      // Report should still exist with sender_user_id = NULL
      const allReports = await db.select().from(reports)
      expect(allReports.length).toBe(1)
      expect(allReports[0]!.senderUserId).toBeNull()
      expect(allReports[0]!.reporterUserId).toBe(receiver.userId)
    })

    test('reports survive reporter account deletion (SET NULL)', async () => {
      const sender = await createAuthenticatedUser()
      const receiver = await createAuthenticatedUser()

      // Send + receive + report
      await requestJSON('/v1/messages', {
        method: 'POST', token: sender.token, body: { text: 'will be reported' },
      })
      const { json } = await requestJSON<{ id: string }>('/v1/messages/today', {
        token: receiver.token,
      })
      await requestJSON(`/v1/messages/${json!.id}/report`, {
        method: 'POST', token: receiver.token, body: {},
      })

      // Reporter deletes account
      await requestJSON('/v1/me', { method: 'DELETE', token: receiver.token })

      // Report should still exist with reporter_user_id = NULL
      const allReports = await db.select().from(reports)
      expect(allReports.length).toBe(1)
      expect(allReports[0]!.reporterUserId).toBeNull()
      expect(allReports[0]!.senderUserId).toBe(sender.userId)
    })
  })
```

**Important:** The carry-forward tests that use `createUser()` directly test the DB-level behavior. The full auth flow (via `/v1/auth/apple`) would require mocking Apple JWT — the re-registration logic is tested indirectly. Consider adding an integration test for the auth endpoint if Apple JWT mocking is already set up (check `tests/integration/auth.test.ts`).

**Step 2: Run tests**

Run: `cd relay-cafe-api && bun test tests/integration/moderation.test.ts --timeout 30000`

Expected: All tests pass.

**Step 3: Commit**

```bash
git add tests/integration/moderation.test.ts
git commit -m "test: add suspension carry-forward and report SET NULL tests"
```

---

## Task 12: Update guidelines page

**Files:**
- Modify: `relay-cafe-site/guidelines.html:43-50`

**Step 1: Replace enforcement section**

At `guidelines.html:43-50`, replace:

```html
      <p>We have zero tolerance for content that violates these guidelines.</p>
      <ul>
        <li>Reported content is removed immediately.</li>
        <li>All reports are reviewed within 24 hours.</li>
        <li>Violations result in content removal and account suspension.</li>
        <li>Accounts that repeatedly violate these rules will be permanently suspended.</li>
      </ul>
```

with:

```html
      <p>We have zero tolerance for content that violates these guidelines.</p>
      <ul>
        <li>Reported messages are removed immediately.</li>
        <li>All reports are reviewed within 24 hours.</li>
        <li>Accounts that violate these guidelines may receive strikes.</li>
        <li>Accounts that accumulate multiple strikes may be temporarily suspended.</li>
        <li>Severe violations may result in immediate suspension.</li>
        <li>Repeated or extreme violations may result in permanent suspension.</li>
      </ul>
      <p>Temporary suspensions may persist even if an account is deleted and recreated. Suspensions automatically expire after a defined period without further violations.</p>
```

**Step 2: Commit**

```bash
cd /Users/vladimirtrifonov/src/ai/relay.cafe
git add relay-cafe-site/guidelines.html
git commit -m "docs: update enforcement section in community guidelines"
```

---

## Task 13: Full test suite verification

**Step 1: Run all backend tests**

Run: `cd relay-cafe-api && bun test --timeout 30000`

Expected: All tests pass. No regressions.

**Step 2: Verify build**

Run: `cd relay-cafe-api && bun build src/index.ts --target=bun --outdir=/tmp/relay-check`

Expected: Build succeeds with no errors.

**Step 3: Run TypeScript check**

Run: `cd relay-cafe-api && npx tsc --noEmit 2>&1 | head -30`

Expected: No errors (or only pre-existing ones documented in the test plan).

**Step 4: Commit any remaining fixes**

If tests fail, fix the failures and commit:

```bash
git add -A
git commit -m "fix: resolve test failures from moderation lifecycle changes"
```

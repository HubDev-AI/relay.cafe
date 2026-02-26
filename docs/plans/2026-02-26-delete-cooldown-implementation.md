# Account Deletion Cooldown Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent users from bypassing daily send/receive limits by deleting and re-creating their account.

**Architecture:** New `deleted_accounts` table stores `apple_id_hash` with a cooldown expiry. Auth checks this before allowing sign-in. A cron job cleans up expired rows.

**Tech Stack:** Drizzle ORM, Hono, PostgreSQL, SwiftUI

---

### Task 1: Database Migration — Create deleted_accounts Table

**Files:**
- Create: `relay-cafe-api/drizzle/0006_deleted_accounts.sql`
- Modify: `relay-cafe-api/src/db/schema.ts`

**Step 1: Add table to Drizzle schema**

In `relay-cafe-api/src/db/schema.ts`, add after the `messages` table:

```typescript
export const deletedAccounts = pgTable('deleted_accounts', {
  appleIdHash: text('apple_id_hash').primaryKey(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }).notNull().defaultNow(),
  cooldownUntil: timestamp('cooldown_until', { withTimezone: true }).notNull(),
})
```

**Step 2: Create the SQL migration**

Create `relay-cafe-api/drizzle/0006_deleted_accounts.sql`:

```sql
CREATE TABLE deleted_accounts (
  apple_id_hash TEXT PRIMARY KEY,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cooldown_until TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_deleted_accounts_cooldown ON deleted_accounts (cooldown_until);
```

**Step 3: Run migration locally**

Run: `cd relay-cafe-api && bun run drizzle-kit push`
Expected: Schema synced, `deleted_accounts` table created.

**Step 4: Commit**

```bash
git add relay-cafe-api/src/db/schema.ts relay-cafe-api/drizzle/0006_deleted_accounts.sql
git commit -m "feat: add deleted_accounts table for cooldown tracking"
```

---

### Task 2: Add cooldownUntil Helper to period.ts

**Files:**
- Modify: `relay-cafe-api/src/lib/period.ts`

**Step 1: Add the helper function**

Append to `relay-cafe-api/src/lib/period.ts`:

```typescript
/**
 * Returns the start of the next token period as a Date.
 * Used for cooldown expiry after account deletion.
 */
export function nextPeriodStart(): Date {
  const seconds = Number(process.env.TOKEN_PERIOD_SECONDS) || 86400
  const nextPeriod = currentPeriod() + 1
  return new Date(nextPeriod * seconds * 1000)
}
```

**Step 2: Commit**

```bash
git add relay-cafe-api/src/lib/period.ts
git commit -m "feat: add nextPeriodStart() helper for cooldown calculation"
```

---

### Task 3: Modify DELETE /v1/me — Insert Cooldown on Deletion

**Files:**
- Modify: `relay-cafe-api/src/routes/me.ts`

**Step 1: Update the delete handler**

Replace the existing `meRouter.delete('/', ...)` handler in `relay-cafe-api/src/routes/me.ts`:

```typescript
import { Hono } from 'hono'
import { db } from '../db'
import { users, dailyTokens, deletedAccounts } from '../db/schema'
import { eq, and } from 'drizzle-orm'
import { authMiddleware } from '../middleware/auth'
import { currentPeriod } from '../lib/period'
import { nextPeriodStart } from '../lib/period'

export const meRouter = new Hono()

meRouter.get('/status', authMiddleware, async (c) => {
  const userId = c.get('userId') as string
  const today = currentPeriod()

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

  // Look up user's appleIdHash before deletion
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  if (!user) return c.body(null, 204)

  // Insert cooldown record (upsert in case of rapid re-deletes)
  await db
    .insert(deletedAccounts)
    .values({
      appleIdHash: user.appleIdHash,
      cooldownUntil: nextPeriodStart(),
    })
    .onConflictDoUpdate({
      target: deletedAccounts.appleIdHash,
      set: { cooldownUntil: nextPeriodStart(), deletedAt: new Date() },
    })

  // Delete user — sessions + dailyTokens cascade
  await db.delete(users).where(eq(users.id, userId))
  return c.body(null, 204)
})
```

**Step 2: Commit**

```bash
git add relay-cafe-api/src/routes/me.ts
git commit -m "feat: insert cooldown record on account deletion"
```

---

### Task 4: Modify POST /v1/auth/apple — Check Cooldown Before Sign-In

**Files:**
- Modify: `relay-cafe-api/src/routes/auth.ts`

**Step 1: Add cooldown check to the auth handler**

In `relay-cafe-api/src/routes/auth.ts`, after computing `appleIdHash` (line 39) and before the transaction (line 44), add:

```typescript
import { deletedAccounts } from '../db/schema'

// ... existing code up to appleIdHash computation ...

// Check cooldown from deleted account
const [cooldown] = await db
  .select()
  .from(deletedAccounts)
  .where(eq(deletedAccounts.appleIdHash, appleIdHash))
  .limit(1)

if (cooldown) {
  if (cooldown.cooldownUntil > new Date()) {
    return c.json({
      error: 'cooldown',
      cooldownUntil: cooldown.cooldownUntil.getTime(),
    }, 403)
  }
  // Expired cooldown — clean up and proceed
  await db.delete(deletedAccounts).where(eq(deletedAccounts.appleIdHash, appleIdHash))
}

// ... existing transaction code ...
```

Important: Do NOT wrap the cooldown 403 in `captureError`. This is expected business logic, not an error.

**Step 2: Commit**

```bash
git add relay-cafe-api/src/routes/auth.ts
git commit -m "feat: check cooldown before allowing sign-in"
```

---

### Task 5: Add Cron Cleanup for Expired Cooldowns

**Files:**
- Modify: `relay-cafe-api/src/index.ts`

**Step 1: Add the cleanup cron**

In `relay-cafe-api/src/index.ts`, after the existing messages cleanup cron (line 28), add:

```typescript
new Cron('*/10 * * * *', async () => {
  try {
    const result = await db.execute(sql`DELETE FROM deleted_accounts WHERE cooldown_until <= NOW()`)
    const count = result.length
    if (count > 0) console.log(`[cleanup] deleted ${count} expired cooldown records`)
  } catch (err) {
    captureError(err, { source: 'cleanup-expired-cooldowns' })
  }
})
```

**Step 2: Commit**

```bash
git add relay-cafe-api/src/index.ts
git commit -m "feat: add cron to clean up expired cooldown records"
```

---

### Task 6: iOS — Add Cooldown Error Case to APIClient

**Files:**
- Modify: `relay-cafe-ios/RelayCafe/Services/APIClient.swift`

**Step 1: Add cooldown case to APIError**

```swift
enum APIError: Error {
    case unauthorized
    case alreadyUsedToday
    case cooldown(until: Date)
    case networkError(Error)
    case serverError(Int)
    case decodingError(Error)
}
```

**Step 2: Parse 403 cooldown response in the request method**

In the `request` method, update the status code switch:

```swift
switch http.statusCode {
case 200...299: return (data, response)
case 401:       throw APIError.unauthorized
case 403:
    // Check if this is a cooldown response
    struct CooldownResponse: Decodable { let error: String; let cooldownUntil: Double? }
    if let cooldown = try? JSONDecoder().decode(CooldownResponse.self, from: data),
       cooldown.error == "cooldown",
       let ms = cooldown.cooldownUntil {
        throw APIError.cooldown(until: Date(timeIntervalSince1970: ms / 1000))
    }
    throw APIError.serverError(403)
case 429:       throw APIError.alreadyUsedToday
default:        throw APIError.serverError(http.statusCode)
}
```

**Step 3: Commit**

```bash
git add relay-cafe-ios/RelayCafe/Services/APIClient.swift
git commit -m "feat(ios): parse cooldown error from 403 response"
```

---

### Task 7: iOS — Display Cooldown Message in SignInView

**Files:**
- Modify: `relay-cafe-ios/RelayCafe/Views/SignInView.swift`

**Step 1: Update the error handling in handleResult**

Replace the catch block in the Task inside `handleResult`:

```swift
Task {
    do {
        _ = try await APIClient.shared.signInWithApple(
            identityToken: token
        )
        await MainActor.run { vm.didSignIn() }
    } catch APIError.cooldown(let until) {
        await MainActor.run {
            let formatter = DateFormatter()
            formatter.dateStyle = .none
            formatter.timeStyle = .short
            if Calendar.current.isDateInTomorrow(until) || Calendar.current.isDateInToday(until) {
                self.error = "You can sign in again tomorrow."
            } else {
                self.error = "You can sign in again at \(formatter.string(from: until))."
            }
        }
    } catch {
        await MainActor.run {
            self.error = "Unable to sign in.\nPlease try again."
        }
    }
}
```

**Step 2: Commit**

```bash
git add relay-cafe-ios/RelayCafe/Views/SignInView.swift
git commit -m "feat(ios): display cooldown message on sign-in screen"
```

---

### Task 8: Bump Build, Push, and Deploy

**Files:**
- Modify: `relay-cafe-ios/project.yml`

**Step 1: Bump build to 9**

In `relay-cafe-ios/project.yml`, change `CFBundleVersion: "8"` to `CFBundleVersion: "9"`.

**Step 2: Regenerate Xcode project**

Run: `cd relay-cafe-ios && xcodegen generate`

**Step 3: Commit all, push to dev, PR to main**

```bash
git add -A
git commit -m "feat: account deletion cooldown — build 9"
git push origin dev
gh pr create --base main --head dev --title "feat: account deletion cooldown" --body "..."
gh pr merge --merge
```

**Step 4: Deploy API**

Run: `railway up` from `relay-cafe-api/`

The migration runs automatically on container start (`bun run drizzle-kit push`).

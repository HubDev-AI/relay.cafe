# Moderation Lifecycle Audit Fixes — Design

**Goal:** Fix 4 HIGH/MEDIUM findings from the App Store 1.2 compliance audit. Replace boolean suspension with time-based model, persist moderation state across account deletion, preserve report audit trail, fix schema drift.

**Architecture:** Extend `deleted_accounts` to carry forward strike/suspension state. Replace `suspended BOOLEAN` with `suspension_until TIMESTAMPTZ`. Change report FK behavior from CASCADE to SET NULL. Extract moderation constants. Add UUID validation.

**Tech Stack:** Drizzle ORM, PostgreSQL, Hono, Bun

---

## Policy Decisions

- 3 strikes → 30-day suspension (configurable via constants)
- Strikes decay after 30 days without violations
- Suspension persists across account deletion for its full duration
- After suspension expires, user starts clean on re-registration
- Reports survive account deletion as anonymized records (SET NULL)
- No permanent ban in v1 (can be added later via longer `suspension_until`)

---

## Part 1: Schema Changes

### `users` table

Replace `suspended BOOLEAN` with `suspension_until TIMESTAMPTZ NULL`.

Check: `suspension_until > NOW()` = suspended. Expired or NULL = not suspended. Auto-clears without explicit update.

Keep `strike_count INT` and `last_strike_at TIMESTAMPTZ` unchanged.

### `deleted_accounts` table (ALTER)

Add two columns:
- `strike_count INT NOT NULL DEFAULT 0`
- `suspension_until TIMESTAMPTZ NULL`

`apple_id_hash` is already the PK (inherently indexed).

### `reports` table

Change FK behavior:
- `reporter_user_id`: `ON DELETE CASCADE` → `ON DELETE SET NULL`, column becomes nullable
- `sender_user_id`: `ON DELETE CASCADE` → `ON DELETE SET NULL`, column becomes nullable

Reports survive user deletion. Identity link broken. Audit trail preserved.

Fix schema/migration mismatch: change `index('idx_reports_unique')` to `uniqueIndex('idx_reports_unique')` in Drizzle schema to match the UNIQUE constraint from migration 003.

### New file: `src/lib/moderationConfig.ts`

```typescript
export const STRIKE_THRESHOLD = 3 as const
export const SUSPENSION_DURATION_DAYS = 30 as const
export const STRIKE_DECAY_DAYS = 30 as const
```

### New file: `src/lib/validators.ts`

```typescript
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
```

### Migration `005_moderation_lifecycle.sql`

```sql
-- 1. Replace boolean suspended with suspension_until
ALTER TABLE users ADD COLUMN suspension_until TIMESTAMPTZ;
UPDATE users SET suspension_until = NOW() + INTERVAL '30 days' WHERE suspended = TRUE;
ALTER TABLE users DROP COLUMN suspended;

-- 2. Add moderation state to deleted_accounts
ALTER TABLE deleted_accounts ADD COLUMN strike_count INT NOT NULL DEFAULT 0;
ALTER TABLE deleted_accounts ADD COLUMN suspension_until TIMESTAMPTZ;

-- 3. Reports FK: CASCADE → SET NULL
ALTER TABLE reports ALTER COLUMN reporter_user_id DROP NOT NULL;
ALTER TABLE reports ALTER COLUMN sender_user_id DROP NOT NULL;

-- Verify actual constraint names before running:
-- SELECT constraint_name FROM information_schema.table_constraints WHERE table_name = 'reports';
ALTER TABLE reports DROP CONSTRAINT reports_reporter_user_id_users_id_fk;
ALTER TABLE reports ADD CONSTRAINT reports_reporter_user_id_users_id_fk
  FOREIGN KEY (reporter_user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE reports DROP CONSTRAINT reports_sender_user_id_users_id_fk;
ALTER TABLE reports ADD CONSTRAINT reports_sender_user_id_users_id_fk
  FOREIGN KEY (sender_user_id) REFERENCES users(id) ON DELETE SET NULL;
```

---

## Part 2: Backend Logic

### Strike Decay + Suspension (report endpoint)

Single atomic query handles decay, increment, and suspension:

```sql
UPDATE users SET
  strike_count = CASE
    WHEN last_strike_at IS NULL THEN 1
    WHEN last_strike_at < NOW() - INTERVAL '$STRIKE_DECAY_DAYS days' THEN 1
    ELSE strike_count + 1
  END,
  last_strike_at = NOW(),
  suspension_until = CASE
    WHEN (CASE
      WHEN last_strike_at IS NULL THEN 1
      WHEN last_strike_at < NOW() - INTERVAL '$STRIKE_DECAY_DAYS days' THEN 1
      ELSE strike_count + 1
    END) >= $STRIKE_THRESHOLD
    THEN GREATEST(
      COALESCE(suspension_until, '1970-01-01'),
      NOW() + INTERVAL '$SUSPENSION_DURATION_DAYS days'
    )
    ELSE suspension_until
  END
WHERE id = $senderUserId
RETURNING strike_count, suspension_until
```

Key behaviors:
- NULL `last_strike_at` → treat as first strike
- Strikes older than decay window → reset to 1
- `GREATEST` prevents shortening an existing suspension
- Single round-trip, no TOCTOU race

### Suspension Check (send endpoint)

Fetch `suspension_until` and decide in application logic, not in WHERE clause:

```typescript
const [user] = await tx
  .select({ suspensionUntil: users.suspensionUntil })
  .from(users)
  .where(eq(users.id, userId))

if (user?.suspensionUntil && user.suspensionUntil > new Date()) {
  return { suspended: true } as const
}
```

### Account Deletion (me.ts)

Updated flow:
1. Read user's `strike_count`, `suspension_until`
2. Upsert `deleted_accounts` with cooldown + moderation state (only if `strike_count > 0` OR `suspension_until > NOW()`)
3. Delete user → reports get SET NULL, messages/delivery_log/blocks CASCADE

### Re-registration (auth.ts)

Updated flow, all inside a single transaction:
1. Check `deleted_accounts` by `apple_id_hash`
2. If `cooldown_until > NOW()` → reject 403 (existing behavior)
3. If row exists and cooldown expired:
   - If `suspension_until` in the future → carry forward to new user row
   - If `suspension_until` expired or NULL → clean start (strikes decayed)
4. Delete `deleted_accounts` row
5. Create user with or without carried-forward state

Transaction prevents double-restoration from concurrent logins.

### Cleanup Cron (index.ts)

```sql
DELETE FROM deleted_accounts
WHERE cooldown_until <= NOW()
AND (suspension_until IS NULL OR suspension_until <= NOW())
```

Rows persist until both cooldown and suspension have expired.

### UUID Validation (report/block endpoints)

Add format check at the top of `/:id/report` and `/:id/block`:

```typescript
if (!UUID_RE.test(messageId)) return c.json({ error: 'Not found' }, 404)
```

Returns 404 (not 400) to avoid enumeration. Import from `src/lib/validators.ts`.

---

## Part 3: Guidelines Update

Replace enforcement section in `relay-cafe-site/guidelines.html` with mechanical, neutral copy. No threshold numbers, no duration, no internal policy details.

---

## Part 4: No iOS Changes

Server still returns 403 for suspended users. `APIError.suspended` already handles it. `HomeViewModel.isSuspended` works unchanged.

---

## Files Changed

| File | Change |
|---|---|
| `src/db/schema.ts` | `suspended` → `suspensionUntil`, reports FKs SET NULL + nullable, `uniqueIndex` |
| `src/routes/messages.ts` | Atomic strike decay/suspension, suspension check, UUID validation |
| `src/routes/me.ts` | Carry forward moderation state on deletion |
| `src/routes/auth.ts` | Restore moderation state on re-registration |
| `src/index.ts` | Updated cleanup cron |
| `src/lib/moderationConfig.ts` | New: constants |
| `src/lib/validators.ts` | New: UUID regex |
| `migrations/005_moderation_lifecycle.sql` | New: migration |
| `relay-cafe-site/guidelines.html` | Updated enforcement copy |

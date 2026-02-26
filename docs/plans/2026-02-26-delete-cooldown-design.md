# Account Deletion Cooldown

## Problem

A user can delete their account, re-create it immediately via Sign in with Apple, and get fresh daily send/receive tokens. Repeating this loop lets them bypass the one-send-one-receive-per-day limit.

## Solution

When a user deletes their account, insert a cooldown record keyed on their `apple_id_hash`. The cooldown lasts until the end of the current token period (UTC midnight by default). During cooldown, sign-in attempts for that identity are rejected with a 403 and a `cooldownUntil` timestamp. A cron job cleans up expired cooldown records.

## Data Model

New table `deleted_accounts`:

- `apple_id_hash` TEXT PRIMARY KEY — same SHA-256 hash from auth
- `deleted_at` TIMESTAMPTZ NOT NULL DEFAULT NOW()
- `cooldown_until` TIMESTAMPTZ NOT NULL — end of current period

Index: `idx_deleted_accounts_cooldown` on `cooldown_until` (for cron cleanup efficiency).

No FK to `users`. Independent table that survives user deletion.

## API Changes

### POST /v1/auth/apple

After token verification and `appleIdHash` computation, before user upsert:

1. Query `deleted_accounts` for matching `appleIdHash`
2. If `cooldown_until > NOW()` → return `403 { error: "cooldown", cooldownUntil: <epoch ms> }`
3. If `cooldown_until <= NOW()` → delete the stale row, proceed normally
4. If no row → proceed normally

Cooldown rejections are NOT logged to Sentry (expected business logic, not errors).

### DELETE /v1/me

Before deleting the user:

1. Look up `appleIdHash` from the user record
2. Insert into `deleted_accounts` with `cooldown_until` = next period boundary
3. Delete the user (sessions + daily_tokens cascade)

## iOS Changes

### APIError

Add a new case: `cooldown(until: Date)`.

### APIClient

Parse 403 responses with `cooldownUntil` field into the new error case.

### SignInView

Display cooldown error in the existing error text area:
"You can sign in again tomorrow." (if next midnight)
Or "You can sign in again at <time>." (if short periods during testing)

No exclamation marks, no technical detail.

## Cron Cleanup

New cron in `index.ts` alongside expired-message cleanup:

- Runs every 10 minutes
- `DELETE FROM deleted_accounts WHERE cooldown_until <= NOW()`
- Logs deletion count to console
- DB errors go to Sentry (unexpected failures, not business logic)

## Cooldown Calculation

Uses `currentPeriod()` and `TOKEN_PERIOD_SECONDS`:
- `cooldownUntil = (currentPeriod() + 1) * TOKEN_PERIOD_SECONDS * 1000` (epoch ms → Date)
- Default (86400s): cooldown until next UTC midnight
- Testing (300s): cooldown until next 5-minute boundary

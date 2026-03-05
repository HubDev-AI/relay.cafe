# Manual QA Playbook — Moderation Security Features

**Date:** 2026-03-01
**Scope:** Test all new moderation features through iOS Simulator + local API
**Tester:** User (iOS app) + Claude (DB operations)

---

## Prerequisites

1. **API server running locally:** `cd relay-cafe-api && bun run src/index.ts`
2. **iOS Simulator running** with app pointed at `localhost`
3. **Migration 005 applied** to your local dev database
4. **GCP KMS credentials** configured in `.env`

### Recommended .env for testing

```
MESSAGE_TTL_SECONDS=3600    # 1 hour — messages won't expire during session
TOKEN_PERIOD_SECONDS=86400  # keep default — we'll reset tokens manually
```

### Seed script

All DB operations use:
```bash
cd relay-cafe-api && bun run scripts/qa-seed.ts <command>
```

### Shorthand

Throughout this doc:
- **SEED** = Claude runs the seed script command
- **iOS** = User does something in the iOS app
- **VERIFY** = Claude runs a verification command

---

## Step 0: Setup

**SEED:** Identify your user ID

```bash
bun run scripts/qa-seed.ts list-users
```

Find your user (the one created when you signed in). Note your `userId` — we'll reference it as `YOUR_ID` throughout.

**SEED:** Create two fake senders

```bash
bun run scripts/qa-seed.ts create-sender alice
bun run scripts/qa-seed.ts create-sender bob
```

Note the IDs — referenced as `ALICE_ID` and `BOB_ID` below.

---

## Scenario 1: Baseline Send + Receive

**What we're testing:** Basic message flow still works after moderation changes.

### Steps

1. **iOS:** Open app, tap "Write today's message", write something, send it.
2. **VERIFY:** Confirm message was created.
   ```bash
   bun run scripts/qa-seed.ts show-user YOUR_ID
   ```
   Expected: `strikeCount: 0`, no suspension.

3. **SEED:** Create a message from Alice for you to receive.
   ```bash
   bun run scripts/qa-seed.ts create-message ALICE_ID "A kind message from Alice"
   ```

4. **SEED:** Reset your receive token.
   ```bash
   bun run scripts/qa-seed.ts reset-tokens YOUR_ID
   ```

5. **iOS:** Tap "Read today's message". You should see "A kind message from Alice".
6. **iOS:** Close the message.

**Expected:** Send and receive work normally. No moderation interference.

---

## Scenario 2: Content Filter

**What we're testing:** Blocked content is rejected before it reaches the DB.

### Steps

1. **SEED:** Reset your tokens.
   ```bash
   bun run scripts/qa-seed.ts reset-tokens YOUR_ID
   ```

2. **iOS:** Tap "Write today's message". Type a message containing a slur or blocked term (refer to `src/lib/contentFilter.ts` for the blocklist).
3. **iOS:** Send it.

**Expected:** The app shows an error. The message is NOT stored. Your send token is NOT consumed (you can send again).

4. **iOS:** Write a normal message and send it.

**Expected:** Normal message sends successfully (201).

---

## Scenario 3: Report a Message

**What we're testing:** Reporting increments the sender's strike count and creates a report record.

### Steps

1. **SEED:** Create a message from Alice.
   ```bash
   bun run scripts/qa-seed.ts create-message ALICE_ID "Something reportable"
   bun run scripts/qa-seed.ts reset-tokens YOUR_ID
   ```

2. **iOS:** Tap "Read today's message". You should see the message.
3. **iOS:** Tap "Report". Confirm in the alert dialog.

**Expected:** Message is dismissed. Status shows "Message reported."

4. **VERIFY:** Check Alice's moderation state and the report record.
   ```bash
   bun run scripts/qa-seed.ts show-user ALICE_ID
   bun run scripts/qa-seed.ts show-reports
   ```

**Expected:**
- Alice's `strikeCount: 1`
- Alice's `lastStrikeAt` is recent
- Alice's `suspensionUntil: null` (only 1 strike, threshold is 3)
- Report record exists with `action: removed`, `strikes_after: 1`

---

## Scenario 4: Block a Sender

**What we're testing:** Blocking prevents receiving future messages from the same sender.

### Steps

1. **SEED:** Create a message from Bob.
   ```bash
   bun run scripts/qa-seed.ts create-message BOB_ID "Message from Bob"
   bun run scripts/qa-seed.ts reset-tokens YOUR_ID
   ```

2. **iOS:** Tap "Read today's message". You should see Bob's message.
3. **iOS:** Tap "Block sender". Confirm in the alert dialog.

**Expected:** Message is dismissed. Status shows "Sender blocked."

4. **SEED:** Create another message from Bob + another from Alice.
   ```bash
   bun run scripts/qa-seed.ts create-message BOB_ID "Bob again — you should NOT see this"
   bun run scripts/qa-seed.ts create-message ALICE_ID "Alice — you SHOULD see this"
   bun run scripts/qa-seed.ts reset-tokens YOUR_ID
   ```

5. **iOS:** Tap "Read today's message".

**Expected:** You receive Alice's message, NOT Bob's. The block is working.

---

## Scenario 5: 3 Strikes → Automatic Suspension

**What we're testing:** When a sender reaches 3 strikes, they get a 30-day suspension.

### Steps

1. **SEED:** Set Alice to 2 strikes (fresh — not decayed).
   ```bash
   bun run scripts/qa-seed.ts set-strikes ALICE_ID 2
   ```

2. **SEED:** Create a message from Alice.
   ```bash
   bun run scripts/qa-seed.ts create-message ALICE_ID "Third strike incoming"
   bun run scripts/qa-seed.ts reset-tokens YOUR_ID
   ```

3. **iOS:** Tap "Read today's message". Report the message.

4. **VERIFY:** Check Alice's state.
   ```bash
   bun run scripts/qa-seed.ts show-user ALICE_ID
   bun run scripts/qa-seed.ts show-reports
   ```

**Expected:**
- Alice's `strikeCount: 3`
- Alice's `suspensionUntil` is ~30 days from now
- Alice is `suspended NOW: YES`
- Latest report has `action: suspended`, `strikes_after: 3`

---

## Scenario 6: Suspended User Cannot Send

**What we're testing:** A user with an active suspension gets 403 on send.

### Steps

1. **SEED:** Suspend YOUR account (temporarily).
   ```bash
   bun run scripts/qa-seed.ts set-suspension YOUR_ID 1
   bun run scripts/qa-seed.ts reset-tokens YOUR_ID
   ```

2. **iOS:** Try to send a message.

**Expected:** The app shows a suspension message. The send button may be disabled or you get an error after tapping send.

3. **VERIFY:** Confirm suspension is set.
   ```bash
   bun run scripts/qa-seed.ts show-user YOUR_ID
   ```

---

## Scenario 7: Suspension Auto-Expiry

**What we're testing:** An expired suspension allows sending again.

### Steps

1. **SEED:** Set your suspension to the past (expired).
   ```bash
   bun run scripts/qa-seed.ts set-suspension YOUR_ID -1
   bun run scripts/qa-seed.ts reset-tokens YOUR_ID
   ```

2. **iOS:** Try to send a message.

**Expected:** Message sends successfully (201). The expired suspension doesn't block anything.

3. **SEED:** Clean up — remove suspension entirely.
   ```bash
   bun run scripts/qa-seed.ts clear-suspension YOUR_ID
   ```

---

## Scenario 8: Strike Decay After 30 Days

**What we're testing:** If a sender's last strike was more than 30 days ago, their strike count resets to 1 on the next report (instead of incrementing).

### Steps

1. **SEED:** Create a new fake sender with old strikes.
   ```bash
   bun run scripts/qa-seed.ts create-sender charlie
   ```
   Note `CHARLIE_ID`.

2. **SEED:** Set Charlie to 2 strikes, backdated 31 days.
   ```bash
   bun run scripts/qa-seed.ts set-strikes CHARLIE_ID 2 31
   ```

3. **SEED:** Create a message from Charlie.
   ```bash
   bun run scripts/qa-seed.ts create-message CHARLIE_ID "Message from Charlie"
   bun run scripts/qa-seed.ts reset-tokens YOUR_ID
   ```

4. **iOS:** Tap "Read today's message". Report the message.

5. **VERIFY:** Check Charlie's state.
   ```bash
   bun run scripts/qa-seed.ts show-user CHARLIE_ID
   ```

**Expected:**
- Charlie's `strikeCount: 1` (reset, NOT 3)
- Charlie's `suspensionUntil: null` (no suspension — only 1 strike)
- This confirms decay is working: old strikes don't accumulate

---

## Scenario 9: Suspension Extension (GREATEST)

**What we're testing:** A new report against an already-suspended sender extends (never shortens) the suspension.

### Steps

1. **SEED:** Create a new sender with an existing suspension.
   ```bash
   bun run scripts/qa-seed.ts create-sender dave
   ```
   Note `DAVE_ID`.

2. **SEED:** Set Dave to 3 strikes + suspension 25 days out.
   ```bash
   bun run scripts/qa-seed.ts set-strikes DAVE_ID 3
   bun run scripts/qa-seed.ts set-suspension DAVE_ID 25
   ```

3. **SEED:** Note Dave's current suspension_until.
   ```bash
   bun run scripts/qa-seed.ts show-user DAVE_ID
   ```
   Record the `suspensionUntil` timestamp.

4. **SEED:** Create a message from Dave + delivery log directly (since Dave is suspended, we bypass the send flow).
   ```bash
   bun run scripts/qa-seed.ts create-message DAVE_ID "Dave should not have sent this"
   bun run scripts/qa-seed.ts reset-tokens YOUR_ID
   ```

5. **iOS:** Receive and report the message.

6. **VERIFY:** Check Dave's state.
   ```bash
   bun run scripts/qa-seed.ts show-user DAVE_ID
   ```

**Expected:**
- Dave's `suspensionUntil` is now ~30 days from now (extended from 25 days)
- The new suspension is LATER than the old one (GREATEST ensures it never shortens)
- `strikeCount: 4` (incremented)

---

## Scenario 10: Account Deletion Carries Moderation State

**What we're testing:** When a user with strikes/suspension deletes their account, the moderation state is preserved in `deleted_accounts`.

### Steps

1. **SEED:** Give yourself some strikes (so there's state to carry forward).
   ```bash
   bun run scripts/qa-seed.ts set-strikes YOUR_ID 2
   bun run scripts/qa-seed.ts set-suspension YOUR_ID 15
   ```

2. **VERIFY:** Confirm your state before deletion.
   ```bash
   bun run scripts/qa-seed.ts show-user YOUR_ID
   ```

3. **iOS:** Go to Settings → Delete Account. Confirm.

4. **VERIFY:** Check deleted_accounts table.
   ```bash
   bun run scripts/qa-seed.ts show-deleted
   ```

**Expected:**
- A row exists in `deleted_accounts` with your `appleIdHash`
- `strikeCount: 2`
- `suspensionUntil` is set (15 days from when you set it)
- `cooldownUntil` is set to next period start

---

## Scenario 11: Re-register with Active Suspension → Carried Forward

**What we're testing:** Re-registering while suspension is still active restores the suspension on the new account.

### Steps

1. **SEED:** Clear the cooldown so you can re-register immediately.
   ```bash
   bun run scripts/qa-seed.ts clear-cooldown
   ```

2. **iOS:** Sign in again with Apple (same Apple ID).

3. **VERIFY:** Check your new user record.
   ```bash
   bun run scripts/qa-seed.ts list-users
   ```
   Find your new user (most recently created).
   ```bash
   bun run scripts/qa-seed.ts show-user NEW_USER_ID
   ```

**Expected:**
- New user has `strikeCount: 2` (carried forward)
- New user has `suspensionUntil` set (carried forward)
- `deleted_accounts` row is gone (cleaned up during re-registration)

4. **iOS:** Try to send a message.

**Expected:** Blocked — suspension is active (403).

---

## Scenario 12: Re-register with Expired Suspension → Clean Start

**What we're testing:** If the suspension expired between deletion and re-registration, the user gets a clean start.

### Steps

1. **SEED:** Set your suspension to expired, then delete.
   ```bash
   bun run scripts/qa-seed.ts set-suspension YOUR_ID -1
   ```

2. **iOS:** Go to Settings → Delete Account. Confirm.

3. **SEED:** Verify deleted_accounts has the expired suspension.
   ```bash
   bun run scripts/qa-seed.ts show-deleted
   ```

4. **SEED:** Clear cooldown.
   ```bash
   bun run scripts/qa-seed.ts clear-cooldown
   ```

5. **iOS:** Sign in again with Apple.

6. **VERIFY:** Check your new user.
   ```bash
   bun run scripts/qa-seed.ts list-users
   bun run scripts/qa-seed.ts show-user NEW_USER_ID
   ```

**Expected:**
- New user has `strikeCount: 0` (clean start)
- New user has `suspensionUntil: null`
- No carried-forward state — expired suspension = fresh start

7. **iOS:** Send a message.

**Expected:** Sends successfully.

---

## Scenario 13: Reports Survive Account Deletion (SET NULL)

**What we're testing:** When a user deletes their account, their reports remain in the DB with the user ID set to NULL.

### Steps

1. **VERIFY:** Check existing reports.
   ```bash
   bun run scripts/qa-seed.ts show-reports
   ```
   Note any reports where Alice is the sender.

2. **SEED:** Delete Alice's user directly (simulating account deletion).
   ```bash
   cd relay-cafe-api && bun -e "
   import { db } from './src/db';
   import { users } from './src/db/schema';
   import { eq } from 'drizzle-orm';
   await db.delete(users).where(eq(users.id, 'ALICE_ID'));
   console.log('Deleted Alice');
   process.exit(0);
   "
   ```

3. **VERIFY:** Check reports again.
   ```bash
   bun run scripts/qa-seed.ts show-reports
   ```

**Expected:**
- Reports that had Alice as `sender` now show `sender: NULL`
- Reports that had you as `reporter` still show your user ID
- The report row itself is preserved (not deleted)

---

## Scenario 14: UUID Validation on Report/Block

**What we're testing:** Invalid UUIDs in report/block endpoints return 404.

### Steps

This is best tested via curl since the iOS app always sends valid UUIDs:

```bash
# Get your session token (from the sessions table)
cd relay-cafe-api && bun -e "
import { db } from './src/db';
import { sessions } from './src/db/schema';
const all = await db.select().from(sessions);
for (const s of all) console.log(s.id, s.tokenHash.slice(0,12) + '...');
process.exit(0);
"
```

Then test with curl:

```bash
# Report with invalid UUID
curl -s -X POST http://localhost:3000/v1/messages/not-a-uuid/report \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'

# Block with invalid UUID
curl -s -X POST http://localhost:3000/v1/messages/not-a-uuid/block \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Expected:** Both return `{"error":"Not found"}` with status 404.

---

## Cleanup

After all testing, reset to a clean state:

```bash
bun run scripts/qa-seed.ts clear-all
```

Then sign in again with Apple to create a fresh account.

---

## Quick Reference

| Command | What it does |
|---------|-------------|
| `list-users` | Show all users with moderation state |
| `create-sender <label>` | Create a fake user |
| `create-message <id> [text]` | Insert an encrypted message |
| `reset-tokens <id>` | Allow user to send/receive again |
| `set-strikes <id> <n> [daysAgo]` | Set strike count |
| `set-suspension <id> <days>` | Set suspension (negative = expired) |
| `clear-suspension <id>` | Remove suspension + strikes |
| `show-user <id>` | Show moderation state |
| `show-reports` | List all reports |
| `show-deleted` | List deleted_accounts |
| `clear-cooldown` | Allow re-registration |
| `clear-all` | Nuclear reset |

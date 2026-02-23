The core idea

  Every user gets one send and one receive per day. That's it. Both tokens reset at
  00:00 UTC.

  The daily cycle

  Period: A "day" is calculated as Math.floor(Date.now() / 86400000) — the epoch day
  number. When this number increments (midnight UTC), every user gets fresh tokens.

  Send flow:
  1. User taps "Write today's message" → compose screen opens
  2. They write up to 1000 characters and submit
  3. Server atomically claims their send token (UPDATE daily_tokens SET sendUsed=true
  WHERE sendUsed=false — if someone races, only one wins)
  4. Message gets encrypted (random AES-256 key → KMS wraps that key) and stored
  5. Message has a 24h TTL from creation
  6. Button greys out: "You've already sent today."

  Receive flow:
  1. User taps "Open today's message" → 2-second intentional pause (design choice —
  builds anticipation)
  2. Server atomically claims their receive token (same pattern as send)
  3. Server picks a random unexpired message (ORDER BY RANDOM()) and locks it (FOR
  UPDATE SKIP LOCKED — so no two users can get the same message)
  4. Inside the same transaction: unwrap KMS key → decrypt → delete the message
  5. If decryption fails, transaction rolls back — message stays, receive token is
  returned
  6. If the pool is empty (no messages available), receive token is returned — user can
  try again later
  7. Message appears on screen with fade-in. User reads it.

  What "the relay is quiet today" means: No messages in the pool. The user's receive
  token was NOT consumed — they can tap again later when someone else has sent
  something.

  Message lifecycle

  Created (encrypted, stored in DB)
    → Sits in pool, available to any receiver (up to 24h)
    → Picked up by a random user → decrypted → hard-deleted from DB
    OR
    → Expires after 24h → sits as dead row (pg_cron cleans up)

  A message is never read by more than one person. It's deleted the moment it's
  delivered.

  Token reset

  There's no cron job or scheduled reset. The period number (Math.floor(now / 86400000))
   just naturally increments at midnight UTC. When the user opens the app the next day,
  loadStatus() queries for today's period — no row exists yet, so sendUsed and
  receiveUsed both return false. Fresh tokens.

  The app polls status every 60 seconds and on every foreground event, so the UI updates
   within a minute of midnight.

  Screenshot / expiry

  If the user screenshots the message, it immediately shows "This message is no longer
  available." If the message's expiresAt passes while they're reading, same thing. The
  message screen checks expiry every 60 seconds and on every foreground event.

  KMS key rotation

  A new encryption key version is created every 24h. Old versions can still decrypt
  messages they encrypted (GCP resolves the right version from ciphertext metadata).
  After 50h, the cleanup script schedules old versions for destruction. After another
  50h safety window, they're actually deleted.

  Good. We’ll lock this in clearly so there is zero ambiguity in the system.

Send this to the agent:

⸻

Relay.cafe – Token Reset Model Clarification (Critical)

We are explicitly using a fixed UTC daily reset model, NOT a rolling 24-hour model.

Clarify and enforce the following:

⸻

1. Definition of “Once per Day”

“Once per day” means:
	•	Once per UTC calendar day.
	•	Tokens reset at 00:00 UTC.
	•	Tokens do NOT reset 24 hours after the last action.
	•	There is NO rolling window.

This must be reflected in:
	•	Code
	•	Comments
	•	Documentation

⸻

2. Period Calculation

The daily period must be calculated as:

Math.floor(Date.now() / 86400000)

This represents the UTC epoch day.

Do NOT:
	•	Store lastSentAt and compare 24 hours.
	•	Implement rolling 24h logic.
	•	Add sliding windows.
	•	Add timers.
	•	Add cron reset jobs.

The system relies solely on period comparison.

⸻

3. Behavioral Examples (Document in Code Comments)

Add explanatory comments in code describing:

Example A:
	•	User sends at 10:00 UTC Monday.
	•	At 00:00 UTC Tuesday, they can send again (even if less than 24 hours passed).

Example B:
	•	User sends at 23:59 UTC.
	•	At 00:00 UTC (1 minute later), they can send again.

This is expected and correct behavior.

⸻

4. Token State Logic

When checking token status:
	•	Query by (userId, currentPeriod)
	•	If no row exists → both sendUsed and receiveUsed = false.
	•	If row exists → enforce flags.

No historical timing comparison required.

⸻

5. Do Not Change This Model

Do NOT convert this to:
	•	Rolling 24-hour windows.
	•	Cooldown timers.
	•	Sliding rate limits.
	•	Per-user 24h delays.

This is a deliberate global ritual design decision.
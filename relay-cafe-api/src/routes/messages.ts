import { Hono } from 'hono'
import { db } from '../db'
import { messages, dailyTokens, users, deliveryLog, reports } from '../db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { encryptMessage, decryptMessage } from '../lib/crypto'
import { wrapKey, unwrapKey } from '../lib/kms'
import { currentPeriod } from '../lib/period'
import { captureError } from '../lib/logger'
import { checkContent } from '../lib/contentFilter'
import { createRateLimitMiddleware } from '../middleware/rateLimit'
import { rateLimiter } from '../lib/container'

// authMiddleware is applied by app.ts when mounting this router
export const messagesRouter = new Hono<{ Variables: { userId: string } }>()

messagesRouter.post('/', createRateLimitMiddleware(rateLimiter, 'messages'), async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body?.text || typeof body.text !== 'string' || body.text.trim().length === 0) {
    return c.json({ error: 'text required' }, 400)
  }
  if (body.text.length > 1000) {
    return c.json({ error: 'text exceeds 1000 characters' }, 400)
  }

  const userId = c.get('userId')
  const today = currentPeriod()

  // Content filter runs before transaction — blocked content never touches the DB or consumes a token
  if (checkContent(body.text).blocked) {
    return c.json({ error: 'This message violates community guidelines.' }, 400)
  }

  try {
    const result = await db.transaction(async (tx) => {
      // 1. Suspension check (first — before token claim)
      const [user] = await tx
        .select({ suspensionUntil: users.suspensionUntil })
        .from(users)
        .where(eq(users.id, userId))

      if (user?.suspensionUntil && user.suspensionUntil > new Date()) {
        return { suspended: true } as const
      }

      // 2. Upsert daily token row
      await tx
        .insert(dailyTokens)
        .values({ userId, date: today, sendUsed: false, receiveUsed: false })
        .onConflictDoNothing()

      // 3. Claim send token
      const claimed = await tx
        .update(dailyTokens)
        .set({ sendUsed: true })
        .where(
          and(
            eq(dailyTokens.userId, userId),
            eq(dailyTokens.date, today),
            eq(dailyTokens.sendUsed, false),
          ),
        )
        .returning()

      if (claimed.length === 0) {
        return { alreadySent: true } as const
      }

      // 4. Encrypt + insert with sender_user_id
      const { ciphertext, iv, key } = await encryptMessage(body.text)
      const { encryptedKey, keyVersion } = await wrapKey(key)

      const ttlMs = (Number(process.env.MESSAGE_TTL_SECONDS) || 86400) * 1000
      const expiresAt = new Date(Date.now() + ttlMs)

      await tx.insert(messages).values({
        senderUserId: userId,
        ciphertext,
        encryptedMessageKey: encryptedKey,
        kmsKeyVersion: keyVersion,
        iv,
        expiresAt,
      })

      return { ok: true } as const
    })

    if ('suspended' in result && result.suspended) {
      return c.json({ error: 'Your account has been suspended for violating community guidelines.' }, 403)
    }
    if ('alreadySent' in result && result.alreadySent) {
      return c.json({ error: 'Already sent today.' }, 429)
    }
    return c.json({ ok: true }, 201)
  } catch (err) {
    captureError(err, { route: 'POST /messages', action: 'send' })
    return c.json({ error: 'Unable to send message.' }, 500)
  }
})

messagesRouter.get('/today', createRateLimitMiddleware(rateLimiter, 'messages'), async (c) => {
  const userId = c.get('userId')
  const today = currentPeriod()

  // Upsert daily token row
  await db
    .insert(dailyTokens)
    .values({ userId, date: today, sendUsed: false, receiveUsed: false })
    .onConflictDoNothing()

  // Atomically claim the receive token (prevents TOCTOU race)
  const claimed = await db
    .update(dailyTokens)
    .set({ receiveUsed: true })
    .where(
      and(
        eq(dailyTokens.userId, userId),
        eq(dailyTokens.date, today),
        eq(dailyTokens.receiveUsed, false),
      ),
    )
    .returning()

  if (claimed.length === 0) {
    return c.json({ error: 'Already received today.' }, 429)
  }

  try {
    const result = await db.transaction(async (tx) => {
      // Lock a random unexpired message, excluding self and blocked senders
      const candidates = await tx.execute<{
        id: string
        ciphertext: string
        encrypted_message_key: string
        kms_key_version: string
        iv: string
        expires_at: Date
        sender_user_id: string
      }>(sql`
        SELECT m.id, m.ciphertext, m.encrypted_message_key, m.kms_key_version, m.iv, m.expires_at, m.sender_user_id
        FROM messages m
        JOIN users sender ON sender.id = m.sender_user_id
        WHERE m.expires_at > NOW()
          AND m.sender_user_id != ${userId}
          AND NOT EXISTS (
            SELECT 1 FROM blocked_senders bs
            WHERE bs.blocker_user_id = ${userId}
              AND bs.blocked_apple_id_hash = sender.apple_id_hash
          )
        ORDER BY RANDOM()
        LIMIT 1
        FOR UPDATE OF m SKIP LOCKED
      `)

      const msg = candidates[0]
      if (!msg) return null

      // Decrypt
      const key = await unwrapKey(msg.encrypted_message_key, msg.kms_key_version)
      const text = await decryptMessage(msg.ciphertext, msg.iv, key)

      // Write delivery log BEFORE deletion
      await tx.execute(sql`
        INSERT INTO delivery_log (id, message_id, sender_user_id, recipient_user_id)
        VALUES (gen_random_uuid(), ${msg.id}, ${msg.sender_user_id}, ${userId})
      `)

      // Delete message
      await tx.execute(sql`DELETE FROM messages WHERE id = ${msg.id}`)

      const expiresAt = msg.expires_at instanceof Date
        ? msg.expires_at.getTime()
        : new Date(msg.expires_at).getTime()

      return { id: msg.id, text, expiresAt }
    })

    if (!result) {
      // No messages available — roll back receive token
      await db
        .update(dailyTokens)
        .set({ receiveUsed: false })
        .where(
          and(
            eq(dailyTokens.userId, userId),
            eq(dailyTokens.date, today),
          ),
        )
      return c.body(null, 204)
    }

    return c.json(result)
  } catch (err) {
    captureError(err, { route: 'GET /messages/today', action: 'decrypt-and-deliver' })
    try {
      await db
        .update(dailyTokens)
        .set({ receiveUsed: false })
        .where(
          and(
            eq(dailyTokens.userId, userId),
            eq(dailyTokens.date, today),
          ),
        )
    } catch (rollbackErr) {
      captureError(rollbackErr, { route: 'GET /messages/today', action: 'receive-token-rollback' })
    }
    return c.json({ error: 'Unable to process message.' }, 500)
  }
})

messagesRouter.post('/:id/report', createRateLimitMiddleware(rateLimiter, 'messages'), async (c) => {
  const userId = c.get('userId')
  const messageId = c.req.param('id')

  // Look up delivery log — can only report messages you received, within 48h
  const [delivery] = await db
    .select({
      senderUserId: deliveryLog.senderUserId,
    })
    .from(deliveryLog)
    .where(
      and(
        eq(deliveryLog.messageId, messageId),
        eq(deliveryLog.recipientUserId, userId),
      ),
    )

  if (!delivery) {
    return c.json({ error: 'Not found' }, 404)
  }

  try {
    const result = await db.transaction(async (tx) => {
      // Idempotency check inside transaction to prevent race
      const [existingReport] = await tx
        .select({ id: reports.id })
        .from(reports)
        .where(
          and(
            eq(reports.messageId, messageId),
            eq(reports.reporterUserId, userId),
          ),
        )

      if (existingReport) {
        return { alreadyReported: true } as const
      }

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

      // Insert report
      await tx.insert(reports).values({
        messageId,
        reporterUserId: userId,
        senderUserId: delivery.senderUserId,
        actionTaken,
        strikeCountAfter: strikeCount,
      })

      return { ok: true } as const
    })

    return c.json({ ok: true })
  } catch (err) {
    captureError(err, { route: 'POST /messages/:id/report', action: 'report' })
    return c.json({ error: 'Unable to process report.' }, 500)
  }
})

messagesRouter.post('/:id/block', createRateLimitMiddleware(rateLimiter, 'messages'), async (c) => {
  const userId = c.get('userId')
  const messageId = c.req.param('id')

  // Look up delivery log — can only block senders of messages you received
  const [delivery] = await db
    .select({
      senderUserId: deliveryLog.senderUserId,
    })
    .from(deliveryLog)
    .where(
      and(
        eq(deliveryLog.messageId, messageId),
        eq(deliveryLog.recipientUserId, userId),
      ),
    )

  if (!delivery) {
    return c.json({ error: 'Not found' }, 404)
  }

  // Look up sender's apple_id_hash — blocks persist across account deletion
  const [sender] = await db
    .select({ appleIdHash: users.appleIdHash })
    .from(users)
    .where(eq(users.id, delivery.senderUserId))

  if (!sender) {
    // Sender already deleted — nothing to block
    return c.json({ ok: true })
  }

  // Insert block by apple_id_hash — idempotent via ON CONFLICT DO NOTHING
  await db.execute(sql`
    INSERT INTO blocked_senders (blocker_user_id, blocked_apple_id_hash)
    VALUES (${userId}, ${sender.appleIdHash})
    ON CONFLICT DO NOTHING
  `)

  return c.json({ ok: true })
})

import { Hono } from 'hono'
import { db } from '../db'
import { messages, dailyTokens } from '../db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { encryptMessage, decryptMessage } from '../lib/crypto'
import { wrapKey, unwrapKey } from '../lib/kms'
import { currentPeriod } from '../lib/period'
import { captureError } from '../lib/logger'
import { createRateLimitMiddleware } from '../middleware/rateLimit'
import { rateLimiter } from '../lib/container'

// authMiddleware is applied by app.ts when mounting this router
export const messagesRouter = new Hono()

messagesRouter.post('/', createRateLimitMiddleware(rateLimiter, 'messages'), async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body?.text || typeof body.text !== 'string' || body.text.trim().length === 0) {
    return c.json({ error: 'text required' }, 400)
  }
  if (body.text.length > 1000) {
    return c.json({ error: 'text exceeds 1000 characters' }, 400)
  }

  const userId = c.get('userId') as string
  const today = currentPeriod()

  // Upsert daily token row
  await db
    .insert(dailyTokens)
    .values({ userId, date: today, sendUsed: false, receiveUsed: false })
    .onConflictDoNothing()

  // Atomically claim the send token: UPDATE ... WHERE sendUsed = false
  // Returns the updated row only if the token was available (prevents TOCTOU race)
  const claimed = await db
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
    return c.json({ error: 'Already sent today.' }, 429)
  }

  // Encrypt + insert. If encrypt/KMS/insert fails, roll back the send token
  // so the user doesn't lose their daily send on a server-side failure.
  try {
    const { ciphertext, iv, key } = await encryptMessage(body.text)
    const { encryptedKey, keyVersion } = await wrapKey(key)

    const ttlMs = (Number(process.env.MESSAGE_TTL_SECONDS) || 86400) * 1000
    const expiresAt = new Date(Date.now() + ttlMs)

    await db.insert(messages).values({
      ciphertext,
      encryptedMessageKey: encryptedKey,
      kmsKeyVersion: keyVersion,
      iv,
      expiresAt,
    })

    return c.json({ ok: true }, 201)
  } catch (err) {
    captureError(err, { route: 'POST /messages', action: 'encrypt-and-insert' })
    // Roll back send token so user can retry
    try {
      await db
        .update(dailyTokens)
        .set({ sendUsed: false })
        .where(
          and(
            eq(dailyTokens.userId, userId),
            eq(dailyTokens.date, today),
          ),
        )
    } catch (rollbackErr) {
      captureError(rollbackErr, { route: 'POST /messages', action: 'send-token-rollback' })
    }
    return c.json({ error: 'Unable to send message.' }, 500)
  }
})

messagesRouter.get('/today', createRateLimitMiddleware(rateLimiter, 'messages'), async (c) => {
  const userId = c.get('userId') as string
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

  // Transaction: lock message → decrypt → delete only on success.
  // If decryption fails, rollback preserves the message and the
  // receive token is rolled back outside the transaction.
  try {
    const result = await db.transaction(async (tx) => {
      // Lock a random unexpired message
      const candidates = await tx.execute<{
        id: string
        ciphertext: string
        encrypted_message_key: string
        kms_key_version: string
        iv: string
        expires_at: Date
      }>(sql`
        SELECT id, ciphertext, encrypted_message_key, kms_key_version, iv, expires_at
        FROM messages
        WHERE expires_at > NOW()
        ORDER BY RANDOM()
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `)

      const msg = candidates[0]
      if (!msg) return null

      // Decrypt before deleting — if this fails, transaction rolls back
      const key = await unwrapKey(msg.encrypted_message_key, msg.kms_key_version)
      const text = await decryptMessage(msg.ciphertext, msg.iv, key)

      // Decryption succeeded — now delete
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
    // Decrypt or KMS failure — transaction rolled back, message preserved.
    // Roll back receive token so user can try again.
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

import { Hono } from 'hono'
import { db } from '../db'
import { messages, dailyTokens } from '../db/schema'
import { and, eq, gt, sql } from 'drizzle-orm'
import { encryptMessage, decryptMessage } from '../lib/crypto'
import { wrapKey, unwrapKey } from '../lib/kms'
import { currentPeriod } from '../lib/period'

// authMiddleware is applied by app.ts when mounting this router
export const messagesRouter = new Hono()

messagesRouter.post('/', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body?.text || typeof body.text !== 'string') {
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

  // Encrypt
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
})

messagesRouter.get('/today', async (c) => {
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

  // Atomically claim a random undelivered, unexpired message using
  // a CTE with FOR UPDATE SKIP LOCKED to prevent two receivers
  // from getting the same message.
  const claimedMessages = await db.execute<{
    id: string
    ciphertext: string
    encrypted_message_key: string
    kms_key_version: string
    iv: string
    expires_at: Date
  }>(sql`
    WITH candidate AS (
      SELECT id FROM messages
      WHERE delivered = false AND expires_at > NOW()
      ORDER BY RANDOM()
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    DELETE FROM messages
    USING candidate
    WHERE messages.id = candidate.id
    RETURNING messages.id, messages.ciphertext,
              messages.encrypted_message_key, messages.kms_key_version,
              messages.iv, messages.expires_at
  `)

  const msg = claimedMessages[0]

  if (!msg) {
    // Quiet day -- no messages available. Roll back the receive token
    // so the user can try again later.
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

  // Decrypt
  const key = await unwrapKey(msg.encrypted_message_key, msg.kms_key_version)
  const text = await decryptMessage(msg.ciphertext, msg.iv, key)

  const expiresAt = msg.expires_at instanceof Date
    ? msg.expires_at.getTime()
    : new Date(msg.expires_at).getTime()

  return c.json({ id: msg.id, text, expiresAt })
})

import { Hono } from 'hono'
import { db } from '../db'
import { messages, dailyTokens } from '../db/schema'
import { and, eq, gt, sql } from 'drizzle-orm'
import { encryptMessage, decryptMessage } from '../lib/crypto'
import { wrapKey, unwrapKey } from '../lib/kms'

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
  const today = new Date().toISOString().slice(0, 10)

  // Upsert daily token row and check
  await db
    .insert(dailyTokens)
    .values({ userId, date: today, sendUsed: false, receiveUsed: false })
    .onConflictDoNothing()

  const [tokens] = await db
    .select()
    .from(dailyTokens)
    .where(and(eq(dailyTokens.userId, userId), eq(dailyTokens.date, today)))

  if (tokens.sendUsed) {
    return c.json({ error: 'Already sent today.' }, 429)
  }

  // Encrypt
  const { ciphertext, iv, key } = await encryptMessage(body.text)
  const { encryptedKey, keyVersion } = await wrapKey(key)

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)

  await db.insert(messages).values({
    ciphertext,
    encryptedMessageKey: encryptedKey,
    kmsKeyVersion: keyVersion,
    iv,
    expiresAt,
  })

  // Mark send token used
  await db
    .update(dailyTokens)
    .set({ sendUsed: true })
    .where(and(eq(dailyTokens.userId, userId), eq(dailyTokens.date, today)))

  return c.body(null, 204)
})

messagesRouter.get('/today', async (c) => {
  const userId = c.get('userId') as string
  const today = new Date().toISOString().slice(0, 10)

  await db
    .insert(dailyTokens)
    .values({ userId, date: today, sendUsed: false, receiveUsed: false })
    .onConflictDoNothing()

  const [tokens] = await db
    .select()
    .from(dailyTokens)
    .where(and(eq(dailyTokens.userId, userId), eq(dailyTokens.date, today)))

  if (tokens.receiveUsed) {
    return c.json({ error: 'Already received today.' }, 429)
  }

  // Pick a random undelivered, unexpired message
  const [msg] = await db
    .select()
    .from(messages)
    .where(and(eq(messages.delivered, false), gt(messages.expiresAt, new Date())))
    .orderBy(sql`RANDOM()`)
    .limit(1)

  if (!msg) {
    // Quiet day — token NOT consumed
    return c.body(null, 204)
  }

  // Decrypt
  const key = await unwrapKey(msg.encryptedMessageKey, msg.kmsKeyVersion)
  const text = await decryptMessage(msg.ciphertext, msg.iv, key)

  // Hard delete message row immediately
  await db.delete(messages).where(eq(messages.id, msg.id))

  // Mark receive token used
  await db
    .update(dailyTokens)
    .set({ receiveUsed: true })
    .where(and(eq(dailyTokens.userId, userId), eq(dailyTokens.date, today)))

  return c.json({ id: msg.id, text })
})

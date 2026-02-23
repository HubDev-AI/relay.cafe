import { test, expect, describe, beforeEach } from 'bun:test'
import { resetDB, createAuthenticatedUser } from '../helpers/db'
import { requestJSON } from '../helpers/http'
import { db } from '../../src/db'
import { messages, dailyTokens } from '../../src/db/schema'
import { eq, and } from 'drizzle-orm'
import { currentPeriod } from '../../src/lib/period'

describe('POST /v1/messages (send)', () => {
  let token: string
  let userId: string

  beforeEach(async () => {
    await resetDB()
    const auth = await createAuthenticatedUser()
    token = auth.token
    userId = auth.userId
  })

  test('valid send returns 201 with { ok: true }', async () => {
    const { status, json } = await requestJSON('/v1/messages', {
      method: 'POST',
      token,
      body: { text: 'Hello stranger' },
    })
    expect(status).toBe(201)
    expect(json).toEqual({ ok: true })
  })

  test('send creates encrypted message in DB', async () => {
    await requestJSON('/v1/messages', {
      method: 'POST',
      token,
      body: { text: 'Check the DB' },
    })
    const allMessages = await db.select().from(messages)
    expect(allMessages.length).toBe(1)
    // Ciphertext should not contain the plaintext
    expect(allMessages[0].ciphertext).not.toContain('Check the DB')
    expect(allMessages[0].ciphertext.length).toBeGreaterThan(0)
    expect(allMessages[0].iv.length).toBeGreaterThan(0)
    expect(allMessages[0].encryptedMessageKey.length).toBeGreaterThan(0)
    expect(allMessages[0].kmsKeyVersion.length).toBeGreaterThan(0)

  })

  test('send marks sendUsed=true in daily tokens', async () => {
    await requestJSON('/v1/messages', {
      method: 'POST',
      token,
      body: { text: 'Check tokens' },
    })
    const today = currentPeriod()
    const [tok] = await db.select().from(dailyTokens).where(
      and(eq(dailyTokens.userId, userId), eq(dailyTokens.date, today))
    ).limit(1)
    expect(tok!.sendUsed).toBe(true)
    expect(tok!.receiveUsed).toBe(false)
  })

  test('expiresAt is set correctly based on MESSAGE_TTL_SECONDS', async () => {
    const before = Date.now()
    await requestJSON('/v1/messages', {
      method: 'POST',
      token,
      body: { text: 'TTL check' },
    })
    const after = Date.now()
    const ttlMs = (Number(process.env.MESSAGE_TTL_SECONDS) || 86400) * 1000

    const [msg] = await db.select().from(messages)
    const expiresAt = msg!.expiresAt.getTime()
    expect(expiresAt).toBeGreaterThanOrEqual(before + ttlMs - 100)
    expect(expiresAt).toBeLessThanOrEqual(after + ttlMs + 100)
  })

  test('already sent today returns 429', async () => {
    await requestJSON('/v1/messages', { method: 'POST', token, body: { text: 'first' } })
    const { status, json } = await requestJSON('/v1/messages', {
      method: 'POST',
      token,
      body: { text: 'second attempt' },
    })
    expect(status).toBe(429)
    expect(json).toHaveProperty('error')
  })

  test('second send does NOT create a second message', async () => {
    await requestJSON('/v1/messages', { method: 'POST', token, body: { text: 'first' } })
    await requestJSON('/v1/messages', { method: 'POST', token, body: { text: 'second' } })
    const allMessages = await db.select().from(messages)
    expect(allMessages.length).toBe(1)
  })

  test('empty text returns 400', async () => {
    const { status } = await requestJSON('/v1/messages', {
      method: 'POST',
      token,
      body: { text: '' },
    })
    expect(status).toBe(400)
  })

  test('missing text field returns 400', async () => {
    const { status } = await requestJSON('/v1/messages', {
      method: 'POST',
      token,
      body: {},
    })
    expect(status).toBe(400)
  })

  test('non-string text returns 400', async () => {
    const { status } = await requestJSON('/v1/messages', {
      method: 'POST',
      token,
      body: { text: 12345 },
    })
    expect(status).toBe(400)
  })

  test('text exceeding 1000 characters returns 400', async () => {
    const { status } = await requestJSON('/v1/messages', {
      method: 'POST',
      token,
      body: { text: 'x'.repeat(1001) },
    })
    expect(status).toBe(400)
  })

  test('exactly 1000 characters is accepted', async () => {
    const { status } = await requestJSON('/v1/messages', {
      method: 'POST',
      token,
      body: { text: 'x'.repeat(1000) },
    })
    expect(status).toBe(201)
  })

  test('whitespace-only text is rejected', async () => {
    const { status } = await requestJSON('/v1/messages', {
      method: 'POST',
      token,
      body: { text: '   ' },
    })
    expect(status).toBe(400)
  })

  test('emoji message works', async () => {
    const { status } = await requestJSON('/v1/messages', {
      method: 'POST',
      token,
      body: { text: '\u{1F30D}\u{1F525}\u{2728}' },
    })
    expect(status).toBe(201)
  })

  test('no auth returns 401', async () => {
    const { status } = await requestJSON('/v1/messages', {
      method: 'POST',
      body: { text: 'no auth' },
    })
    expect(status).toBe(401)
  })

  test('two users can both send in the same period', async () => {
    const userA = await createAuthenticatedUser()
    const userB = await createAuthenticatedUser()

    const resA = await requestJSON('/v1/messages', {
      method: 'POST',
      token: userA.token,
      body: { text: 'from A' },
    })
    const resB = await requestJSON('/v1/messages', {
      method: 'POST',
      token: userB.token,
      body: { text: 'from B' },
    })
    expect(resA.status).toBe(201)
    expect(resB.status).toBe(201)

    const allMessages = await db.select().from(messages)
    expect(allMessages.length).toBe(2)
  })
})

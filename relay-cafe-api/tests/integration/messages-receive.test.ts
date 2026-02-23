import { test, expect, describe, beforeEach } from 'bun:test'
import { resetDB, createAuthenticatedUser, createMessage } from '../helpers/db'
import { requestJSON, request } from '../helpers/http'
import { db } from '../../src/db'
import { messages, dailyTokens } from '../../src/db/schema'
import { eq, and } from 'drizzle-orm'
import { currentPeriod } from '../../src/lib/period'

describe('GET /messages/today (receive)', () => {
  beforeEach(async () => {
    await resetDB()
  })

  test('message available — returns 200 with { id, text, expiresAt }', async () => {
    const { plaintext } = await createMessage()
    const receiver = await createAuthenticatedUser()

    const { status, json } = await requestJSON<{ id: string; text: string; expiresAt: string }>('/messages/today', {
      token: receiver.token,
    })
    expect(status).toBe(200)
    expect(json!.id).toBeTruthy()
    expect(json!.text).toBe(plaintext)
    expect(json!.expiresAt).toBeTruthy()
  })

  test('message is deleted from DB after delivery', async () => {
    await createMessage()
    const receiver = await createAuthenticatedUser()
    await requestJSON('/messages/today', { token: receiver.token })

    const remaining = await db.select().from(messages)
    expect(remaining.length).toBe(0)
  })

  test('receiveUsed is set to true after successful receive', async () => {
    await createMessage()
    const receiver = await createAuthenticatedUser()
    await requestJSON('/messages/today', { token: receiver.token })

    const today = currentPeriod()
    const [tok] = await db.select().from(dailyTokens).where(
      and(eq(dailyTokens.userId, receiver.userId), eq(dailyTokens.date, today))
    ).limit(1)
    expect(tok!.receiveUsed).toBe(true)
  })

  test('empty pool — returns 204, receiveUsed stays false', async () => {
    const receiver = await createAuthenticatedUser()
    const res = await request('/messages/today', { token: receiver.token })
    expect(res.status).toBe(204)

    const today = currentPeriod()
    const [tok] = await db.select().from(dailyTokens).where(
      and(eq(dailyTokens.userId, receiver.userId), eq(dailyTokens.date, today))
    ).limit(1)
    expect(tok!.receiveUsed).toBe(false)
  })

  test('after empty pool, user can try again and succeed', async () => {
    const receiver = await createAuthenticatedUser()
    // First attempt: empty pool
    const r1 = await request('/messages/today', { token: receiver.token })
    expect(r1.status).toBe(204)

    // Now add a message
    await createMessage()

    // Second attempt: should succeed
    const { status, json } = await requestJSON<{ text: string }>('/messages/today', {
      token: receiver.token,
    })
    expect(status).toBe(200)
    expect(json!.text).toBeTruthy()
  })

  test('already received today returns 429', async () => {
    await createMessage()
    const receiver = await createAuthenticatedUser()
    await requestJSON('/messages/today', { token: receiver.token })

    // Insert another message so pool isn't empty
    await createMessage()

    const { status } = await requestJSON('/messages/today', { token: receiver.token })
    expect(status).toBe(429)
  })

  test('expiresAt is valid ISO8601 with milliseconds', async () => {
    await createMessage()
    const receiver = await createAuthenticatedUser()
    const { json } = await requestJSON<{ expiresAt: string }>('/messages/today', {
      token: receiver.token,
    })
    const expiresAt = json!.expiresAt
    const parsed = new Date(expiresAt)
    expect(parsed.getTime()).toBeGreaterThan(0)
    // Verify ISO format compatible with iOS decoder
    const isoWithMs = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/
    const isoWithoutMs = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/
    expect(isoWithMs.test(expiresAt) || isoWithoutMs.test(expiresAt)).toBe(true)
  })

  test('expired message is NOT served', async () => {
    await createMessage({ expiresInMs: -1000 })
    const receiver = await createAuthenticatedUser()
    const res = await request('/messages/today', { token: receiver.token })
    expect(res.status).toBe(204)
  })

  test('send and receive are independent token systems', async () => {
    const user = await createAuthenticatedUser()
    await createMessage()

    // Send first
    await requestJSON('/messages', {
      method: 'POST',
      token: user.token,
      body: { text: 'I sent' },
    })

    // Should still be able to receive
    const { status } = await requestJSON('/messages/today', { token: user.token })
    expect(status).toBe(200)
  })

  test('receive then send are independent', async () => {
    const user = await createAuthenticatedUser()
    await createMessage()

    // Receive first
    await requestJSON('/messages/today', { token: user.token })

    // Should still be able to send
    const { status } = await requestJSON('/messages', {
      method: 'POST',
      token: user.token,
      body: { text: 'I sent after receiving' },
    })
    expect(status).toBe(201)
  })

  test('decrypted text matches original plaintext', async () => {
    const { plaintext } = await createMessage()
    const receiver = await createAuthenticatedUser()
    const { json } = await requestJSON<{ text: string }>('/messages/today', {
      token: receiver.token,
    })
    expect(json!.text).toBe(plaintext)
  })

  test('no auth returns 401', async () => {
    const { status } = await requestJSON('/messages/today')
    expect(status).toBe(401)
  })

  test('multiple messages in pool — only one is served', async () => {
    await createMessage()
    await createMessage()
    await createMessage()
    const receiver = await createAuthenticatedUser()
    const { status } = await requestJSON('/messages/today', { token: receiver.token })
    expect(status).toBe(200)

    const remaining = await db.select().from(messages)
    expect(remaining.length).toBe(2)
  })
})

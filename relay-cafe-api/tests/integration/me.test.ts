import { test, expect, describe, beforeAll, beforeEach } from 'bun:test'
import { resetDB, createAuthenticatedUser, createMessage } from '../helpers/db'
import { requestJSON, request } from '../helpers/http'
import { db } from '../../src/db'
import { users, sessions, dailyTokens } from '../../src/db/schema'
import { eq } from 'drizzle-orm'

describe('GET /v1/me/status', () => {
  let token: string

  beforeAll(async () => {
    await resetDB()
    const auth = await createAuthenticatedUser()
    token = auth.token
  })

  test('fresh user has both tokens available', async () => {
    const { status, json } = await requestJSON<{ sendUsed: boolean; receiveUsed: boolean; date: number }>('/v1/me/status', { token })
    expect(status).toBe(200)
    expect(json!.sendUsed).toBe(false)
    expect(json!.receiveUsed).toBe(false)
    expect(json!.date).toBeTruthy()
  })

  test('no auth returns 401', async () => {
    const { status } = await requestJSON('/v1/me/status')
    expect(status).toBe(401)
  })

  test('invalid token returns 401', async () => {
    const { status } = await requestJSON('/v1/me/status', { token: '00000000-0000-0000-0000-000000000000' })
    expect(status).toBe(401)
  })

  test('non-UUID token returns 401', async () => {
    const { status } = await requestJSON('/v1/me/status', { token: 'not-a-uuid' })
    expect(status).toBe(401)
  })

  test('expired session returns 401', async () => {
    await resetDB()
    const auth = await createAuthenticatedUser()
    // Manually expire the session
    await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.userId, auth.userId))
    const { status } = await requestJSON('/v1/me/status', { token: auth.token })
    expect(status).toBe(401)
  })
})

describe('DELETE /v1/me (account deletion)', () => {
  test('deletes user and cascades sessions + tokens', async () => {
    await resetDB()
    const auth = await createAuthenticatedUser()
    // Fetch status to create a daily token row
    await requestJSON('/v1/me/status', { token: auth.token })

    const res = await request('/v1/me', { method: 'DELETE', token: auth.token })
    expect(res.status).toBe(204)

    // Verify user is gone
    const [user] = await db.select().from(users).where(eq(users.id, auth.userId)).limit(1)
    expect(user).toBeUndefined()

    // Verify sessions cascaded
    const [session] = await db.select().from(sessions).where(eq(sessions.userId, auth.userId)).limit(1)
    expect(session).toBeUndefined()

    // Verify daily tokens cascaded
    const [tok] = await db.select().from(dailyTokens).where(eq(dailyTokens.userId, auth.userId)).limit(1)
    expect(tok).toBeUndefined()
  })

  test('deleted session no longer authenticates', async () => {
    await resetDB()
    const auth = await createAuthenticatedUser()
    await request('/v1/me', { method: 'DELETE', token: auth.token })
    const { status } = await requestJSON('/v1/me/status', { token: auth.token })
    expect(status).toBe(401)
  })

  test('messages left in pool survive after user deleted (anonymous)', async () => {
    await resetDB()
    const sender = await createAuthenticatedUser()
    // Send a message
    await requestJSON('/v1/messages', {
      method: 'POST',
      token: sender.token,
      body: { text: 'I will survive' },
    })
    // Delete the sender's account
    await request('/v1/me', { method: 'DELETE', token: sender.token })

    // A different user should still be able to receive the message
    const receiver = await createAuthenticatedUser()
    const { status, json } = await requestJSON<{ text: string }>('/v1/messages/today', { token: receiver.token })
    expect(status).toBe(200)
    expect(json!.text).toBe('I will survive')
  })

  test('no auth returns 401', async () => {
    const res = await request('/v1/me', { method: 'DELETE' })
    expect(res.status).toBe(401)
  })
})

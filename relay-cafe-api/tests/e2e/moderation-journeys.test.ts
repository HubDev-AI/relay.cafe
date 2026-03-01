import { test, expect, describe, beforeEach } from 'bun:test'
import { resetDB, createAuthenticatedUser, createUser, createSession } from '../helpers/db'
import { requestJSON, request } from '../helpers/http'
import { db } from '../../src/db'
import { users, reports } from '../../src/db/schema'
import { eq, sql } from 'drizzle-orm'

describe('E2E Moderation Journeys', () => {
  beforeEach(async () => {
    await resetDB()
  })

  test('Journey 1: send → receive → report → strike verified', async () => {
    const sender = await createAuthenticatedUser()
    const receiver = await createAuthenticatedUser()

    // Sender writes a message
    const sendRes = await requestJSON('/v1/messages', {
      method: 'POST',
      token: sender.token,
      body: { text: 'This is a mean message' },
    })
    expect(sendRes.status).toBe(201)

    // Receiver opens today's message
    const { status, json } = await requestJSON<{ id: string; text: string }>('/v1/messages/today', {
      token: receiver.token,
    })
    expect(status).toBe(200)
    expect(json!.text).toBe('This is a mean message')

    // Receiver reports it
    const reportRes = await requestJSON(`/v1/messages/${json!.id}/report`, {
      method: 'POST',
      token: receiver.token,
      body: {},
    })
    expect(reportRes.status).toBe(200)

    // Verify: sender has 1 strike
    const [senderUser] = await db.select().from(users).where(eq(users.id, sender.userId))
    expect(senderUser!.strikeCount).toBe(1)

    // Verify: report record exists
    const allReports = await db.select().from(reports)
    expect(allReports.length).toBe(1)
    expect(allReports[0]!.actionTaken).toBe('removed')
  })

  test('Journey 2: send → receive → block → blocked sender excluded', async () => {
    const sender = await createAuthenticatedUser()
    const receiver = await createAuthenticatedUser()

    // Round 1: send + receive + block
    await requestJSON('/v1/messages', {
      method: 'POST',
      token: sender.token,
      body: { text: 'first message' },
    })
    const { json: msg1 } = await requestJSON<{ id: string }>('/v1/messages/today', {
      token: receiver.token,
    })
    await requestJSON(`/v1/messages/${msg1!.id}/block`, {
      method: 'POST', token: receiver.token, body: {},
    })

    // Round 2: sender sends again
    await db.execute(sql`UPDATE daily_tokens SET send_used = false WHERE user_id = ${sender.userId}`)
    await db.execute(sql`UPDATE daily_tokens SET receive_used = false WHERE user_id = ${receiver.userId}`)

    await requestJSON('/v1/messages', {
      method: 'POST',
      token: sender.token,
      body: { text: 'second message after block' },
    })

    // Receiver should NOT get blocked sender's message
    const res = await request('/v1/messages/today', { token: receiver.token })
    expect(res.status).toBe(204)

    // But a third user CAN receive it
    const thirdUser = await createAuthenticatedUser()
    const { status } = await requestJSON<{ text: string }>('/v1/messages/today', {
      token: thirdUser.token,
    })
    expect(status).toBe(200)
  })

  test('Journey 3: 3 reports → suspension → cannot send', async () => {
    const sender = await createAuthenticatedUser()

    for (let i = 0; i < 3; i++) {
      const receiver = await createAuthenticatedUser()

      await requestJSON('/v1/messages', {
        method: 'POST',
        token: sender.token,
        body: { text: `offensive msg ${i}` },
      })

      const { json } = await requestJSON<{ id: string }>('/v1/messages/today', {
        token: receiver.token,
      })

      await requestJSON(`/v1/messages/${json!.id}/report`, {
        method: 'POST', token: receiver.token, body: {},
      })

      // Reset sender's token for next round
      await db.execute(sql`UPDATE daily_tokens SET send_used = false WHERE user_id = ${sender.userId}`)
    }

    // Sender tries to send — should be suspended
    const { status, json } = await requestJSON('/v1/messages', {
      method: 'POST',
      token: sender.token,
      body: { text: 'I should be suspended' },
    })
    expect(status).toBe(403)
    expect((json as { error: string }).error).toContain('suspended')
  })

  test('Journey 4: content filter → clean retry → success', async () => {
    const user = await createAuthenticatedUser()

    // Attempt 1: blocked content
    const { status: s1 } = await requestJSON('/v1/messages', {
      method: 'POST',
      token: user.token,
      body: { text: 'i will kill you' },
    })
    expect(s1).toBe(400)

    // Attempt 2: clean content — same period, token still available
    const { status: s2 } = await requestJSON('/v1/messages', {
      method: 'POST',
      token: user.token,
      body: { text: 'I hope you have a great day' },
    })
    expect(s2).toBe(201)
  })

  test('Journey 5: block persists across account deletion + recreation', async () => {
    // Setup: sender with known Apple ID
    const { user: senderUser, appleSubId } = await createUser()
    const senderToken = await createSession(senderUser.id)
    const receiver = await createAuthenticatedUser()

    // Send → receive → block
    await requestJSON('/v1/messages', {
      method: 'POST',
      token: senderToken,
      body: { text: 'pre-deletion' },
    })
    const { json: msg } = await requestJSON<{ id: string }>('/v1/messages/today', {
      token: receiver.token,
    })
    await requestJSON(`/v1/messages/${msg!.id}/block`, {
      method: 'POST', token: receiver.token, body: {},
    })

    // Sender deletes account
    await requestJSON('/v1/me', { method: 'DELETE', token: senderToken })
    await db.execute(sql`DELETE FROM deleted_accounts`)

    // Sender recreates with SAME Apple ID
    const { user: newSender } = await createUser(appleSubId)
    const newToken = await createSession(newSender.id)

    // New sender sends
    await requestJSON('/v1/messages', {
      method: 'POST',
      token: newToken,
      body: { text: 'post-recreation' },
    })

    // Receiver should NOT get it (apple_id_hash block persists)
    await db.execute(sql`UPDATE daily_tokens SET receive_used = false WHERE user_id = ${receiver.userId}`)
    const res = await request('/v1/messages/today', { token: receiver.token })
    expect(res.status).toBe(204)
  })
})

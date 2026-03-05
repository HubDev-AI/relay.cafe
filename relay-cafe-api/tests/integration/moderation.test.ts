import { test, expect, describe, beforeEach } from 'bun:test'
import { resetDB, createAuthenticatedUser, createMessage, createUser, createSession } from '../helpers/db'
import { requestJSON, request } from '../helpers/http'
import { db } from '../../src/db'
import { messages, users, deliveryLog, reports, blockedSenders, deletedAccounts } from '../../src/db/schema'
import { eq, sql } from 'drizzle-orm'

describe('Moderation', () => {
  beforeEach(async () => {
    await resetDB()
  })

  // ── Self-receive prevention ──────────────────────────────

  describe('self-receive prevention', () => {
    test('user cannot receive their own message', async () => {
      const sender = await createAuthenticatedUser()

      await requestJSON('/v1/messages', {
        method: 'POST',
        token: sender.token,
        body: { text: 'hello from me' },
      })

      const res = await request('/v1/messages/today', { token: sender.token })
      expect(res.status).toBe(204)
    })

    test('user A can receive user B message', async () => {
      const sender = await createAuthenticatedUser()
      const receiver = await createAuthenticatedUser()

      await requestJSON('/v1/messages', {
        method: 'POST',
        token: sender.token,
        body: { text: 'cross-user message' },
      })

      const { status, json } = await requestJSON<{ text: string }>('/v1/messages/today', {
        token: receiver.token,
      })
      expect(status).toBe(200)
      expect(json!.text).toBe('cross-user message')
    })
  })

  // ── Content filter ───────────────────────────────────────

  describe('content filter on send', () => {
    test('blocked content returns 400', async () => {
      const user = await createAuthenticatedUser()
      const { status, json } = await requestJSON('/v1/messages', {
        method: 'POST',
        token: user.token,
        body: { text: 'kill yourself' },
      })
      expect(status).toBe(400)
      expect((json as { error: string }).error).toContain('community guidelines')
    })

    test('blocked content does not consume send token', async () => {
      const user = await createAuthenticatedUser()

      await requestJSON('/v1/messages', {
        method: 'POST',
        token: user.token,
        body: { text: 'kill yourself' },
      })

      const { status } = await requestJSON('/v1/messages', {
        method: 'POST',
        token: user.token,
        body: { text: 'Have a nice day' },
      })
      expect(status).toBe(201)
    })

    test('blocked content is not stored in DB', async () => {
      const user = await createAuthenticatedUser()
      await requestJSON('/v1/messages', {
        method: 'POST',
        token: user.token,
        body: { text: 'i will kill you' },
      })

      const allMessages = await db.select().from(messages)
      expect(allMessages.length).toBe(0)
    })
  })

  // ── Suspension ───────────────────────────────────────────

  describe('suspension check on send', () => {
    test('suspended user gets 403', async () => {
      const user = await createAuthenticatedUser()

      await db.update(users).set({ suspensionUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) }).where(eq(users.id, user.userId))

      const { status, json } = await requestJSON('/v1/messages', {
        method: 'POST',
        token: user.token,
        body: { text: 'I am suspended' },
      })
      expect(status).toBe(403)
      expect((json as { error: string }).error).toContain('suspended')
    })

    test('suspended user does not consume send token', async () => {
      const user = await createAuthenticatedUser()
      await db.update(users).set({ suspensionUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) }).where(eq(users.id, user.userId))

      await requestJSON('/v1/messages', {
        method: 'POST',
        token: user.token,
        body: { text: 'test' },
      })

      const allMessages = await db.select().from(messages)
      expect(allMessages.length).toBe(0)
    })
  })

  // ── Report flow ──────────────────────────────────────────

  describe('report', () => {
    async function sendAndReceive() {
      const sender = await createAuthenticatedUser()
      const receiver = await createAuthenticatedUser()

      await requestJSON('/v1/messages', {
        method: 'POST',
        token: sender.token,
        body: { text: 'reportable message' },
      })

      const { json } = await requestJSON<{ id: string }>('/v1/messages/today', {
        token: receiver.token,
      })

      return { sender, receiver, messageId: json!.id }
    }

    test('report returns 200 and increments strike', async () => {
      const { sender, receiver, messageId } = await sendAndReceive()

      const { status } = await requestJSON(`/v1/messages/${messageId}/report`, {
        method: 'POST',
        token: receiver.token,
        body: {},
      })
      expect(status).toBe(200)

      const [user] = await db.select().from(users).where(eq(users.id, sender.userId))
      expect(user!.strikeCount).toBe(1)
    })

    test('duplicate report is idempotent — no double strike', async () => {
      const { sender, receiver, messageId } = await sendAndReceive()

      await requestJSON(`/v1/messages/${messageId}/report`, {
        method: 'POST',
        token: receiver.token,
        body: {},
      })
      await requestJSON(`/v1/messages/${messageId}/report`, {
        method: 'POST',
        token: receiver.token,
        body: {},
      })

      const [user] = await db.select().from(users).where(eq(users.id, sender.userId))
      expect(user!.strikeCount).toBe(1)
    })

    test('report without delivery log returns 404', async () => {
      const user = await createAuthenticatedUser()
      const fakeId = '00000000-0000-0000-0000-000000000000'

      const { status } = await requestJSON(`/v1/messages/${fakeId}/report`, {
        method: 'POST',
        token: user.token,
        body: {},
      })
      expect(status).toBe(404)
    })

    test('3 strikes auto-suspends', async () => {
      const sender = await createAuthenticatedUser()

      for (let i = 0; i < 3; i++) {
        const receiver = await createAuthenticatedUser()

        await requestJSON('/v1/messages', {
          method: 'POST',
          token: sender.token,
          body: { text: `message ${i}` },
        })

        const { json } = await requestJSON<{ id: string }>('/v1/messages/today', {
          token: receiver.token,
        })

        await requestJSON(`/v1/messages/${json!.id}/report`, {
          method: 'POST',
          token: receiver.token,
          body: {},
        })

        await db.execute(sql`UPDATE daily_tokens SET send_used = false WHERE user_id = ${sender.userId}`)
      }

      const [user] = await db.select().from(users).where(eq(users.id, sender.userId))
      expect(user!.suspensionUntil).not.toBeNull()
      expect(user!.suspensionUntil!.getTime()).toBeGreaterThan(Date.now())
      expect(user!.strikeCount).toBe(3)

      await db.execute(sql`UPDATE daily_tokens SET send_used = false WHERE user_id = ${sender.userId}`)
      const { status } = await requestJSON('/v1/messages', {
        method: 'POST',
        token: sender.token,
        body: { text: 'I am suspended now' },
      })
      expect(status).toBe(403)
    })

    test('report creates report record', async () => {
      const { receiver, messageId } = await sendAndReceive()

      await requestJSON(`/v1/messages/${messageId}/report`, {
        method: 'POST',
        token: receiver.token,
        body: {},
      })

      const allReports = await db.select().from(reports)
      expect(allReports.length).toBe(1)
      expect(allReports[0]!.messageId).toBe(messageId)
      expect(allReports[0]!.reporterUserId).toBe(receiver.userId)
      expect(allReports[0]!.actionTaken).toBe('removed')
    })

    test('strikes decay after 30 days — old strikes reset to 1', async () => {
      const sender = await createAuthenticatedUser()
      const receiver1 = await createAuthenticatedUser()

      // Direct DB state injection for test setup — bypasses moderation logic intentionally
      await db.update(users).set({
        strikeCount: 2,
        lastStrikeAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
      }).where(eq(users.id, sender.userId))

      // Send + receive + report
      await requestJSON('/v1/messages', {
        method: 'POST', token: sender.token, body: { text: 'old strikes msg' },
      })
      const { json } = await requestJSON<{ id: string }>('/v1/messages/today', {
        token: receiver1.token,
      })
      await requestJSON(`/v1/messages/${json!.id}/report`, {
        method: 'POST', token: receiver1.token, body: {},
      })

      // Strike should have reset to 1 (not incremented to 3)
      const [user] = await db.select().from(users).where(eq(users.id, sender.userId))
      expect(user!.strikeCount).toBe(1)
      expect(user!.suspensionUntil).toBeNull()
    })
  })

  // ── Block flow ───────────────────────────────────────────

  describe('block', () => {
    test('block sender returns 200', async () => {
      const sender = await createAuthenticatedUser()
      const receiver = await createAuthenticatedUser()

      await requestJSON('/v1/messages', {
        method: 'POST',
        token: sender.token,
        body: { text: 'block test' },
      })

      const { json } = await requestJSON<{ id: string }>('/v1/messages/today', {
        token: receiver.token,
      })

      const { status } = await requestJSON(`/v1/messages/${json!.id}/block`, {
        method: 'POST',
        token: receiver.token,
        body: {},
      })
      expect(status).toBe(200)
    })

    test('block is idempotent', async () => {
      const sender = await createAuthenticatedUser()
      const receiver = await createAuthenticatedUser()

      await requestJSON('/v1/messages', {
        method: 'POST',
        token: sender.token,
        body: { text: 'block test' },
      })

      const { json } = await requestJSON<{ id: string }>('/v1/messages/today', {
        token: receiver.token,
      })

      await requestJSON(`/v1/messages/${json!.id}/block`, {
        method: 'POST', token: receiver.token, body: {},
      })
      await requestJSON(`/v1/messages/${json!.id}/block`, {
        method: 'POST', token: receiver.token, body: {},
      })

      const blocks = await db.select().from(blockedSenders)
      expect(blocks.length).toBe(1)
    })

    test('blocked sender messages are excluded from receive pool', async () => {
      const sender = await createAuthenticatedUser()
      const receiver = await createAuthenticatedUser()

      // Send + receive + block
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

      // Reset tokens
      await db.execute(sql`UPDATE daily_tokens SET receive_used = false WHERE user_id = ${receiver.userId}`)
      await db.execute(sql`UPDATE daily_tokens SET send_used = false WHERE user_id = ${sender.userId}`)

      // Sender sends another message
      await requestJSON('/v1/messages', {
        method: 'POST',
        token: sender.token,
        body: { text: 'second message after block' },
      })

      // Receiver should not get it
      const res = await request('/v1/messages/today', { token: receiver.token })
      expect(res.status).toBe(204)
    })

    test('block persists across account deletion and recreation', async () => {
      const { user: senderUser, appleSubId: senderAppleSub } = await createUser()
      const senderToken = await createSession(senderUser.id)
      const receiver = await createAuthenticatedUser()

      // Send + receive + block
      await requestJSON('/v1/messages', {
        method: 'POST',
        token: senderToken,
        body: { text: 'before deletion' },
      })
      const { json: msg } = await requestJSON<{ id: string }>('/v1/messages/today', {
        token: receiver.token,
      })
      await requestJSON(`/v1/messages/${msg!.id}/block`, {
        method: 'POST', token: receiver.token, body: {},
      })

      // Sender deletes account
      await requestJSON('/v1/me', {
        method: 'DELETE',
        token: senderToken,
      })

      // Clear cooldown so sender can recreate
      await db.execute(sql`DELETE FROM deleted_accounts`)

      // Sender recreates with same Apple ID
      const { user: newSenderUser } = await createUser(senderAppleSub)
      const newSenderToken = await createSession(newSenderUser.id)

      // New sender sends a message
      await requestJSON('/v1/messages', {
        method: 'POST',
        token: newSenderToken,
        body: { text: 'after recreation' },
      })

      // Reset receiver token
      await db.execute(sql`UPDATE daily_tokens SET receive_used = false WHERE user_id = ${receiver.userId}`)

      // Receiver should NOT get the message (block persists via apple_id_hash)
      const res = await request('/v1/messages/today', { token: receiver.token })
      expect(res.status).toBe(204)
    })
  })

  // ── Delivery log ─────────────────────────────────────────

  describe('delivery log', () => {
    test('receive creates delivery_log entry', async () => {
      const sender = await createAuthenticatedUser()
      const receiver = await createAuthenticatedUser()

      await requestJSON('/v1/messages', {
        method: 'POST',
        token: sender.token,
        body: { text: 'delivery log test' },
      })

      const { json } = await requestJSON<{ id: string }>('/v1/messages/today', {
        token: receiver.token,
      })

      const logs = await db.select().from(deliveryLog)
      expect(logs.length).toBe(1)
      expect(logs[0]!.messageId).toBe(json!.id)
      expect(logs[0]!.senderUserId).toBe(sender.userId)
      expect(logs[0]!.recipientUserId).toBe(receiver.userId)
    })
  })

  // ── Suspension expiry ───────────────────────────────────

  describe('suspension expiry', () => {
    test('expired suspension allows sending again', async () => {
      const user = await createAuthenticatedUser()

      // Direct DB state injection for test setup — bypasses moderation logic intentionally
      await db.update(users).set({
        suspensionUntil: new Date(Date.now() - 1000),
        strikeCount: 3,
      }).where(eq(users.id, user.userId))

      const { status } = await requestJSON('/v1/messages', {
        method: 'POST',
        token: user.token,
        body: { text: 'I am free again' },
      })
      expect(status).toBe(201)
    })
  })

  // ── UUID validation ────────────────────────────────────

  describe('UUID validation', () => {
    test('report with invalid UUID returns 404', async () => {
      const user = await createAuthenticatedUser()
      const { status } = await requestJSON('/v1/messages/not-a-uuid/report', {
        method: 'POST', token: user.token, body: {},
      })
      expect(status).toBe(404)
    })

    test('block with invalid UUID returns 404', async () => {
      const user = await createAuthenticatedUser()
      const { status } = await requestJSON('/v1/messages/not-a-uuid/block', {
        method: 'POST', token: user.token, body: {},
      })
      expect(status).toBe(404)
    })
  })

  // ── Account deletion cascades ────────────────────────────

  describe('account deletion with moderation data', () => {
    test('user with messages in pool can delete account', async () => {
      const user = await createAuthenticatedUser()
      await requestJSON('/v1/messages', {
        method: 'POST',
        token: user.token,
        body: { text: 'pre-deletion message' },
      })

      const res = await request('/v1/me', { method: 'DELETE', token: user.token })
      expect(res.status).toBe(204)

      const remaining = await db.select().from(messages)
      expect(remaining.length).toBe(0)
    })

    test('user with delivery log and reports can delete account', async () => {
      const sender = await createAuthenticatedUser()
      const receiver = await createAuthenticatedUser()

      await requestJSON('/v1/messages', {
        method: 'POST',
        token: sender.token,
        body: { text: 'will be reported' },
      })
      const { json } = await requestJSON<{ id: string }>('/v1/messages/today', {
        token: receiver.token,
      })
      await requestJSON(`/v1/messages/${json!.id}/report`, {
        method: 'POST', token: receiver.token, body: {},
      })

      const res = await request('/v1/me', { method: 'DELETE', token: receiver.token })
      expect(res.status).toBe(204)
    })
  })

  // ── API response privacy ─────────────────────────────────

  describe('API response privacy', () => {
    test('receive response does not contain sender_user_id', async () => {
      const sender = await createAuthenticatedUser()
      const receiver = await createAuthenticatedUser()

      await requestJSON('/v1/messages', {
        method: 'POST',
        token: sender.token,
        body: { text: 'privacy check' },
      })

      const { json } = await requestJSON('/v1/messages/today', {
        token: receiver.token,
      })

      const keys = Object.keys(json as object)
      expect(keys).not.toContain('sender_user_id')
      expect(keys).not.toContain('senderUserId')
      expect(keys).not.toContain('apple_id_hash')
      expect(keys).not.toContain('appleIdHash')
      expect(keys.sort()).toEqual(['expiresAt', 'id', 'text'])
    })
  })

  // ── Suspension carry-forward across account deletion ───

  describe('suspension carry-forward across account deletion', () => {
    test('reports survive sender account deletion (SET NULL)', async () => {
      const sender = await createAuthenticatedUser()
      const receiver = await createAuthenticatedUser()

      // Send + receive + report
      await requestJSON('/v1/messages', {
        method: 'POST', token: sender.token, body: { text: 'will be reported' },
      })
      const { json } = await requestJSON<{ id: string }>('/v1/messages/today', {
        token: receiver.token,
      })
      await requestJSON(`/v1/messages/${json!.id}/report`, {
        method: 'POST', token: receiver.token, body: {},
      })

      // Sender deletes account
      await requestJSON('/v1/me', { method: 'DELETE', token: sender.token })

      // Report should still exist with sender_user_id = NULL
      const allReports = await db.select().from(reports)
      expect(allReports.length).toBe(1)
      expect(allReports[0]!.senderUserId).toBeNull()
      expect(allReports[0]!.reporterUserId).toBe(receiver.userId)
    })

    test('reports survive reporter account deletion (SET NULL)', async () => {
      const sender = await createAuthenticatedUser()
      const receiver = await createAuthenticatedUser()

      // Send + receive + report
      await requestJSON('/v1/messages', {
        method: 'POST', token: sender.token, body: { text: 'will be reported' },
      })
      const { json } = await requestJSON<{ id: string }>('/v1/messages/today', {
        token: receiver.token,
      })
      await requestJSON(`/v1/messages/${json!.id}/report`, {
        method: 'POST', token: receiver.token, body: {},
      })

      // Reporter deletes account
      await requestJSON('/v1/me', { method: 'DELETE', token: receiver.token })

      // Report should still exist with reporter_user_id = NULL
      const allReports = await db.select().from(reports)
      expect(allReports.length).toBe(1)
      expect(allReports[0]!.reporterUserId).toBeNull()
      expect(allReports[0]!.senderUserId).toBe(sender.userId)
    })

    test('moderation state saved in deleted_accounts on deletion', async () => {
      const user = await createAuthenticatedUser()

      // Direct DB state injection for test setup — bypasses moderation logic intentionally
      const futureDate = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000)
      await db.update(users).set({
        strikeCount: 3,
        suspensionUntil: futureDate,
      }).where(eq(users.id, user.userId))

      // Delete account
      await requestJSON('/v1/me', { method: 'DELETE', token: user.token })

      // Verify moderation state saved in deleted_accounts
      const [deleted] = await db.select().from(deletedAccounts)
      expect(deleted!.strikeCount).toBe(3)
      expect(deleted!.suspensionUntil).not.toBeNull()
    })
  })
})

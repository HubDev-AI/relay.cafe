import { test, expect, describe, beforeEach } from 'bun:test'
import { resetDB, createAuthenticatedUser, createMessage } from '../helpers/db'
import { requestJSON } from '../helpers/http'
import { db } from '../../src/db'
import { messages } from '../../src/db/schema'

describe('concurrent receive atomicity', () => {
  beforeEach(async () => {
    await resetDB()
  })

  test('two simultaneous receives for one message — only one gets it', async () => {
    await createMessage()
    const userA = await createAuthenticatedUser()
    const userB = await createAuthenticatedUser()

    // Fire both receives concurrently
    const [resA, resB] = await Promise.all([
      requestJSON<{ text: string }>('/v1/messages/today', { token: userA.token }),
      requestJSON<{ text: string }>('/v1/messages/today', { token: userB.token }),
    ])

    const statuses = [resA.status, resB.status].sort()
    // One gets 200 (message), the other gets 204 (empty pool)
    expect(statuses).toEqual([200, 204])

    // Message should be deleted from DB
    const remaining = await db.select().from(messages)
    expect(remaining.length).toBe(0)
  })

  test('10 concurrent receives for 3 messages — exactly 3 get served', async () => {
    await createMessage()
    await createMessage()
    await createMessage()

    const users = await Promise.all(
      Array.from({ length: 10 }, () => createAuthenticatedUser())
    )

    const results = await Promise.all(
      users.map(u => requestJSON('/v1/messages/today', { token: u.token }))
    )

    const got200 = results.filter(r => r.status === 200).length
    const got204 = results.filter(r => r.status === 204).length
    expect(got200).toBe(3)
    expect(got204).toBe(7)

    // All messages deleted
    const remaining = await db.select().from(messages)
    expect(remaining.length).toBe(0)
  })
})

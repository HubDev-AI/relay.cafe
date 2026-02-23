import { test, expect, describe, beforeEach } from 'bun:test'
import { resetDB, createMessage } from '../helpers/db'
import { db } from '../../src/db'
import { messages } from '../../src/db/schema'
import { sql } from 'drizzle-orm'

describe('pg_cron cleanup SQL', () => {
  beforeEach(async () => {
    await resetDB()
  })

  // This is the exact SQL that pg_cron executes:
  // DELETE FROM messages WHERE expires_at <= NOW();
  async function runCleanupSQL() {
    await db.execute(sql`DELETE FROM messages WHERE expires_at <= NOW()`)
  }

  test('expired messages are deleted', async () => {
    await createMessage({ expiresInMs: -5000 })
    await createMessage({ expiresInMs: -1000 })

    await runCleanupSQL()

    const remaining = await db.select().from(messages)
    expect(remaining.length).toBe(0)
  })

  test('non-expired messages survive cleanup', async () => {
    await createMessage({ expiresInMs: 60000 })
    await createMessage({ expiresInMs: -1000 })

    await runCleanupSQL()

    const remaining = await db.select().from(messages)
    expect(remaining.length).toBe(1)
  })

  test('cleanup with empty table does not error', async () => {
    await runCleanupSQL()
    // No error = pass
    const remaining = await db.select().from(messages)
    expect(remaining.length).toBe(0)
  })

  test('message expiring at exactly NOW() is deleted', async () => {
    await createMessage({ expiresInMs: 0 })
    // Small delay to ensure NOW() > expiresAt
    await new Promise(r => setTimeout(r, 50))
    await runCleanupSQL()

    const remaining = await db.select().from(messages)
    expect(remaining.length).toBe(0)
  })
})

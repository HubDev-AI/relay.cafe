import { db } from '../db'
import { messages, ipEvents } from '../db/schema'
import { lt, sql } from 'drizzle-orm'

export function buildCleanupQueries(): string[] {
  return [
    'DELETE FROM messages WHERE expires_at < NOW()',
    "DELETE FROM ip_events WHERE created_at < NOW() - INTERVAL '48 hours'",
  ]
}

export async function runCleanup(): Promise<void> {
  await db.delete(messages).where(lt(messages.expiresAt, new Date()))
  await db.execute(sql`DELETE FROM ip_events WHERE created_at < NOW() - INTERVAL '48 hours'`)
  console.log('[cleanup] expired messages and ip_events pruned')
}

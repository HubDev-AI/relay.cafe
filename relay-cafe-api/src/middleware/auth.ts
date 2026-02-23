import type { Context, Next } from 'hono'
import { db } from '../db'
import { sessions } from '../db/schema'
import { eq } from 'drizzle-orm'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function authMiddleware(c: Context, next: Next) {
  const header = c.req.header('Authorization')
  if (!header?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const token = header.slice(7)

  // Validate UUID format before hitting the database to avoid
  // Postgres "invalid input syntax for type uuid" errors
  if (!UUID_RE.test(token)) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, token))
    .limit(1)

  if (!session || session.expiresAt < new Date()) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  c.set('userId', session.userId)
  await next()
}

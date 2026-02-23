import type { Context, Next } from 'hono'
import { db } from '../db'
import { sessions } from '../db/schema'
import { eq } from 'drizzle-orm'
import { hashToken } from '../lib/sessionToken'

const HEX_64_RE = /^[0-9a-f]{64}$/

export async function authMiddleware(c: Context, next: Next) {
  const header = c.req.header('Authorization')
  if (!header?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const rawToken = header.slice(7)

  // Validate hex format before hashing to reject obvious junk early
  if (!HEX_64_RE.test(rawToken)) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const tokenHash = hashToken(rawToken)

  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.tokenHash, tokenHash))
    .limit(1)

  if (!session || session.expiresAt < new Date()) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  c.set('userId', session.userId)
  await next()
}

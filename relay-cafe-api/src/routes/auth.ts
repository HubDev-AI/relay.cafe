import { Hono } from 'hono'
import { createHash } from 'node:crypto'
import { db } from '../db'
import { users, sessions } from '../db/schema'
import { eq } from 'drizzle-orm'
import { verifyAppleToken } from '../lib/appleAuth'
import { authMiddleware } from '../middleware/auth'
import { ipRateLimit } from '../middleware/rateLimit'

export const authRouter = new Hono()

authRouter.post(
  '/apple',
  ipRateLimit({ maxRequests: 5, windowMs: 60 * 60 * 1000 }),
  async (c) => {
    const body = await c.req.json().catch(() => null)
    if (!body?.identityToken) {
      return c.json({ error: 'identityToken required' }, 400)
    }

    let claims
    try {
      claims = await verifyAppleToken(body.identityToken)
    } catch {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const appleIdHash = createHash('sha256')
      .update(process.env.APPLE_ID_SALT + claims.sub)
      .digest('hex')

    // Upsert user
    let [user] = await db.select().from(users).where(eq(users.appleIdHash, appleIdHash)).limit(1)
    if (!user) {
      ;[user] = await db.insert(users).values({ appleIdHash }).returning()
    }

    // Create session (30 days)
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    const [session] = await db
      .insert(sessions)
      .values({
        userId: user.id,
        expiresAt,
        deviceFingerprint: body.deviceFingerprint ?? null,
      })
      .returning()

    return c.json({ sessionToken: session.id, expiresAt: expiresAt.toISOString() })
  }
)

authRouter.delete('/session', authMiddleware, async (c) => {
  const sessionId = c.req.header('Authorization')!.slice(7)
  await db.delete(sessions).where(eq(sessions.id, sessionId))
  return c.body(null, 204)
})

import { Hono } from 'hono'
import { createHash } from 'node:crypto'
import { db } from '../db'
import { users, sessions } from '../db/schema'
import { eq } from 'drizzle-orm'
import { verifyAppleToken } from '../lib/appleAuth'
import { authMiddleware } from '../middleware/auth'
import { ipRateLimit } from '../middleware/rateLimit'

export const authRouter = new Hono()

const APPLE_ID_SALT = process.env.APPLE_ID_SALT
if (!APPLE_ID_SALT) {
  throw new Error('APPLE_ID_SALT environment variable is required')
}

authRouter.post(
  '/apple',
  ipRateLimit({ maxRequests: 5, windowMs: 60 * 60 * 1000 }),
  async (c) => {
    const body = await c.req.json().catch(() => null)
    if (!body?.identityToken || typeof body.identityToken !== 'string') {
      return c.json({ error: 'identityToken required' }, 400)
    }

    let claims
    try {
      claims = await verifyAppleToken(body.identityToken)
    } catch {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const appleIdHash = createHash('sha256')
      .update(APPLE_ID_SALT + claims.sub)
      .digest('hex')

    // Upsert user
    const [existingUser] = await db.select().from(users).where(eq(users.appleIdHash, appleIdHash)).limit(1)
    const user = existingUser ?? (await db.insert(users).values({ appleIdHash }).returning())[0]
    if (!user) {
      return c.json({ error: 'Failed to create user' }, 500)
    }

    // Create session (30 days)
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    const session = (await db
      .insert(sessions)
      .values({
        userId: user.id,
        expiresAt,
        deviceFingerprint: body.deviceFingerprint ?? null,
      })
      .returning())[0]
    if (!session) {
      return c.json({ error: 'Failed to create session' }, 500)
    }

    return c.json({ sessionToken: session.id, expiresAt: expiresAt.getTime() })
  }
)

authRouter.delete('/session', authMiddleware, async (c) => {
  const sessionId = c.req.header('Authorization')!.slice(7)
  await db.delete(sessions).where(eq(sessions.id, sessionId))
  return c.body(null, 204)
})

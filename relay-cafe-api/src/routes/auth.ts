import { Hono } from 'hono'
import { createHash } from 'node:crypto'
import { db } from '../db'
import { users, sessions } from '../db/schema'
import { eq } from 'drizzle-orm'
import { verifyAppleToken } from '../lib/appleAuth'
import { authMiddleware } from '../middleware/auth'
import { createRateLimitMiddleware } from '../middleware/rateLimit'
import { rateLimiter } from '../lib/container'
import { captureError } from '../lib/logger'

export const authRouter = new Hono()

const APPLE_ID_SALT = process.env.APPLE_ID_SALT
if (!APPLE_ID_SALT) {
  throw new Error('APPLE_ID_SALT environment variable is required')
}

authRouter.post(
  '/apple',
  createRateLimitMiddleware(rateLimiter, 'auth'),
  async (c) => {
    const body = await c.req.json().catch(() => null)
    if (!body?.identityToken || typeof body.identityToken !== 'string') {
      return c.json({ error: 'identityToken required' }, 400)
    }

    let claims
    try {
      claims = await verifyAppleToken(body.identityToken)
    } catch (err) {
      captureError(err, { route: 'POST /auth/apple', action: 'verify-apple-token' })
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const appleIdHash = createHash('sha256')
      .update(APPLE_ID_SALT + claims.sub)
      .digest('hex')

    // Transaction: upsert user + create session atomically.
    // Prevents race where concurrent sign-ins create orphaned rows or
    // hit unique-constraint errors instead of gracefully reusing the user.
    const result = await db.transaction(async (tx) => {
      const [existingUser] = await tx.select().from(users).where(eq(users.appleIdHash, appleIdHash)).limit(1)
      const user = existingUser ?? (await tx.insert(users).values({ appleIdHash }).returning())[0]
      if (!user) return null

      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      const [session] = await tx
        .insert(sessions)
        .values({
          userId: user.id,
          expiresAt,
          deviceFingerprint: body.deviceFingerprint ?? null,
        })
        .returning()
      if (!session) return null

      return { sessionToken: session.id, expiresAt: expiresAt.getTime() }
    })

    if (!result) {
      return c.json({ error: 'Failed to create session' }, 500)
    }

    return c.json(result)
  }
)

authRouter.delete('/session', authMiddleware, async (c) => {
  const sessionId = c.req.header('Authorization')!.slice(7)
  await db.delete(sessions).where(eq(sessions.id, sessionId))
  return c.body(null, 204)
})

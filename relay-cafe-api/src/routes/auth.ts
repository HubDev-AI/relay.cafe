import { Hono } from 'hono'
import { createHash } from 'node:crypto'
import { db } from '../db'
import { users, sessions, deletedAccounts } from '../db/schema'
import { eq } from 'drizzle-orm'
import { verifyAppleToken } from '../lib/appleAuth'
import { authMiddleware } from '../middleware/auth'
import { createRateLimitMiddleware } from '../middleware/rateLimit'
import { rateLimiter } from '../lib/container'
import { captureError } from '../lib/logger'
import { generateToken, hashToken } from '../lib/sessionToken'

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

    // Check deleted account for cooldown + moderation carry-forward
    // Entire flow in one transaction to prevent double-restoration
    const result = await db.transaction(async (tx) => {
      const [deleted] = await tx
        .select()
        .from(deletedAccounts)
        .where(eq(deletedAccounts.appleIdHash, appleIdHash))
        .limit(1)

      if (deleted) {
        if (deleted.cooldownUntil > new Date()) {
          return {
            cooldown: true,
            cooldownUntil: deleted.cooldownUntil.getTime(),
          } as const
        }

        // Carry forward only if suspension is still active.
        // Intentional: if suspension expired, user gets a clean start (strikeCount reset).
        // Strike decay already handles gradual reset during active usage.
        const carryForward = deleted.suspensionUntil && deleted.suspensionUntil > new Date()
          ? { suspensionUntil: deleted.suspensionUntil, strikeCount: deleted.strikeCount }
          : null

        // Clean up deleted_accounts row
        await tx.delete(deletedAccounts).where(eq(deletedAccounts.appleIdHash, appleIdHash))

        // Create or reuse user with carried-forward moderation state
        const [existingUser] = await tx.select().from(users).where(eq(users.appleIdHash, appleIdHash)).limit(1)
        const user = existingUser ?? (await tx.insert(users).values({
          appleIdHash,
          ...(carryForward ?? {}),
        }).returning())[0]
        if (!user) return null

        // If existing user found and we have carry-forward state, apply it
        if (existingUser && carryForward) {
          await tx.update(users).set(carryForward).where(eq(users.id, user.id))
        }

        const rawToken = generateToken()
        const tokenHash = hashToken(rawToken)
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        const [session] = await tx
          .insert(sessions)
          .values({ userId: user.id, tokenHash, expiresAt })
          .returning()
        if (!session) return null

        return { sessionToken: rawToken, expiresAt: expiresAt.getTime() }
      }

      // No deleted account — normal sign-in flow
      const [existingUser] = await tx.select().from(users).where(eq(users.appleIdHash, appleIdHash)).limit(1)
      const user = existingUser ?? (await tx.insert(users).values({ appleIdHash }).returning())[0]
      if (!user) return null

      const rawToken = generateToken()
      const tokenHash = hashToken(rawToken)
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      const [session] = await tx
        .insert(sessions)
        .values({ userId: user.id, tokenHash, expiresAt })
        .returning()
      if (!session) return null

      return { sessionToken: rawToken, expiresAt: expiresAt.getTime() }
    })

    if (!result) {
      return c.json({ error: 'Failed to create session' }, 500)
    }
    if ('cooldown' in result) {
      return c.json({
        error: 'cooldown',
        cooldownUntil: result.cooldownUntil,
      }, 403)
    }

    return c.json(result)
  }
)

authRouter.delete('/session', authMiddleware, async (c) => {
  const rawToken = c.req.header('Authorization')!.slice(7)
  const tokenHash = hashToken(rawToken)
  await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash))
  return c.body(null, 204)
})

import { Hono } from 'hono'
import { db } from '../db'
import { users, dailyTokens, deletedAccounts } from '../db/schema'
import { eq, and } from 'drizzle-orm'
import { authMiddleware } from '../middleware/auth'
import { currentPeriod } from '../lib/period'
import { nextPeriodStart } from '../lib/period'
import { isDemoMode } from '../lib/demo'

export const meRouter = new Hono<{ Variables: { userId: string } }>()

// Token status: query by (userId, currentPeriod).
// If no row exists for today's period, both tokens are fresh (false).
// No historical timing comparison — period number is the only input.
meRouter.get('/status', authMiddleware, async (c) => {
  const userId = c.get('userId')
  const today = currentPeriod()

  const [[tokens], [user]] = await Promise.all([
    db
      .select()
      .from(dailyTokens)
      .where(and(eq(dailyTokens.userId, userId), eq(dailyTokens.date, today)))
      .limit(1),
    db
      .select({ suspensionUntil: users.suspensionUntil })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1),
  ])

  const suspensionUntil = user?.suspensionUntil && user.suspensionUntil > new Date()
    ? user.suspensionUntil.getTime()
    : null

  return c.json({
    sendUsed: isDemoMode() ? false : (tokens?.sendUsed ?? false),
    receiveUsed: isDemoMode() ? false : (tokens?.receiveUsed ?? false),
    date: today,
    suspendedUntil: suspensionUntil,
  })
})

meRouter.delete('/', authMiddleware, async (c) => {
  const userId = c.get('userId')

  // Look up user before deletion
  const [user] = await db
    .select({
      appleIdHash: users.appleIdHash,
      strikeCount: users.strikeCount,
      suspensionUntil: users.suspensionUntil,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (!user) return c.body(null, 204)

  // Insert cooldown (+ moderation state if applicable) + delete user atomically
  await db.transaction(async (tx) => {
    const hasModState = user.strikeCount > 0 || (user.suspensionUntil && user.suspensionUntil > new Date())

    await tx
      .insert(deletedAccounts)
      .values({
        appleIdHash: user.appleIdHash,
        cooldownUntil: nextPeriodStart(),
        strikeCount: hasModState ? user.strikeCount : 0,
        suspensionUntil: hasModState ? user.suspensionUntil : null,
      })
      .onConflictDoUpdate({
        target: deletedAccounts.appleIdHash,
        set: {
          cooldownUntil: nextPeriodStart(),
          deletedAt: new Date(),
          // Always set moderation fields explicitly — prevents stale state from prior row
          strikeCount: hasModState ? user.strikeCount : 0,
          suspensionUntil: hasModState ? user.suspensionUntil : null,
        },
      })

    // Delete user — sessions, dailyTokens, messages, deliveryLog, blockedSenders cascade
    // Reports get SET NULL (audit trail preserved)
    await tx.delete(users).where(eq(users.id, userId))
  })

  return c.body(null, 204)
})

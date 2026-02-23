import { Hono } from 'hono'
import { db } from '../db'
import { users, dailyTokens } from '../db/schema'
import { eq, and } from 'drizzle-orm'
import { authMiddleware } from '../middleware/auth'
import { currentPeriod } from '../lib/period'

export const meRouter = new Hono()

// Token status: query by (userId, currentPeriod).
// If no row exists for today's period, both tokens are fresh (false).
// No historical timing comparison — period number is the only input.
meRouter.get('/status', authMiddleware, async (c) => {
  const userId = c.get('userId') as string
  const today = currentPeriod()

  const [tokens] = await db
    .select()
    .from(dailyTokens)
    .where(and(eq(dailyTokens.userId, userId), eq(dailyTokens.date, today)))
    .limit(1)

  return c.json({
    sendUsed: tokens?.sendUsed ?? false,
    receiveUsed: tokens?.receiveUsed ?? false,
    date: today,
  })
})

meRouter.delete('/', authMiddleware, async (c) => {
  const userId = c.get('userId') as string
  await db.delete(users).where(eq(users.id, userId))
  // sessions + dailyTokens cascade on user delete
  return c.body(null, 204)
})

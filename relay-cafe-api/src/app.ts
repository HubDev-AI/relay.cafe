import { Hono } from 'hono'
import { timingSafeEqual } from 'node:crypto'
import { authRouter } from './routes/auth'
import { meRouter } from './routes/me'
import { messagesRouter } from './routes/messages'
import { authMiddleware } from './middleware/auth'
import { runCleanup } from './jobs/cleanup'

export const app = new Hono()

app.get('/health', (c) => c.json({ ok: true }))
app.route('/auth', authRouter)
app.route('/me', meRouter)
app.use('/messages/*', authMiddleware)
app.route('/messages', messagesRouter)

// Called by Railway cron every 10 minutes
// Secured by shared secret header
app.post('/internal/cleanup', async (c) => {
  const secret = process.env.CRON_SECRET
  const header = c.req.header('X-Cron-Secret') ?? ''

  // Reject if CRON_SECRET is not configured or header is missing
  if (!secret || !header) {
    return c.body(null, 401)
  }

  // Constant-time comparison to prevent timing attacks
  const a = Buffer.from(secret, 'utf8')
  const b = Buffer.from(header, 'utf8')
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return c.body(null, 401)
  }

  try {
    await runCleanup()
  } catch (err) {
    console.error('[cleanup] failed:', err)
    return c.json({ error: 'Cleanup failed' }, 500)
  }

  return c.json({ ok: true })
})

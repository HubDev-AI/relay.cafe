import { Hono } from 'hono'
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
  if (c.req.header('X-Cron-Secret') !== process.env.CRON_SECRET) {
    return c.body(null, 401)
  }
  await runCleanup()
  return c.json({ ok: true })
})

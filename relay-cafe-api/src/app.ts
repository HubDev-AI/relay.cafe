import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { authRouter } from './routes/auth'
import { meRouter } from './routes/me'
import { messagesRouter } from './routes/messages'
import { authMiddleware } from './middleware/auth'
import { db } from './db'
import { captureError } from './lib/logger'

export const app = new Hono()

app.onError((err, c) => {
  captureError(err, { method: c.req.method, path: c.req.path })
  return c.json({ error: 'Internal server error' }, 500)
})

app.notFound((c) => {
  return c.json({ error: 'Not found' }, 404)
})

app.get('/health', async (c) => {
  try {
    await db.execute(sql`SELECT 1`)
    return c.json({ ok: true })
  } catch (err) {
    captureError(err, { route: 'GET /health', action: 'db-check' })
    return c.json({ ok: false, db: 'unreachable' }, 503)
  }
})

app.route('/auth', authRouter)
app.route('/me', meRouter)
app.use('/messages/*', authMiddleware)
app.route('/messages', messagesRouter)

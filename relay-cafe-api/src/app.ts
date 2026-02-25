import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { authRouter } from './routes/auth'
import { meRouter } from './routes/me'
import { messagesRouter } from './routes/messages'
import { telemetryRouter } from './routes/telemetry'
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

app.use('*', async (c, next) => {
  await next()
  c.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains')
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('X-Frame-Options', 'DENY')
  c.header('Cache-Control', 'no-store')
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

const v1 = new Hono()
v1.route('/auth', authRouter)
v1.route('/me', meRouter)
v1.use('/messages/*', authMiddleware)
v1.route('/messages', messagesRouter)
v1.use('/telemetry/*', authMiddleware)
v1.route('/telemetry', telemetryRouter)

app.route('/v1', v1)

import { serve } from '@hono/node-server'
import { Cron } from 'croner'
import { sql } from 'drizzle-orm'
import { app } from './app'
import { db } from './db'
import { initSentry, captureError } from './lib/logger'

initSentry()

process.on('unhandledRejection', (err) => {
  captureError(err, { source: 'unhandledRejection' })
})

process.on('uncaughtException', (err) => {
  captureError(err, { source: 'uncaughtException' })
  process.exit(1)
})

// TODO: Replace with pg_cron when available on Railway Postgres.
new Cron('*/10 * * * *', async () => {
  try {
    const result = await db.execute(sql`DELETE FROM messages WHERE expires_at <= NOW()`)
    const count = result.length
    if (count > 0) console.log(`[cleanup] deleted ${count} expired messages`)
  } catch (err) {
    captureError(err, { source: 'cleanup-expired-messages' })
  }
})

serve({ fetch: app.fetch, port: 3000 }, () => {
  console.log('relay-cafe-api running on :3000')
})

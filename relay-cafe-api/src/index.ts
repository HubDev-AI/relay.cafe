import { serve } from '@hono/node-server'
import { Cron } from 'croner'
import { sql } from 'drizzle-orm'
import { app } from './app'
import { db } from './db'
import { initSentry, captureError } from './lib/logger'
import { currentPeriod } from './lib/period'

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

new Cron('*/10 * * * *', async () => {
  try {
    const result = await db.execute(sql`DELETE FROM deleted_accounts WHERE cooldown_until <= NOW() AND (suspension_until IS NULL OR suspension_until <= NOW())`)
    const count = result.length
    if (count > 0) console.log(`[cleanup] deleted ${count} expired cooldown records`)
  } catch (err) {
    captureError(err, { source: 'cleanup-expired-cooldowns' })
  }
})

new Cron('*/10 * * * *', async () => {
  try {
    const result = await db.execute(sql`DELETE FROM delivery_log WHERE delivered_at < NOW() - INTERVAL '48 hours'`)
    const count = result.length
    if (count > 0) console.log(`[cleanup] deleted ${count} expired delivery log entries`)
  } catch (err) {
    captureError(err, { source: 'cleanup-expired-delivery-log' })
  }
})

new Cron('0 * * * *', async () => {
  try {
    const cutoff = currentPeriod() - 7
    const result = await db.execute(sql`DELETE FROM daily_tokens WHERE date < ${cutoff}`)
    const count = result.length
    if (count > 0) console.log(`[cleanup] deleted ${count} stale daily token records`)
  } catch (err) {
    captureError(err, { source: 'cleanup-stale-daily-tokens' })
  }
})

serve({ fetch: app.fetch, port: 3000 }, () => {
  console.log('relay-cafe-api running on :3000')
})

import { serve } from '@hono/node-server'
import { app } from './app'
import { initSentry, captureError } from './lib/logger'

initSentry()

process.on('unhandledRejection', (err) => {
  captureError(err, { source: 'unhandledRejection' })
})

process.on('uncaughtException', (err) => {
  captureError(err, { source: 'uncaughtException' })
  process.exit(1)
})

serve({ fetch: app.fetch, port: 3000 }, () => {
  console.log('relay-cafe-api running on :3000')
})

import { serve } from '@hono/node-server'
import { app } from './app'

serve({ fetch: app.fetch, port: 3000 }, () => {
  console.log('relay-cafe-api running on :3000')
})

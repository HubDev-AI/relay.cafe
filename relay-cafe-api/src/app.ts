import { Hono } from 'hono'
import { authRouter } from './routes/auth'
import { meRouter } from './routes/me'
import { messagesRouter } from './routes/messages'
import { authMiddleware } from './middleware/auth'

export const app = new Hono()

app.get('/health', (c) => c.json({ ok: true }))
app.route('/auth', authRouter)
app.route('/me', meRouter)
app.use('/messages/*', authMiddleware)
app.route('/messages', messagesRouter)

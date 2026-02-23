import { describe, it, expect } from 'bun:test'
import { app } from '../src/app'

describe('POST /messages', () => {
  it('returns 401 without token', async () => {
    const res = await app.request('/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'hello' }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 400 if text is missing', async () => {
    // We test this by patching the auth middleware in a helper app
    const { Hono } = await import('hono')
    const { messagesRouter } = await import('../src/routes/messages')
    const testApp = new Hono()
    testApp.use('*', async (c, next) => { c.set('userId', 'test-user'); await next() })
    testApp.route('/messages', messagesRouter)

    const res = await testApp.request('/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 if text exceeds 1000 chars', async () => {
    const { Hono } = await import('hono')
    const { messagesRouter } = await import('../src/routes/messages')
    const testApp = new Hono()
    testApp.use('*', async (c, next) => { c.set('userId', 'test-user'); await next() })
    testApp.route('/messages', messagesRouter)

    const res = await testApp.request('/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'a'.repeat(1001) }),
    })
    expect(res.status).toBe(400)
  })
})

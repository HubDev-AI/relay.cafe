import { describe, it, expect } from 'bun:test'
import { app } from '../src/app'

describe('GET /me/status', () => {
  it('returns 401 without token', async () => {
    const res = await app.request('/me/status')
    expect(res.status).toBe(401)
  })
})

describe('DELETE /me', () => {
  it('returns 401 without token', async () => {
    const res = await app.request('/me', { method: 'DELETE' })
    expect(res.status).toBe(401)
  })
})

import { describe, it, expect } from 'bun:test'
import { app } from '../src/app'

describe('health', () => {
  it('GET /health returns ok', async () => {
    const res = await app.request('/health')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })
})

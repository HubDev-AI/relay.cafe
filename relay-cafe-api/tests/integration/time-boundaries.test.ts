import { test, expect, describe, beforeEach } from 'bun:test'
import { resetDB, createAuthenticatedUser, createMessage } from '../helpers/db'
import { requestJSON, request } from '../helpers/http'

const TTL_SECONDS = Number(process.env.MESSAGE_TTL_SECONDS) || 2
const PERIOD_SECONDS = Number(process.env.TOKEN_PERIOD_SECONDS) || 3

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

/** Wait until we're at the start of a fresh period (at least 2s remaining). */
async function waitForFreshPeriod() {
  const periodMs = PERIOD_SECONDS * 1000
  const elapsed = Date.now() % periodMs
  const remaining = periodMs - elapsed
  // If less than 2s remain in the current period, wait for the next one
  if (remaining < 2000) {
    await sleep(remaining + 100)
  }
}

describe('message TTL expiry', () => {
  beforeEach(async () => {
    await resetDB()
  })

  test(`message expires after ${TTL_SECONDS}s — not served`, async () => {
    await createMessage()
    const receiver = await createAuthenticatedUser()

    // Wait for TTL to pass
    await sleep((TTL_SECONDS + 0.5) * 1000)

    const res = await request('/messages/today', { token: receiver.token })
    expect(res.status).toBe(204)
  }, (TTL_SECONDS + 2) * 1000)

  test('message is served when NOT expired', async () => {
    const { plaintext } = await createMessage()
    const receiver = await createAuthenticatedUser()

    const { status, json } = await requestJSON<{ text: string }>('/messages/today', {
      token: receiver.token,
    })
    expect(status).toBe(200)
    expect(json!.text).toBe(plaintext)
  })

  test('mix of expired and fresh messages — only fresh is served', async () => {
    await createMessage({ expiresInMs: -1000 })
    const { plaintext } = await createMessage()

    const receiver = await createAuthenticatedUser()
    const { status, json } = await requestJSON<{ text: string }>('/messages/today', {
      token: receiver.token,
    })
    expect(status).toBe(200)
    expect(json!.text).toBe(plaintext)
  })
})

describe('token period boundary', () => {
  beforeEach(async () => {
    await resetDB()
  })

  test(`user can send again after ${PERIOD_SECONDS}s period resets`, async () => {
    await waitForFreshPeriod()
    const user = await createAuthenticatedUser()

    // Send in current period
    const r1 = await requestJSON('/messages', {
      method: 'POST',
      token: user.token,
      body: { text: 'period 1' },
    })
    expect(r1.status).toBe(201)

    // Second send in same period fails
    const r2 = await requestJSON('/messages', {
      method: 'POST',
      token: user.token,
      body: { text: 'period 1 again' },
    })
    expect(r2.status).toBe(429)

    // Wait for period to change
    await sleep((PERIOD_SECONDS + 0.5) * 1000)

    // Send in new period succeeds
    const r3 = await requestJSON('/messages', {
      method: 'POST',
      token: user.token,
      body: { text: 'period 2' },
    })
    expect(r3.status).toBe(201)
  }, (PERIOD_SECONDS * 2 + 3) * 1000)

  test(`user can receive again after ${PERIOD_SECONDS}s period resets`, async () => {
    await waitForFreshPeriod()
    const receiver = await createAuthenticatedUser()

    // Insert and receive in period 1
    await createMessage()
    const r1 = await requestJSON('/messages/today', { token: receiver.token })
    expect(r1.status).toBe(200)

    // Second receive in same period fails
    await createMessage()
    const r2 = await requestJSON('/messages/today', { token: receiver.token })
    expect(r2.status).toBe(429)

    // Wait for period to change
    await sleep((PERIOD_SECONDS + 0.5) * 1000)

    // Receive in new period succeeds
    await createMessage()
    const r3 = await requestJSON('/messages/today', { token: receiver.token })
    expect(r3.status).toBe(200)
  }, (PERIOD_SECONDS * 2 + 3) * 1000)

  test('status reflects new period after reset', async () => {
    await waitForFreshPeriod()
    const user = await createAuthenticatedUser()

    // Use both tokens
    await createMessage()
    await requestJSON('/messages', { method: 'POST', token: user.token, body: { text: 'sent' } })
    await requestJSON('/messages/today', { token: user.token })

    const statusBefore = await requestJSON<{ sendUsed: boolean; receiveUsed: boolean }>('/me/status', { token: user.token })
    expect(statusBefore.json!.sendUsed).toBe(true)
    expect(statusBefore.json!.receiveUsed).toBe(true)

    // Wait for period reset
    await sleep((PERIOD_SECONDS + 0.5) * 1000)

    const statusAfter = await requestJSON<{ sendUsed: boolean; receiveUsed: boolean }>('/me/status', { token: user.token })
    expect(statusAfter.json!.sendUsed).toBe(false)
    expect(statusAfter.json!.receiveUsed).toBe(false)
  }, (PERIOD_SECONDS * 2 + 3) * 1000)
})

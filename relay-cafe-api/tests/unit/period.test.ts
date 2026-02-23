import { test, expect, describe, afterEach } from 'bun:test'
import { currentPeriod } from '../../src/lib/period'

describe('currentPeriod', () => {
  const originalEnv = process.env.TOKEN_PERIOD_SECONDS

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.TOKEN_PERIOD_SECONDS = originalEnv
    } else {
      delete process.env.TOKEN_PERIOD_SECONDS
    }
  })

  test('production mode (86400) returns YYYY-MM-DD', () => {
    process.env.TOKEN_PERIOD_SECONDS = '86400'
    const result = currentPeriod()
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  test('unset TOKEN_PERIOD_SECONDS defaults to YYYY-MM-DD', () => {
    delete process.env.TOKEN_PERIOD_SECONDS
    const result = currentPeriod()
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  test('production mode date matches UTC date', () => {
    process.env.TOKEN_PERIOD_SECONDS = '86400'
    const result = currentPeriod()
    const expected = new Date().toISOString().slice(0, 10)
    expect(result).toBe(expected)
  })

  test('test mode (< 86400) returns numeric period ID', () => {
    process.env.TOKEN_PERIOD_SECONDS = '300'
    const result = currentPeriod()
    expect(result).toMatch(/^\d+$/)
    expect(Number(result)).toBeGreaterThan(0)
  })

  test('test mode period ID is consistent within same period', () => {
    process.env.TOKEN_PERIOD_SECONDS = '300'
    const a = currentPeriod()
    const b = currentPeriod()
    expect(a).toBe(b)
  })

  test('test mode with 1-second period changes quickly', async () => {
    process.env.TOKEN_PERIOD_SECONDS = '1'
    const a = currentPeriod()
    await new Promise(r => setTimeout(r, 1100))
    const b = currentPeriod()
    expect(a).not.toBe(b)
  })

  test('very large TOKEN_PERIOD_SECONDS (>= 86400) uses date format', () => {
    process.env.TOKEN_PERIOD_SECONDS = '100000'
    const result = currentPeriod()
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

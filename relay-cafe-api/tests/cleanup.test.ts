import { describe, it, expect } from 'bun:test'
import { buildCleanupQueries } from '../src/jobs/cleanup'

describe('buildCleanupQueries', () => {
  it('returns two SQL strings', () => {
    const queries = buildCleanupQueries()
    expect(queries).toHaveLength(2)
    expect(queries[0]).toContain('messages')
    expect(queries[1]).toContain('ip_events')
  })
})

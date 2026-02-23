import { describe, it, expect } from 'bun:test'
import { users, sessions, dailyTokens, messages, ipEvents } from '../src/db/schema'

describe('schema', () => {
  it('exports users table', () => expect(users).toBeDefined())
  it('exports sessions table', () => expect(sessions).toBeDefined())
  it('exports dailyTokens table', () => expect(dailyTokens).toBeDefined())
  it('exports messages table', () => expect(messages).toBeDefined())
  it('exports ipEvents table', () => expect(ipEvents).toBeDefined())
})

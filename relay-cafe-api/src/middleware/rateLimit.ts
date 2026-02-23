import type { Context, Next } from 'hono'
import { createHash } from 'node:crypto'

// In-memory store. For multi-instance Railway deploys, swap with Redis.
const store = new Map<string, { count: number; resetAt: number }>()

// Sweep expired entries every 60 seconds to prevent unbounded memory growth
const SWEEP_INTERVAL_MS = 60_000
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of store) {
    if (entry.resetAt < now) {
      store.delete(key)
    }
  }
}, SWEEP_INTERVAL_MS).unref()

interface Options {
  maxRequests: number
  windowMs: number
}

export function ipRateLimit({ maxRequests, windowMs }: Options) {
  return async (c: Context, next: Next) => {
    const ip = c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ?? 'unknown'
    const key = createHash('sha256').update(ip).digest('hex')
    const now = Date.now()

    const entry = store.get(key)
    if (!entry || entry.resetAt < now) {
      store.set(key, { count: 1, resetAt: now + windowMs })
      return next()
    }

    entry.count++
    if (entry.count > maxRequests) {
      return c.json({ error: 'Please try again later.' }, 429)
    }

    return next()
  }
}

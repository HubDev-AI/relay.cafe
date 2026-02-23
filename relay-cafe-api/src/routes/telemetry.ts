import { Hono } from 'hono'
import { captureMessage } from '../lib/logger'

export const telemetryRouter = new Hono()

const ALLOWED_EVENTS = new Set(['translation.unavailable', 'translation.error'])

const ALLOWED_KEYS = new Set([
  'event', 'sourceLanguage', 'targetLanguage',
  'osVersion', 'appVersion', 'errorCode', 'errorDomain',
])

telemetryRouter.post('/', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return c.json({ error: 'Invalid payload' }, 400)
  }

  // Reject any keys not in the whitelist
  for (const key of Object.keys(body)) {
    if (!ALLOWED_KEYS.has(key)) {
      return c.json({ error: 'Unexpected field' }, 400)
    }
  }

  if (!body.event || !ALLOWED_EVENTS.has(body.event)) {
    return c.json({ error: 'Invalid event' }, 400)
  }

  const extra: Record<string, unknown> = {}
  if (body.sourceLanguage) extra.sourceLanguage = String(body.sourceLanguage)
  if (body.targetLanguage) extra.targetLanguage = String(body.targetLanguage)
  if (body.osVersion) extra.osVersion = String(body.osVersion)
  if (body.appVersion) extra.appVersion = String(body.appVersion)
  if (body.errorCode != null) extra.errorCode = String(body.errorCode)
  if (body.errorDomain) extra.errorDomain = String(body.errorDomain)

  const level = body.event === 'translation.error' ? 'warning' as const : 'info' as const
  captureMessage(body.event, level, extra)

  return c.body(null, 204)
})

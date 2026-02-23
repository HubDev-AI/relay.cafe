import * as Sentry from '@sentry/bun'

export function initSentry() {
  const dsn = process.env.SENTRY_DSN
  if (dsn) {
    Sentry.init({ dsn })
  }
}

export function captureError(err: unknown, context?: Record<string, string>) {
  console.error('[relay-cafe]', context ?? {}, err)
  if (process.env.SENTRY_DSN) {
    Sentry.captureException(err, { extra: context })
  }
}

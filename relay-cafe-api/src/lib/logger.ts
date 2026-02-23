import * as Sentry from '@sentry/bun'

export function initSentry() {
  const dsn = process.env.SENTRY_DSN
  if (dsn) {
    Sentry.init({
      dsn,
      beforeSend(event) {
        if (event.request) {
          delete event.request.headers?.['Authorization']
          delete event.request.headers?.['authorization']
          delete event.request.data
        }
        return event
      },
      beforeBreadcrumb(breadcrumb) {
        if (breadcrumb.category === 'http') {
          delete breadcrumb.data?.requestBody
          delete breadcrumb.data?.responseBody
        }
        return breadcrumb
      },
    })
  }
}

export function captureError(err: unknown, context?: Record<string, string>) {
  console.error('[relay-cafe]', context ?? {}, err)
  if (process.env.SENTRY_DSN) {
    Sentry.captureException(err, { extra: context })
  }
}

export function captureMessage(message: string, level: 'info' | 'warning', extra?: Record<string, unknown>) {
  if (process.env.SENTRY_DSN) {
    Sentry.captureMessage(message, { level, extra })
  }
}

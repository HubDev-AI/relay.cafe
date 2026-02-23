/**
 * Returns the current token period key.
 *
 * Production (TOKEN_PERIOD_SECONDS unset or 86400): returns YYYY-MM-DD UTC — resets daily at midnight.
 * Testing (TOKEN_PERIOD_SECONDS=300): returns a numeric period ID that increments every 5 minutes.
 */
export function currentPeriod(): string {
  const seconds = Number(process.env.TOKEN_PERIOD_SECONDS) || 86400
  if (seconds >= 86400) {
    return new Date().toISOString().slice(0, 10) // YYYY-MM-DD
  }
  return String(Math.floor(Date.now() / (seconds * 1000)))
}

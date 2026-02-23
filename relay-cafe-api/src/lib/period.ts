/**
 * Returns the current token period as an epoch-based number.
 *
 * Production (TOKEN_PERIOD_SECONDS unset or 86400): epoch day (days since Unix epoch, resets at 00:00 UTC).
 * Testing (TOKEN_PERIOD_SECONDS=300): epoch period ID that increments every N seconds.
 */
export function currentPeriod(): number {
  const seconds = Number(process.env.TOKEN_PERIOD_SECONDS) || 86400
  return Math.floor(Date.now() / (seconds * 1000))
}

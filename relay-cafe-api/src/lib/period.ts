/**
 * Returns the current token period as an epoch-based number.
 *
 * This is a fixed UTC daily reset, NOT a rolling 24-hour window.
 * Tokens reset at 00:00 UTC for all users simultaneously.
 * No lastSentAt timestamps, no per-user cooldowns, no sliding windows.
 *
 * Production (TOKEN_PERIOD_SECONDS unset or 86400):
 *   epoch day = Math.floor(Date.now() / 86400000)
 *   Resets at 00:00 UTC.
 *
 * Testing (TOKEN_PERIOD_SECONDS=300):
 *   epoch period ID that increments every N seconds.
 *
 * Examples:
 *   User sends at 10:00 UTC Monday. At 00:00 UTC Tuesday (14h later), they can send again.
 *   User sends at 23:59 UTC. At 00:00 UTC (1 minute later), they can send again.
 *   Both are expected and correct — this is a calendar-day ritual, not a cooldown.
 */
export function currentPeriod(): number {
  const seconds = Number(process.env.TOKEN_PERIOD_SECONDS) || 86400
  return Math.floor(Date.now() / (seconds * 1000))
}

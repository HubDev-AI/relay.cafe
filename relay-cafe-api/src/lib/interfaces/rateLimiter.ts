export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: number
}

export type RateLimitTier = 'global' | 'auth' | 'messages'

export interface IRateLimiter {
  check(key: string, tier: RateLimitTier): Promise<RateLimitResult>
}

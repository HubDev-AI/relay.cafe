import { randomBytes, createHmac } from 'node:crypto'

const SESSION_SALT = process.env.SESSION_SALT
if (!SESSION_SALT) {
  throw new Error('SESSION_SALT environment variable is required')
}

export function generateToken(): string {
  return randomBytes(32).toString('hex')
}

export function hashToken(rawToken: string): string {
  return createHmac('sha256', SESSION_SALT).update(rawToken).digest('hex')
}

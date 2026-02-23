import { db } from '../../src/db'
import { users, sessions, dailyTokens, messages } from '../../src/db/schema'
import { sql } from 'drizzle-orm'
import { randomUUID, createHash } from 'node:crypto'
import { generateToken, hashToken } from '../../src/lib/sessionToken'

/**
 * Wipe all rows. Call in beforeAll/beforeEach.
 */
export async function resetDB() {
  // Order matters: foreign keys
  await db.delete(messages)
  await db.delete(dailyTokens)
  await db.delete(sessions)
  await db.delete(users)
}

/**
 * Create a user with a deterministic apple ID hash.
 * Returns the user row.
 */
export async function createUser(appleSubId = `test-${randomUUID()}`) {
  const salt = process.env.APPLE_ID_SALT!
  const appleIdHash = createHash('sha256').update(salt + appleSubId).digest('hex')
  const [user] = await db.insert(users).values({ appleIdHash }).returning()
  return { user: user!, appleSubId }
}

/**
 * Create a session for an existing user.
 * Returns the raw session token (64-char hex).
 */
export async function createSession(userId: string, expiresInMs = 30 * 24 * 60 * 60 * 1000) {
  const rawToken = generateToken()
  const tokenHash = hashToken(rawToken)
  const expiresAt = new Date(Date.now() + expiresInMs)
  await db.insert(sessions).values({ userId, tokenHash, expiresAt })
  return rawToken
}

/**
 * Insert an encrypted message directly into the DB for receive tests.
 * Uses real KMS encryption.
 */
export async function createMessage(opts?: { expiresInMs?: number }) {
  const { encryptMessage } = await import('../../src/lib/crypto')
  const { wrapKey } = await import('../../src/lib/kms')

  const text = `test-message-${randomUUID()}`
  const { ciphertext, iv, key } = await encryptMessage(text)
  const { encryptedKey, keyVersion } = await wrapKey(key)

  const ttlMs = opts?.expiresInMs ?? (Number(process.env.MESSAGE_TTL_SECONDS) || 86400) * 1000
  const expiresAt = new Date(Date.now() + ttlMs)

  const [msg] = await db.insert(messages).values({
    ciphertext,
    encryptedMessageKey: encryptedKey,
    kmsKeyVersion: keyVersion,
    iv,
    expiresAt,
  }).returning()

  return { message: msg!, plaintext: text }
}

/**
 * Create a user + session in one call. Returns { userId, token }.
 */
export async function createAuthenticatedUser(appleSubId?: string) {
  const { user } = await createUser(appleSubId)
  const token = await createSession(user.id)
  return { userId: user.id, token }
}

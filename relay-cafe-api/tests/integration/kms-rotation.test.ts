import { test, expect, describe, beforeAll, afterAll } from 'bun:test'
import { KeyManagementServiceClient } from '@google-cloud/kms'
import { wrapKey, unwrapKey } from '../../src/lib/kms'
import { encryptMessage, decryptMessage } from '../../src/lib/crypto'
import { randomBytes } from 'node:crypto'

// NOTE: This test creates 1 real GCP KMS key version per run.
// Key versions are billed and cannot be deleted (only scheduled for destruction).
// The test cleans up by restoring the original primary and scheduling destruction
// of the created version.

const client = new KeyManagementServiceClient()

function keyName(): string {
  return [
    `projects/${process.env.GCP_PROJECT_ID}`,
    `locations/${process.env.GCP_KMS_LOCATION}`,
    `keyRings/${process.env.GCP_KMS_KEY_RING}`,
    `cryptoKeys/${process.env.GCP_KMS_KEY_NAME}`,
  ].join('/')
}

function extractVersionId(versionName: string): string {
  return versionName.split('/').pop()!
}

describe('KMS key rotation (real GCP KMS)', () => {
  const name = keyName()
  let originalPrimaryVersionId: string
  let createdVersionName: string | null = null

  // Pre-rotation state: wrapped with old primary before rotation happens
  let rawKeyA: Buffer
  let wrappedA: { encryptedKey: string; keyVersion: string }
  let plaintextB: string
  let ciphertextB: string
  let ivB: string
  let rawKeyB: Buffer
  let wrappedB: { encryptedKey: string; keyVersion: string }

  beforeAll(async () => {
    // 1. Wrap keys with the current primary (before rotation)
    rawKeyA = randomBytes(32)
    wrappedA = await wrapKey(rawKeyA)

    plaintextB = 'Message encrypted before key rotation — must survive rotation'
    const encrypted = await encryptMessage(plaintextB)
    ciphertextB = encrypted.ciphertext
    ivB = encrypted.iv
    rawKeyB = encrypted.key
    wrappedB = await wrapKey(rawKeyB)

    // 2. Record current primary version
    const [cryptoKey] = await client.getCryptoKey({ name })
    originalPrimaryVersionId = extractVersionId(cryptoKey.primary!.name as string)

    // 3. Create a new key version
    const [newVersion] = await client.createCryptoKeyVersion({ parent: name })
    createdVersionName = newVersion.name as string

    // Wait for ENABLED state (software keys are usually immediate)
    for (let i = 0; i < 10; i++) {
      const [v] = await client.getCryptoKeyVersion({ name: createdVersionName })
      if (v.state === 'ENABLED' || v.state === 1) break
      await new Promise(r => setTimeout(r, 1000))
    }

    // 4. Set new version as primary (simulates rotation)
    await client.updateCryptoKeyPrimaryVersion({
      name,
      cryptoKeyVersionId: extractVersionId(createdVersionName),
    })
  }, 30_000)

  afterAll(async () => {
    // Restore original primary
    if (originalPrimaryVersionId) {
      await client.updateCryptoKeyPrimaryVersion({
        name,
        cryptoKeyVersionId: originalPrimaryVersionId,
      })
    }
    // Schedule destruction of the test version
    if (createdVersionName) {
      try {
        await client.destroyCryptoKeyVersion({ name: createdVersionName })
      } catch {
        // May already be scheduled — ignore
      }
    }
  }, 10_000)

  test('unwrap still works after rotation (core guarantee)', async () => {
    // wrappedA was encrypted with the OLD primary version.
    // After rotation, a new version is primary, but GCP auto-resolves
    // the correct version from the ciphertext metadata.
    const unwrapped = await unwrapKey(wrappedA.encryptedKey, wrappedA.keyVersion)
    expect(Buffer.compare(rawKeyA, unwrapped)).toBe(0)
  })

  test('full encrypt → wrap → rotate → unwrap → decrypt chain', async () => {
    // wrappedB was encrypted (AES) + wrapped (KMS) with the OLD primary.
    // After rotation, unwrap auto-resolves to old version, then AES
    // decryption recovers the original plaintext.
    const unwrapped = await unwrapKey(wrappedB.encryptedKey, wrappedB.keyVersion)
    const decrypted = await decryptMessage(ciphertextB, ivB, unwrapped)
    expect(decrypted).toBe(plaintextB)
  })

  test('key config: destroyScheduledDuration >= 50h', async () => {
    const [cryptoKey] = await client.getCryptoKey({ name })

    // destroyScheduledDuration is a Duration proto: { seconds: number }
    const destroyDuration = cryptoKey.destroyScheduledDuration
    expect(destroyDuration).toBeDefined()
    const destroySeconds = Number(destroyDuration!.seconds)
    const fiftyHoursInSeconds = 50 * 60 * 60 // 180,000
    expect(destroySeconds).toBeGreaterThanOrEqual(fiftyHoursInSeconds)

    // rotationPeriod should be configured (24h = 86400s)
    const rotationPeriod = cryptoKey.rotationPeriod
    expect(rotationPeriod).toBeDefined()
    expect(Number(rotationPeriod!.seconds)).toBeGreaterThan(0)
  })
})

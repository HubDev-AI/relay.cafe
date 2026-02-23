import { KeyManagementServiceClient } from '@google-cloud/kms'

const client = new KeyManagementServiceClient()

const GCP_PROJECT_ID = process.env.GCP_PROJECT_ID
const GCP_KMS_LOCATION = process.env.GCP_KMS_LOCATION
const GCP_KMS_KEY_RING = process.env.GCP_KMS_KEY_RING
const GCP_KMS_KEY_NAME = process.env.GCP_KMS_KEY_NAME

if (!GCP_PROJECT_ID || !GCP_KMS_LOCATION || !GCP_KMS_KEY_RING || !GCP_KMS_KEY_NAME) {
  throw new Error('GCP_PROJECT_ID, GCP_KMS_LOCATION, GCP_KMS_KEY_RING, GCP_KMS_KEY_NAME environment variables are required')
}

// Returns the CryptoKey resource name (no version suffix).
// GCP KMS encrypt uses the primary version; decrypt resolves the version
// automatically from the ciphertext so we only need the key name for both.
function keyName(): string {
  return [
    `projects/${GCP_PROJECT_ID}`,
    `locations/${GCP_KMS_LOCATION}`,
    `keyRings/${GCP_KMS_KEY_RING}`,
    `cryptoKeys/${GCP_KMS_KEY_NAME}`,
  ].join('/')
}

export async function wrapKey(rawKey: Buffer): Promise<{ encryptedKey: string; keyVersion: string }> {
  const name = keyName()
  const [result] = await client.encrypt({ name, plaintext: rawKey })
  return {
    encryptedKey: Buffer.from(result.ciphertext as Uint8Array).toString('base64'),
    keyVersion: name,
  }
}

export async function unwrapKey(encryptedKey: string, keyVersion: string): Promise<Buffer> {
  // keyVersion stores the CryptoKey resource name; GCP selects the correct
  // key version from the ciphertext automatically.
  const [result] = await client.decrypt({
    name: keyVersion,
    ciphertext: Buffer.from(encryptedKey, 'base64'),
  })
  return Buffer.from(result.plaintext as Uint8Array)
}

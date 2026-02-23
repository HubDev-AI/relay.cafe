import { KeyManagementServiceClient } from '@google-cloud/kms'

const client = new KeyManagementServiceClient()

function todayKeyVersion(): string {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  return [
    `projects/${process.env.GCP_PROJECT_ID}`,
    `locations/${process.env.GCP_KMS_LOCATION}`,
    `keyRings/${process.env.GCP_KMS_KEY_RING}`,
    `cryptoKeys/${process.env.GCP_KMS_KEY_NAME}`,
    `cryptoKeyVersions/${today}`,
  ].join('/')
}

export async function wrapKey(rawKey: Buffer): Promise<{ encryptedKey: string; keyVersion: string }> {
  const keyVersion = todayKeyVersion()
  const [result] = await client.encrypt({
    name: keyVersion,
    plaintext: rawKey,
  })
  return {
    encryptedKey: Buffer.from(result.ciphertext as Uint8Array).toString('base64'),
    keyVersion,
  }
}

export async function unwrapKey(encryptedKey: string, keyVersion: string): Promise<Buffer> {
  const [result] = await client.decrypt({
    name: keyVersion,
    ciphertext: Buffer.from(encryptedKey, 'base64'),
  })
  return Buffer.from(result.plaintext as Uint8Array)
}

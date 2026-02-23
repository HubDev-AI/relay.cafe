#!/usr/bin/env bun
/**
 * KMS Key Version Cleanup
 *
 * Finds non-primary ENABLED key versions older than KEY_MAX_AGE_HOURS
 * and schedules them for destruction. GCP's destroyScheduledDuration
 * (50h) provides a safety window before actual deletion.
 *
 * Idempotent — safe to run repeatedly via Cloud Scheduler.
 *
 * Usage:
 *   bun run scripts/cleanup-kms-versions.ts
 *
 * Required env vars:
 *   GCP_PROJECT_ID, GCP_KMS_LOCATION, GCP_KMS_KEY_RING, GCP_KMS_KEY_NAME
 */

import { KeyManagementServiceClient } from '@google-cloud/kms'

const client = new KeyManagementServiceClient()

// 50h: MESSAGE_TTL (24h) + rotation_period (24h) + 2h safety buffer
const KEY_MAX_AGE_HOURS = 50

function keyName(): string {
  return [
    `projects/${process.env.GCP_PROJECT_ID}`,
    `locations/${process.env.GCP_KMS_LOCATION}`,
    `keyRings/${process.env.GCP_KMS_KEY_RING}`,
    `cryptoKeys/${process.env.GCP_KMS_KEY_NAME}`,
  ].join('/')
}

async function main() {
  const name = keyName()

  const [cryptoKey] = await client.getCryptoKey({ name })
  const primaryName = cryptoKey.primary!.name as string
  console.log(`Primary version: ${primaryName}`)

  const [versions] = await client.listCryptoKeyVersions({ parent: name })

  const cutoff = Date.now() - KEY_MAX_AGE_HOURS * 60 * 60 * 1000
  let scheduled = 0
  let skipped = 0

  for (const version of versions) {
    if (version.name === primaryName) continue

    // Only touch ENABLED versions — DISABLED/DESTROY_SCHEDULED/DESTROYED are already handled
    const state = version.state
    if (state !== 'ENABLED' && state !== 1) continue

    const createTime = version.createTime
    if (!createTime) continue

    const createdMs = Number(createTime.seconds) * 1000 + Math.floor(Number(createTime.nanos) / 1e6)
    if (createdMs > cutoff) {
      skipped++
      continue
    }

    const age = ((Date.now() - createdMs) / 3600000).toFixed(1)
    console.log(`Scheduling destruction: ${version.name} (age: ${age}h)`)
    await client.destroyCryptoKeyVersion({ name: version.name as string })
    scheduled++
  }

  console.log(`Done. ${scheduled} scheduled for destruction, ${skipped} too recent.`)
}

main().catch((err) => {
  console.error('KMS cleanup failed:', err)
  process.exit(1)
})

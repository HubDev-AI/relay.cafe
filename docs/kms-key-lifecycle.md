# KMS Key Lifecycle

## Overview

relay.cafe uses GCP KMS envelope encryption. Each message is encrypted with a random AES-256 key, and that key is wrapped (encrypted) by the current KMS primary key version. KMS key versions rotate daily and are destroyed after they can no longer be needed.

## Parameters

| Parameter | Value | Why |
|-----------|-------|-----|
| Rotation period | 24h | One primary version per UTC day |
| Message TTL | 24h | Messages expire and are undeliverable after this |
| Cleanup threshold | 50h | MESSAGE_TTL (24h) + rotation_period (24h) + 2h buffer |
| Destroy scheduled duration | 50h | Safety net before actual deletion after scheduling |
| Max key lifetime | ~80h | 24h primary + 6h max until cleanup + 50h destroy delay |

## Key Version States

```
ENABLED (primary)     -- actively wrapping new message keys
    |
    | (rotation every 24h)
    v
ENABLED (non-primary) -- can still unwrap, no new wraps
    |
    | (cleanup script, after 50h from creation)
    v
DESTROY_SCHEDULED     -- 50h countdown to actual deletion; restorable
    |
    | (50h destroy-scheduled-duration)
    v
DESTROYED             -- gone, ciphertext using this version is unrecoverable
```

## Scripts

### `scripts/setup-kms.sh`

Creates or updates the KMS key ring and key with correct rotation and destruction schedule. Run once per environment.

```bash
GCP_PROJECT_ID=... GCP_KMS_LOCATION=... GCP_KMS_KEY_RING=... GCP_KMS_KEY_NAME=... \
  bash scripts/setup-kms.sh
```

**Note:** `destroy-scheduled-duration` cannot be reduced on an existing key (GCP restriction). It can only be increased. If you need a shorter duration, you must create a new key.

### `scripts/cleanup-kms-versions.ts`

Finds non-primary ENABLED versions older than 50h and schedules them for destruction. Idempotent.

```bash
GCP_PROJECT_ID=... GCP_KMS_LOCATION=... GCP_KMS_KEY_RING=... GCP_KMS_KEY_NAME=... \
  bun run scripts/cleanup-kms-versions.ts
```

## Production Deployment

### Cloud Scheduler Setup

Run cleanup every 6 hours via Cloud Scheduler + Cloud Run Job (or equivalent):

```bash
gcloud scheduler jobs create http kms-cleanup \
  --schedule="0 */6 * * *" \
  --uri="https://<CLOUD_RUN_JOB_URL>" \
  --http-method=POST \
  --time-zone="UTC"
```

Or if running as a standalone Cloud Run Job:

```bash
gcloud run jobs create kms-cleanup \
  --image=<IMAGE> \
  --command="bun" \
  --args="run,scripts/cleanup-kms-versions.ts" \
  --set-env-vars="GCP_PROJECT_ID=...,GCP_KMS_LOCATION=...,GCP_KMS_KEY_RING=...,GCP_KMS_KEY_NAME=..." \
  --max-retries=1

gcloud scheduler jobs create http kms-cleanup-trigger \
  --schedule="0 */6 * * *" \
  --uri="https://<REGION>-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/<PROJECT>/jobs/kms-cleanup:run" \
  --oauth-service-account-email=<SA_EMAIL> \
  --time-zone="UTC"
```

### Required IAM Permissions

The service account running cleanup needs:

- `cloudkms.cryptoKeyVersions.list` — list versions
- `cloudkms.cryptoKeyVersions.destroy` — schedule destruction
- `cloudkms.cryptoKeys.get` — read primary version

Role `roles/cloudkms.admin` covers all of these (same as what's needed for setup and rotation tests).

## Safety

- **Primary version is never touched.** The cleanup script skips it unconditionally.
- **50h destroy delay.** After scheduling, there are 50h to restore a version via `gcloud kms keys versions restore` if something went wrong.
- **Idempotent.** Running cleanup multiple times is safe; already-scheduled versions are skipped (they're no longer in ENABLED state).
- **Messages are short-lived.** 24h TTL + hard-delete on delivery means in practice most keys are unused well before the 50h cleanup threshold.

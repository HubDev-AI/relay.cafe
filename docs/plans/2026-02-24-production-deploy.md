# Production Deployment Plan

## Status: In Progress

## Completed

### GCP Production Setup
- Created GCP project `relay-cafe-prod` (ID: relay-cafe-prod)
- Billing linked to account `019599-E07129-90CE1A`
- KMS API enabled
- Key ring `relay-cafe` created in `global` location
- Key `message-key` created with:
  - 24h rotation period
  - Default 30-day destroy-scheduled-duration (cannot reduce after creation; more conservative than the 50h minimum)
- Service account `relay-api@relay-cafe-prod.iam.gserviceaccount.com` created
  - Role: `roles/cloudkms.cryptoKeyEncrypterDecrypter`
- Service account key generated and base64-encoded at `/tmp/relay-cafe-prod-key-b64.txt`
  - **Action needed**: This temp file will be lost on reboot. Set as `GCP_CREDENTIALS_B64` env var in Railway before then.

### Dockerfile Updated
- Added `GCP_CREDENTIALS_B64` env var decoding at container startup
- Writes decoded JSON to `/app/gcp-credentials.json` before running migrations and server

### Railway Project Created
- Project name: `triumphant-benevolence` (auto-generated, can rename)
- Linked in `relay-cafe-api/` directory
- Environment: production
- No service deployed yet

## In Progress

### Switch from Upstash Redis to Railway Redis
- **Backend code changes needed** before deploying
- Current code uses `@upstash/redis` and `@upstash/ratelimit` (REST-based)
- Need to switch to standard Redis client compatible with Railway Redis (TCP-based)
- Files to change:
  - Rate limiting code (uses `@upstash/ratelimit`)
  - Any direct Redis usage
  - Environment variables (replace `UPSTASH_REDIS_REST_URL`/`TOKEN` with `REDIS_URL`)

## Not Started

### Railway Environment Variables
Need to set before deploy:
| Variable | Value/Source | Status |
|----------|-------------|--------|
| `DATABASE_URL` | From shareal.ink Railway project | Need from user |
| `GCP_PROJECT_ID` | `relay-cafe-prod` | Ready |
| `GCP_KMS_LOCATION` | `global` | Ready |
| `GCP_KMS_KEY_RING` | `relay-cafe` | Ready |
| `GCP_KMS_KEY_NAME` | `message-key` | Ready |
| `GCP_CREDENTIALS_B64` | `/tmp/relay-cafe-prod-key-b64.txt` | Ready (temp file) |
| `GOOGLE_APPLICATION_CREDENTIALS` | `/app/gcp-credentials.json` | Ready (hardcoded in Dockerfile) |
| `APPLE_BUNDLE_ID` | `cafe.relay.app` | Ready |
| `APPLE_ID_SALT` | Generate 32+ char random string | Need to generate |
| `SESSION_SALT` | Generate 32+ char random string | Need to generate |
| `MESSAGE_TTL_SECONDS` | `86400` | Ready |
| `TOKEN_PERIOD_SECONDS` | `86400` | Ready |
| `SENTRY_DSN` | Optional | Need from user |
| `REDIS_URL` | From Railway Redis (after switch) | Pending Redis switch |

### Deploy and Verify
1. `railway up` to deploy
2. Add custom domain `api.relay.cafe`
3. Configure DNS CNAME to Railway
4. Run `pg_cron_setup.sql` in Railway Postgres console
5. Verify: `curl https://api.relay.cafe/health`

### Post-Deploy
- KMS cleanup cron (Cloud Scheduler + Cloud Run Job) — can set up later
- TestFlight iOS app distribution

## Shared Infrastructure Notes
- Postgres shared with shareal.ink — no table conflicts confirmed
  - shareal.ink: `spaces`, `responses`, `og_jobs`
  - relay-cafe: `users`, `sessions`, `daily_tokens`, `messages`
- Redis shared with shareal.ink (switching to Railway Redis)

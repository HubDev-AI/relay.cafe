# Deployment Guide

## API (Railway)

### Environment Variables

All are required unless noted:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Postgres connection string |
| `GCP_PROJECT_ID` | GCP project ID |
| `GCP_KMS_LOCATION` | KMS location (e.g., `global`) |
| `GCP_KMS_KEY_RING` | KMS key ring name |
| `GCP_KMS_KEY_NAME` | KMS key name |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to GCP service account JSON |
| `APPLE_BUNDLE_ID` | iOS app bundle ID (e.g., `cafe.relay.app`) |
| `APPLE_ID_SALT` | Salt for hashing Apple user IDs (min 32 chars) |
| `SESSION_SALT` | Salt for session operations (min 32 chars) |
| `MESSAGE_TTL_SECONDS` | Message expiry (default: `86400` = 24h) |
| `TOKEN_PERIOD_SECONDS` | Token reset period (default: `86400` = daily) |
| `SENTRY_DSN` | Optional. Sentry error tracking DSN |

### Deploy Gotcha: TOKEN_PERIOD_SECONDS

`TOKEN_PERIOD_SECONDS` controls the daily token reset calculation:
`Math.floor(Date.now() / (TOKEN_PERIOD_SECONDS * 1000))`

If this value changes between deploys (e.g., accidentally left at `300` from testing),
the period number changes completely and all users get fresh tokens mid-day. Always
verify this is set to `86400` in production.

### Steps

1. Create Railway project with Postgres addon
2. Set all environment variables above
3. Deploy from `relay-cafe-api/` directory
4. Run DB migration: `bunx drizzle-kit push`
5. Verify: `curl https://api.relay.cafe/health` returns `{"ok":true}`

### Health Check

`GET /health` — returns `{"ok":true}` if the database is reachable, `{"ok":false,"db":"unreachable"}` with 503 otherwise.

## GCP KMS Setup

See [kms-key-lifecycle.md](kms-key-lifecycle.md) for full details.

Quick setup:

```bash
export GCP_PROJECT_ID=your-project
export GCP_KMS_LOCATION=global
export GCP_KMS_KEY_RING=relay-cafe
export GCP_KMS_KEY_NAME=message-key

bash relay-cafe-api/scripts/setup-kms.sh
```

Required IAM roles for the API service account:
- `roles/cloudkms.cryptoKeyEncrypterDecrypter` — encrypt/decrypt message keys

Required IAM roles for the cleanup script service account:
- `roles/cloudkms.admin` — list versions, schedule destruction, read primary

### Key Rotation

Keys rotate automatically every 24 hours. Old versions are cleaned up by
`scripts/cleanup-kms-versions.ts` (run via Cloud Scheduler every 6 hours).

## Landing Page (GitHub Pages)

Deployed automatically via GitHub Actions when files in `relay-cafe-site/` change on `main`.

Custom domain: `relay.cafe`

### DNS Records

Add these to your DNS provider:

| Type | Name | Value |
|------|------|-------|
| A | @ | 185.199.108.153 |
| A | @ | 185.199.109.153 |
| A | @ | 185.199.110.153 |
| A | @ | 185.199.111.153 |
| CNAME | www | hubdev-ai.github.io |

### GitHub Repo Settings

1. Settings > Pages > Source: GitHub Actions
2. Settings > Pages > Custom domain: `relay.cafe`
3. Check "Enforce HTTPS"

## Message Cleanup

Messages expire after `MESSAGE_TTL_SECONDS`. Expired messages are cleaned up by a
`pg_cron` job running every 5 minutes:

```sql
SELECT cron.schedule('cleanup-expired-messages', '*/5 * * * *',
  $$DELETE FROM messages WHERE expires_at <= NOW()$$
);
```

See `relay-cafe-api/drizzle/pg_cron_setup.sql`.

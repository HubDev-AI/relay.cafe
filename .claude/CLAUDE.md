# relay.cafe – Project Instructions

## Repo Structure

Monorepo with three subdirectories:
- `relay-cafe-api/` — Hono + Bun backend API
- `relay-cafe-ios/` — SwiftUI iOS app
- `relay-cafe-site/` — Static landing page (HTML/CSS, no JS, no build step)

Other directories:
- `docs/landing/` — Landing page specs and icon source assets (PAGE.md, TERMS.md, images)
- `docs/plans/` — Implementation plans and design documents
- `docs/marketing/` — Marketing strategy

## Git Workflow

**Branches:**
- `main` — production-ready, PR-only merges, no force push, no deletion
- `dev` — integration branch, PR-only merges, no force push, no deletion. **This is the working branch.**
- Feature branches: `feature/<name>`, created from `dev`, merge back to `dev` via PR

**Flow:** `feature/*` → PR → `dev` → PR → `main`. Never skip `dev`. Never push directly to `dev` or `main` (both are protected).

**When creating a new feature branch:** Always branch from `dev`, not `main`.
**When creating a PR:** Always target `dev`, unless explicitly told to target `main`.

Remote: `git@github.com:HubDev-AI/relay.cafe.git`

**After committing on a feature branch:** Automatically push, create PR to `dev`, merge it, checkout `dev`, and pull. Do not ask — just do it.

## API Server

- Entry point: `relay-cafe-api/src/index.ts` (NOT `src/app.ts` — that just exports)
- Runtime: Bun
- Start: `cd relay-cafe-api && bun run src/index.ts`
- ORM: Drizzle + `postgres` driver
- Auth: Sign in with Apple, session tokens (UUID of session row — no JWT)
- Encryption: GCP KMS envelope encryption, one key version per UTC day

## Environment Variables (relay-cafe-api/.env)

```
DATABASE_URL=
GCP_PROJECT_ID=
GCP_KMS_LOCATION=
GCP_KMS_KEY_RING=
GCP_KMS_KEY_NAME=
GOOGLE_APPLICATION_CREDENTIALS=
APPLE_BUNDLE_ID=
APPLE_ID_SALT=
SESSION_SALT=
MESSAGE_TTL_SECONDS=86400        # production: 86400, testing: 300
TOKEN_PERIOD_SECONDS=86400       # production: 86400, testing: 300
SENTRY_DSN=                      # optional
```

Copy `.env.example` to `.env` — never commit `.env`.

## Token Period System

`currentPeriod()` in `src/lib/period.ts`:
- Always returns a number: `Math.floor(Date.now() / (seconds * 1000))`
- Default (86400): epoch day number (days since Unix epoch)
- Testing (e.g. 300): epoch period ID that increments every N seconds

`daily_tokens.date` column is BIGINT.

## Key API Behaviours

- `POST /messages` → 201 `{ ok: true }` (was 204 — breaks iOS client)
- `GET /messages/today` → includes `expiresAt` as epoch milliseconds (number)
- Receive token NOT consumed if message pool is empty
- Messages hard-deleted on delivery
- Expired messages cleaned up every 10 min by in-process cron (`croner` in `index.ts`). Replace with `pg_cron` when Railway Postgres supports it.

## iOS App

- Min deployment: iOS 17.0
- Architecture: `@Observable` + `@MainActor` ViewModels
- Date decoding: custom decoder converts epoch milliseconds (number) to Date
- Background refresh: scenePhase `.active` + 60s Timer in HomeView
- No haptics, no sound, no spring/bounce animations
- All error copy: generic, non-technical, no exclamation marks

## Testing

Reset DB for clean test:
```sql
DELETE FROM messages; DELETE FROM daily_tokens;
```

Set short periods for testing send→receive→expiry cycle:
```
MESSAGE_TTL_SECONDS=120
TOKEN_PERIOD_SECONDS=180
```

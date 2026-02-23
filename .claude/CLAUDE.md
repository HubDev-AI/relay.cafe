# relay.cafe – Project Instructions

## Repo Structure

Monorepo with two subdirectories:
- `relay-cafe-api/` — Hono + Bun backend API
- `relay-cafe-ios/` — SwiftUI iOS app

## Git Workflow

- `main` — production-ready, PR-only merges, no force push, no deletion
- `dev` — integration branch, PR-only merges, no force push, no deletion
- Feature branches: `feature/<name>`, merge to `dev` via PR, then `dev` → `main`

Remote: `git@github.com:HubDev-AI/relay.cafe.git`

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
KMS_LOCATION=
KMS_KEYRING=
KMS_KEY=
APPLE_TEAM_ID=
APPLE_CLIENT_ID=
MESSAGE_TTL_SECONDS=86400        # production: 86400, testing: 300
TOKEN_PERIOD_SECONDS=86400       # production: 86400, testing: 300
```

Copy `.env.example` to `.env` — never commit `.env`.

## Token Period System

`currentPeriod()` in `src/lib/period.ts`:
- `TOKEN_PERIOD_SECONDS >= 86400` → returns YYYY-MM-DD (daily UTC reset)
- Otherwise → numeric period ID (for testing short cycles)

`daily_tokens.date` column is TEXT to support both formats.

## Key API Behaviours

- `POST /messages` → 201 `{ ok: true }` (was 204 — breaks iOS client)
- `GET /messages/receive` → includes `expiresAt` ISO8601 string
- Receive token NOT consumed if message pool is empty
- Messages hard-deleted on delivery

## iOS App

- Min deployment: iOS 17.0
- Architecture: `@Observable` + `@MainActor` ViewModels
- Date decoding: custom ISO8601 decoder with `.withFractionalSeconds` (JS always emits ms)
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

# relay-cafe-api

Backend API for [Relay.cafe](https://relay.cafe) — a daily anonymous message service.

Built with [Hono](https://hono.dev) + [Bun](https://bun.sh), using Drizzle ORM and GCP KMS envelope encryption.

## Prerequisites

- [Bun](https://bun.sh) (latest)
- PostgreSQL 15+
- GCP project with KMS enabled (see [KMS setup](../docs/kms-key-lifecycle.md))

## Setup

```bash
bun install
cp .env.example .env
# Edit .env with your values
```

## Database

```bash
bunx drizzle-kit push
```

## Run

```bash
bun run src/index.ts
# → relay-cafe-api running on :3000
```

## Test

```bash
bun test
```

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /health | No | Health check (DB connectivity) |
| POST | /auth/apple | No | Sign in with Apple (rate limited) |
| DELETE | /auth/session | Yes | Sign out (delete session) |
| GET | /me/status | Yes | Daily token status |
| DELETE | /me | Yes | Delete account (cascades) |
| POST | /messages | Yes | Send today's message (1/day) |
| GET | /messages/today | Yes | Receive a random message (1/day) |

Auth = Bearer session token in Authorization header.

## Environment Variables

See `.env.example` for all required variables and descriptions.

Key variables: `DATABASE_URL`, `GCP_PROJECT_ID`, `GCP_KMS_*`, `APPLE_BUNDLE_ID`, `APPLE_ID_SALT`.

For deployment details, see [docs/DEPLOY.md](../docs/DEPLOY.md).

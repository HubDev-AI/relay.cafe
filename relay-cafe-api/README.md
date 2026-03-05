# relay-cafe-api

Backend API for [Relay.cafe](https://relay.cafe) — a daily anonymous message service.

Built with [Hono](https://hono.dev) + [Bun](https://bun.sh), using Drizzle ORM and GCP KMS envelope encryption.

## Prerequisites

- [Bun](https://bun.sh) (latest)
- [Docker](https://docs.docker.com/get-docker/) + Docker Compose
- GCP project with KMS enabled (see [KMS setup](../docs/kms-key-lifecycle.md))

## Quick Start

```bash
bun install
cp .env.example .env    # edit with your values
make dev                # start postgres + redis
make db-push            # push schema
make start              # start API server
```

## Docker Compose

The `docker-compose.yml` provides Postgres and Redis for local development.

```bash
# Start infra only (recommended — run API natively for fast iteration)
make dev

# Start full stack (postgres + redis + API in container)
make up

# Stop everything
make down

# View logs (optionally filter: make logs SVC=postgres)
make logs

# Remove containers, volumes, and images
make clean
```

When running `make dev`, the API connects to Postgres and Redis on localhost using the values in `.env`:
- `DATABASE_URL=postgres://relay:relay@localhost:5432/relaycafe`
- `REDIS_URL=redis://localhost:6379`

## Make Targets

| Target | Description |
|--------|-------------|
| `make dev` | Start postgres + redis (run API natively) |
| `make up` | Start full stack including API container |
| `make down` | Stop all services |
| `make logs` | Tail container logs |
| `make clean` | Remove containers, volumes, images |
| `make test` | Run tests (`bun test`) |
| `make db-push` | Push Drizzle schema to database |
| `make db-reset` | Delete messages + daily tokens |
| `make start` | Start API server natively |

## Database

```bash
make db-push            # push schema
make db-reset           # clear test data
```

## Test

```bash
make test
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

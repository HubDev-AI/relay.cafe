# Rate Limiting, Session Token Security & DNS Setup — Design

**Goal:** Add Redis-backed rate limiting (Upstash), harden session tokens with HMAC hashing, and configure Cloudflare DNS for GitHub Pages.

**Architecture:** Interface-based rate limiter (same pattern as shareal.ink) with Upstash cloud in production and local docker-compose proxy for dev. Session tokens changed from raw UUID to opaque random token with HMAC-SHA256 hash storage. Cloudflare proxies DNS for GitHub Pages with automatic SSL.

**Tech Stack:** @upstash/ratelimit, @upstash/redis, hiett/serverless-redis-http (local), node:crypto HMAC, Cloudflare DNS, Drizzle ORM migrations

---

## 1. Redis Rate Limiting

### Dependencies

- `@upstash/ratelimit` — sliding window rate limiter
- `@upstash/redis` — REST-based Redis client (works with Upstash cloud and local proxy)

### Architecture

Interface pattern from shareal.ink:

```
IRateLimiter interface
  ├── UpstashRateLimiter  (production + local docker)
  └── InMemoryRateLimiter (fallback when no Redis env vars)
```

Container picks implementation based on env vars:
- `UPSTASH_REDIS_REST_URL` set → UpstashRateLimiter
- Not set + production → InMemoryRateLimiter + console warning
- Not set + dev → InMemoryRateLimiter (silent)

### Rate Limit Tiers

| Tier | Routes | Limit | Window | Key |
|------|--------|-------|--------|-----|
| Global | All routes | 60 req | 1 min | IP hash |
| Auth | POST /auth/apple | 5 req | 1 hr | IP hash |
| Messages | POST /messages, GET /messages/today | 20 req | 1 min | IP hash |

Per-route limits stack with the global limit (both are checked).

### Response

429 status with `{ "error": "Please try again later." }` and `Retry-After` header (seconds until reset).

### New Files

- `src/lib/interfaces/rateLimiter.ts` — IRateLimiter interface
- `src/lib/adapters/upstashRateLimiter.ts` — Upstash implementation (3 limiter instances for 3 tiers)
- `src/lib/adapters/inMemoryRateLimiter.ts` — sliding window fallback
- `src/lib/container.ts` — DI wiring
- `docker-compose.yml` — local Redis + REST proxy

### Modified Files

- `src/middleware/rateLimit.ts` — rewrite to use IRateLimiter from container
- `src/app.ts` — global rate limit middleware
- `src/routes/auth.ts` — keep stricter auth limit
- `src/routes/messages.ts` — add messages tier limit
- `.env.example` — add UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN

### Local Development

docker-compose.yml at relay-cafe-api/:

```yaml
services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
  redis-rest:
    image: hiett/serverless-redis-http:latest
    ports:
      - "8079:80"
    environment:
      SRH_MODE: env
      SRH_TOKEN: local-token
      REDIS_URL: redis://redis:6379
```

Local .env:
```
UPSTASH_REDIS_REST_URL=http://localhost:8079
UPSTASH_REDIS_REST_TOKEN=local-token
```

### Cleanup

- Drop `ip_events` table (Drizzle migration)
- Remove `ipEvents` from schema.ts
- Old in-memory rateLimit.ts replaced entirely

---

## 2. Session Token Security

### Current State

Session token = `sessions.id` (UUID v4, 122 bits entropy). Client sends UUID directly. Auth middleware looks up by primary key. DB leak exposes usable tokens.

### New Design

Opaque random token with HMAC-SHA256 hash storage.

**Login flow:**
1. Generate `rawToken = crypto.randomBytes(32).toString('hex')` (64-char hex, 256 bits)
2. Compute `tokenHash = HMAC-SHA256(SESSION_SALT, rawToken)`
3. INSERT session with `token_hash = tokenHash`
4. Return `{ sessionToken: rawToken, expiresAt }` to client

**Auth middleware:**
1. Extract Bearer token
2. Validate format: `/^[0-9a-f]{64}$/`
3. Compute `tokenHash = HMAC-SHA256(SESSION_SALT, token)`
4. SELECT WHERE `token_hash = tokenHash` AND `expires_at > NOW()`

**Logout:** Hash incoming token, delete by `token_hash`.

### Schema Change

```sql
-- sessions table
ALTER TABLE sessions ADD COLUMN token_hash TEXT;
-- No live users, so we can immediately make it NOT NULL
ALTER TABLE sessions ALTER COLUMN token_hash SET NOT NULL;
CREATE UNIQUE INDEX sessions_token_hash_idx ON sessions(token_hash);
```

The `id` column (UUID) remains as internal PK. It is never sent to clients.

### Security Properties

- DB leak: hashes exposed, not usable tokens
- SESSION_SALT: server-side only, required to compute hashes
- Entropy: 256 bits (vs 122 for UUIDv4)
- Timing-safe comparison via constant-time HMAC recomputation

### Modified Files

- `src/db/schema.ts` — add `token_hash` column
- `src/routes/auth.ts` — generate random token, hash with SESSION_SALT, store hash
- `src/middleware/auth.ts` — hash incoming token, lookup by token_hash
- Drizzle migration for schema change

### iOS Impact

Minimal. Session token changes from 36-char UUID to 64-char hex string. Stored in Keychain as opaque string. No logic change needed.

### Startup Validation

SESSION_SALT validated at startup (fail-fast), same pattern as APPLE_ID_SALT.

---

## 3. DNS + GitHub Pages (Cloudflare)

### Setup

1. Add relay.cafe to Cloudflare (free plan)
2. DNS records (all proxied):
   - 4x A records: @ → 185.199.108-111.153
   - 1x CNAME: www → hubdev-ai.github.io
3. SSL/TLS mode: Full
4. Enable Always Use HTTPS
5. Change Namecheap nameservers to Cloudflare's
6. GitHub Pages: source = GitHub Actions, custom domain = relay.cafe

### Why Cloudflare

- Automatic SSL (no GitHub Pages certificate issues)
- CDN caching for static pages
- DDoS protection at DNS level
- Free tier is sufficient

### Existing Infrastructure

- `.github/workflows/deploy-site.yml` — already deployed to main
- `relay-cafe-site/CNAME` — contains `relay.cafe`
- CSP meta tags on all 3 HTML pages

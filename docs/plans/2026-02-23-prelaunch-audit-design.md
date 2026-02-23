# Pre-Launch Audit, Docs & Deployment — Design

**Date:** 2026-02-23
**Goal:** Get relay.cafe production-ready: security hardened, codebase clean, docs useful, landing page deployed.
**Approach:** Sequential — audit first, then code review/cleanup, then docs, then GH Pages.

---

## 1. Security Audit

Full-stack review: API, iOS client (surface-level), landing page.

### API

| Area | Files | What to check |
|------|-------|---------------|
| Auth flow | `routes/auth.ts`, `middleware/auth.ts`, `lib/appleAuth.ts` | Token validation, session management, Apple ID hash salting, Bearer token handling |
| Crypto | `lib/crypto.ts`, `lib/kms.ts` | AES-256-GCM correctness, IV generation (12-byte random), KMS envelope encryption, key wrapping |
| Input validation | `routes/messages.ts`, `routes/auth.ts` | Body parsing, text length limits, type checking, missing fields |
| Rate limiting | `middleware/rateLimit.ts` | In-memory store resets on deploy, IP hash collision, sweep correctness |
| Database | `db/index.ts`, `db/schema.ts` | Connection string handling, SQL injection surface via Drizzle, cascade behavior |
| Environment | `.env.example` vs code usage | Env var naming consistency (CLAUDE.md vs code), secrets exposure |
| Error handling | `lib/logger.ts`, `app.ts` | Error leakage in 500 responses, Sentry config |
| Deploy resilience | `lib/period.ts` | TOKEN_PERIOD_SECONDS change between deploys orphaning daily_tokens rows |

### iOS (surface-level)

- Auth token storage (Keychain vs UserDefaults)
- ATS / certificate pinning configuration
- Screenshot protection implementation

### Landing page

- Missing CSP / security headers (static HTML, no server)
- Meta tag information leakage
- Mixed content risks

### Deliverable

Findings report with severity ratings: Critical / High / Medium / Low / Info.

---

## 2. Code Review + Dead Code Cleanup

### Review focus

- Atomic token claiming correctness (`UPDATE ... WHERE sendUsed = false`)
- Transaction boundaries in receive flow (decrypt-then-delete)
- Error recovery (send/receive token rollback paths)
- Type safety — `c.get('userId') as string` without Hono typed context
- `@hono/node-server` usage — needed with Bun's native `Bun.serve()`?

### Dead code investigation

- `ipEvents` schema table — is it used anywhere? (rate limiter is in-memory)
- Unused imports/exports across 14 source files
- Test files referencing removed/changed APIs

### Cleanup

Remove confirmed dead code. Fix clear bugs found during review. No architectural changes.

---

## 3. Documentation

### `relay-cafe-api/README.md` — rewrite (lean)

- Project description (one paragraph)
- Prerequisites: Bun, Postgres, GCP KMS credentials
- Setup: clone, `bun install`, `.env` from `.env.example`, DB migration
- Running: `bun run src/index.ts`
- Testing: `bun test`
- API endpoints table (method, path, auth, description)

### `docs/DEPLOY.md` — new

- Railway setup for API
- Environment variables checklist
- Database provisioning
- GCP KMS setup: project, keyring, key, service account, rotation
- `TOKEN_PERIOD_SECONDS` deploy gotcha
- Health check endpoint

### `docs/kms-key-lifecycle.md` — review/update

Already exists. Verify accuracy against current code.

### `.env.example`

Ensure all env var names match actual code usage. Keep `SESSION_SALT` (planned use). Fix any naming discrepancies (e.g., CLAUDE.md says `KMS_LOCATION` but code uses `GCP_KMS_LOCATION`).

---

## 4. GitHub Pages Deployment

### `.github/workflows/deploy-site.yml`

- Trigger: push to `main` when `relay-cafe-site/**` changes + `workflow_dispatch`
- Action: `actions/deploy-pages` deploying `relay-cafe-site/` directory
- No build step (static files)

### `relay-cafe-site/CNAME`

Contains `relay.cafe`.

### Manual steps (documented in DEPLOY.md)

1. GitHub repo settings: enable Pages, source = GitHub Actions, custom domain = `relay.cafe`, enforce HTTPS
2. DNS records:
   - A records: 185.199.108.153, 185.199.109.153, 185.199.110.153, 185.199.111.153
   - CNAME: `www.relay.cafe` → `hubdev-ai.github.io`

---

## Execution Order

1. Security audit → findings report
2. Code review + dead code cleanup → commits
3. Documentation updates → commits
4. GitHub Pages action + CNAME → commit + PR

## Follow-up (post-audit, not in this session)

- Migrate rate limiting from in-memory to Redis

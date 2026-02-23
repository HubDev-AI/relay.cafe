# Pre-Launch Audit, Docs & Deployment — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Get relay.cafe production-ready: security audit with findings report, code review and dead code cleanup, lean documentation, and GitHub Pages deployment for the landing page.

**Architecture:** Sequential execution — security audit first (produces findings report), then code review/cleanup (informed by audit), then documentation, then GitHub Pages action. All work happens on a feature branch from `dev`, merged back via PR.

**Tech Stack:** Hono + Bun API, Drizzle ORM, GCP KMS, SwiftUI iOS client, static HTML/CSS landing page, GitHub Actions

---

## Task 1: Create Feature Branch

**Files:**
- None (git operation only)

**Step 1: Create branch from dev**

```bash
cd /Users/vladimirtrifonov/src/ai/relay.cafe
git checkout dev
git pull origin dev
git checkout -b feature/prelaunch-audit
```

**Step 2: Verify branch**

```bash
git branch --show-current
```

Expected: `feature/prelaunch-audit`

---

## Task 2: Security Audit — API Auth

**Files:**
- Read: `relay-cafe-api/src/routes/auth.ts`
- Read: `relay-cafe-api/src/middleware/auth.ts`
- Read: `relay-cafe-api/src/lib/appleAuth.ts`
- Create: `docs/SECURITY-AUDIT.md` (append findings as we go)

**Step 1: Audit auth.ts**

Review for:
- `APPLE_ID_SALT` — read from env at module top level, server crashes on startup if missing (good — fail-fast). But the salt is concatenated as `APPLE_ID_SALT + claims.sub` — check if this is vulnerable to length-extension or if HMAC would be safer.
- `body.identityToken` — checked for existence and string type (good).
- `body.deviceFingerprint` — accepted without validation, stored as-is. Check for XSS/injection (stored in DB, never rendered in HTML, so low risk).
- Session token = UUID of session row returned directly. No signing, no MAC. Acceptable for this app (opaque random token).
- Session expiry: 30 days hardcoded. Verify this is intentional.
- `DELETE /auth/session` — extracts sessionId from Authorization header via `slice(7)`. Relies on authMiddleware running first (it does — `authMiddleware` is applied). But the route only deletes the session matching the Bearer token, which is correct (user can only delete their own session).

**Step 2: Audit auth middleware**

Review for:
- UUID regex validation before DB query (good — prevents Postgres type errors).
- Session expiry check: `session.expiresAt < new Date()` — correct direction.
- No session refresh/sliding window — sessions expire after 30 days fixed. Fine for v1.
- `c.set('userId', session.userId)` — stores userId in Hono context. Type-safe? No — uses `as string` cast at consumption sites. Low risk (value comes from DB), but could use Hono's typed context.

**Step 3: Audit Apple auth verification**

Review for:
- Uses `jose` JWKS verification against Apple's endpoint (good).
- Validates `issuer` = `https://appleid.apple.com` (good).
- Validates `audience` = `process.env.APPLE_BUNDLE_ID` — but no startup check if this env var is missing. If undefined, `audience` verification is effectively skipped (jose may accept any audience). This is a **finding**.
- Returns `email` field from token — but it's never used anywhere. Not a security issue, just dead data.

**Step 4: Write initial findings to audit report**

Create `docs/SECURITY-AUDIT.md` with findings from this task. Include severity ratings.

Known findings so far:
- **HIGH**: `APPLE_BUNDLE_ID` env var has no startup validation — if missing, Apple token audience check may be bypassed
- **MEDIUM**: `APPLE_ID_SALT` uses simple concatenation (`salt + sub`) instead of HMAC. SHA-256 of concatenation is acceptable but HMAC is standard practice.
- **LOW**: `deviceFingerprint` accepted without length/format validation (stored in DB, never rendered)
- **INFO**: Session expiry hardcoded to 30 days — consider making configurable
- **INFO**: `email` field parsed from Apple token but never used

**Step 5: Commit**

```bash
git add docs/SECURITY-AUDIT.md
git commit -m "docs: start security audit — auth findings"
```

---

## Task 3: Security Audit — Crypto & KMS

**Files:**
- Read: `relay-cafe-api/src/lib/crypto.ts`
- Read: `relay-cafe-api/src/lib/kms.ts`
- Modify: `docs/SECURITY-AUDIT.md`

**Step 1: Audit crypto.ts**

Review for:
- AES-256-GCM with 12-byte random IV (correct per NIST SP 800-38D).
- Random key per message via `randomBytes(32)` (good).
- Auth tag stored prepended to ciphertext as `authTag + encrypted` (good — consistent format).
- `encryptMessage` and `decryptMessage` are symmetric — verify round-trip correctness.
- No key reuse concern (fresh key per message).

**Step 2: Audit kms.ts**

Review for:
- `keyName()` builds resource path from env vars — 4 env vars (`GCP_PROJECT_ID`, `GCP_KMS_LOCATION`, `GCP_KMS_KEY_RING`, `GCP_KMS_KEY_NAME`). None validated at startup. If any is undefined, the KMS call will fail with a confusing GCP error at runtime instead of a clear startup error.
- `wrapKey` returns `keyVersion: name` — this stores the CryptoKey name (not version), and `unwrapKey` uses it as the decrypt `name`. GCP resolves the correct version automatically from ciphertext metadata. This is correct.
- `result.ciphertext` and `result.plaintext` are cast as `Uint8Array` — this should be safe for GCP KMS client.
- No retry logic on KMS calls — if KMS is temporarily unavailable, the request fails. Acceptable for v1.

**Step 3: Append findings**

- **MEDIUM**: KMS env vars (`GCP_PROJECT_ID`, `GCP_KMS_LOCATION`, `GCP_KMS_KEY_RING`, `GCP_KMS_KEY_NAME`) have no startup validation — server starts successfully but fails on first encrypt/decrypt
- **INFO**: No KMS call retry — transient GCP failures cause 500s. Acceptable for v1.
- **INFO**: Crypto implementation follows NIST recommendations (AES-256-GCM, 12-byte IV, auth tag). No issues found.

**Step 4: Commit**

```bash
git add docs/SECURITY-AUDIT.md
git commit -m "docs: security audit — crypto & KMS findings"
```

---

## Task 4: Security Audit — Input Validation & Rate Limiting

**Files:**
- Read: `relay-cafe-api/src/routes/messages.ts`
- Read: `relay-cafe-api/src/middleware/rateLimit.ts`
- Modify: `docs/SECURITY-AUDIT.md`

**Step 1: Audit messages.ts input validation**

Review for:
- `POST /messages`: Checks `body.text` exists, is string, max 1000 chars. Good.
- But: no check for empty string (`""` passes `typeof === 'string'`). Could insert an empty encrypted message. Should check `body.text.length > 0`.
- No check for non-printable characters, null bytes, or excessively long Unicode (e.g., zalgo text). Low risk since messages are encrypted and never rendered server-side.
- `body.text.length` counts UTF-16 code units, not characters. A user sending 500 emoji (each 2 code units) would use 1000 of the limit. This is fine — it's how JavaScript `.length` works.

**Step 2: Audit rate limiting**

Review for:
- In-memory `Map` — resets on deploy/restart. An attacker could time attempts around deploys. **MEDIUM** finding.
- IP extraction: `X-Forwarded-For` first entry — relies on reverse proxy (Railway) to set this correctly. If no proxy, IP is `'unknown'` and all unauthenticated users share a rate limit bucket. Document this dependency.
- IP is SHA-256 hashed before use as key (good — no raw IPs in memory).
- Sweep interval: 60 seconds. Entries are cleaned up if `resetAt < now`. Correct.
- Rate limit only on `/auth/apple` (5 per hour). Authenticated endpoints have no rate limit beyond the daily token system. The daily token system itself is the rate limit.
- `setInterval(...).unref()` — good, won't keep the process alive.

**Step 3: Audit deploy resilience**

- `TOKEN_PERIOD_SECONDS` changing between deploys: If someone deploys with `300` (test mode) and then redeploys with `86400`, the period number changes dramatically. All existing `daily_tokens` rows become orphaned and everyone gets fresh tokens instantly. **MEDIUM** finding — document the gotcha, add a startup warning log if value differs from 86400.

**Step 4: Append findings**

- **MEDIUM**: Empty string `""` passes text validation — encrypted empty messages can be stored
- **MEDIUM**: In-memory rate limiter resets on every deploy/restart — planned Redis migration addresses this
- **MEDIUM**: `TOKEN_PERIOD_SECONDS` env var change between deploys silently resets all daily tokens
- **LOW**: Rate limit depends on `X-Forwarded-For` header from reverse proxy; direct access uses shared `'unknown'` bucket
- **INFO**: No rate limiting on authenticated endpoints (daily token system serves as natural rate limit)

**Step 5: Commit**

```bash
git add docs/SECURITY-AUDIT.md
git commit -m "docs: security audit — validation & rate limiting findings"
```

---

## Task 5: Security Audit — Database & Environment

**Files:**
- Read: `relay-cafe-api/src/db/index.ts`
- Read: `relay-cafe-api/src/db/schema.ts`
- Read: `relay-cafe-api/.env.example`
- Read: `relay-cafe-api/.gitignore` (repo root)
- Modify: `docs/SECURITY-AUDIT.md`

**Step 1: Audit database setup**

Review for:
- Connection string from env — `TEST_DATABASE_URL || DATABASE_URL`. Startup fails if both missing (good).
- No connection pool configuration — `postgres` driver defaults. Fine for low-traffic v1.
- No SSL/TLS enforcement on DB connection. Railway Postgres uses TLS by default, but it's not enforced in code. Consider `?sslmode=require` in production connection string.
- Drizzle ORM queries are parameterized (safe from SQL injection). Raw SQL in `messages.ts` (`sql` template tag) is also parameterized.
- CASCADE on delete for sessions and dailyTokens (correct — account deletion cleans up).

**Step 2: Audit environment handling**

- `.env` and `.env.test` are in `.gitignore` (via `relay-cafe-api/.env` in root `.gitignore`). Good.
- `gcp-credentials.json` is in `.gitignore`. Good.
- `.env.example` contains placeholder values, no real secrets. Good.
- CLAUDE.md documents env vars with outdated names (`KMS_LOCATION` vs `GCP_KMS_LOCATION`). Not a security issue but a documentation bug.

**Step 3: Append findings**

- **LOW**: No SSL enforcement on Postgres connection string — Railway handles this, but explicit `?sslmode=require` is safer
- **LOW**: `.env.test` exists but is not in `.gitignore` patterns explicitly — currently covered by relay-cafe-api/.env matching. Verify.
- **INFO**: CLAUDE.md has outdated env var names — will fix in docs task

**Step 4: Commit**

```bash
git add docs/SECURITY-AUDIT.md
git commit -m "docs: security audit — database & environment findings"
```

---

## Task 6: Security Audit — iOS Client Surface Review

**Files:**
- Read: `relay-cafe-ios/RelayCafe/Services/APIClient.swift`
- Read: `relay-cafe-ios/RelayCafe/Services/KeychainManager.swift`
- Read: `relay-cafe-ios/RelayCafe/Info.plist`
- Read: `relay-cafe-ios/RelayCafe/RelayCafe.entitlements`
- Modify: `docs/SECURITY-AUDIT.md`

**Step 1: Audit APIClient.swift**

Review for:
- Session token stored via KeychainManager (good — not UserDefaults).
- Token expiry checked before each request: `expiresAt <= Date()` (good).
- `clearTokenSync()` uses fire-and-forget `Task` from `nonisolated` context — race condition possible where a request reads the token between `clearTokenSync` call and actual keychain deletion. Very low risk (only called on sign-out path).
- Uses `URLSession.shared` — no custom TLS configuration, no certificate pinning. Relies on iOS ATS for TLS enforcement. Acceptable for v1 but certificate pinning is recommended before handling sensitive financial data.
- `#if DEBUG` uses `http://localhost:3000` — ATS exception in Info.plist (`NSAllowsLocalNetworking = true`) covers this. In production (non-DEBUG), uses `https://api.relay.cafe`. Good.

**Step 2: Audit KeychainManager.swift**

Review for:
- Uses `kSecClassGenericPassword` — correct for storing session tokens.
- No `kSecAttrAccessible` specified — defaults to `kSecAttrAccessibleWhenUnlocked`. This means keychain items are accessible whenever the device is unlocked. For higher security, could use `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` to prevent iCloud Keychain sync.
- No access control (`kSecAttrAccessControl`) — no biometric/passcode requirement to access the token. Acceptable for session tokens.
- Save method does delete-then-insert (not upsert). Race condition if called concurrently — mitigated by `actor APIClient` serialization.

**Step 3: Audit Info.plist & entitlements**

- `NSAllowsLocalNetworking = true` under `NSAppTransportSecurity` — allows HTTP for local development. This is fine — it only affects localhost/LAN, not internet connections.
- No other ATS exceptions — all internet traffic requires HTTPS (good).
- `NSFaceIDUsageDescription` present — but FaceID isn't used for keychain access (no `kSecAttrAccessControl`). Harmless but misleading.
- Portrait only on iPhone, all orientations on iPad. Fine.
- Sign in with Apple entitlement present. Good.

**Step 4: Append findings**

- **LOW**: Keychain items don't specify `kSecAttrAccessible` — consider `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` to prevent iCloud Keychain sync of session tokens
- **LOW**: No certificate pinning — acceptable for v1 but recommended for production
- **INFO**: `NSFaceIDUsageDescription` in Info.plist but FaceID not used for keychain access
- **INFO**: `clearTokenSync()` fire-and-forget Task has theoretical race window — mitigated by `actor` serialization

**Step 5: Commit**

```bash
git add docs/SECURITY-AUDIT.md
git commit -m "docs: security audit — iOS client findings"
```

---

## Task 7: Security Audit — Landing Page

**Files:**
- Read: `relay-cafe-site/index.html`
- Read: `relay-cafe-site/privacy.html`
- Read: `relay-cafe-site/terms.html`
- Modify: `docs/SECURITY-AUDIT.md`

**Step 1: Audit HTML files**

Review for:
- No JavaScript on any page — no XSS surface (good).
- No forms — no CSRF surface (good).
- No external scripts or third-party resources loaded (good).
- All links are relative (`privacy.html`, `terms.html`) or `mailto:` — no open redirect risk.
- Structured data (`application/ld+json`) contains only public info — no leaks.
- `og-image.png` referenced — verify it exists and contains no sensitive metadata.
- Email address `relay.cafe@pm.me` is public (in footer and legal pages) — intentional.

**Step 2: Audit meta tags**

- Canonical URLs use `https://relay.cafe/` — correct for production.
- `robots.txt` allows all — fine for a public landing page.
- No CSP headers in HTML — GitHub Pages doesn't support custom response headers natively. Could add `<meta http-equiv="Content-Security-Policy">` tag.

**Step 3: Append final findings**

- **LOW**: No Content-Security-Policy — add `<meta>` CSP tag to restrict sources to `'self'`
- **INFO**: No external scripts/resources — minimal attack surface
- **INFO**: All pages pass basic security review

**Step 4: Write audit summary**

Add a summary section to `docs/SECURITY-AUDIT.md` with:
- Total findings by severity
- Recommended priority fixes (HIGH items)
- Items deferred to post-launch (LOW/INFO)

**Step 5: Commit**

```bash
git add docs/SECURITY-AUDIT.md
git commit -m "docs: security audit complete — landing page + summary"
```

---

## Task 8: Code Review — Fix HIGH/MEDIUM Audit Findings

**Files:**
- Modify: `relay-cafe-api/src/lib/appleAuth.ts` (add APPLE_BUNDLE_ID validation)
- Modify: `relay-cafe-api/src/lib/kms.ts` (add env var validation)
- Modify: `relay-cafe-api/src/routes/messages.ts` (fix empty string validation)

**Step 1: Fix APPLE_BUNDLE_ID startup validation**

In `relay-cafe-api/src/lib/appleAuth.ts`, add at the top (after imports):

```typescript
const APPLE_BUNDLE_ID = process.env.APPLE_BUNDLE_ID
if (!APPLE_BUNDLE_ID) {
  throw new Error('APPLE_BUNDLE_ID environment variable is required')
}
```

Then change the `audience` reference to use the constant:

```typescript
audience: APPLE_BUNDLE_ID,
```

**Step 2: Fix KMS env var startup validation**

In `relay-cafe-api/src/lib/kms.ts`, add after imports:

```typescript
const GCP_PROJECT_ID = process.env.GCP_PROJECT_ID
const GCP_KMS_LOCATION = process.env.GCP_KMS_LOCATION
const GCP_KMS_KEY_RING = process.env.GCP_KMS_KEY_RING
const GCP_KMS_KEY_NAME = process.env.GCP_KMS_KEY_NAME

if (!GCP_PROJECT_ID || !GCP_KMS_LOCATION || !GCP_KMS_KEY_RING || !GCP_KMS_KEY_NAME) {
  throw new Error('GCP_PROJECT_ID, GCP_KMS_LOCATION, GCP_KMS_KEY_RING, GCP_KMS_KEY_NAME environment variables are required')
}
```

Update `keyName()` to use the constants instead of `process.env.*`.

**Step 3: Fix empty message validation**

In `relay-cafe-api/src/routes/messages.ts`, change the text validation:

```typescript
// Before:
if (!body?.text || typeof body.text !== 'string') {

// After (also catches empty string):
if (!body?.text || typeof body.text !== 'string' || body.text.trim().length === 0) {
```

**Step 4: Run tests**

```bash
cd /Users/vladimirtrifonov/src/ai/relay.cafe/relay-cafe-api
bun test
```

Expected: All tests pass (or existing failures unrelated to our changes).

**Step 5: Commit**

```bash
git add relay-cafe-api/src/lib/appleAuth.ts relay-cafe-api/src/lib/kms.ts relay-cafe-api/src/routes/messages.ts
git commit -m "fix: add startup env validation and empty message check (audit findings)"
```

---

## Task 9: Code Review — Dead Code Cleanup

**Files:**
- Modify: `relay-cafe-api/src/db/schema.ts` (investigate ipEvents)
- Check: all `src/` files for unused imports

**Step 1: Investigate ipEvents table**

The `ipEvents` table is defined in schema but never imported or used outside `schema.ts`. The rate limiter uses an in-memory `Map` instead. Since the user plans to move to Redis (not DB-based) rate limiting, this table is dead code.

Ask user: Should `ipEvents` be removed from the schema? If it's already in the production database, we'd also need a migration to drop it. If it was never migrated to production, just remove from schema.

For now: add a `// TODO: remove if unused after Redis rate limiting migration` comment. Do not remove without user confirmation since this may require a DB migration.

**Step 2: Check for unused imports**

Scan all `src/` files for imports that aren't used. Use grep/read to verify each.

Known check: `relay-cafe-api/src/db/schema.ts` exports `ipEvents` — verify no other file imports it.

**Step 3: Commit if changes made**

```bash
git add -A relay-cafe-api/src/
git commit -m "chore: annotate dead code, clean unused imports"
```

---

## Task 10: Documentation — Update API README

**Files:**
- Modify: `relay-cafe-api/README.md`

**Step 1: Rewrite README**

Replace the boilerplate with:

```markdown
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
```

**Step 2: Commit**

```bash
git add relay-cafe-api/README.md
git commit -m "docs: rewrite API README with setup, endpoints, and env reference"
```

---

## Task 11: Documentation — Create Deploy Guide

**Files:**
- Create: `docs/DEPLOY.md`

**Step 1: Write deployment guide**

```markdown
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
5. Verify: `curl https://api.relay.cafe/health` → `{"ok":true}`

### Health Check

`GET /health` — returns `{"ok":true}` if the database is reachable, `{"ok":false,"db":"unreachable"}` with 503 otherwise.

## GCP KMS Setup

See [kms-key-lifecycle.md](kms-key-lifecycle.md) for full details.

Quick setup:

```bash
# Set env vars
export GCP_PROJECT_ID=your-project
export GCP_KMS_LOCATION=global
export GCP_KMS_KEY_RING=relay-cafe
export GCP_KMS_KEY_NAME=message-key

# Run setup script
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

1. Settings → Pages → Source: GitHub Actions
2. Settings → Pages → Custom domain: `relay.cafe`
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
```

**Step 2: Commit**

```bash
git add docs/DEPLOY.md
git commit -m "docs: add deployment guide with Railway, KMS, DNS, and gotchas"
```

---

## Task 12: Documentation — Update CLAUDE.md Env Var Names

**Files:**
- Modify: `/Users/vladimirtrifonov/src/ai/relay.cafe/.claude/CLAUDE.md`

**Step 1: Fix env var names**

The CLAUDE.md says:
```
KMS_LOCATION=
KMS_KEYRING=
KMS_KEY=
```

But code uses:
```
GCP_KMS_LOCATION=
GCP_KMS_KEY_RING=
GCP_KMS_KEY_NAME=
```

Update the Environment Variables section in CLAUDE.md to match actual usage. Also add the missing env vars (`APPLE_BUNDLE_ID`, `APPLE_ID_SALT`, `GOOGLE_APPLICATION_CREDENTIALS`, `SENTRY_DSN`).

**Step 2: Commit**

```bash
git add .claude/CLAUDE.md
git commit -m "docs: fix env var names in CLAUDE.md to match code"
```

---

## Task 13: Documentation — Review kms-key-lifecycle.md

**Files:**
- Read: `docs/kms-key-lifecycle.md`

**Step 1: Verify accuracy**

Compare the documented parameters, states, and scripts against actual code:
- `scripts/setup-kms.sh` and `scripts/cleanup-kms-versions.ts` — verify they exist and match descriptions
- Verify the 50h threshold, 24h rotation, and destroy-scheduled-duration values

**Step 2: Fix any stale content if found**

If the doc is accurate, no changes needed. If any values are stale, update them.

**Step 3: Commit if changed**

```bash
git add docs/kms-key-lifecycle.md
git commit -m "docs: update KMS key lifecycle if stale"
```

---

## Task 14: GitHub Pages — Create Workflow

**Files:**
- Create: `.github/workflows/deploy-site.yml`

**Step 1: Create workflow directory**

```bash
mkdir -p /Users/vladimirtrifonov/src/ai/relay.cafe/.github/workflows
```

**Step 2: Write workflow file**

```yaml
name: Deploy Landing Page

on:
  push:
    branches: [main]
    paths:
      - 'relay-cafe-site/**'
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/configure-pages@v5

      - uses: actions/upload-pages-artifact@v3
        with:
          path: relay-cafe-site

      - id: deployment
        uses: actions/deploy-pages@v4
```

**Step 3: Commit**

```bash
git add .github/workflows/deploy-site.yml
git commit -m "ci: add GitHub Actions workflow for landing page deployment"
```

---

## Task 15: GitHub Pages — Add CNAME

**Files:**
- Create: `relay-cafe-site/CNAME`

**Step 1: Create CNAME file**

```
relay.cafe
```

Single line, no trailing newline.

**Step 2: Commit**

```bash
git add relay-cafe-site/CNAME
git commit -m "ci: add CNAME for relay.cafe custom domain"
```

---

## Task 16: Landing Page — Add CSP Meta Tag

**Files:**
- Modify: `relay-cafe-site/index.html`
- Modify: `relay-cafe-site/privacy.html`
- Modify: `relay-cafe-site/terms.html`

**Step 1: Add CSP meta tag to all HTML files**

Add inside `<head>` (after `<meta charset>`):

```html
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self'; img-src 'self'; font-src 'self'; base-uri 'self'; form-action 'none'">
```

This restricts all resource loading to the same origin and blocks forms, scripts, and external content.

**Step 2: Verify pages still render**

Open each HTML file in a browser and confirm styles and images load correctly.

**Step 3: Commit**

```bash
git add relay-cafe-site/index.html relay-cafe-site/privacy.html relay-cafe-site/terms.html
git commit -m "security: add Content-Security-Policy meta tags to landing pages"
```

---

## Task 17: Final Review & PR

**Files:**
- None (git operations)

**Step 1: Review all changes**

```bash
cd /Users/vladimirtrifonov/src/ai/relay.cafe
git log --oneline feature/prelaunch-audit..HEAD
git diff dev...HEAD --stat
```

**Step 2: Push and create PR**

```bash
git push -u origin feature/prelaunch-audit
gh pr create --base dev --title "Pre-launch: security audit, code cleanup, docs, GH Pages" --body "$(cat <<'EOF'
## Summary

- Security audit of API, iOS client, and landing page (see docs/SECURITY-AUDIT.md)
- Fixed HIGH/MEDIUM findings: env var startup validation, empty message check
- Rewrote API README with setup, endpoints, and env reference
- Added deployment guide (docs/DEPLOY.md)
- Updated CLAUDE.md env var names to match code
- Added GitHub Actions workflow for landing page deployment to GitHub Pages
- Added CNAME for relay.cafe custom domain
- Added Content-Security-Policy meta tags to all landing pages
- Annotated dead code (ipEvents table)

## Test plan

- [ ] Verify `bun test` passes
- [ ] Verify landing pages render with CSP tags (open index.html locally)
- [ ] After merge to main: verify GitHub Pages deployment triggers
- [ ] Configure DNS records per docs/DEPLOY.md
- [ ] Verify https://relay.cafe loads after DNS propagation

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**Step 3: Return PR URL**

---

## Execution Summary

| Task | Description | Estimated |
|------|-------------|-----------|
| 1 | Create feature branch | 1 min |
| 2-7 | Security audit (6 tasks) | Audit report |
| 8 | Fix HIGH/MEDIUM findings | Code changes |
| 9 | Dead code cleanup | Code changes |
| 10 | Rewrite API README | Docs |
| 11 | Create DEPLOY.md | Docs |
| 12 | Fix CLAUDE.md env vars | Docs |
| 13 | Review KMS lifecycle doc | Docs |
| 14-15 | GitHub Pages workflow + CNAME | CI/CD |
| 16 | CSP meta tags | Security |
| 17 | Final review & PR | Git |

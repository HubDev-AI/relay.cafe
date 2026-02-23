# Security Audit — relay.cafe

**Date:** 2026-02-23
**Scope:** API (Hono+Bun), iOS client (surface), Landing page (static HTML)
**Auditor:** Automated (Claude Code)
**Commit:** `405152d` (branch `dev`)

## Summary

| Severity | Count |
|----------|-------|
| HIGH     | 1     |
| MEDIUM   | 6     |
| LOW      | 7     |
| INFO     | 5     |

**Total findings: 19**

### Priority Actions (pre-launch)

1. **[HIGH] F-01** -- Validate `APPLE_BUNDLE_ID` at startup; missing value may bypass JWT audience verification.
2. **[MEDIUM] F-02** -- Switch Apple ID hashing from `salt + sub` concatenation to HMAC-SHA256.
3. **[MEDIUM] F-03** -- Validate all KMS environment variables at startup.
4. **[MEDIUM] F-04** -- Reject empty / whitespace-only message text.
5. **[MEDIUM] F-07** -- Add security response headers to the API (HSTS, X-Content-Type-Options, etc.).

### Deferred (post-launch acceptable)

- **[MEDIUM] F-05** -- Move rate limiter to Redis for multi-instance persistence.
- **[MEDIUM] F-06** -- Document `TOKEN_PERIOD_SECONDS` operational constraints.
- **[LOW] F-08 through F-14** -- Device fingerprint validation, X-Forwarded-For trust, SSL enforcement, Keychain accessibility, cert pinning, CSP headers, session cleanup.
- **[INFO] F-15 through F-19** -- Session hardcode, unused email field, unused FaceID plist key, unused SESSION_SALT env var, userId in Sentry context.

---

## Findings

### Authentication and Authorization

#### [HIGH] F-01: APPLE_BUNDLE_ID has no startup validation -- audience check may be bypassed

**Location:** `relay-cafe-api/src/lib/appleAuth.ts:15`
**Description:** The `APPLE_BUNDLE_ID` environment variable is read directly from `process.env` at call time with no startup guard. If the variable is missing or empty, `audience` is `undefined`. The `jose` library's `jwtVerify` function, when `audience` is `undefined`, skips the audience claim verification entirely. Any valid Apple-issued JWT (for any app) would be accepted.
**Risk:** An attacker could use a valid Apple identity token from a different application to authenticate as that user in relay.cafe.
**Recommendation:** Add a startup assertion at module load time, consistent with how `APPLE_ID_SALT` is validated in `auth.ts`.

---

#### [MEDIUM] F-02: Apple ID hashing uses simple concatenation instead of HMAC

**Location:** `relay-cafe-api/src/routes/auth.ts:35-37`
**Description:** The Apple `sub` claim is hashed using SHA-256 with simple string concatenation (`salt + sub`). The standard construction for keyed hashing is HMAC. While exploitability is limited because Apple `sub` values have a fixed format, this is a cryptographic best-practice violation.
**Risk:** If the salt were ever short or predictable, ambiguity attacks could be engineered.
**Recommendation:** Replace with `createHmac('sha256', APPLE_ID_SALT).update(claims.sub).digest('hex')`. Note: This is a breaking change that invalidates existing `apple_id_hash` values.

---

### Environment and Configuration

#### [MEDIUM] F-03: KMS environment variables have no startup validation

**Location:** `relay-cafe-api/src/lib/kms.ts:8-15`
**Description:** Four KMS-related environment variables are read lazily at function call time. If any are missing, the server starts successfully but every encrypt/decrypt call fails with a cryptic GCP API error. The `/health` endpoint still passes since it only checks the database.
**Risk:** A misconfigured deployment appears healthy but all message operations fail.
**Recommendation:** Add startup assertions for all four KMS env vars.

---

#### [MEDIUM] F-06: TOKEN_PERIOD_SECONDS change between deploys silently resets all daily tokens

**Location:** `relay-cafe-api/src/lib/period.ts:20-23`
**Description:** Changing `TOKEN_PERIOD_SECONDS` between deploys (e.g., from a testing value of 300 back to production 86400) produces a completely different period number. All users immediately get fresh send/receive tokens.
**Risk:** Operational error could grant all users extra tokens, violating the one-send/one-receive-per-day invariant.
**Recommendation:** Document as critical operational constraint. Log the active `TOKEN_PERIOD_SECONDS` at startup.

---

### Input Validation

#### [MEDIUM] F-04: Whitespace-only string passes text validation in POST /messages

**Location:** `relay-cafe-api/src/routes/messages.ts:15-16`
**Description:** A string consisting only of whitespace (e.g., `" "`, `"\n"`) passes the truthiness check and gets encrypted and stored. A recipient would receive a blank message, consuming their daily receive token.
**Risk:** Resource abuse -- users can waste other users' daily receive tokens.
**Recommendation:** Add `text.trim().length === 0` check.

---

#### [LOW] F-08: deviceFingerprint accepted without length or format validation

**Location:** `relay-cafe-api/src/routes/auth.ts:53`
**Description:** The `deviceFingerprint` field is stored directly with no length validation. An attacker could submit an arbitrarily large string.
**Risk:** Low -- requires a valid Apple identity token. Could be used for database bloat.
**Recommendation:** Validate max length (e.g., 256 characters).

---

### Rate Limiting and Abuse Prevention

#### [MEDIUM] F-05: In-memory rate limiter resets on every deploy/restart

**Location:** `relay-cafe-api/src/middleware/rateLimit.ts:5`
**Description:** The rate limiter uses an in-memory `Map` lost on every server restart. On Railway, rate limit state resets each deployment.
**Risk:** Attacker can bypass rate limits by waiting for a deployment.
**Recommendation:** Acceptable for launch. Post-launch, migrate to Redis-backed rate limiting.

---

#### [LOW] F-09: Rate limit depends on X-Forwarded-For -- direct access shares a single bucket

**Location:** `relay-cafe-api/src/middleware/rateLimit.ts:25`
**Description:** When `X-Forwarded-For` is absent, all requests share the single `'unknown'` bucket. The header can also be spoofed if the server is not behind a trusted proxy.
**Risk:** Rate limit bypass via header spoofing or shared bucket.
**Recommendation:** Ensure Railway's proxy sets `X-Forwarded-For` (it does by default).

---

### API Security Headers

#### [MEDIUM] F-07: No security response headers on API responses

**Location:** `relay-cafe-api/src/app.ts`
**Description:** The API does not set HSTS, X-Content-Type-Options, X-Frame-Options, or Cache-Control headers. Without HSTS, SSL stripping is possible. Without Cache-Control: no-store, proxies could cache authenticated responses containing decrypted messages.
**Risk:** Man-in-the-middle downgrade; proxy caching of sensitive responses.
**Recommendation:** Add global security headers middleware.

---

### Database Security

#### [LOW] F-10: No SSL enforcement on Postgres connection string

**Location:** `relay-cafe-api/src/db/index.ts:10`
**Description:** The database connection is created with no explicit SSL configuration. Railway managed Postgres supports SSL but it's not enforced in code.
**Risk:** Credentials and data could transit in plaintext if misconfigured.
**Recommendation:** Add `?sslmode=require` to connection string or pass `{ ssl: 'require' }`.

---

#### [LOW] F-14: No cleanup job for expired sessions

**Location:** `relay-cafe-api/drizzle/pg_cron_setup.sql`
**Description:** pg_cron only cleans up expired messages. Expired sessions (30-day TTL) accumulate indefinitely.
**Risk:** Unbounded session table growth degrades query performance over time.
**Recommendation:** Add a pg_cron job: `DELETE FROM sessions WHERE expires_at <= NOW()`.

---

### iOS Client Security

#### [LOW] F-11: Keychain items do not specify kSecAttrAccessible

**Location:** `relay-cafe-ios/RelayCafe/Services/KeychainManager.swift:12-15`
**Description:** Keychain items are saved without `kSecAttrAccessible`. Default is `kSecAttrAccessibleWhenUnlocked`, which includes items in unencrypted iTunes backups.
**Risk:** Session tokens could be extracted from an unencrypted device backup.
**Recommendation:** Use `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`.

---

#### [LOW] F-12: No certificate pinning in iOS client

**Location:** `relay-cafe-ios/RelayCafe/Services/APIClient.swift:136`
**Description:** Uses `URLSession.shared` without certificate pinning. Any valid CA-signed certificate for `api.relay.cafe` is trusted.
**Risk:** Sophisticated MITM with compromised CA could intercept traffic.
**Recommendation:** Defer to post-launch. Consider Apple's `NSPinnedDomains` in Info.plist.

---

### Landing Page

#### [LOW] F-13: No Content-Security-Policy on landing pages

**Location:** `relay-cafe-site/index.html`, `privacy.html`, `terms.html`
**Description:** No CSP meta tags. Pages have no JavaScript and no user input, so XSS risk is near zero.
**Risk:** Minimal for static content. Defense-in-depth measure.
**Recommendation:** Add `<meta http-equiv="Content-Security-Policy">` tag.

---

### Informational Findings

#### [INFO] F-15: Session expiry hardcoded to 30 days

**Location:** `relay-cafe-api/src/routes/auth.ts:47`
**Description:** Session lifetime is hardcoded. No session refresh/rotation mechanism. Acceptable for v1.

#### [INFO] F-16: email field from Apple token parsed but never used

**Location:** `relay-cafe-api/src/lib/appleAuth.ts:22`
**Description:** `email` is extracted from Apple's identity token but never used. Unnecessary PII processing.

#### [INFO] F-17: NSFaceIDUsageDescription in Info.plist but FaceID not used

**Location:** `relay-cafe-ios/RelayCafe/Info.plist:21-22`
**Description:** Vestigial plist key. App Review may question the declaration.

#### [INFO] F-18: SESSION_SALT defined in .env.example but not yet used in code

**Location:** `relay-cafe-api/.env.example:8`
**Description:** No code references `process.env.SESSION_SALT`. Reserved for future use.

#### [INFO] F-19: userId included in Sentry error context

**Location:** `relay-cafe-api/src/routes/messages.ts:68`
**Description:** Internal UUID sent to Sentry. Minimal risk since it's opaque.

---

## Positive Findings

1. **Cryptography (AES-256-GCM + KMS envelope encryption):** Correctly uses 12-byte random IVs, 32-byte random DEKs, proper authTag handling, and GCP KMS for key wrapping. Follows NIST SP 800-38D.
2. **TOCTOU prevention on token claiming:** Atomic `UPDATE ... WHERE used = false` with `.returning()` correctly prevents race conditions.
3. **Message locking with FOR UPDATE SKIP LOCKED:** Prevents two concurrent receivers from decrypting the same message.
4. **Transaction rollback on failure:** Both send and receive paths roll back the daily token if encryption/decryption/KMS fails.
5. **Auth middleware UUID validation:** Validates bearer token format before querying the database.
6. **Apple JWKS remote key set:** Correctly uses `createRemoteJWKSet` from `jose` with automatic key rotation handling.
7. **Cascading foreign keys:** `ON DELETE CASCADE` for sessions and daily_tokens ensures clean account deletion.
8. **ATS configuration (iOS):** Only `NSAllowsLocalNetworking` for debug; production HTTPS enforced.
9. **pg_cron message cleanup:** Expired messages purged every 5 minutes with an index on `expires_at`.
10. **Error handler does not leak internals:** Generic error messages in all responses; no stack traces exposed.

---

## Risk Matrix

| ID    | Severity | Exploitability | Impact   | Component        | Status       |
|-------|----------|----------------|----------|------------------|--------------|
| F-01  | HIGH     | Medium         | High     | Auth (Apple JWT) | Fix pre-launch |
| F-02  | MEDIUM   | Low            | Medium   | Auth (hashing)   | Fix pre-launch |
| F-03  | MEDIUM   | N/A (config)   | High     | KMS              | Fix pre-launch |
| F-04  | MEDIUM   | High           | Low      | Messages         | Fix pre-launch |
| F-05  | MEDIUM   | Medium         | Medium   | Rate limiting    | Accept for launch |
| F-06  | MEDIUM   | N/A (ops)      | Medium   | Token period     | Document |
| F-07  | MEDIUM   | Low            | Medium   | API headers      | Fix pre-launch |
| F-08  | LOW      | Low            | Low      | Auth (input)     | Fix pre-launch |
| F-09  | LOW      | Medium         | Low      | Rate limiting    | Accept for launch |
| F-10  | LOW      | Low            | Medium   | Database         | Verify config |
| F-11  | LOW      | Low            | Low      | iOS Keychain     | Fix post-launch |
| F-12  | LOW      | Very Low       | Medium   | iOS networking   | Defer |
| F-13  | LOW      | Very Low       | Low      | Landing page     | Fix pre-launch |
| F-14  | LOW      | N/A            | Low      | Database         | Fix post-launch |
| F-15  | INFO     | N/A            | N/A      | Auth (config)    | Document |
| F-16  | INFO     | N/A            | N/A      | Auth (PII)       | Clean up |
| F-17  | INFO     | N/A            | N/A      | iOS (plist)      | Clean up |
| F-18  | INFO     | N/A            | N/A      | Config           | Planned use |
| F-19  | INFO     | N/A            | N/A      | Logging          | Document |

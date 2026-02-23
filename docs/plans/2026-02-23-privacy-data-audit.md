# Relay.cafe — Privacy & Data Collection Audit

**Date:** 2026-02-23
**Scope:** Full codebase (relay-cafe-api + relay-cafe-ios)
**Purpose:** App Store Privacy disclosure accuracy

---

## 1. Apple Sign-In

| Question | Answer | Evidence |
|----------|--------|----------|
| Store Apple email? | **No** | `appleAuth.ts:27` returns `email` from JWT payload but `auth.ts:37-39` only uses `claims.sub` to create `appleIdHash`. Email is never read or stored. |
| Store Apple full name? | **No** | `SignInView.swift:46` sets `requestedScopes = []` — name is never requested from Apple. |
| Persist raw Apple identity token? | **No** | Token is verified in-memory (`appleAuth.ts:18`), sub extracted, token discarded. Never written to DB. |
| Store only hashed Apple sub? | **Yes** | `auth.ts:37-39`: `sha256(APPLE_ID_SALT + claims.sub)` stored as `apple_id_hash` in `users` table. |

## 2. User Identifiers

| Identifier | Stored Where | Linked to User | Logged |
|-----------|-------------|----------------|--------|
| `apple_id_hash` (SHA-256 of salted Apple sub) | `users.apple_id_hash` (DB) | Yes — is the user identity | No |
| User UUID | `users.id` (DB) | Yes — primary key | Sent to Sentry as `extra.userId` on message errors |
| Session token (random 32 bytes hex) | Client-side Keychain only. Server stores `HMAC-SHA256(token, SESSION_SALT)` in `sessions.token_hash` | Yes — linked via `sessions.user_id` | No |
| Device fingerprint | `sessions.device_fingerprint` (DB) | Yes — linked to session/user | No |
| `identifierForVendor` | Used in-memory on iOS to compute fingerprint hash. Not stored raw. | Indirectly (hashed into fingerprint) | No |

**Device fingerprint details** (`SignInView.swift:85-93`): `SHA256(identifierForVendor + "-" + systemVersion)`. The raw vendor ID and OS version are never transmitted — only the hash.

## 3. Message Data

| Question | Answer | Evidence |
|----------|--------|----------|
| Stored in plaintext? | **No** | `messages.ts:54`: `encryptMessage(body.text)` via AES-256-GCM. DB stores `ciphertext`, `encrypted_message_key`, `kms_key_version`, `iv`. Plaintext exists only in request memory. |
| Decrypted messages logged? | **No** | `messages.ts:143`: decrypted text returned in response JSON, never passed to `console.log` or `captureError`. |
| Stored temporarily in memory only? | **Yes** | Plaintext exists only during request handler execution. On send: received as `body.text`, encrypted immediately. On receive: decrypted in-memory, returned in response, then hard-deleted from DB (`messages.ts:146`). |
| Message content in logs/error tracking? | **No** | `captureError` calls pass only `{ route, action, userId }` — never message text. No `console.log` contains message content. |

## 4. IP Address Handling

| Question | Answer | Evidence |
|----------|--------|----------|
| Logged? | **No** | No `console.log` or `captureError` call includes IP. |
| Stored in DB? | **No** | No column in any table stores IP addresses. |
| Used at all? | **Yes, transiently** | `rateLimit.ts:7-8`: IP extracted from `X-Forwarded-For`, immediately SHA-256 hashed, used as in-memory rate limit key. Raw IP is never stored. |
| Retained long-term? | **No** | In-memory rate limiter (`inMemoryRateLimiter.ts:20-28`): cleanup runs every 120s, evicts entries older than 1h. Upstash: sliding window TTLs (60s–3600s). Hashed IP only, not raw. |

## 5. Sentry Integration

| Question | Answer | Evidence |
|----------|--------|----------|
| Capturing request bodies? | **No** | `logger.ts:6`: `Sentry.init({ dsn })` — bare minimum config, no `integrations`, no `beforeSend`, no request body capture. |
| Capturing headers? | **Default Bun SDK behavior** | `@sentry/bun` may auto-capture some request metadata. No explicit header capture configured. |
| Capturing Authorization tokens? | **Not explicitly** | No code passes auth tokens to Sentry. Default SDK scrubs `Authorization` header. |
| Capturing message text? | **No** | `captureError` only passes `{ route, action, userId?, source?, method?, path? }` as `extra`. Never message content. |
| PII scrubbing? | **SDK defaults** | No explicit `sendDefaultPii: true` — SDK default is `false`, so PII scrubbing is on by default. |

**What IS sent to Sentry:**

- Error stack traces
- `extra` context: route name, action description
- `userId` (UUID) on message route errors (`messages.ts:70,83,171,185`)
- Request method + path on global errors (`app.ts:15`)
- Sentry SDK may transmit the server's IP as part of the event envelope

## 6. Logs

Every `console.*` call in the API:

| File | Line | Statement | Sensitive Data? |
|------|------|-----------|----------------|
| `index.ts` | 17 | `console.log('relay-cafe-api running on :3000')` | No |
| `logger.ts` | 11 | `console.error('[relay-cafe]', context, err)` | `userId` UUID in context for message errors |
| `container.ts` | 9 | `console.warn('[container] UPSTASH_REDIS_REST_URL not set...')` | No |

**iOS app:** Zero `print()`, `os_log`, `Logger`, `NSLog`, or `debugPrint` calls found in any Swift source file.

## 7. Analytics

| SDK | Present? |
|-----|----------|
| Firebase | No |
| Amplitude | No |
| Mixpanel | No |
| Segment | No |
| Google Analytics | No |
| AppsFlyer | No |
| Adjust | No |
| Facebook SDK | No |
| AdSupport / IDFA | No |
| AppTrackingTransparency | No |

**Zero analytics, tracking, or advertising SDKs in either codebase.**

## 8. Push Notifications

| Question | Answer |
|----------|--------|
| Collecting device push tokens? | **No** |
| Push tokens stored? | **No** |
| Push tokens sent to backend? | **No** |

Zero references to `UNUserNotificationCenter`, `registerForRemoteNotifications`, `deviceToken`, or `pushToken` in the iOS codebase.

## 9. Data Sharing with Third Parties

| Service | Data Transmitted | User Content Shared? |
|---------|-----------------|---------------------|
| **GCP KMS** | 32-byte random DEKs for wrap/unwrap. No message content, no user identifiers. | No |
| **Railway** | Hosts the API. Sees network traffic (IPs at infrastructure level). No app-level data sharing. | No |
| **Sentry** | Error stack traces + extra context (`route`, `action`, `userId` UUID, `method`, `path`). No message text, no Apple ID, no email. | No |
| **Upstash Redis** (if configured) | SHA-256 hashed IPs as rate limit keys. No user identifiers, no content. | No |
| **Apple** (Sign-In) | Receives auth requests. App does not send any user-generated content to Apple. | No |

## 10. Retention

| Data | Storage | Retention | User Can Delete | Linked to Identity |
|------|---------|-----------|-----------------|-------------------|
| `apple_id_hash` | DB `users` table | Until account deletion | Yes (`DELETE /me`) | Yes (is the identity) |
| User UUID | DB `users.id` | Until account deletion | Yes (cascade) | Yes |
| Session token hash | DB `sessions.token_hash` | 30 days (expiry) or account deletion | Yes (sign out or delete account) | Yes (via `user_id` FK) |
| Device fingerprint hash | DB `sessions.device_fingerprint` | Same as session | Yes (cascade) | Yes (via session) |
| Daily token usage | DB `daily_tokens` | Until account deletion | Yes (cascade) | Yes (via `user_id` FK) |
| Message ciphertext | DB `messages` | `MESSAGE_TTL_SECONDS` (default 24h), or deleted on delivery | N/A (not tied to sender) | **No** — messages table has no `user_id` column |
| Hashed IP (rate limit) | In-memory or Upstash Redis | 60s–3600s sliding window | No | No |
| Session token (raw) | iOS Keychain | Until sign-out or app deletion | Yes | On-device only |
| `onboardingComplete` flag | iOS UserDefaults | Until account deletion | Yes | No (boolean flag only) |
| Sentry error events | Sentry cloud | Sentry retention policy (default 90 days) | No direct user control | Partially (`userId` UUID in extras) |

---

## App Store Privacy Summary

### Data Types Collected

| Data Type (Apple Category) | Collected | Stored | Shared with Third Parties | Linked to Identity | Used for Tracking | Purpose |
|---------------------------|-----------|--------|--------------------------|--------------------|--------------------|---------|
| **User ID** (hashed Apple sub) | Yes | Yes (server DB) | No | Yes | No | App Functionality |
| **Device ID** (hashed vendor+OS) | Yes | Yes (server DB) | No | Yes | No | App Functionality |
| **User Content** (messages) | Yes | Yes (encrypted, server DB, ephemeral) | No | No | No | App Functionality |
| **Diagnostics** (crash data) | Yes (if Sentry DSN set) | Yes (Sentry cloud) | Yes (Sentry) | Yes (userId in extras) | No | App Functionality |

### Data Types NOT Collected

- Contact Info (name, email, phone)
- Health & Fitness
- Financial Info
- Location
- Contacts
- Search History
- Browsing History
- Purchases
- Photos or Videos
- Sensitive Info
- Audio Data
- Gameplay Content
- Advertising Data
- Usage Data / Product Interaction (no analytics)

### Key Disclosure Notes

1. **Diagnostics → Linked to User:** The `userId` UUID is sent to Sentry as extra context on errors. This makes crash/error data linkable to a specific user account. Must be disclosed as "Data Linked to You" under Diagnostics.

2. **User Content → Not Linked:** Messages are encrypted at rest and have no `user_id` column. Once sent, a message cannot be traced back to its sender through the messages table. The decrypted text is returned to the receiver and hard-deleted. Must be disclosed as "Data Not Linked to You" under User Content.

3. **No Tracking:** No data is shared with data brokers, no advertising identifiers are collected, no cross-app/cross-site tracking occurs.

4. **Account Deletion:** `DELETE /me` cascades to sessions, daily_tokens. Messages are structurally unlinkable to users. Full account deletion is supported.

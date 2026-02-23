# Relay.cafe — System Design

**Date:** 2026-02-23
**Status:** Approved

---

## Overview

Relay.cafe is a native iOS app (Swift + SwiftUI) that relays one anonymous message per user per day. Messages expire in 24 hours. No history. No identity. No noise.

---

## Stack

| Layer | Technology |
|-------|-----------|
| iOS client | Swift + SwiftUI |
| API | TypeScript + Hono on Bun, hosted on Railway |
| Database | PostgreSQL on Railway |
| Key management | Google Cloud KMS |
| Auth | Sign in with Apple |
| SMS | None |

---

## Architecture

```
iOS App (Swift + SwiftUI)
    │
    │  HTTPS
    ▼
Hono API (Bun) on Railway
    ├── PostgreSQL (Railway)
    ├── Google Cloud KMS
    └── Apple JWKS endpoint (token verification)
```

---

## Authentication

1. User taps "Sign in with Apple" — Apple returns `identityToken` (JWT) + stable `user` sub
2. Client sends `identityToken` + `deviceFingerprint` to `POST /auth/apple`
3. Server verifies JWT against Apple's JWKS
4. Server hashes the `sub` with a salt → stored as `apple_id_hash` (raw sub never stored)
5. Server creates user if new, returns opaque session token
6. Client stores session token in iOS Keychain

Device fingerprint: `hash(deviceModel + osVersion + appVersion)` — stored on session creation, never used to block, only to flag anomaly patterns (e.g. 10+ accounts from same device).

---

## Encryption Model

Envelope encryption. No E2E. No user keypairs.

**On message creation (server-side):**
1. Generate random AES-256-GCM key per message
2. Encrypt plaintext with AES-256-GCM
3. Use GCP KMS (today's key version) to wrap the AES key
4. Store: `ciphertext`, `encrypted_message_key`, `kms_key_version`, `iv`, `created_at`, `expires_at`

**On message retrieval (server-side):**
1. Select a random undelivered, unexpired message
2. KMS unwraps the message key
3. AES decrypt → plaintext
4. Send plaintext to client over HTTPS
5. Hard delete the message row immediately on successful delivery

**KMS key lifecycle:**
- One GCP KMS key version per UTC day
- New version generated daily via GCP Cloud Scheduler
- Previous version scheduled for destruction at 26 hours (all messages using it are max 24h old)
- No key backups, no long-term retention

---

## Database Schema

```sql
-- Users
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  apple_id_hash TEXT UNIQUE NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Sessions (opaque tokens, fully revocable)
CREATE TABLE sessions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at          TIMESTAMPTZ NOT NULL,
  device_fingerprint  TEXT
);

-- Daily tokens (server-enforced, resets at 00:00 UTC)
CREATE TABLE daily_tokens (
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date          DATE NOT NULL,
  send_used     BOOLEAN NOT NULL DEFAULT false,
  receive_used  BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, date)
);

-- Messages (envelope-encrypted, no sender/recipient linking)
CREATE TABLE messages (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ciphertext            TEXT NOT NULL,
  encrypted_message_key TEXT NOT NULL,
  kms_key_version       TEXT NOT NULL,
  iv                    TEXT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at            TIMESTAMPTZ NOT NULL,
  delivered             BOOLEAN NOT NULL DEFAULT false
);

-- IP abuse tracking (pruned after 48h)
CREATE TABLE ip_events (
  ip_hash     TEXT NOT NULL,
  event_type  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ON ip_events (ip_hash, event_type, created_at);
```

---

## API

```
POST   /auth/apple          Sign in with Apple → session token
DELETE /auth/session        Sign out

GET    /me/status           Today's token state
DELETE /me                  Account deletion (hard delete)

POST   /messages            Send message (consumes send token)
GET    /messages/today      Receive message (server decrypts, deletes, returns plaintext)
```

### POST /auth/apple
```
Body:    { identityToken: string, deviceFingerprint: string }
Returns: { sessionToken: string, expiresAt: string }
Rate:    5 attempts / IP / hour
```

### GET /me/status
```
Auth:    Bearer session token
Returns: { sendUsed: boolean, receiveUsed: boolean, date: string }
```

### POST /messages
```
Auth:    Bearer session token
Body:    { text: string }   // max 1000 chars, plain text only
Logic:
  1. Check send_used = false → else 429
  2. Generate AES-256-GCM key
  3. Encrypt text
  4. KMS wraps key
  5. INSERT into messages
  6. Mark send_used = true
Returns: 204 No Content
```

### GET /messages/today
```
Auth:    Bearer session token
Logic:
  1. Check receive_used = false → else 429
  2. SELECT id, ciphertext, encrypted_message_key, kms_key_version, iv
     FROM messages
     WHERE delivered = false AND expires_at > NOW()
     ORDER BY RANDOM() LIMIT 1
  3. If none → 204 (token NOT consumed)
  4. KMS unwrap key → AES decrypt → plaintext
  5. Hard DELETE message row
  6. Mark receive_used = true
Returns: { id: string, text: string } | 204
```

### DELETE /me
```
Auth:    Bearer session token
Logic:   Hard delete user row (cascades to sessions, daily_tokens)
         Messages in pool remain until natural expiry (now fully anonymous)
Returns: 204 No Content
```

---

## Rate Limiting & Abuse Protection

| Rule | Limit |
|------|-------|
| Account creation (`POST /auth/apple`) | 5 attempts / IP / hour |
| Send token | 1 per user per UTC day (server-enforced) |
| Receive token | 1 per user per UTC day (server-enforced) |
| Device fingerprint | Soft signal only — flag if >10 accounts from same device |
| Abuse alert | >20 account creations from single IP subnet in 1 hour |

No content logging anywhere in the stack.

---

## Cleanup Job

Railway cron, every 10 minutes:

```sql
DELETE FROM messages WHERE expires_at < NOW();
DELETE FROM ip_events WHERE created_at < NOW() - INTERVAL '48 hours';
```

---

## iOS App Structure

### Screens

| Screen | Trigger |
|--------|---------|
| `OnboardingView` | First launch |
| `SignInView` | After onboarding or after account deletion |
| `HomeView` | Authenticated |
| `ComposeView` | Tap "Write today's message" |
| `MessageView` | Message received |
| `SettingsView` | From home (account deletion only) |
| `DeletionConfirmView` | From settings |

### Home state machine

```
send_used = false  →  [ Write today's message ]
send_used = true   →  "You've already sent today."

receive_used = false  →  [ Open today's message ]
receive_used = true   →  "You've already received today."
```

### Message receive flow

1. Tap "Open today's message"
2. Blank screen, 2–3 second intentional pause (no spinner)
3a. Message received → `MessageView` with text + translation caption
3b. No message → "The relay is quiet today."
4. User closes `MessageView` → wipe local text from memory (no API call — server already deleted)

### Translation (MessageView)

- Detect language: `NaturalLanguage` framework
- Translate: `Translation` framework (iOS 17+, on-device)
- Display: translated text + small caption "Originally written in [Language]."
- If unavailable: show original + "Translation unavailable.\nYou may read the original."
- Server never translates

### Keychain storage

```
sessionToken     // opaque Bearer token
sessionExpiry    // to refresh Sign in with Apple before expiry
```

No CoreData. No SwiftData. No UserDefaults for message content.

---

## UI Copy

| State | Copy |
|-------|------|
| Onboarding | "Once a day, you may send a message. Once a day, you may receive one. Messages exist for 24 hours. They are never stored." |
| Sign in subtext | "Your identity is not shown to others." |
| Compose hint | "It may be read once. Or not at all." |
| After send | "Sent." |
| Send used | "You've already sent today." |
| Receive used | "You've already received today." |
| No message | "The relay is quiet today." |
| Translation unavailable | "Translation unavailable.\nYou may read the original." |
| Rate limited | "Please try again later." |
| Network error | "Connection unavailable.\nPlease try again." |
| Message expired mid-flow | "This message is no longer available." |
| Deletion confirm | "Your account will be permanently removed.\nThis cannot be undone." |
| After deletion | "You've left the relay." |

**Tone rules:** No exclamation marks. No emojis. No urgency. No gamification. No technical detail in UI.

---

## Non-Goals (MVP Scope Lock)

- No chat threads, replies, reactions
- No read receipts or message status
- No push notifications
- No premium tier
- No message history or archive
- No statistics or user profiles
- No follower system
- No copy/share UI
- No screenshot detection (v1)
- No message retry
- No delivery analytics
- No AI moderation

---

## Visual Identity System

### Color Palette

| Role | Light | Dark |
|------|-------|------|
| Background | `#F6F4EF` (warm off-white) | `#1C1C1C` (soft charcoal) |
| Text | System default | `#EDEBE6` |

No gradients. No accent colors.

### Typography

SF Pro Text (system font, no custom fonts in v1).

| Role | Size | Weight | Notes |
|------|------|--------|-------|
| Title (Relay.cafe) | 28–32pt | Regular | Generous top spacing |
| Body text | 17–19pt | Regular | Line height 1.4–1.5x |
| Secondary text | 13–14pt | Regular | 70% opacity |

No bold in body copy. Whitespace creates hierarchy.

### Layout

- Horizontal padding: 24–32pt minimum
- Vertical spacing: generous, never cramped
- Buttons: text-only, no filled containers, light opacity change on tap
- No cards, no shadows, no rounded content containers, no borders, no icons, no illustrations

### Motion

Everything should feel like breathing, not sliding.

| Interaction | Behavior |
|------------|----------|
| Receive loading | Screen clears. 2.0–2.5s pause. No spinner. Message fades in at 0.6s, easeInOut. |
| After sending | Text fades out. "Sent." fades in at 0.4s. Fades out after 1.5s. Return to home. |
| Closing a message | Message fades out 0.3s. Then delete. No theatrical destruction. |

No bounce. No spring. No haptics. No sound. No vibration.

### Dark Mode

Supported. No pure black. No neon white. Soft charcoal background. Reading in a dim room.

### Disabled State

When token used: button opacity 60–70%. No layout shift.

### Translation Display

Message text, then 16–20pt vertical space, then small muted caption: "Originally written in [Language]."

---

## App Store Description

```
Relay.cafe

Once a day, you may send a message.
Once a day, you may receive one.

Messages exist for 24 hours.
They are never stored.
They are never shown twice.

No profiles.
No history.
No replies.
No metrics.

Just a signal, passing once.
```

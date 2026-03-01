# Moderation Test Suite + TS Fixes — Design

**Goal:** Add comprehensive unit, integration, and E2E tests for the App Store 1.2 compliance moderation system. Fix all TypeScript errors. Fix existing broken tests.

**Architecture:** Extend the existing Bun test infrastructure (real DB, real KMS, Hono `app.request()`). Add XCUITest E2E tests for iOS moderation UI against local API.

**Tech Stack:** Bun test runner, Drizzle ORM, Hono, XCUITest, xcodegen

---

## Part 1: Fix Existing Broken Tests + TS Errors

### Broken tests

1. **`createMessage()` helper** — missing required `senderUserId` field after schema change. Fix: accept `senderUserId` parameter, create a sender user if not provided.
2. **`resetDB()` helper** — doesn't clean `deliveryLog`, `reports`, `blockedSenders`. Fix: add delete statements in FK order.
3. **Self-receive test** (`messages-receive.test.ts:200-218`) — expects `status 200` but self-receive is now blocked. Fix: expect `204`.

### TS errors (15 total)

| File | Error | Fix |
|------|-------|-----|
| `src/routes/messages.ts` (x4) | `c.get('userId')` — Hono context not typed | Add `Variables` type to router |
| `src/routes/me.ts` (x2) | Same `c.get('userId')` issue | Add `Variables` type to router |
| `src/lib/sessionToken.ts` | `SESSION_SALT` possibly undefined | Already guarded by throw; add `!` |
| `src/lib/adapters/inMemoryRateLimiter.ts` | `timestamps[0]` possibly undefined | Add `!` (length already checked) |
| `tests/helpers/db.ts` | `createMessage()` missing `senderUserId` | Add parameter |
| `tests/integration/messages-send.test.ts` (x4) | `allMessages[0]` possibly undefined | Add `!` assertions |
| `tests/integration/kms.test.ts` | Array access possibly undefined | Add `!` assertion |
| `tests/unit/crypto.test.ts` | Array access possibly undefined | Add `!` assertion |
| `tests/unit/rateLimitMiddleware.test.ts` | `body` is `unknown` | Type the `requestJSON` call |

## Part 2: Backend Unit Tests

### `tests/unit/contentFilter.test.ts`

- Each blocked category triggers (slurs, sexual, CSAM, threats, harassment)
- Word boundaries prevent false positives ("flag" not blocked)
- Normalization: zero-width chars, punctuation stripping, case-insensitive
- Clean messages pass
- Edge cases: empty string, whitespace-only

## Part 3: Backend Integration Tests

### `tests/integration/moderation.test.ts`

**Self-receive prevention:**
- User sends → same user receives → 204
- User A sends → User B receives → 200

**Report flow:**
- Report message → strike incremented
- Report same message twice → idempotent
- Report without delivery log → 404
- 3 strikes → auto-suspension
- Suspended user can't send (403)

**Block flow:**
- Block sender → 200
- Block same sender twice → idempotent
- Blocked sender's messages excluded from receive
- Block persists across account deletion/recreation (apple_id_hash)

**Delivery log:**
- Receive creates delivery_log entry

**Account deletion cascades:**
- User with messages/reports/delivery_log can delete

## Part 4: API-level E2E Journeys

### `tests/e2e/moderation-journeys.test.ts`

1. Report journey: send → receive → report → strike verified
2. Block journey: send → receive → block → sender's next message not delivered
3. Suspension journey: 3 reports → suspended → can't send
4. Content filter journey: blocked text → 400 → clean text → 201
5. Block persistence: block → delete account → recreate → block still active

## Part 5: XCUITest E2E (iOS)

### Prerequisites
- Implement `-resetState` handler in `RelayCafeApp.swift`
- Configure `APIBaseURL = http://localhost:3000` for UI test target via `project.yml`

### `RelayCafeUITests/ModerationUITests.swift`
- Settings: Safety section, Guidelines button, email button
- Message view: Report/Block buttons visible
- Report alert: confirmation text
- Block alert: confirmation text

### `RelayCafeUITests/SettingsUITests.swift`
- Settings: all links present (Terms, Privacy, Guidelines)
- Delete account flow UI

## Part 6: TS Errors Only (No Lint Setup)

Fix TypeScript strict mode errors. No ESLint/Biome setup (none exists today).

# Napkin

## Corrections
| Date | Source | What Went Wrong | What To Do Instead |
|------|--------|----------------|-------------------|
| 2026-02-23 | iOS build | Plan used `#available(iOS 17.4, *)` and `text.translated(to:using:)` for Translation framework | `TranslationSession` is iOS 18.0+ in Xcode 16 SDK. Use `@available(iOS 18.0, *)` ViewModifier + `.translationTask` modifier. Can't call `translated()` on String directly. |
| 2026-02-23 | iOS build | `MessageResponse` didn't conform to `Equatable`, blocking `ReceiveState: Equatable` synthesis | Add `Equatable` to `MessageResponse` in APIClient.swift |
| 2026-02-23 | iOS typecheck | `import Translation` placed inside a struct body | Swift imports are file-level only; put `import Translation` at top of file |
| 2026-02-23 | swiftc | `swiftc -target arm64-apple-ios17.0-simulator` without full Xcode path fails | Use `/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swiftc -sdk $(xcrun --sdk iphonesimulator --show-sdk-path)` |

## User Preferences
- Apple Sign-In only (no phone verification — original IDEA.md had phone SMS but system design superseded it)
- Envelope encryption server-side with GCP KMS, not E2E user keypairs
- iOS 17.0 minimum (required for Translation.framework)
- No haptics, no sound, no bounce, no spring anywhere in the app

## Patterns That Work
- Drizzle ORM with `postgres` driver for Hono/Bun API
- `jose` for Apple JWT verification against Apple's JWKS
- `@Observable` + `@MainActor` pattern for SwiftUI ViewModels
- Bun test with `mock.module()` to mock Apple JWT calls in unit tests
- `actor APIClient` for thread-safe token management in Swift

## Patterns That Don't Work

## Domain Notes
- Two separate repos: `relay-cafe-api` (Hono/Bun) and `relay-cafe-ios` (SwiftUI)
- Session token = UUID of session row — no JWT for sessions
- Daily tokens reset at 00:00 UTC (not local timezone)
- Messages hard-deleted immediately on delivery; never marked delivered first
- Receive token NOT consumed if pool is empty (204 without token consumption)
- `devices fingerprint = hash(deviceModel + osVersion + appVersion)` — soft signal only
- KMS: one key version per UTC day, previous version destroyed at 26h
- `Translation.framework` requires iOS 17.4+ for `text.translated()` API
- All UI copy: no exclamation marks, no emojis, no urgency, no technical detail

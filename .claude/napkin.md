# Napkin

## Corrections
| Date | Source | What Went Wrong | What To Do Instead |
|------|--------|----------------|-------------------|
| 2026-02-23 | iOS build | Plan used `#available(iOS 17.4, *)` and `text.translated(to:using:)` for Translation framework | `TranslationSession` is iOS 18.0+ in Xcode 16 SDK. Use `@available(iOS 18.0, *)` ViewModifier + `.translationTask` modifier. Can't call `translated()` on String directly. |
| 2026-02-23 | iOS build | `MessageResponse` didn't conform to `Equatable`, blocking `ReceiveState: Equatable` synthesis | Add `Equatable` to `MessageResponse` in APIClient.swift |
| 2026-02-23 | iOS typecheck | `import Translation` placed inside a struct body | Swift imports are file-level only; put `import Translation` at top of file |
| 2026-02-23 | swiftc | `swiftc -target arm64-apple-ios17.0-simulator` without full Xcode path fails | Use `/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swiftc -sdk $(xcrun --sdk iphonesimulator --show-sdk-path)` |
| 2026-02-23 | API | Hono endpoint returned `c.body(null, 204)` for send; iOS `validate()` treated it as `APIError.noMessage` | Always return `c.json({ ok: true }, 201)` for successful mutation responses |
| 2026-02-23 | API+iOS | Dates were serialized as ISO8601 strings — fragile across platforms (fractional seconds, timezone) | Use epoch milliseconds (numbers) for all date wire formats; daily_tokens.date is BIGINT epoch day |
| 2026-02-23 | API | Running `bun run src/app.ts` does nothing — it just exports the Hono app | Real server entry point is `src/index.ts`; `src/app.ts` is just the app factory |
| 2026-02-23 | git | Copying a directory that contains `.git` causes git to add it as a gitlink (mode 160000) not a plain directory | Remove `.git` from the copy before `git add`, or use `git rm --cached -f` + re-add |
| 2026-02-23 | git | Created PR targeting `main` instead of `dev`; merged directly to `main` bypassing `dev`; created feature branches from `main` instead of `dev` | `dev` is the working branch. ALWAYS: branch from `dev`, PR to `dev`. Only `dev` → `main` for releases. Never skip `dev`. |
| 2026-02-24 | croner | Used `Cron(...)` without `new` keyword — crash loop on Railway | `croner` exports a class; must use `new Cron(...)` |
| 2026-02-24 | Railway | `watchPatterns = ["relay-cafe-api/**"]` in railway.toml caused all deploys to be SKIPPED | watchPatterns are relative to root directory setting. Since root is already `relay-cafe-api`, use `["**"]` not `["relay-cafe-api/**"]` |
| 2026-02-25 | Redis | Bun.RedisClient `.send()` through external Railway proxy hangs indefinitely — no command timeout, no error, blocks entire request for 2+ min | Use `Promise.race` with `REDIS_TIMEOUT_MS` timeout. Always fail-open on Redis errors. Use Lua EVAL (1 round trip) not sequential calls (4+ round trips). |
| 2026-02-25 | Redis | Global rate limiter on `*` including `/health` meant health checks hit Redis too — stalled Redis = failed health checks = deploy failures | Don't put rate limiter on health check routes. Use per-route rate limiting only. |
| 2026-02-25 | deploy | `railway redeploy` invalidates Docker layer cache — builds take 5+ min instead of 30s. Triggered 3 deploys by doing git push + git push dev:main + railway up | Use `railway up` for quick testing. For production, merge via PR and let auto-deploy handle it (uses cached layers). |

## User Preferences
- Apple Sign-In only (no phone verification — original IDEA.md had phone SMS but system design superseded it)
- Envelope encryption server-side with GCP KMS, not E2E user keypairs
- iOS 17.0 minimum (required for Translation.framework)
- No haptics, no sound, no bounce, no spring anywhere in the app

## Final Decisions (LOCKED — do not change)
- **Message layout**: left-aligned, NOT horizontally centered. Slightly ABOVE vertical center (1 spacer above, 2 below). More space below than above. No cards, no containers, no borders, no frames. Translation hint: left-aligned below message, muted. Close button: centered horizontally near bottom, visually secondary. Feels like a handwritten note — human, slightly asymmetrical, not staged.

## Patterns That Work
- Drizzle ORM with `postgres` driver for Hono/Bun API
- `jose` for Apple JWT verification against Apple's JWKS
- `@Observable` + `@MainActor` pattern for SwiftUI ViewModels
- Bun test with `mock.module()` to mock Apple JWT calls in unit tests
- `actor APIClient` for thread-safe token management in Swift
- Redis rate limiting: Lua EVAL script for atomic sliding window in 1 round trip (matches shareal.ink)
- `Promise.race` with timeout for external Redis calls — fail-open on timeout/error
- Per-route rate limiting only, no global middleware (keeps health checks fast)

## Patterns That Don't Work
- KMS key had no `rotationPeriod` set — config test caught it; always verify infra config with assertions, not assumptions
- Bun.RedisClient sequential `.send()` calls through external proxy — hangs indefinitely, no built-in timeout
- Global rate limiter on `*` — blocks health checks and every route with Redis overhead

## Domain Notes
- Monorepo at `relay.cafe/` with `relay-cafe-api/` and `relay-cafe-ios/` subdirectories; remote: `git@github.com:HubDev-AI/relay.cafe.git`
- Session token = UUID of session row — no JWT for sessions
- Daily tokens reset at 00:00 UTC (not local timezone)
- Messages hard-deleted immediately on delivery; never marked delivered first
- Receive token NOT consumed if pool is empty (204 without token consumption)
- `devices fingerprint = hash(deviceModel + osVersion + appVersion)` — soft signal only
- KMS: auto-rotation every 24h (`rotationPeriod: 86400s`), `destroyScheduledDuration: 2592000s` (30 days), SA needs `cloudkms.admin` on key for rotation tests
- `Translation.framework` requires iOS 17.4+ for `text.translated()` API
- All UI copy: no exclamation marks, no emojis, no urgency, no technical detail

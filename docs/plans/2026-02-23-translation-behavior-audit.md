# Relay.cafe — Translation Behavior Audit

**Date:** 2026-02-23
**Scope:** iOS app translation implementation
**Files audited:**
- `RelayCafe/Services/TranslationService.swift`
- `RelayCafe/Views/TranslationModifier.swift`
- `RelayCafe/Views/MessageView.swift`

---

## 1. Language Detection

**Where:** `TranslationService.swift` — `detectLanguage(in:)` function.

**How it works:**
- Uses `NLLanguageRecognizer` (NaturalLanguage framework, available iOS 11+).
- Calls `recognizer.processString(text)` then checks `dominantLanguage`.
- Returns `nil` (no translation needed) if language is `.undetermined` or matches user's preferred language.
- Preferred language extracted from `Locale.preferredLanguages.first`, normalized to bare language code (e.g. `"en-US"` → `"en"`) for comparison with `NLLanguage.rawValue`.

**When it runs:** Once per message, on `MessageView.onAppear` — triggered inside `TranslationTaskModifier.setupConfig()`.

**Threshold:** Binary — if `NLLanguageRecognizer.dominantLanguage` differs from preferred language, translation is attempted. No confidence threshold is checked (NLLanguageRecognizer provides one via `languageHypotheses(withMaximum:)` but it is not used). Short or ambiguous text may produce incorrect detection.

## 2. Translation Trigger

**When:** Translation is attempted automatically when `MessageView` appears, if and only if `detectLanguage(in:)` returns a non-nil language name (meaning detected language differs from user's preferred language).

**Flow:**
1. `MessageView` mounts with `.applyTranslationIfAvailable()` modifier.
2. On iOS 18+, `TranslationTaskModifier` is applied; on iOS 17, no-op.
3. `onAppear` → `setupConfig()` calls `detectLanguage(in: text)`.
4. If language differs: sets `originalLanguage` binding and creates `TranslationSession.Configuration()`.
5. Setting `config` triggers `.translationTask(config)` which calls `session.translate(text)`.
6. If same language or undetermined: `config` stays `nil`, `.translationTask` never fires.

**Result:** Translation is fully automatic. No user action required. No "Translate" button exists.

## 3. Model Download Behavior

**Framework:** Apple's `Translation` framework (`import Translation`), available iOS 18.0+.

**API used:** `TranslationSession` via the `.translationTask(_:action:)` SwiftUI modifier.

**Model download:**
- `TranslationSession.Configuration()` is created with no explicit language pair — Apple infers source/target from the text and device language.
- Apple's Translation framework manages model downloads internally. If a model is not downloaded, the framework may:
  - Prompt the user to download it (system UI).
  - Fail silently and throw an error.
- **No pre-check for model availability** exists in the current code. There is no call to any availability-checking API.
- **No explicit download trigger** — the code does not call any download API.

**On failure:** The `do/catch` in `TranslationTaskModifier.body` sets `translationFailed = true`. MessageView then shows: `"Translation unavailable.\nYou may read the original."` The original message text remains visible (`displayText` falls back to `message.text` when `translatedText` is nil).

## 4. Caching / Retries

**Caching:** None. There is no cached state for "translation available" or "translation unavailable" per language pair.

**Retries:** No explicit retry logic. Translation is attempted once per `MessageView` appearance. Since messages are ephemeral (hard-deleted on delivery), the same message won't be shown twice — so retry is not a practical concern.

**If user dismisses and re-opens:** Not possible — messages are deleted after delivery. Each message view is a one-time display.

**Recommendation:** No caching or retry strategy needed for v1. Each message is shown exactly once. If translation fails, the fallback message appears. No repeated slow attempts are possible by design.

## 5. Current UX Behavior (Already Matches v1 Spec)

| Requirement | Status | Evidence |
|------------|--------|----------|
| Attempt translation automatically when language differs | Done | `TranslationTaskModifier.setupConfig()` triggers on appear when `detectLanguage` returns non-nil |
| Only when model is available | Partially | No pre-check; relies on try/catch. If model unavailable, failure is caught gracefully. |
| Show original + fallback message on failure | Done | `MessageView.swift:45-47`: `"Translation unavailable.\nYou may read the original."` |
| No "Translate" button in v1 | Done | No button exists anywhere in the codebase |
| Show "Originally written in [language]" on success | Done | `MessageView.swift:47-49`: `"Originally written in \(lang)."` |
| iOS 17 graceful degradation | Done | `TranslationModifier.swift:15`: `if #available(iOS 18.0, *)` — iOS 17 sees original text only, no caption |

## Summary

The current implementation already fulfills the v1 translation spec. The architecture is minimal and correct:

- `TranslationService.swift`: 24 lines, language detection only
- `TranslationModifier.swift`: 57 lines, SwiftUI modifier wrapping Translation framework
- `MessageView.swift`: integrates both via `.applyTranslationIfAvailable()` modifier

**One gap:** No model availability pre-check. Current behavior is try-and-catch, which is acceptable for v1 given messages are one-time views.

**No code changes needed** for v1 unless model availability checking is desired.

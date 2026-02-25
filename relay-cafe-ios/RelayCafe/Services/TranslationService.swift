import Foundation
import NaturalLanguage

struct DetectedLanguage {
    let displayName: String
    let code: String
}

// Detects the language of `text` and returns its display name and code
// if the text is in a language different from the user's preferred language.
// Returns nil when no translation is needed or language is undetermined.
@MainActor
func detectLanguage(in text: String) -> DetectedLanguage? {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard trimmed.count >= 12 else { return nil }

    let recognizer = NLLanguageRecognizer()
    recognizer.processString(trimmed)
    guard
        let detected = recognizer.dominantLanguage,
        detected != .undetermined
    else { return nil }

    let hypotheses = recognizer.languageHypotheses(withMaximum: 1)
    guard let confidence = hypotheses[detected], confidence > 0.5 else { return nil }

    // Locale.preferredLanguages returns BCP 47 tags like "en-US", but NLLanguage
    // rawValues are bare codes like "en". Extract just the language component to compare.
    let preferredTag = Locale.preferredLanguages.first ?? ""
    let preferredLang = NLLanguage(rawValue: Locale(identifier: preferredTag).language.languageCode?.identifier ?? preferredTag)
    guard detected != preferredLang else { return nil }

    let displayName = Locale.current.localizedString(forLanguageCode: detected.rawValue)
        ?? detected.rawValue
    return DetectedLanguage(displayName: displayName, code: detected.rawValue)
}

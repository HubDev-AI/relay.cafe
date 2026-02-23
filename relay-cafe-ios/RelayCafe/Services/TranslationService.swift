import Foundation
import NaturalLanguage

// Detects the language of `text` and returns a displayable name (e.g. "Spanish")
// if the text is in a language different from the user's preferred language.
// Returns nil when no translation is needed or language is undetermined.
@MainActor
func detectLanguage(in text: String) -> String? {
    let recognizer = NLLanguageRecognizer()
    recognizer.processString(text)
    guard
        let detected = recognizer.dominantLanguage,
        detected != .undetermined
    else { return nil }

    // Locale.preferredLanguages returns BCP 47 tags like "en-US", but NLLanguage
    // rawValues are bare codes like "en". Extract just the language component to compare.
    let preferredTag = Locale.preferredLanguages.first ?? ""
    let preferredLang = NLLanguage(rawValue: Locale(identifier: preferredTag).language.languageCode?.identifier ?? preferredTag)
    guard detected != preferredLang else { return nil }

    return Locale.current.localizedString(forLanguageCode: detected.rawValue)
        ?? detected.rawValue
}

import SwiftUI
import NaturalLanguage
@preconcurrency import Translation

extension View {
    /// Applies on-device translation (iOS 18+) using only installed language models
    /// where possible. On iOS 26+, checks isReady to avoid download prompts entirely.
    /// On iOS 18–25, falls back to try/catch (Apple may show a download prompt).
    /// On iOS 17, shows original text only.
    @ViewBuilder
    func applyTranslationIfAvailable(
        text: String,
        translatedText: Binding<String?>,
        originalLanguage: Binding<String?>,
        translationFailed: Binding<Bool>
    ) -> some View {
        if #available(iOS 18.0, *) {
            self.modifier(
                InstalledTranslationModifier(
                    text: text,
                    translatedText: translatedText,
                    originalLanguage: originalLanguage,
                    translationFailed: translationFailed
                )
            )
        } else {
            self
        }
    }
}

@available(iOS 18.0, *)
private struct InstalledTranslationModifier: ViewModifier {
    let text: String
    @Binding var translatedText: String?
    @Binding var originalLanguage: String?
    @Binding var translationFailed: Bool

    @State private var config: TranslationSession.Configuration?
    @State private var detectedCode: String?

    func body(content: Content) -> some View {
        content
            .onAppear { setupConfig() }
            .translationTask(config) { session in
                let target = Locale.preferredLanguages.first.map {
                    Locale(identifier: $0).language.languageCode?.identifier ?? $0
                }

                // iOS 26+: check isReady to skip if models aren't installed
                // (avoids download prompt entirely). Never call prepareTranslation().
                if #available(iOS 26.0, *) {
                    guard await session.isReady else {
                        translationFailed = true
                        Task { await APIClient.shared.reportTranslationEvent(
                            event: "translation.unavailable",
                            sourceLanguage: detectedCode,
                            targetLanguage: target
                        )}
                        return
                    }
                }
                // iOS 18–25: no availability check API exists.
                // translate() may trigger Apple's download prompt if model is missing.
                do {
                    let response = try await session.translate(text)
                    translatedText = response.targetText
                } catch {
                    translationFailed = true
                    let nsErr = error as NSError
                    Task { await APIClient.shared.reportTranslationEvent(
                        event: "translation.error",
                        sourceLanguage: detectedCode,
                        targetLanguage: target,
                        errorCode: String(nsErr.code),
                        errorDomain: nsErr.domain
                    )}
                }
            }
    }

    private func setupConfig() {
        guard let detected = detectLanguage(in: text) else { return }
        originalLanguage = detected.displayName
        detectedCode = detected.code
        config = TranslationSession.Configuration()
    }
}

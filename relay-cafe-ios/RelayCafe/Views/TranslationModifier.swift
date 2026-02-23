import SwiftUI
import NaturalLanguage
@preconcurrency import Translation

extension View {
    /// Applies on-device translation (iOS 18+) silently.
    /// On iOS 17, shows the original text — no caption.
    @ViewBuilder
    func applyTranslationIfAvailable(
        text: String,
        translatedText: Binding<String?>,
        originalLanguage: Binding<String?>,
        translationFailed: Binding<Bool>
    ) -> some View {
        if #available(iOS 18.0, *) {
            self.modifier(
                TranslationTaskModifier(
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
private struct TranslationTaskModifier: ViewModifier {
    let text: String
    @Binding var translatedText: String?
    @Binding var originalLanguage: String?
    @Binding var translationFailed: Bool

    @State private var config: TranslationSession.Configuration?

    func body(content: Content) -> some View {
        content
            .onAppear { setupConfig() }
            .translationTask(config) { session in
                do {
                    let response = try await session.translate(text)
                    translatedText = response.targetText
                } catch {
                    translationFailed = true
                }
            }
    }

    private func setupConfig() {
        guard let lang = detectLanguage(in: text) else { return }
        originalLanguage = lang
        config = TranslationSession.Configuration()
    }
}

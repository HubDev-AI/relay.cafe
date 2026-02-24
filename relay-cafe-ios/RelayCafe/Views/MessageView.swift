import SwiftUI

struct MessageView: View {
    let message: MessageResponse
    @Bindable var homeVM: HomeViewModel
    @Environment(\.dismiss) var dismiss
    @Environment(\.scenePhase) private var scenePhase

    @State private var translatedText: String?
    @State private var originalLanguage: String?
    @State private var translationFailed = false
    @State private var appeared = false
    @State private var expired = false

    var displayText: String { translatedText ?? message.text }

    var body: some View {
        ZStack {
            LinearGradient.relayBackground.ignoresSafeArea()

            if expired {
                VStack(spacing: 0) {
                    Spacer()
                    Text("This message is no longer available.")
                        .font(.system(size: 19, weight: .regular))
                        .opacity(0.35)
                        .accessibilityIdentifier("message.expiredLabel")
                    Spacer()
                    Button("Close") { close() }
                        .font(.system(size: 17))
                        .opacity(0.35)
                        .buttonStyle(.plain)
                        .padding(.bottom, 48)
                        .accessibilityIdentifier("message.closeButton")
                }
            } else {
                VStack(alignment: .leading, spacing: 0) {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 20) {
                            Text(displayText)
                                .font(.system(size: 19, weight: .regular))
                                .lineSpacing(8)
                                .textSelection(.enabled)
                                .opacity(appeared ? 1 : 0)
                                .animation(.easeInOut(duration: 0.6), value: appeared)
                                .accessibilityIdentifier("message.text")

                            Group {
                                if translationFailed {
                                    Text("Translation unavailable.\nYou may read the original.")
                                } else if let lang = originalLanguage {
                                    Text("Originally written in \(lang).")
                                } else {
                                    Text(" ")
                                }
                            }
                            .font(.system(size: 14))
                            .opacity(0.4)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.top, 64)
                    }
                    .scrollIndicators(.hidden)

                    Button("Close") { close() }
                        .font(.system(size: 17))
                        .opacity(0.35)
                        .buttonStyle(.plain)
                        .frame(maxWidth: .infinity, alignment: .center)
                        .padding(.top, 32)
                        .padding(.bottom, 48)
                        .accessibilityIdentifier("message.closeButton")
                }
            .padding(.horizontal, 28)
            }
        }
        .onAppear {
            withAnimation { appeared = true }
            checkExpiration()
        }
        .onChange(of: scenePhase) {
            if scenePhase == .active { checkExpiration() }
        }
        .onReceive(Timer.publish(every: 60, on: .main, in: .common).autoconnect()) { _ in
            checkExpiration()
        }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.userDidTakeScreenshotNotification)) { _ in
            guard !expired else { return }
            withAnimation(.easeInOut(duration: 0.35)) { expired = true }
        }
        #if DEBUG
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("relay.simulateScreenshot"))) { _ in
            guard !expired else { return }
            withAnimation(.easeInOut(duration: 0.35)) { expired = true }
        }
        #endif
        .applyTranslationIfAvailable(
            text: message.text,
            translatedText: $translatedText,
            originalLanguage: $originalLanguage,
            translationFailed: $translationFailed
        )
        .interactiveDismissDisabled()
    }

    private func checkExpiration() {
        guard !expired, Date() >= message.expiresAt else { return }
        withAnimation(.easeInOut(duration: 0.35)) { expired = true }
    }

    private func close() {
        withAnimation(.easeInOut(duration: 0.3)) { appeared = false }
        Task {
            try? await Task.sleep(for: .milliseconds(300))
            await homeVM.loadStatus()
            dismiss()
        }
    }
}

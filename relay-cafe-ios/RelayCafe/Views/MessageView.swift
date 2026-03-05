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
    @State private var showReportAlert = false
    @State private var showBlockAlert = false
    @State private var showActions = false
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

                    VStack(spacing: 24) {
                        Button("Close") { close() }
                            .font(.system(size: 17))
                            .opacity(0.35)
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("message.closeButton")

                        ZStack {
                            VStack(spacing: 14) {
                                Button("Report") { showReportAlert = true }
                                    .font(.system(size: 13))
                                    .opacity(0.3)
                                    .buttonStyle(.plain)
                                    .accessibilityIdentifier("message.reportButton")

                                Button("Block sender") { showBlockAlert = true }
                                    .font(.system(size: 13))
                                    .opacity(0.3)
                                    .buttonStyle(.plain)
                                    .accessibilityIdentifier("message.blockButton")
                            }
                            .opacity(showActions ? 1 : 0)

                            Button(action: { showActions = true }) {
                                Image(systemName: "ellipsis")
                                    .font(.system(size: 14))
                                    .opacity(0.2)
                                    .frame(width: 44, height: 44)
                                    .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("message.moreButton")
                            .opacity(showActions ? 0 : 1)
                            .allowsHitTesting(!showActions)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.top, 32)
                    .padding(.bottom, 48)
                }
            .padding(.horizontal, 28)
            }
        }
        .alert("Report this message?", isPresented: $showReportAlert) {
            Button("Cancel", role: .cancel) { }
            Button("Report", role: .destructive) {
                Task {
                    await homeVM.reportMessage(id: message.id)
                    dismiss()
                }
            }
        } message: {
            Text("The message will be removed and reviewed according to our guidelines.")
        }
        .alert("Block this sender?", isPresented: $showBlockAlert) {
            Button("Cancel", role: .cancel) { }
            Button("Block", role: .destructive) {
                Task {
                    await homeVM.blockSender(messageId: message.id)
                    dismiss()
                }
            }
        } message: {
            Text("You will not receive messages from this sender again.")
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

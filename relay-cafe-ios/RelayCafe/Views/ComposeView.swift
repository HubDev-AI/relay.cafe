import SwiftUI

struct ComposeView: View {
    @Bindable var homeVM: HomeViewModel
    @Environment(\.dismiss) var dismiss

    @State private var text = ""
    @State private var phase: Phase = .composing
    @State private var sendError: String?
    @State private var alreadySent = false
    @FocusState private var focused: Bool

    enum Phase { case composing, sending, sent }

    var body: some View {
        ZStack {
            LinearGradient.relayBackground.ignoresSafeArea()

            switch phase {
            case .composing:
                composingView
            case .sending:
                Color.clear
            case .sent:
                sentView
            }
        }
        .onAppear { focused = true }
    }

    private var composingView: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 12) {
                Text("It may be read once.")
                    .font(.system(size: 14))
                    .opacity(0.4)
                Text("Or not at all.")
                    .font(.system(size: 14))
                    .opacity(0.4)
            }
            .padding(.top, 64)
            .padding(.bottom, 20)

            TextEditor(text: $text)
                .font(.system(size: 18))
                .focused($focused)
                .frame(minHeight: 120)
                .scrollContentBackground(.hidden)
                .background(Color.clear)
                .accessibilityIdentifier("compose.textEditor")
                .onChange(of: text) {
                    if text.count > 1000 { text = String(text.prefix(1000)) }
                }

            if let sendError {
                Text(sendError)
                    .font(.system(size: 13))
                    .opacity(0.45)
                    .padding(.top, 12)
                    .accessibilityIdentifier("compose.errorLabel")
            }

            Spacer()

            HStack {
                Spacer()
                if alreadySent {
                    Button("Done") { dismiss() }
                        .font(.system(size: 17))
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("compose.doneButton")
                } else {
                    Button("Send") { send() }
                        .font(.system(size: 17))
                        .opacity(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? 0.3 : 0.8)
                        .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("compose.sendButton")
                }
            }
            .padding(.bottom, 48)
        }
        .padding(.horizontal, 28)
    }

    private var sentView: some View {
        Text("Sent.")
            .font(.system(size: 24, weight: .regular))
            .transition(.opacity)
    }

    private func send() {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        sendError = nil
        phase = .sending

        Task {
            do {
                try await APIClient.shared.sendMessage(text: trimmed)
                withAnimation(.easeInOut(duration: 0.4)) { phase = .sent }
                await homeVM.loadStatus()
                try? await Task.sleep(for: .seconds(1.5))
                withAnimation(.easeInOut(duration: 0.3)) { dismiss() }
            } catch APIError.unauthorized {
                // Session expired — dismiss silently; HomeView will sign out
                dismiss()
            } catch APIError.suspended {
                await homeVM.loadStatus()
                dismiss()
            } catch APIError.alreadyUsedToday {
                phase = .composing
                sendError = "You've already sent today."
                alreadySent = true
            } catch {
                phase = .composing
                sendError = "Message not sent.\nPlease try again."  // case 2 — text preserved, screen stays open
            }
        }
    }
}

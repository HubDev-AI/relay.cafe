import SwiftUI

struct OnboardingView: View {
    let vm: AppViewModel
    @State private var agreedToTerms = false
    @State private var safariURL: URL?

    var body: some View {
        ZStack {
            LinearGradient.relayBackground.ignoresSafeArea()

            VStack(alignment: .leading, spacing: 0) {
                Spacer()

                Text("Relay.cafe")
                    .font(.system(size: 30, weight: .regular))
                    .padding(.bottom, 52)

                VStack(alignment: .leading, spacing: 8) {
                    Text("Once a day,")
                    Text("you may send a message.")
                    Text("Once a day,")
                    Text("you may receive one.")
                }
                .font(.system(size: 18, weight: .regular))
                .lineSpacing(4)

                Spacer()

                Button(action: { vm.completeOnboarding() }) {
                    Text("Continue")
                        .font(.system(size: 17, weight: .regular))
                        .opacity(agreedToTerms ? 0.7 : 0.2)
                }
                .buttonStyle(.plain)
                .disabled(!agreedToTerms)
                .accessibilityIdentifier("onboarding.continueButton")

                termsText
                    .padding(.top, 6)
                    .padding(.bottom, 32)
            }
            .padding(.horizontal, 28)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .sheet(item: $safariURL) { url in
            SafariView(url: url)
                .ignoresSafeArea()
        }
    }

    private var termsText: some View {
        HStack(spacing: 0) {
            Button(action: { agreedToTerms.toggle() }) {
                HStack(spacing: 6) {
                    Image(systemName: agreedToTerms ? "checkmark.square.fill" : "square")
                        .font(.system(size: 16))
                        .opacity(agreedToTerms ? 0.6 : 0.3)
                    Text("I agree with the")
                }
                .padding(.vertical, 8)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("onboarding.agreeCheckbox")

            Text(" ")

            Button(action: { safariURL = URL(string: "https://relay.cafe/terms") }) {
                Text("Terms of Use").underline()
            }
            .buttonStyle(.plain)

            Text(" and ")

            Button(action: { safariURL = URL(string: "https://relay.cafe/privacy") }) {
                Text("Privacy Policy").underline()
            }
            .buttonStyle(.plain)
        }
        .fixedSize()
        .font(.system(size: 11))
        .opacity(agreedToTerms ? 0.5 : 0.3)
    }
}

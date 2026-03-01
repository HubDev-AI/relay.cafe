import SwiftUI

struct OnboardingView: View {
    let vm: AppViewModel

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
                .padding(.bottom, 48)

                VStack(alignment: .leading, spacing: 8) {
                    Text("Messages are available for 24 hours.")
                    Text("They are automatically deleted after that.")
                }
                .font(.system(size: 18, weight: .regular))
                .lineSpacing(4)

                Spacer()

                Button(action: { vm.completeOnboarding() }) {
                    Text("Continue")
                        .font(.system(size: 17, weight: .regular))
                        .opacity(0.7)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("onboarding.continueButton")

                Text("By continuing, you agree to the Terms of Use and Privacy Policy.")
                    .font(.system(size: 11))
                    .opacity(0.3)
                    .padding(.top, 12)
                    .padding(.bottom, 32)
            }
            .padding(.horizontal, 28)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

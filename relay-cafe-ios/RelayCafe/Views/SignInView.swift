import SwiftUI
import AuthenticationServices

struct SignInView: View {
    let vm: AppViewModel
    @State private var error: String?

    var body: some View {
        ZStack {
            LinearGradient.relayBackground.ignoresSafeArea()

            VStack(spacing: 0) {
                Spacer()

                Text("Sign in to enter the relay.")
                    .font(.system(size: 18, weight: .regular))
                    .multilineTextAlignment(.center)
                    .padding(.bottom, 40)

                SignInWithAppleButton(.signIn, onRequest: configureRequest, onCompletion: handleResult)
                    .signInWithAppleButtonStyle(.black)
                    .frame(height: 50)
                    .padding(.horizontal, 28)

                Text("Your identity is not shown to others.")
                    .font(.system(size: 13, weight: .regular))
                    .opacity(0.5)
                    .padding(.top, 16)

                if let error {
                    Text(error)
                        .font(.system(size: 14))
                        .opacity(0.6)
                        .multilineTextAlignment(.center)
                        .padding(.top, 12)
                        .padding(.horizontal, 28)
                }

                Spacer()
            }
        }
    }

    private func configureRequest(_ request: ASAuthorizationAppleIDRequest) {
        request.requestedScopes = []
    }

    private func handleResult(_ result: Result<ASAuthorization, Error>) {
        switch result {
        case .success(let auth):
            guard
                let cred = auth.credential as? ASAuthorizationAppleIDCredential,
                let tokenData = cred.identityToken,
                let token = String(data: tokenData, encoding: .utf8)
            else {
                error = "Unable to sign in.\nPlease try again."
                return
            }

            Task {
                do {
                    _ = try await APIClient.shared.signInWithApple(
                        identityToken: token
                    )
                    await MainActor.run { vm.didSignIn() }
                } catch {
                    await MainActor.run {
                        self.error = "Unable to sign in.\nPlease try again."
                    }
                }
            }

        case .failure(let err):
            let nsErr = err as NSError
            // 1001 = user cancelled — silent. All other failures show generic message.
            if nsErr.code != 1001 {
                error = "Unable to sign in.\nPlease try again."
            }
        }
    }

}

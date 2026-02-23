import SwiftUI
import SafariServices

struct SettingsView: View {
    let appVM: AppViewModel
    @State private var showDeleteConfirm = false
    @State private var isDeleting = false
    @State private var deleteError: String?
    @State private var safariURL: URL?

    var body: some View {
        ZStack {
            LinearGradient.relayBackground.ignoresSafeArea()

            VStack {
                Spacer()

                if showDeleteConfirm {
                    deleteConfirmView
                } else {
                    VStack(spacing: 10) {
                        Button("Delete account") {
                            showDeleteConfirm = true
                        }
                        .font(.system(size: 17))
                        .opacity(0.5)
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("settings.deleteButton")

                        Text("Your account and data will be permanently removed.")
                            .font(.system(size: 13))
                            .opacity(0.3)
                            .multilineTextAlignment(.center)
                    }
                }

                Spacer()

                VStack(spacing: 16) {
                    Button("Terms of Use") {
                        safariURL = URL(string: "https://relay.cafe/terms")
                    }
                    .font(.system(size: 14))
                    .opacity(0.35)
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("settings.termsButton")

                    Button("Privacy Policy") {
                        safariURL = URL(string: "https://relay.cafe/privacy")
                    }
                    .font(.system(size: 14))
                    .opacity(0.35)
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("settings.privacyButton")
                }
                .padding(.bottom, 32)
            }
            .padding(.horizontal, 28)
        }
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: $safariURL) { url in
            SafariView(url: url)
                .ignoresSafeArea()
        }
    }

    private var deleteConfirmView: some View {
        VStack(spacing: 24) {
            VStack(spacing: 12) {
                Text("Your account will be permanently removed.")
                    .font(.system(size: 17))
                    .multilineTextAlignment(.center)
                Text("This cannot be undone.")
                    .font(.system(size: 17))
                    .multilineTextAlignment(.center)
            }
            .opacity(0.7)

            if let deleteError {
                Text(deleteError)
                    .font(.system(size: 14))
                    .opacity(0.6)
                    .multilineTextAlignment(.center)
            }

            HStack(spacing: 40) {
                Button("Cancel") {
                    showDeleteConfirm = false
                    deleteError = nil
                }
                .font(.system(size: 17))
                .opacity(0.5)
                .buttonStyle(.plain)
                .accessibilityIdentifier("settings.cancelButton")

                Button("Delete account") {
                    Task { await deleteAccount() }
                }
                .font(.system(size: 17))
                .opacity(isDeleting ? 0.3 : 0.7)
                .disabled(isDeleting)
                .buttonStyle(.plain)
                .accessibilityIdentifier("settings.confirmDeleteButton")
            }
        }
    }

    private func deleteAccount() async {
        isDeleting = true
        deleteError = nil
        do {
            try await APIClient.shared.deleteAccount()
            await MainActor.run {
                appVM.didDeleteAccount()
            }
        } catch {
            isDeleting = false
            deleteError = "Account not deleted.\nPlease try again."
        }
    }
}

extension URL: @retroactive Identifiable {
    public var id: String { absoluteString }
}

struct SafariView: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> SFSafariViewController {
        SFSafariViewController(url: url)
    }

    func updateUIViewController(_ uiViewController: SFSafariViewController, context: Context) {}
}

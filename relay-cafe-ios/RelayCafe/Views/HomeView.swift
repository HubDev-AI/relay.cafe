import SwiftUI

struct HomeView: View {
    let vm: AppViewModel
    @State private var homeVM = HomeViewModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        NavigationStack {
            ZStack {
                LinearGradient.relayBackground.ignoresSafeArea()

                VStack(spacing: 0) {
                    Spacer()

                    sendSection
                        .padding(.bottom, 56)

                    receiveSection

                    Spacer()

                    settingsButton
                        .padding(.bottom, 48)
                }
                .padding(.horizontal, 28)
            }
            .toolbar(.hidden, for: .navigationBar)
            .task { await homeVM.loadStatus() }
            .onChange(of: scenePhase) {
                if scenePhase == .active {
                    Task { await homeVM.loadStatus() }
                }
            }
            .onReceive(Timer.publish(every: 60, on: .main, in: .common).autoconnect()) { _ in
                guard scenePhase == .active else { return }
                Task { await homeVM.loadStatus() }
            }
            .onChange(of: homeVM.isUnauthorized) {
                if homeVM.isUnauthorized {
                    APIClient.shared.clearTokenSync()
                    vm.didSignOut()
                }
            }
            .sheet(isPresented: $homeVM.showCompose) {
                ComposeView(homeVM: homeVM)
            }
            .sheet(item: $homeVM.presentedMessage) { msg in
                MessageView(message: msg, homeVM: homeVM)
            }
        }
    }

    // Layout never shifts. Buttons always visible. Only opacity + interaction changes.
    private var sendSection: some View {
        let used = homeVM.status?.sendUsed == true
        return VStack(spacing: 8) {
            Button("Write today's message") {
                if !used && !homeVM.isSuspended { homeVM.showCompose = true }
            }
            .font(.system(size: 17, weight: .regular))
            .buttonStyle(.plain)
            .opacity(used || homeVM.isSuspended ? 0.62 : 1.0)
            .disabled(used || homeVM.isSuspended)
            .accessibilityIdentifier("home.sendButton")

            if homeVM.isSuspended {
                Text("Your account has been suspended\nfor violating community guidelines.")
                    .font(.system(size: 13))
                    .opacity(0.3)
                    .multilineTextAlignment(.center)
            } else if used {
                Text("You've already sent today.")
                    .font(.system(size: 13))
                    .opacity(0.4)
                    .accessibilityIdentifier("home.sendUsedLabel")
            } else {
                // Reserve space so layout stays identical
                Text(" ").font(.system(size: 13))
            }
        }
    }

    private var receiveSection: some View {
        let used = homeVM.status?.receiveUsed == true
        let isLoading = homeVM.receiveState == .loading
        let isQuiet = homeVM.receiveState == .quiet
        let receiveError: String? = {
            if case .error(let msg) = homeVM.receiveState { return msg }
            return nil
        }()
        return VStack(spacing: 8) {
            Button("Open today's message") {
                if !used && !isLoading && !homeVM.isSuspended {
                    Task { await homeVM.openReceive() }
                }
            }
            .font(.system(size: 17, weight: .regular))
            .buttonStyle(.plain)
            .opacity(used || isLoading || homeVM.isSuspended ? 0.62 : 1.0)
            .disabled(used || isLoading || homeVM.isSuspended)
            .accessibilityIdentifier("home.receiveButton")

            // Sub-label: stable height, content varies
            Group {
                if !homeVM.isSuspended, let notice = homeVM.moderationNotice {
                    Text(notice)
                        .opacity(0.5)
                        .onAppear {
                            Task {
                                try? await Task.sleep(for: .seconds(3))
                                homeVM.clearModerationNotice()
                            }
                        }
                } else if used {
                    Text("You've already received today.")
                        .opacity(0.4)
                        .accessibilityIdentifier("home.receiveUsedLabel")
                } else if isQuiet {
                    Text("The relay is quiet today.")
                        .opacity(0.4)
                        .accessibilityIdentifier("home.quietLabel")
                } else if let receiveError {
                    Text(receiveError)
                        .opacity(0.6)
                } else if let statusError = homeVM.statusError {
                    Text(statusError)
                        .opacity(0.6)
                } else {
                    Text(" ")  // holds space
                }
            }
            .font(.system(size: 13))
        }
    }

    private var settingsButton: some View {
        NavigationLink(destination: SettingsView(appVM: vm)) {
            Text("Settings")
                .font(.system(size: 13))
                .opacity(0.3)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("home.settingsButton")
    }
}

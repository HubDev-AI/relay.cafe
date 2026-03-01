import SwiftUI

@main
struct RelayCafeApp: App {
    @State private var appVM = AppViewModel()

    init() {
        if ProcessInfo.processInfo.arguments.contains("-resetState") {
            UserDefaults.standard.removeObject(forKey: "onboardingComplete")
            let keychain = KeychainManager()
            try? keychain.delete(key: "sessionToken")
            try? keychain.delete(key: "tokenExpiresAt")
        }
    }

    var body: some Scene {
        WindowGroup {
            switch appVM.route {
            case .onboarding: OnboardingView(vm: appVM)
            case .signIn: SignInView(vm: appVM)
            case .home: HomeView(vm: appVM)
            case .farewell: FarewellView()
            }
        }
    }
}

import Foundation

enum AppRoute {
    case onboarding
    case signIn
    case home
    case farewell
}

@MainActor
@Observable
final class AppViewModel {
    var route: AppRoute = .onboarding
    private let keychain = KeychainManager()

    init() {
        if let _ = try? keychain.load(key: "sessionToken") {
            route = .home
        } else if UserDefaults.standard.bool(forKey: "onboardingComplete") {
            route = .signIn
        } else {
            route = .onboarding
        }
    }

    func completeOnboarding() {
        UserDefaults.standard.set(true, forKey: "onboardingComplete")
        route = .signIn
    }

    func didSignIn() {
        route = .home
    }

    func didSignOut() {
        route = .signIn
    }

    func didDeleteAccount() {
        UserDefaults.standard.removeObject(forKey: "onboardingComplete")
        route = .farewell
        Task {
            try? await Task.sleep(for: .seconds(2.5))
            route = .onboarding
        }
    }
}

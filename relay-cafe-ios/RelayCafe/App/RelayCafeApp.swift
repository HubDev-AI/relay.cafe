import SwiftUI

@main
struct RelayCafeApp: App {
    @State private var appVM = AppViewModel()

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

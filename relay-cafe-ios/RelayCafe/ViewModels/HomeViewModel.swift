import Foundation

@MainActor
@Observable
final class HomeViewModel {
    var status: DayStatus?
    var isLoading = false
    var showCompose = false
    var presentedMessage: MessageResponse?
    var receiveState: ReceiveState = .idle
    var statusError: String?
    var isUnauthorized = false

    enum ReceiveState: Equatable {
        case idle, loading, quiet, received(MessageResponse), error(String)
    }

    func loadStatus() async {
        isLoading = true
        statusError = nil
        defer { isLoading = false }
        do {
            status = try await APIClient.shared.getStatus()
        } catch APIError.unauthorized {
            isUnauthorized = true
        } catch {
            statusError = "Connection unavailable.\nPlease try again."  // case 1
        }
    }

    func openReceive() async {
        receiveState = .loading
        // intentional 2-second pause per design spec
        try? await Task.sleep(for: .seconds(2))

        do {
            if let msg = try await APIClient.shared.receiveMessage() {
                receiveState = .received(msg)
                presentedMessage = msg
            } else {
                receiveState = .quiet
            }
        } catch APIError.alreadyUsedToday {
            await loadStatus()
        } catch APIError.unauthorized {
            isUnauthorized = true
        } catch APIError.serverError(404) {
            receiveState = .error("This message is no longer available.")
        } catch {
            receiveState = .error("Unable to open message.\nPlease try again.")  // case 3
        }
    }
}

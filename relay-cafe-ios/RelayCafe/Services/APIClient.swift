import Foundation

// MARK: - Models

struct DayStatus: Codable {
    let sendUsed: Bool
    let receiveUsed: Bool
    let date: Int
}

struct MessageResponse: Codable, Equatable, Identifiable {
    let id: String
    let text: String
    let expiresAt: Date
}

// MARK: - APIError

enum APIError: Error {
    case unauthorized
    case alreadyUsedToday
    case noMessage          // 204 — relay is quiet
    case networkError(Error)
    case serverError(Int)
    case decodingError(Error)
}

// MARK: - APIClient

actor APIClient {
    static let shared = APIClient()

    // Force-unwrap is safe: both literals are valid URLs at compile time.
    #if DEBUG
    private static let defaultBaseURL = URL(string: "http://localhost:3000")!
    #else
    private static let defaultBaseURL = URL(string: "https://api.relay.cafe")!
    #endif

    private let baseURL: URL
    private var sessionToken: String?
    private var tokenExpiresAt: Date?
    private let keychain = KeychainManager()
    private let decoder: JSONDecoder = {
        let d = JSONDecoder()
        // Server sends dates as epoch milliseconds (number)
        d.dateDecodingStrategy = .custom { decoder in
            let c = try decoder.singleValueContainer()
            let ms = try c.decode(Double.self)
            return Date(timeIntervalSince1970: ms / 1000)
        }
        return d
    }()

    init(baseURL: URL = APIClient.defaultBaseURL) {
        self.baseURL = baseURL
        sessionToken = try? keychain.load(key: "sessionToken")
        if let expiryString = try? keychain.load(key: "tokenExpiresAt"),
           let ms = Double(expiryString) {
            tokenExpiresAt = Date(timeIntervalSince1970: ms / 1000)
        }
    }

    func setToken(_ token: String, expiresAt: Date) throws {
        sessionToken = token
        tokenExpiresAt = expiresAt
        try keychain.save(key: "sessionToken", value: token)
        try keychain.save(key: "tokenExpiresAt", value: String(Int(expiresAt.timeIntervalSince1970 * 1000)))
    }

    func clearToken() {
        sessionToken = nil
        tokenExpiresAt = nil
        try? keychain.delete(key: "sessionToken")
        try? keychain.delete(key: "tokenExpiresAt")
    }

    /// Non-isolated convenience so callers on MainActor can fire-and-forget token cleanup.
    nonisolated func clearTokenSync() {
        Task { await clearToken() }
    }

    // MARK: Auth

    func signInWithApple(identityToken: String, deviceFingerprint: String) async throws -> String {
        let body: [String: Any] = [
            "identityToken": identityToken,
            "deviceFingerprint": deviceFingerprint,
        ]
        struct Response: Codable { let sessionToken: String; let expiresAt: Double }
        let response: Response = try await post("/auth/apple", body: body, requiresAuth: false)
        try setToken(
            response.sessionToken,
            expiresAt: Date(timeIntervalSince1970: response.expiresAt / 1000)
        )
        return response.sessionToken
    }

    func signOut() async throws {
        try await delete("/auth/session")
        clearToken()
    }

    // MARK: Status

    func getStatus() async throws -> DayStatus {
        try await get("/me/status")
    }

    // MARK: Messages

    func sendMessage(text: String) async throws {
        try await postEmpty("/messages", body: ["text": text])
    }

    func receiveMessage() async throws -> MessageResponse? {
        do {
            return try await get("/messages/today")
        } catch APIError.noMessage {
            return nil
        }
    }

    func deleteAccount() async throws {
        try await delete("/me")
        clearToken()
    }

    // MARK: Private helpers

    private func get<T: Decodable>(_ path: String) async throws -> T {
        var req = URLRequest(url: baseURL.appendingPathComponent(path))
        try attachAuth(&req)
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await URLSession.shared.data(for: req)
        } catch {
            throw APIError.networkError(error)
        }
        try validate(response, data: data)
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIError.decodingError(error)
        }
    }

    private func post<T: Decodable>(
        _ path: String, body: [String: Any], requiresAuth: Bool = true
    ) async throws -> T {
        var req = URLRequest(url: baseURL.appendingPathComponent(path))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        if requiresAuth { try attachAuth(&req) }
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await URLSession.shared.data(for: req)
        } catch {
            throw APIError.networkError(error)
        }
        try validate(response, data: data)
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIError.decodingError(error)
        }
    }

    private func postEmpty(_ path: String, body: [String: Any]) async throws {
        var req = URLRequest(url: baseURL.appendingPathComponent(path))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        try attachAuth(&req)
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await URLSession.shared.data(for: req)
        } catch {
            throw APIError.networkError(error)
        }
        try validate(response, data: data)
    }

    private func delete(_ path: String) async throws {
        var req = URLRequest(url: baseURL.appendingPathComponent(path))
        req.httpMethod = "DELETE"
        try attachAuth(&req)
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await URLSession.shared.data(for: req)
        } catch {
            throw APIError.networkError(error)
        }
        try validate(response, data: data, allow204: true)
    }

    private func attachAuth(_ req: inout URLRequest) throws {
        guard let token = sessionToken else {
            throw APIError.unauthorized
        }
        if let expiresAt = tokenExpiresAt, expiresAt <= Date() {
            clearToken()
            throw APIError.unauthorized
        }
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    }

    private func validate(_ response: URLResponse, data: Data, allow204: Bool = false) throws {
        guard let http = response as? HTTPURLResponse else {
            throw APIError.serverError(-1)
        }
        switch http.statusCode {
        case 200...203: return
        case 204 where allow204: return
        case 204: throw APIError.noMessage
        case 401: throw APIError.unauthorized
        case 429: throw APIError.alreadyUsedToday
        default: throw APIError.serverError(http.statusCode)
        }
    }
}

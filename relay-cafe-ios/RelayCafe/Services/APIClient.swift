import Foundation
import os
import UIKit

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
    case cooldown(until: Date)
    case suspended
    case networkError(Error)
    case serverError(Int)
    case decodingError(Error)
}

// MARK: - APIClient

actor APIClient {
    static let shared = APIClient()

    private static let defaultBaseURL: URL = {
        // UI test override via launch environment
        if let envURL = ProcessInfo.processInfo.environment["API_BASE_URL"],
           let url = URL(string: envURL) {
            return url
        }
        let info = Bundle.main.infoDictionary
        if let urlString = info?["APIBaseURL"] as? String, let url = URL(string: urlString) {
            return url
        }
        return URL(string: "https://api.relay.cafe")!
    }()
    private static let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.relaycafe", category: "APIClient")

    private let baseURL: URL
    private let session: URLSession
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
        let info = Bundle.main.infoDictionary
        let requestTimeout = (info?["APITimeoutRequest"] as? NSNumber)?.doubleValue ?? 5
        let resourceTimeout = (info?["APITimeoutResource"] as? NSNumber)?.doubleValue ?? 30
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = requestTimeout
        config.timeoutIntervalForResource = resourceTimeout
        self.session = URLSession(configuration: config)
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

    func signInWithApple(identityToken: String) async throws -> String {
        let body: [String: Any] = [
            "identityToken": identityToken,
        ]
        struct Response: Codable { let sessionToken: String; let expiresAt: Double }
        let response: Response = try await post("/v1/auth/apple", body: body, requiresAuth: false, timeout: 30)
        try setToken(
            response.sessionToken,
            expiresAt: Date(timeIntervalSince1970: response.expiresAt / 1000)
        )
        return response.sessionToken
    }

    func signOut() async throws {
        try await delete("/v1/auth/session")
        clearToken()
    }

    // MARK: Status

    func getStatus() async throws -> DayStatus {
        try await get("/v1/me/status")
    }

    // MARK: Messages

    func sendMessage(text: String) async throws {
        try await postEmpty("/v1/messages", body: ["text": text])
    }

    func receiveMessage() async throws -> MessageResponse? {
        try await getOptional("/v1/messages/today")
    }

    func deleteAccount() async throws {
        try await delete("/v1/me")
        clearToken()
    }

    // MARK: Moderation

    func reportMessage(id: String) async throws {
        try await postEmpty("/v1/messages/\(id)/report", body: [:])
    }

    func blockSender(messageId: String) async throws {
        try await postEmpty("/v1/messages/\(messageId)/block", body: [:])
    }

    // MARK: Telemetry

    func reportTranslationEvent(
        event: String,
        sourceLanguage: String?,
        targetLanguage: String?,
        errorCode: String? = nil,
        errorDomain: String? = nil
    ) async {
        let osVersion = await UIDevice.current.systemVersion
        var body: [String: Any] = [
            "event": event,
            "osVersion": "iOS \(osVersion)",
            "appVersion": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "unknown",
        ]
        if let sourceLanguage { body["sourceLanguage"] = sourceLanguage }
        if let targetLanguage { body["targetLanguage"] = targetLanguage }
        if let errorCode { body["errorCode"] = errorCode }
        if let errorDomain { body["errorDomain"] = errorDomain }

        try? await postEmpty("/v1/telemetry", body: body)
    }

    // MARK: Private helpers

    private func get<T: Decodable>(_ path: String) async throws -> T {
        let (data, _) = try await request(path, method: "GET")
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIError.decodingError(error)
        }
    }

    /// GET that returns nil on 204 (no content) instead of throwing.
    private func getOptional<T: Decodable>(_ path: String) async throws -> T? {
        let (data, response) = try await request(path, method: "GET")
        guard let http = response as? HTTPURLResponse else { return nil }
        if http.statusCode == 204 || data.isEmpty { return nil }
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIError.decodingError(error)
        }
    }

    private func post<T: Decodable>(
        _ path: String, body: [String: Any], requiresAuth: Bool = true, timeout: TimeInterval? = nil
    ) async throws -> T {
        let (data, _) = try await request(path, method: "POST", body: body, requiresAuth: requiresAuth, timeout: timeout)
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIError.decodingError(error)
        }
    }

    private func postEmpty(_ path: String, body: [String: Any]) async throws {
        _ = try await request(path, method: "POST", body: body)
    }

    private func delete(_ path: String) async throws {
        _ = try await request(path, method: "DELETE")
    }

    // MARK: Single request pipeline

    private func request(
        _ path: String,
        method: String,
        body: [String: Any]? = nil,
        requiresAuth: Bool = true,
        timeout: TimeInterval? = nil
    ) async throws -> (Data, URLResponse) {
        var req = URLRequest(url: baseURL.appendingPathComponent(path))
        req.httpMethod = method
        if let timeout { req.timeoutInterval = timeout }
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        if requiresAuth { try attachAuth(&req) }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: req)
        } catch {
            let nsError = error as NSError
            if nsError.code == NSURLErrorTimedOut {
                Self.logger.warning("Request timed out: \(method) \(path)")
            } else {
                Self.logger.warning("Network error: \(method) \(path) — \(error.localizedDescription)")
            }
            throw APIError.networkError(error)
        }

        guard let http = response as? HTTPURLResponse else {
            throw APIError.serverError(-1)
        }

        switch http.statusCode {
        case 200...299: return (data, response)
        case 401:       throw APIError.unauthorized
        case 403:
            struct ForbiddenResponse: Decodable { let error: String; let cooldownUntil: Double? }
            if let body = try? JSONDecoder().decode(ForbiddenResponse.self, from: data) {
                if body.error == "cooldown", let ms = body.cooldownUntil {
                    throw APIError.cooldown(until: Date(timeIntervalSince1970: ms / 1000))
                }
                if body.error.contains("suspended") {
                    throw APIError.suspended
                }
            }
            throw APIError.serverError(403)
        case 429:       throw APIError.alreadyUsedToday
        default:        throw APIError.serverError(http.statusCode)
        }
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
}

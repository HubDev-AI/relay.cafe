import XCTest
@testable import RelayCafe

final class APIClientTests: XCTestCase {
    /// Custom decoder matching APIClient's decoder — supports ISO8601 with and without fractional seconds.
    private let decoder: JSONDecoder = {
        let d = JSONDecoder()
        let fmt = ISO8601DateFormatter()
        fmt.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let fmt2 = ISO8601DateFormatter()
        d.dateDecodingStrategy = .custom { decoder in
            let c = try decoder.singleValueContainer()
            let s = try c.decode(String.self)
            if let d = fmt.date(from: s) { return d }
            if let d = fmt2.date(from: s) { return d }
            throw DecodingError.dataCorruptedError(in: c, debugDescription: "Invalid ISO8601 date: \(s)")
        }
        return d
    }()

    func testStatusDecodesCorrectly() throws {
        let json = """
        {"sendUsed": true, "receiveUsed": false, "date": "2026-02-23"}
        """.data(using: .utf8)!

        let status = try JSONDecoder().decode(DayStatus.self, from: json)
        XCTAssertTrue(status.sendUsed)
        XCTAssertFalse(status.receiveUsed)
    }

    func testMessageResponseDecodesWithMilliseconds() throws {
        let json = """
        {"id": "abc-123", "text": "hello world", "expiresAt": "2026-02-23T11:45:07.145Z"}
        """.data(using: .utf8)!

        let msg = try decoder.decode(MessageResponse.self, from: json)
        XCTAssertEqual(msg.id, "abc-123")
        XCTAssertEqual(msg.text, "hello world")
        XCTAssertNotNil(msg.expiresAt)
    }

    func testMessageResponseDecodesWithoutMilliseconds() throws {
        let json = """
        {"id": "abc-123", "text": "hello world", "expiresAt": "2026-02-23T11:45:07Z"}
        """.data(using: .utf8)!

        let msg = try decoder.decode(MessageResponse.self, from: json)
        XCTAssertEqual(msg.text, "hello world")
    }

    func testMessageResponseMissingExpiresAtThrows() {
        let json = """
        {"id": "abc-123", "text": "hello world"}
        """.data(using: .utf8)!

        XCTAssertThrowsError(try decoder.decode(MessageResponse.self, from: json))
    }

    func testStatusAllCombinations() throws {
        let combos: [(Bool, Bool)] = [(false, false), (true, false), (false, true), (true, true)]
        for (send, receive) in combos {
            let json = """
            {"sendUsed": \(send), "receiveUsed": \(receive), "date": "2026-02-23"}
            """.data(using: .utf8)!
            let status = try JSONDecoder().decode(DayStatus.self, from: json)
            XCTAssertEqual(status.sendUsed, send)
            XCTAssertEqual(status.receiveUsed, receive)
        }
    }
}

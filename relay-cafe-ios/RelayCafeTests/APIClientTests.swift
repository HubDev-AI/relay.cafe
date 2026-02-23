import XCTest
@testable import RelayCafe

final class APIClientTests: XCTestCase {
    /// Custom decoder matching APIClient's decoder — decodes epoch milliseconds to Date.
    private let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .custom { decoder in
            let c = try decoder.singleValueContainer()
            let ms = try c.decode(Double.self)
            return Date(timeIntervalSince1970: ms / 1000)
        }
        return d
    }()

    func testStatusDecodesCorrectly() throws {
        let json = """
        {"sendUsed": true, "receiveUsed": false, "date": 20535}
        """.data(using: .utf8)!

        let status = try JSONDecoder().decode(DayStatus.self, from: json)
        XCTAssertTrue(status.sendUsed)
        XCTAssertFalse(status.receiveUsed)
        XCTAssertEqual(status.date, 20535)
    }

    func testMessageResponseDecodesEpochMs() throws {
        let epochMs = 1771843507145.0  // 2026-02-23T11:45:07.145Z
        let json = """
        {"id": "abc-123", "text": "hello world", "expiresAt": \(epochMs)}
        """.data(using: .utf8)!

        let msg = try decoder.decode(MessageResponse.self, from: json)
        XCTAssertEqual(msg.id, "abc-123")
        XCTAssertEqual(msg.text, "hello world")
        XCTAssertNotNil(msg.expiresAt)
        XCTAssertEqual(msg.expiresAt.timeIntervalSince1970, epochMs / 1000, accuracy: 0.001)
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
            {"sendUsed": \(send), "receiveUsed": \(receive), "date": 20535}
            """.data(using: .utf8)!
            let status = try JSONDecoder().decode(DayStatus.self, from: json)
            XCTAssertEqual(status.sendUsed, send)
            XCTAssertEqual(status.receiveUsed, receive)
        }
    }

    func testEpochMsDecoderHandlesWholeNumbers() throws {
        let json = """
        {"id": "abc", "text": "test", "expiresAt": 1771843507000}
        """.data(using: .utf8)!

        let msg = try decoder.decode(MessageResponse.self, from: json)
        XCTAssertEqual(msg.expiresAt.timeIntervalSince1970, 1771843507.0, accuracy: 0.001)
    }
}

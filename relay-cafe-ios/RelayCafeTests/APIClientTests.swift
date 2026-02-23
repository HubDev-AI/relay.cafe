import XCTest
@testable import RelayCafe

final class APIClientTests: XCTestCase {
    func testStatusDecodesCorrectly() throws {
        let json = """
        {"sendUsed": true, "receiveUsed": false, "date": "2026-02-23"}
        """.data(using: .utf8)!

        let status = try JSONDecoder().decode(DayStatus.self, from: json)
        XCTAssertTrue(status.sendUsed)
        XCTAssertFalse(status.receiveUsed)
    }

    func testMessageResponseDecodesCorrectly() throws {
        let json = """
        {"id": "abc-123", "text": "hello world"}
        """.data(using: .utf8)!

        let msg = try JSONDecoder().decode(MessageResponse.self, from: json)
        XCTAssertEqual(msg.text, "hello world")
    }
}

import XCTest
@testable import RelayCafe

final class KeychainManagerTests: XCTestCase {
    let km = KeychainManager()
    let key = "test.session.token"

    override func tearDown() {
        try? km.delete(key: key)
    }

    func testSaveAndLoad() throws {
        try km.save(key: key, value: "abc123")
        let loaded = try km.load(key: key)
        XCTAssertEqual(loaded, "abc123")
    }

    func testOverwrite() throws {
        try km.save(key: key, value: "first")
        try km.save(key: key, value: "second")
        XCTAssertEqual(try km.load(key: key), "second")
    }

    func testDeletedKeyThrows() throws {
        try? km.delete(key: key)
        XCTAssertThrowsError(try km.load(key: key))
    }
}

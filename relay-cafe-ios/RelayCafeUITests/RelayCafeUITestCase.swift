import XCTest

/// Base class for all UI tests.
/// Ensures the app launches in a clean state pointing at the local test server.
class RelayCafeUITestCase: XCTestCase {
    var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments += ["-resetState"]
        // Point to local API for E2E testing
        app.launchEnvironment["API_BASE_URL"] = "http://localhost:3000"
        app.launch()
    }

    override func tearDownWithError() throws {
        app.terminate()
    }

    // MARK: - Helpers

    /// Wait for an element to exist with a timeout.
    func waitForElement(_ element: XCUIElement, timeout: TimeInterval = 5) {
        let exists = element.waitForExistence(timeout: timeout)
        XCTAssertTrue(exists, "Expected element to exist: \(element)")
    }
}

import XCTest
import UIKit

final class ScreenshotDetectionTests: XCTestCase {
    func testScreenshotNotificationNameExists() {
        let name = UIApplication.userDidTakeScreenshotNotification
        XCTAssertEqual(name.rawValue, "UIApplicationUserDidTakeScreenshotNotification")
    }

    func testDebugSimulateScreenshotNotificationCanBePosted() {
        #if DEBUG
        let expectation = expectation(forNotification: Notification.Name("relay.simulateScreenshot"), object: nil)
        NotificationCenter.default.post(name: Notification.Name("relay.simulateScreenshot"), object: nil)
        wait(for: [expectation], timeout: 1.0)
        #endif
    }
}

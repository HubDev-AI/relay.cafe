import XCTest

final class OnboardingUITests: RelayCafeUITestCase {
    func testOnboardingShowsRelayCopy() {
        waitForElement(app.staticTexts["Once a day,"])
        XCTAssertTrue(app.staticTexts["you may send a message."].exists)
        XCTAssertTrue(app.staticTexts["you may receive one."].exists)
    }

    func testContinueButtonExists() {
        let continueButton = app.buttons["onboarding.continueButton"]
        waitForElement(continueButton)
        XCTAssertTrue(continueButton.isEnabled)
    }
}

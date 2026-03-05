import XCTest

final class SettingsUITests: RelayCafeUITestCase {

    func testOnboardingShowsRetentionCopy() {
        // After -resetState, app shows onboarding
        waitForElement(app.staticTexts["Once a day,"])
        XCTAssertTrue(app.staticTexts["Messages are available for 24 hours."].exists)
        XCTAssertTrue(app.staticTexts["They are automatically deleted after that."].exists)
    }

    func testContinueButtonNavigatesToSignIn() {
        let continueButton = app.buttons["onboarding.continueButton"]
        waitForElement(continueButton)
        continueButton.tap()

        // Should navigate to sign-in screen
        let signInButton = app.buttons["Sign in with Apple"]
        waitForElement(signInButton, timeout: 3)
    }
}

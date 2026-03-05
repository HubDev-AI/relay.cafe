import XCTest

final class ModerationUITests: RelayCafeUITestCase {

    // NOTE: Full E2E tests (send → receive → report → block) require
    // Apple Sign-In which cannot be automated in XCUITest.
    // The API-level E2E tests cover the full moderation flow.
    // These tests verify UI element presence and accessibility.

    func testOnboardingContinueButtonIsAccessible() {
        let button = app.buttons["onboarding.continueButton"]
        waitForElement(button)
        XCTAssertTrue(button.isHittable)
        XCTAssertTrue(button.isEnabled)
    }

    // The following tests are structured for when a test user session
    // can be injected. They are currently skipped but serve as a template.

    // To enable: implement a test-only auth bypass that injects a session
    // token into the keychain before launch, bypassing Apple Sign-In.
    // Example:
    //   app.launchArguments += ["-testToken", "<valid-session-token>"]
    //   Then in AppViewModel.init(), check for -testToken and inject it.
}

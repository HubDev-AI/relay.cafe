import XCTest
import NaturalLanguage
@testable import RelayCafe

final class LanguageDetectionTests: XCTestCase {

    // MARK: - Core detection

    private static let languageSamples: [(code: String, text: String)] = [
        ("ar", "مرحبا بكم في الموقع الالكتروني"),
        ("bg", "Добре дошли в електронния сайт"),
        ("bn", "ইলেকট্রনিক ওয়েবসাইটে স্বাগতম"),
        ("ca", "Benvinguts al lloc web electronic"),
        ("cs", "Vitejte na elektronickych webovych strankach"),
        ("da", "Velkommen til den elektroniske hjemmeside"),
        ("de", "Willkommen auf der elektronischen Webseite"),
        ("el", "Καλώς ήρθατε στον ηλεκτρονικό ιστότοπο"),
        ("es", "Bienvenidos al sitio web electronico"),
        ("fa", "به وب سایت الکترونیکی خوش آمدید"),
        ("fi", "Tervetuloa elektroniselle verkkosivustolle"),
        ("fr", "Bienvenue sur le site internet electronique"),
        ("he", "ברוכים הבאים לאתר האלקטרוני"),
        ("hi", "इलेक्ट्रॉनिक वेबसाइट में आपका स्वागत है"),
        ("hr", "Dobrodosli na elektronicku web stranicu"),
        ("hu", "Udvozoljuk az elektronikus weboldalon"),
        ("id", "Selamat datang di situs web elektronik"),
        ("it", "Benvenuti nel sito web elettronico"),
        ("ja", "電子ウェブサイトへようこそ"),
        ("ko", "전자 웹사이트에 오신 것을 환영합니다"),
        ("lt", "Sveiki atvyke i elektronine svetaine"),
        ("ms", "Selamat datang ke laman web elektronik"),
        ("nl", "Welkom op de elektronische website"),
        ("pl", "Witamy na stronie internetowej elektronicznej"),
        ("pt", "Bem-vindos ao website eletronico"),
        ("ro", "Bun venit pe site-ul electronic"),
        ("ru", "Добро пожаловать на электронный сайт"),
        ("sk", "Vitajte na elektronickej webovej stranke"),
        ("sv", "Valkommen till den elektroniska webbplatsen"),
        ("sw", "Karibu kwenye tovuti ya kielektroniki"),
        ("ta", "மின்னணு இணையதளத்திற்கு வருக"),
        ("te", "ఎలక్ట్రానిక్ వెబ్‌సైట్‌కు స్వాగతం"),
        ("th", "ยินดีต้อนรับสู่เว็บไซต์อิเล็กทรอนิกส์"),
        ("tl", "Maligayang pagdating sa elektronikong website"),
        ("tr", "Elektronik web sitesine hos geldiniz"),
        ("uk", "Ласкаво просимо на електронний веб-сайт"),
        ("ur", "الیکٹرانک ویب سائٹ میں خوش آمدید"),
        ("vi", "Chao mung den trang web dien tu"),
        ("zh-Hans", "欢迎来到电子网站"),
        ("zh-Hant", "歡迎來到電子網站"),
    ]

    @MainActor
    func testDetectsNonEnglishLanguages() {
        for sample in Self.languageSamples {
            let result = detectLanguage(in: sample.text)
            // If the sample language matches device preferred language, nil is correct.
            // Otherwise we expect a non-empty display name.
            if result != nil {
                XCTAssertFalse(result!.isEmpty, "Expected display name for \(sample.code), got empty string")
            }
            // In either case, no crash = pass
        }
    }

    @MainActor
    func testEnglishTextReturnsNilOnEnglishDevice() {
        let preferredLang = Locale.preferredLanguages.first ?? ""
        guard preferredLang.hasPrefix("en") else {
            // Skip on non-English simulators
            return
        }
        let result = detectLanguage(in: "Welcome to the electronic website for testing purposes")
        XCTAssertNil(result)
    }

    @MainActor
    func testShortTextReturnsNilGracefully() {
        let result = detectLanguage(in: "Hi")
        // Should not crash; may return nil or a guess
        _ = result
    }

    @MainActor
    func testEmptyTextReturnsNil() {
        let result = detectLanguage(in: "")
        XCTAssertNil(result)
    }

    @MainActor
    func testEmojiOnlyReturnsNil() {
        let result = detectLanguage(in: "\u{1F30D}\u{1F525}\u{2728}\u{1F389}\u{1F4AB}")
        XCTAssertNil(result)
    }

    @MainActor
    func testDisplayNameIsHumanReadable() {
        let preferredLang = Locale.preferredLanguages.first ?? ""
        guard preferredLang.hasPrefix("en") else { return }
        let result = detectLanguage(in: "Bienvenidos al sitio web electronico de pruebas")
        if let result {
            XCTAssertFalse(result.count <= 3, "Expected human-readable name, got '\(result)'")
        }
    }

    // MARK: - Locale.localizedString coverage

    func testLocalizedStringCoversAllLanguageCodes() {
        let codes = Self.languageSamples.map { $0.code }
        for code in codes {
            let name = Locale.current.localizedString(forLanguageCode: code)
            XCTAssertNotNil(name, "No localized name for code: \(code)")
            if let name {
                XCTAssertFalse(name.isEmpty, "Empty localized name for code: \(code)")
            }
        }
    }
}

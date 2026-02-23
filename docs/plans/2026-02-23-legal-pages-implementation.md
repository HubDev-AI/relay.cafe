# Legal Pages Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build two static legal pages (Terms of Use + Privacy Policy) with shared styling, update the landing page footer to link both, add legal links to iOS Settings, and add consent line to iOS onboarding.

**Architecture:** Two HTML pages sharing a dedicated `legal.css`. Same warm off-white aesthetic as the landing page but with document-tuned typography and tighter spacing. No JavaScript. iOS Settings gets two SFSafariViewController links. Onboarding gets a muted consent line.

**Tech Stack:** HTML5, CSS3 (web pages). SwiftUI + SafariServices (iOS).

**Design doc:** `docs/plans/2026-02-23-legal-pages-design.md`

**Depends on:** Landing page must be built first (`docs/plans/2026-02-23-landing-page-implementation.md`) — we need `index.html` to exist before updating its footer.

---

### Task 1: Create legal.css

**Files:**
- Create: `relay-cafe-site/legal.css`

**Step 1: Write the stylesheet**

```css
*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html {
  font-size: 16px;
  -webkit-text-size-adjust: 100%;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-weight: 400;
  line-height: 1.7;
  color: #111;
  background: #FAF9F6;
}

.legal {
  max-width: 720px;
  margin: 0 auto;
  padding: 3rem 24px 4rem;
}

.back {
  display: inline-block;
  font-size: 0.875rem;
  color: rgba(17, 17, 17, 0.55);
  text-decoration: none;
  margin-bottom: 3rem;
}

.back:hover {
  color: #111;
}

h1 {
  font-size: 1.75rem;
  font-weight: 400;
  line-height: 1.3;
  margin-bottom: 0.5rem;
}

.updated {
  font-size: 0.85rem;
  color: rgba(17, 17, 17, 0.45);
  margin-bottom: 2.5rem;
}

.intro {
  font-size: 1rem;
  margin-bottom: 3rem;
}

section {
  margin-bottom: 3rem;
}

h2 {
  font-size: 1.15rem;
  font-weight: 500;
  line-height: 1.4;
  margin-bottom: 1rem;
}

p {
  font-size: 1rem;
}

section p + p {
  margin-top: 1rem;
}

ul {
  margin-top: 0.75rem;
  margin-bottom: 0.75rem;
  padding-left: 1.5rem;
}

li {
  font-size: 1rem;
  margin-bottom: 0.4rem;
  color: #111;
}

li::marker {
  color: rgba(17, 17, 17, 0.3);
}

a {
  color: #111;
  text-decoration: underline;
  text-underline-offset: 0.15em;
}

a:hover {
  opacity: 0.6;
}

@media (min-width: 640px) {
  .legal {
    padding: 4rem 32px 5rem;
  }

  h1 {
    font-size: 1.85rem;
  }
}
```

**Step 2: Verify**

Open any HTML file that links to it (we'll create terms.html next). For now, just confirm the file exists.

**Step 3: Commit**

```bash
git add relay-cafe-site/legal.css
git commit -m "feat: legal pages stylesheet"
```

---

### Task 2: Create terms.html

**Files:**
- Create: `relay-cafe-site/terms.html`

**Step 1: Write terms.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Terms of Use — Relay.cafe</title>
  <meta name="description" content="Terms of Use for Relay.cafe, a daily anonymous message service.">
  <link rel="stylesheet" href="legal.css">
</head>
<body>
  <main class="legal">
    <a class="back" href="/">relay.cafe</a>
    <h1>Terms of Use</h1>
    <p class="updated">Last updated: February 23, 2026</p>
    <p class="intro">Relay.cafe ("Relay", "we", "us") is a mobile application that allows users to send and receive one anonymous message per day. By using Relay, you agree to these Terms. If you do not agree, do not use the service.</p>

    <section>
      <h2>1. The Service</h2>
      <p>Relay allows users to:</p>
      <ul>
        <li>Send one message per day.</li>
        <li>Receive one message per day.</li>
        <li>Messages are automatically deleted after 24 hours.</li>
      </ul>
      <p>Relay does not guarantee that any message will be delivered, received, or read. Messages may expire unread.</p>
      <p>The service is provided "as is" and "as available."</p>
    </section>

    <section>
      <h2>2. Eligibility</h2>
      <p>You must be at least 16 years old to use Relay, or the minimum age required by applicable law in your country.</p>
    </section>

    <section>
      <h2>3. User Conduct</h2>
      <p>You agree not to use Relay to:</p>
      <ul>
        <li>Engage in illegal activity.</li>
        <li>Threaten violence or harm.</li>
        <li>Harass, intimidate, or defame others.</li>
        <li>Share unlawful or abusive content.</li>
        <li>Attempt to disrupt, reverse engineer, or interfere with the service.</li>
        <li>Automate usage or bypass usage limits.</li>
      </ul>
      <p>We reserve the right to suspend or terminate access at our discretion.</p>
    </section>

    <section>
      <h2>4. Content Disclaimer</h2>
      <p>Messages on Relay are user-generated and anonymous.</p>
      <p>Relay does not review messages before delivery. Relay does not endorse user content. Relay does not verify the accuracy or legality of messages.</p>
      <p>Users are solely responsible for the content they submit. Relay is not responsible for user-generated content.</p>
    </section>

    <section>
      <h2>5. Intellectual Property</h2>
      <p>Users retain all rights to the content they submit. Relay processes messages solely for the purpose of relaying them to another user. Relay does not claim ownership of user content.</p>
    </section>

    <section>
      <h2>6. No Warranty</h2>
      <p>Relay is provided without warranties of any kind. We do not guarantee:</p>
      <ul>
        <li>Continuous availability.</li>
        <li>Delivery of messages.</li>
        <li>Error-free operation.</li>
        <li>That messages will be received or readable.</li>
      </ul>
      <p>Use of the service is at your own risk.</p>
    </section>

    <section>
      <h2>7. Limitation of Liability</h2>
      <p>To the maximum extent permitted by law, Relay and its operator shall not be liable for:</p>
      <ul>
        <li>Indirect, incidental, or consequential damages.</li>
        <li>Emotional distress or psychological impact from user content.</li>
        <li>Loss of data.</li>
        <li>Loss of opportunity.</li>
        <li>Service interruptions.</li>
        <li>Any damages arising from use or inability to use the service.</li>
      </ul>
      <p>Your sole remedy is to stop using the service.</p>
    </section>

    <section>
      <h2>8. Account Suspension and Termination</h2>
      <p>We may suspend, restrict, or terminate accounts at any time for violation of these Terms or for protecting the integrity of the service.</p>
      <p>We may remove access without prior notice.</p>
    </section>

    <section>
      <h2>9. Legal Compliance</h2>
      <p>Relay may comply with valid legal requests or court orders in accordance with applicable law.</p>
      <p>Messages are automatically deleted after 24 hours and are not retained beyond that period. We cannot provide access to content that no longer exists in our systems.</p>
    </section>

    <section>
      <h2>10. Privacy</h2>
      <p>Your use of Relay is also governed by our <a href="/privacy">Privacy Policy</a>, which describes what data we process, how long we retain it, and your rights under GDPR.</p>
    </section>

    <section>
      <h2>11. Governing Law</h2>
      <p>These Terms are governed by the laws of the Republic of Bulgaria.</p>
      <p>Any disputes shall be resolved by the competent courts of Bulgaria.</p>
    </section>

    <section>
      <h2>12. Contact</h2>
      <p>For questions regarding these Terms: <a href="mailto:hello@relay.cafe">hello@relay.cafe</a></p>
    </section>
  </main>
</body>
</html>
```

**Step 2: Verify in browser**

Run: `open relay-cafe-site/terms.html`
Expected: Clean, readable legal document. 12 numbered sections. Warm off-white background, left-aligned, quiet "relay.cafe" back link at top.

**Step 3: Commit**

```bash
git add relay-cafe-site/terms.html
git commit -m "feat: terms of use page"
```

---

### Task 3: Create privacy.html

**Files:**
- Create: `relay-cafe-site/privacy.html`

**Step 1: Write privacy.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Privacy Policy — Relay.cafe</title>
  <meta name="description" content="Privacy Policy for Relay.cafe. GDPR-compliant. Operated from the European Union.">
  <link rel="stylesheet" href="legal.css">
</head>
<body>
  <main class="legal">
    <a class="back" href="/">relay.cafe</a>
    <h1>Privacy Policy</h1>
    <p class="updated">Last updated: February 23, 2026</p>
    <p class="intro">Relay.cafe is operated from the European Union. We respect your privacy.</p>

    <section>
      <h2>1. Data We Process</h2>
      <p>Relay may process:</p>
      <ul>
        <li>Apple Sign-In identifier (hashed).</li>
        <li>Session tokens.</li>
        <li>Technical data such as IP address for security and rate limiting.</li>
        <li>Encrypted message data (automatically deleted after 24 hours).</li>
      </ul>
      <p>We do not store message history beyond 24 hours.</p>
    </section>

    <section>
      <h2>2. Message Deletion</h2>
      <p>Messages are automatically deleted from our systems after 24 hours.</p>
      <p>Once deleted, they cannot be recovered. We do not maintain archives of deleted messages.</p>
    </section>

    <section>
      <h2>3. Legal Basis (GDPR)</h2>
      <p>We process data on the basis of:</p>
      <ul>
        <li>Contractual necessity (to provide the service).</li>
        <li>Legitimate interest (security and abuse prevention).</li>
      </ul>
    </section>

    <section>
      <h2>4. Data Retention</h2>
      <ul>
        <li>Message content: maximum 24 hours.</li>
        <li>Session data: until expiration or account deletion.</li>
        <li>Security logs: retained only as necessary for abuse prevention and legal compliance.</li>
      </ul>
    </section>

    <section>
      <h2>5. Your Rights (EU Users)</h2>
      <p>Under GDPR, you have the right to:</p>
      <ul>
        <li>Access your data.</li>
        <li>Request deletion.</li>
        <li>Request correction.</li>
        <li>Restrict processing.</li>
        <li>Lodge a complaint with a supervisory authority.</li>
      </ul>
      <p>You may delete your account at any time within the app.</p>
    </section>

    <section>
      <h2>6. International Data Processing</h2>
      <p>Infrastructure providers may process data outside Bulgaria. We rely on appropriate safeguards under applicable data protection law.</p>
    </section>

    <section>
      <h2>7. Contact</h2>
      <p><a href="mailto:hello@relay.cafe">hello@relay.cafe</a></p>
    </section>
  </main>
</body>
</html>
```

**Step 2: Verify in browser**

Run: `open relay-cafe-site/privacy.html`
Expected: Same visual treatment as terms page. Seven sections, GDPR rights listed, clean and readable.

**Step 3: Commit**

```bash
git add relay-cafe-site/privacy.html
git commit -m "feat: privacy policy page (GDPR-compliant)"
```

---

### Task 4: Update landing page footer

**Files:**
- Modify: `relay-cafe-site/index.html` (footer nav section)

**Step 1: Update the footer nav in index.html**

Find the current footer `<nav>`:

```html
<nav>
  <a href="/privacy">Privacy Policy</a>
  <span class="sep">&middot;</span>
  <a href="mailto:hello@relay.cafe">hello@relay.cafe</a>
</nav>
```

Replace with:

```html
<nav>
  <a href="/privacy">Privacy Policy</a>
  <span class="sep">&middot;</span>
  <a href="/terms">Terms</a>
  <span class="sep">&middot;</span>
  <a href="mailto:hello@relay.cafe">hello@relay.cafe</a>
</nav>
```

**Step 2: Verify in browser**

Run: `open relay-cafe-site/index.html`
Expected: Footer now shows three links: Privacy Policy, Terms, hello@relay.cafe — separated by middots.

**Step 3: Commit**

```bash
git add relay-cafe-site/index.html
git commit -m "feat: add terms link to landing page footer"
```

---

### Task 5: Add legal links to iOS Settings

**Files:**
- Modify: `relay-cafe-ios/RelayCafe/Views/SettingsView.swift`

**Step 1: Add SafariServices import**

At the top of the file, add:

```swift
import SafariServices
```

**Step 2: Add state and URL constants, then add legal links below the delete section**

Add a `@State` property for the Safari URL and two link buttons below the existing delete account VStack. The full updated body should place the legal links at the bottom of the screen, below the delete section:

Replace the body content. The updated `SettingsView` should be:

```swift
import SwiftUI
import SafariServices

struct SettingsView: View {
    let appVM: AppViewModel
    @State private var showDeleteConfirm = false
    @State private var isDeleting = false
    @State private var deleteError: String?
    @State private var safariURL: URL?

    var body: some View {
        ZStack {
            LinearGradient.relayBackground.ignoresSafeArea()

            VStack {
                Spacer()

                if showDeleteConfirm {
                    deleteConfirmView
                } else {
                    VStack(spacing: 10) {
                        Button("Delete account") {
                            showDeleteConfirm = true
                        }
                        .font(.system(size: 17))
                        .opacity(0.5)
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("settings.deleteButton")

                        Text("Your account and data will be permanently removed.")
                            .font(.system(size: 13))
                            .opacity(0.3)
                            .multilineTextAlignment(.center)
                    }
                }

                Spacer()

                VStack(spacing: 16) {
                    Button("Terms of Use") {
                        safariURL = URL(string: "https://relay.cafe/terms")
                    }
                    .font(.system(size: 14))
                    .opacity(0.35)
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("settings.termsButton")

                    Button("Privacy Policy") {
                        safariURL = URL(string: "https://relay.cafe/privacy")
                    }
                    .font(.system(size: 14))
                    .opacity(0.35)
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("settings.privacyButton")
                }
                .padding(.bottom, 32)
            }
            .padding(.horizontal, 28)
        }
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: $safariURL) { url in
            SafariView(url: url)
                .ignoresSafeArea()
        }
    }

    // ... deleteConfirmView and deleteAccount() remain unchanged
}

extension URL: @retroactive Identifiable {
    public var id: String { absoluteString }
}

struct SafariView: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> SFSafariViewController {
        SFSafariViewController(url: url)
    }

    func updateUIViewController(_ uiViewController: SFSafariViewController, context: Context) {}
}
```

**Step 3: Verify**

Build the iOS project:
Run: `cd relay-cafe-ios && xcodebuild -project RelayCafe.xcodeproj -scheme RelayCafe -destination 'platform=iOS Simulator,name=iPhone 16' build 2>&1 | tail -5`
Expected: BUILD SUCCEEDED

**Step 4: Commit**

```bash
git add relay-cafe-ios/RelayCafe/Views/SettingsView.swift
git commit -m "feat: add terms and privacy links to iOS settings"
```

---

### Task 6: Add consent line to onboarding

**Files:**
- Modify: `relay-cafe-ios/RelayCafe/Views/OnboardingView.swift`

**Step 1: Add consent text below the Continue button**

In `OnboardingView.swift`, find:

```swift
                .buttonStyle(.plain)
                .padding(.bottom, 48)
                .accessibilityIdentifier("onboarding.continueButton")
```

Replace with:

```swift
                .buttonStyle(.plain)
                .accessibilityIdentifier("onboarding.continueButton")

                Text("By continuing, you agree to the Terms of Use and Privacy Policy.")
                    .font(.system(size: 11))
                    .opacity(0.3)
                    .padding(.top, 12)
                    .padding(.bottom, 32)
```

**Step 2: Verify**

Build the iOS project:
Run: `cd relay-cafe-ios && xcodebuild -project RelayCafe.xcodeproj -scheme RelayCafe -destination 'platform=iOS Simulator,name=iPhone 16' build 2>&1 | tail -5`
Expected: BUILD SUCCEEDED

**Step 3: Commit**

```bash
git add relay-cafe-ios/RelayCafe/Views/OnboardingView.swift
git commit -m "feat: add terms consent line to onboarding"
```

---

### Task 7: Final review of all pages

**Step 1: Open all three web pages and verify**

Checklist:
- [ ] `index.html` — footer has three links (Privacy Policy, Terms, hello@relay.cafe)
- [ ] `terms.html` — 12 sections, all content present, "relay.cafe" back link works
- [ ] `privacy.html` — 7 sections, all content present, "relay.cafe" back link works
- [ ] All three pages use warm off-white background
- [ ] Legal pages use tighter spacing than landing page
- [ ] "Last updated: February 23, 2026" visible on both legal pages
- [ ] All text left-aligned, no centering
- [ ] No JavaScript on any page
- [ ] Mobile: readable at 375px width, 24px padding
- [ ] iOS: Settings shows Terms of Use and Privacy Policy links at bottom
- [ ] iOS: Tapping links opens SFSafariViewController
- [ ] iOS: Onboarding shows consent line below Continue button, small and muted

**Step 2: Fix any issues found**

**Step 3: Commit if needed**

```bash
git add relay-cafe-site/ relay-cafe-ios/
git commit -m "fix: legal pages adjustments"
```

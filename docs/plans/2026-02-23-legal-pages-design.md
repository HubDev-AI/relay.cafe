# Legal Pages Design — relay.cafe

## Overview

Two static legal pages (Terms of Use + Privacy Policy) for relay.cafe. Required for EU/GDPR compliance and App Store submission. Operator is based in Bulgaria.

## Files

```
relay-cafe-site/
  terms.html       (Terms of Use)
  privacy.html     (Privacy Policy)
  legal.css        (shared styles for both)
  index.html       (update footer to add Terms link)
```

## Content

### Terms of Use (12 sections)

Last updated: February 23, 2026

1. **The Service** — what Relay does, "as is" and "as available", no delivery guarantees
2. **Eligibility** — must be at least 16 years old (GDPR minimum age)
3. **User Conduct** — prohibited uses (illegal activity, threats, harassment, reverse engineering, automation)
4. **Content Disclaimer** — user-generated anonymous content, no review/endorsement/verification by Relay
5. **Intellectual Property** — users retain rights to their messages, Relay processes only for relay purposes, no ownership claim
6. **No Warranty** — no guarantees of availability, delivery, or error-free operation
7. **Limitation of Liability** — not liable for indirect/consequential damages, emotional distress, data loss; sole remedy is to stop using service
8. **Account Suspension & Termination** — may suspend/terminate without notice
9. **Legal Compliance** — may comply with valid legal requests; messages auto-deleted after 24h, cannot provide what doesn't exist
10. **Privacy** — link to Privacy Policy, summary of what we collect and don't store
11. **Governing Law** — laws of Republic of Bulgaria, competent courts of Bulgaria
12. **Contact** — hello@relay.cafe

### Privacy Policy (7 sections)

Last updated: February 23, 2026

1. **Data We Process** — Apple Sign-In ID (hashed), session tokens, IP for rate limiting, encrypted message data (auto-deleted 24h)
2. **Message Deletion** — auto-deleted after 24h, irrecoverable, no archives
3. **Legal Basis (GDPR)** — contractual necessity + legitimate interest
4. **Data Retention** — messages 24h max, sessions until expiry/deletion, security logs as necessary
5. **Your Rights (EU Users)** — access, deletion, correction, restrict processing, lodge complaint with supervisory authority; in-app account deletion
6. **International Data Processing** — infrastructure may be outside Bulgaria, appropriate safeguards
7. **Contact** — hello@relay.cafe

## Visual Treatment (legal.css)

Self-contained stylesheet. Does not import or depend on style.css.

- Background: `#FAF9F6` (same warm off-white)
- Font: system stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`)
- Body text: `1rem`, weight 400, line-height 1.7
- h1 (page title): ~1.75rem, weight 400
- h2 (section headings): ~1.15rem, weight 500
- Max-width: `720px`, centered
- Padding: 24px mobile, 32px wider screens
- Section spacing: `3rem` (tighter than landing page)
- Lists: proper indentation, muted bullet color
- "Last updated" line: small, muted, below h1
- Links: `#111` with underline, opacity hover

## Page Structure

Both pages follow the same template:

```
<body>
  <main class="legal">
    <a class="back" href="/">relay.cafe</a>
    <h1>Terms of Use / Privacy Policy</h1>
    <p class="updated">Last updated: February 23, 2026</p>
    <p class="intro">Introductory paragraph...</p>

    <section>
      <h2>1. Section Name</h2>
      <p>Content...</p>
    </section>
    ...
  </main>
</body>
```

- Back link at top: quiet "relay.cafe" link to home
- No footer on legal pages
- No navigation bar
- No JavaScript

## Landing Page Update

Update `docs/landing/index.html` footer nav to:

```
Privacy Policy · Terms · hello@relay.cafe
```

Three links separated by middot separators.

## Navigation

- Landing page footer → Privacy Policy (`/privacy`) and Terms (`/terms`)
- Legal pages → back to home via "relay.cafe" link at top
- URL paths: `/terms` → `terms.html`, `/privacy` → `privacy.html` (CDN rewrite rules or directory structure)

## iOS App Changes

Add Terms of Use and Privacy Policy links to SettingsView.swift:

- Two links below the "Delete account" section
- Open in SFSafariViewController (in-app browser)
- Small, muted style — consistent with existing Settings tone
- URLs: `https://relay.cafe/terms` and `https://relay.cafe/privacy`

Add consent line to `OnboardingView.swift`:

- Below the "Continue" button: "By continuing, you agree to the Terms of Use and Privacy Policy."
- Font size 11, opacity 0.3 — very small and muted
- Plain text (not tappable links — the full documents are accessible from Settings)
- Creates explicit GDPR agreement without changing the app's quiet tone

No other app changes needed. No consent banner, no warning banners.

## Non-Goals

- No cookie banner (no cookies used beyond session)
- No consent management platform
- No age verification gate (age requirement stated in Terms only)
- No monetization/payment terms
- No arbitration clause

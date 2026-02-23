# Legal Pages Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build two static legal pages (Terms of Use + Privacy Policy) with shared styling, and update the landing page footer to link both.

**Architecture:** Two HTML pages sharing a dedicated `legal.css`. Same warm off-white aesthetic as the landing page but with document-tuned typography and tighter spacing. No JavaScript.

**Tech Stack:** HTML5, CSS3. No build tools.

**Design doc:** `docs/plans/2026-02-23-legal-pages-design.md`

**Depends on:** Landing page must be built first (`docs/plans/2026-02-23-landing-page-implementation.md`) — we need `index.html` to exist before updating its footer.

---

### Task 1: Create legal.css

**Files:**
- Create: `docs/landing/legal.css`

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
git add docs/landing/legal.css
git commit -m "feat: legal pages stylesheet"
```

---

### Task 2: Create terms.html

**Files:**
- Create: `docs/landing/terms.html`

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
      <h2>2. User Conduct</h2>
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
      <h2>3. Content Disclaimer</h2>
      <p>Messages on Relay are user-generated and anonymous.</p>
      <p>Relay does not review messages before delivery. Relay does not endorse user content. Relay does not verify the accuracy or legality of messages.</p>
      <p>Users are solely responsible for the content they submit. Relay is not responsible for user-generated content.</p>
    </section>

    <section>
      <h2>4. No Warranty</h2>
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
      <h2>5. Limitation of Liability</h2>
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
      <h2>6. Account Suspension and Termination</h2>
      <p>We may suspend, restrict, or terminate accounts at any time for violation of these Terms or for protecting the integrity of the service.</p>
      <p>We may remove access without prior notice.</p>
    </section>

    <section>
      <h2>7. Legal Compliance</h2>
      <p>Relay may comply with valid legal requests or court orders in accordance with applicable law.</p>
      <p>Messages are automatically deleted after 24 hours and are not retained beyond that period. We cannot provide access to content that no longer exists in our systems.</p>
    </section>

    <section>
      <h2>8. Governing Law</h2>
      <p>These Terms are governed by the laws of the Republic of Bulgaria.</p>
      <p>Any disputes shall be resolved by the competent courts of Bulgaria.</p>
    </section>

    <section>
      <h2>9. Contact</h2>
      <p>For questions regarding these Terms: <a href="mailto:hello@relay.cafe">hello@relay.cafe</a></p>
    </section>
  </main>
</body>
</html>
```

**Step 2: Verify in browser**

Run: `open docs/landing/terms.html`
Expected: Clean, readable legal document. Warm off-white background, left-aligned, numbered sections, quiet "relay.cafe" back link at top.

**Step 3: Commit**

```bash
git add docs/landing/terms.html
git commit -m "feat: terms of use page"
```

---

### Task 3: Create privacy.html

**Files:**
- Create: `docs/landing/privacy.html`

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

Run: `open docs/landing/privacy.html`
Expected: Same visual treatment as terms page. Seven sections, GDPR rights listed, clean and readable.

**Step 3: Commit**

```bash
git add docs/landing/privacy.html
git commit -m "feat: privacy policy page (GDPR-compliant)"
```

---

### Task 4: Update landing page footer

**Files:**
- Modify: `docs/landing/index.html` (footer nav section)

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

Run: `open docs/landing/index.html`
Expected: Footer now shows three links: Privacy Policy, Terms, hello@relay.cafe — separated by middots.

**Step 3: Commit**

```bash
git add docs/landing/index.html
git commit -m "feat: add terms link to landing page footer"
```

---

### Task 5: Final review of all pages

**Step 1: Open all three pages and verify**

Checklist:
- [ ] `index.html` — footer has three links (Privacy Policy, Terms, hello@relay.cafe)
- [ ] `terms.html` — 9 sections, all content present, "relay.cafe" back link works
- [ ] `privacy.html` — 7 sections, all content present, "relay.cafe" back link works
- [ ] All three pages use warm off-white background
- [ ] Legal pages use tighter spacing than landing page
- [ ] "Last updated: February 23, 2026" visible on both legal pages
- [ ] All text left-aligned, no centering
- [ ] No JavaScript on any page
- [ ] Mobile: readable at 375px width, 24px padding

**Step 2: Fix any issues found**

**Step 3: Commit if needed**

```bash
git add docs/landing/
git commit -m "fix: legal pages visual adjustments"
```

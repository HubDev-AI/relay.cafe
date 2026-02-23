# Landing Page Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the static relay.cafe landing page — two files (index.html + style.css), no JS, no build step.

**Architecture:** Single HTML page with external CSS. Semantic HTML5 sections. System font stack. Mobile-first responsive. Deployed as static files to a CDN.

**Tech Stack:** HTML5, CSS3. No JavaScript. No build tools.

**Design doc:** `docs/plans/2026-02-23-landing-page-design.md`
**Spec:** `relay-cafe-site/PAGE.md`

---

### Task 1: Create the HTML file

**Files:**
- Create: `relay-cafe-site/index.html`

**Step 1: Write index.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Relay.cafe — A daily anonymous message</title>
  <meta name="description" content="Once a day, you can send a message to a stranger. Messages disappear after 24 hours.">
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <main>
    <section class="hero">
      <h1>Relay.cafe</h1>
      <p class="tagline">
        Once a day,<br>
        you may send a message.<br>
        Once a day,<br>
        you may receive one.
      </p>
      <p>Messages exist for 24 hours.<br>They are never stored.</p>
      <p class="cta">Coming soon</p>
    </section>

    <section class="what">
      <h2>What It Is</h2>
      <p>
        Relay is a quiet experiment.<br>
        A message written to no one in particular.<br>
        Delivered to someone, somewhere.<br>
        Once.
      </p>
      <p>
        There are no profiles.<br>
        No followers.<br>
        No replies.<br>
        No history.
      </p>
      <p>
        You won't know if your message was read.<br>
        And you won't see it again.
      </p>
    </section>

    <section class="how">
      <h2>How It Works</h2>
      <p>
        You can send one message per day.<br>
        You can receive one message per day.<br>
        That's all.
      </p>
      <p>
        Messages disappear after 24 hours.<br>
        If they are not read, they vanish.<br>
        The relay does not remember.
      </p>
    </section>

    <section class="privacy">
      <h2>Privacy</h2>
      <p>
        Messages are encrypted in transit.<br>
        They are automatically deleted after 24 hours.<br>
        Relay does not store message history.
      </p>
    </section>
  </main>

  <footer>
    <p class="footer-name">Relay.cafe</p>
    <p class="footer-tagline">A small place on the internet.</p>
    <nav>
      <a href="/privacy">Privacy Policy</a>
      <span class="sep">&middot;</span>
      <a href="mailto:hello@relay.cafe">hello@relay.cafe</a>
    </nav>
  </footer>
</body>
</html>
```

**Step 2: Verify in browser**

Run: `open relay-cafe-site/index.html`
Expected: Unstyled but structurally correct page with all 5 sections visible.

**Step 3: Commit**

```bash
git add relay-cafe-site/index.html
git commit -m "feat: landing page HTML structure"
```

---

### Task 2: Create the CSS file — reset and typography

**Files:**
- Create: `relay-cafe-site/style.css`

**Step 1: Write base styles (reset, typography, colors)**

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

h1 {
  font-size: 2.5rem;
  font-weight: 400;
  line-height: 1.2;
  margin-bottom: 2rem;
}

h2 {
  font-size: 1.25rem;
  font-weight: 500;
  line-height: 1.4;
  margin-bottom: 1.5rem;
}

p {
  font-size: 1.1rem;
}

a {
  color: #111;
  text-decoration: underline;
  text-underline-offset: 0.15em;
}

a:hover {
  opacity: 0.6;
}
```

**Step 2: Verify in browser**

Run: `open relay-cafe-site/index.html`
Expected: Typography applied — system font, warm off-white background, proper heading sizes.

**Step 3: Commit**

```bash
git add relay-cafe-site/style.css
git commit -m "feat: landing page base typography and reset"
```

---

### Task 3: Add layout styles

**Files:**
- Modify: `relay-cafe-site/style.css` (append)

**Step 1: Add layout rules to style.css**

Append after the base styles:

```css
main {
  max-width: 720px;
  margin: 0 auto;
  padding: 20vh 24px 4rem;
}

section {
  margin-bottom: 7rem;
}

section p + p {
  margin-top: 1.5rem;
}

footer {
  max-width: 720px;
  margin: 0 auto;
  padding: 4rem 24px 3rem;
  border-top: 1px solid rgba(17, 17, 17, 0.1);
}
```

**Step 2: Verify in browser**

Run: `open relay-cafe-site/index.html`
Expected: Content centered with max-width, generous spacing between sections, hero pushed down from top.

**Step 3: Commit**

```bash
git add relay-cafe-site/style.css
git commit -m "feat: landing page layout and spacing"
```

---

### Task 4: Add section-specific styles

**Files:**
- Modify: `relay-cafe-site/style.css` (append)

**Step 1: Add hero, privacy, footer, and CTA styles**

Append after layout styles:

```css
.tagline {
  font-size: 1.2rem;
  line-height: 1.8;
  margin-bottom: 1.5rem;
}

.cta {
  margin-top: 2.5rem;
  font-size: 0.95rem;
  color: rgba(17, 17, 17, 0.55);
  letter-spacing: 0.02em;
}

.privacy p {
  font-size: 0.95rem;
  color: rgba(17, 17, 17, 0.55);
}

.privacy h2 {
  font-size: 1.1rem;
}

.footer-name {
  font-size: 1rem;
  margin-bottom: 0.25rem;
}

.footer-tagline {
  font-size: 0.875rem;
  color: rgba(17, 17, 17, 0.55);
  margin-bottom: 1.5rem;
}

footer nav {
  font-size: 0.875rem;
}

footer nav a {
  color: rgba(17, 17, 17, 0.55);
}

.sep {
  margin: 0 0.5rem;
  color: rgba(17, 17, 17, 0.3);
}
```

**Step 2: Verify in browser**

Run: `open relay-cafe-site/index.html`
Expected: Hero tagline slightly larger, "Coming soon" muted, privacy section muted and smaller, footer compact with muted links.

**Step 3: Commit**

```bash
git add relay-cafe-site/style.css
git commit -m "feat: landing page section-specific styles"
```

---

### Task 5: Add responsive breakpoint

**Files:**
- Modify: `relay-cafe-site/style.css` (append)

**Step 1: Add media query for wider screens**

Append at the end of style.css:

```css
@media (min-width: 640px) {
  main {
    padding: 20vh 32px 4rem;
  }

  footer {
    padding: 4rem 32px 3rem;
  }

  h1 {
    font-size: 2.75rem;
  }

  .tagline {
    font-size: 1.3rem;
  }
}
```

**Step 2: Verify responsive behavior**

Open in browser and resize window. At narrow widths (<640px): 24px padding, slightly smaller type. At wider widths: 32px padding, slightly larger hero type. No layout shifts.

**Step 3: Commit**

```bash
git add relay-cafe-site/style.css
git commit -m "feat: landing page responsive breakpoint"
```

---

### Task 6: Final visual review and commit

**Step 1: Open the page and verify against the spec**

Checklist:
- [ ] All text left-aligned (no centered paragraphs)
- [ ] Warm off-white background
- [ ] System font, no bold blocks except headings
- [ ] Generous vertical spacing between sections
- [ ] Hero has breathing room at top (~20vh)
- [ ] "Coming soon" is muted, not a button
- [ ] Privacy section is smaller and muted
- [ ] Footer has separator line, muted links
- [ ] No animations, no scroll effects
- [ ] Page loads quietly — no flash, no shift
- [ ] Mobile: 24px padding, readable type
- [ ] Desktop: 720px max-width, centered

**Step 2: Fix any issues found**

If any visual issues, fix them and commit the fix.

**Step 3: Final commit (if needed)**

```bash
git add relay-cafe-site/
git commit -m "feat: landing page complete"
```

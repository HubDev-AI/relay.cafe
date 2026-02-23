# Landing Page Design — relay.cafe

## Overview

Static landing page for relay.cafe. Informational only — a minimal introduction and bridge to the App Store. Not a web app, not a marketing funnel.

## Files

```
docs/landing/
  index.html
  style.css
  PAGE.md        (existing spec — not deployed)
```

Deploy `index.html` + `style.css` to a static CDN (Cloudflare Pages, Netlify, GitHub Pages, etc.). No build step.

## Content Sections

### 1. Hero (above the fold)

```
Relay.cafe

Once a day,
you may send a message.
Once a day,
you may receive one.

Messages exist for 24 hours.
They are never stored.

Coming soon
```

- Left-aligned
- "Coming soon" as plain text (swap for App Store badge + link when app goes live)
- No animated hero, no background images, no device mockups

### 2. What It Is

```
What It Is

Relay is a quiet experiment.
A message written to no one in particular.
Delivered to someone, somewhere.
Once.

There are no profiles.
No followers.
No replies.
No history.

You won't know if your message was read.
And you won't see it again.
```

### 3. How It Works

```
How It Works

You can send one message per day.
You can receive one message per day.
That's all.

Messages disappear after 24 hours.
If they are not read, they vanish.
The relay does not remember.
```

### 4. Privacy

Smaller/muted treatment.

```
Privacy

Messages are encrypted in transit.
They are automatically deleted after 24 hours.
Relay does not store message history.
```

No technical bragging, no mention of KMS or infrastructure.

### 5. Footer

```
Relay.cafe
A small place on the internet.

Privacy Policy · hello@relay.cafe
```

No social media icons. No newsletter signup. App Store link added when live.

## HTML Structure

Semantic HTML5. Single `<main>` with four `<section>` elements + `<footer>`.

- Line breaks in the tagline use `<br>` for poem-like rhythm
- "Coming soon" is a `<p>` (not a link/button)
- Footer uses `<nav>` for links
- No JavaScript
- No external resources (no fonts, no images in v1)

## Typography

- System font stack: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
- h1 (Relay.cafe): ~2.5rem, weight 400
- h2 (section headings): ~1.25rem, weight 500
- Body text: ~1.1rem, weight 400, line-height ~1.7
- Privacy section text: ~0.95rem, muted color
- Footer text: ~0.875rem, muted
- No bold blocks for emphasis except headings
- No custom fonts loaded

## Colors

- Background: warm off-white `#FAF9F6`
- Primary text: `#111`
- Muted/secondary text: `rgba(17, 17, 17, 0.55)`
- Links: `#111` with underline, subtle opacity change on hover
- No accent color

## Layout

- Max content width: `720px`, centered with `margin: 0 auto`
- Horizontal padding: `24px` base, `32px` at wider viewports
- Vertical spacing: `6rem–8rem` between sections
- Hero top padding: ~20vh for breathing room
- All text left-aligned — no centered paragraphs, no justified text

## Responsive

- Mobile-first CSS
- Single breakpoint at `640px` for minor font-size and spacing adjustments
- No layout changes — already single column
- No dark mode in v1

## Interactions

- None. No scroll animations, no parallax, no entrance animations, no auto-play, no popups, no modals.
- Page loads quietly.

## SEO

- Title: `Relay.cafe — A daily anonymous message`
- Meta description: `Once a day, you can send a message to a stranger. Messages disappear after 24 hours.`
- No keyword stuffing

## Non-Goals

- No testimonials, user counters, social proof
- No email capture, newsletter signup, waitlist
- No countdown timer, urgency language
- No analytics scripts (optional later)
- No blog, feature grid, about section
- No social media icons
- No dark mode

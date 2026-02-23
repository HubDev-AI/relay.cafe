# 📄 Relay.cafe – Technical & Product Specification (v1)

You can feed this directly into your AI agent.

---

## 1. Project Overview

**Name:** Relay.cafe
**Platform:** Native iOS (Swift + SwiftUI)
**Philosophy:** A pure signal relay with no memory.

### Core Principles

1. One message per user per day (send).
2. One message per user per day (receive).
3. Messages exist for a strict 24 hours from creation.
4. If read → deleted immediately.
5. If unread after 24h → permanently deleted.
6. Sender never knows if message was read.
7. No history.
8. No archive.
9. No ghost messages.
10. No analytics tracking message content.
11. No push notifications (v1).
12. No copy/share functionality in UI.

---

## 2. User Flow

### 2.1 First Launch

Display:

Relay.cafe

Once a day,
you may send a message.
Once a day,
you may receive one.

Messages exist for 24 hours.
They are never stored.

[Continue]

Then:

* Phone verification required.

Display:

Phone verification helps prevent spam.
Your number is never stored.

---

## 3. Account System

### 3.1 Registration

* Phone verification via SMS provider.
* After verification:

  * Hash + salt phone number.
  * Store only hashed version.
  * Immediately discard raw phone number.

### 3.2 On First Successful Login

* Generate public/private keypair.
* Private key stored in Secure Enclave.
* Public key stored server-side.

---

## 4. Daily Token Rules

Each user has:

* 1 Send Token per UTC day.
* 1 Receive Token per UTC day.

Reset time:
00:00 UTC daily.

Tokens do NOT roll over.

If used, button becomes disabled with text:
"You’ve already sent today."
"You’ve already received today."

---

## 5. Message Rules

### 5.1 Message Creation

* Plain text only.
* Max length: 1000 characters (configurable).
* No attachments.
* No images.
* No links preview.
* No formatting.
* Emoji allowed (native keyboard only).

When user taps Send:

* Encrypt message client-side using recipient-agnostic encryption.
* Attach:

  * Creation timestamp (UTC).
  * Expiration timestamp (UTC + 24h).
  * Sender public key.
* Send encrypted blob to server.

Immediately remove message from local UI.

Display:
Sent.

No delivery state stored.

---

## 6. Message Storage (Server)

Each message stored as:

{
id: UUID,
ciphertext: string,
created_at: timestamp,
expires_at: timestamp,
delivered: boolean
}

Server must:

* Never decrypt.
* Never inspect content.
* Run expiration cleanup job every 10 minutes.
* Hard delete expired messages.

No backups of expired messages.

---

## 7. Message Retrieval

When user taps "Open today’s message":

1. Client requests message from server.

2. Server:

   * Selects random message where:
     delivered = false
     expires_at > now
   * Marks delivered = true
   * Returns ciphertext.

3. Client decrypts locally.

4. Client displays message.

5. After user closes view:

   * Client sends delete confirmation.
   * Server permanently deletes message.

If no message available:

Display:
The relay is quiet today.

Receive token is consumed regardless of message availability?
→ No. Token only consumed if a message is delivered.

---

## 8. Message Viewing Rules

* No copy button.
* Disable text selection.
* No share sheet.
* No screenshot detection in v1.
* Message remains visible until user closes screen.
* On close:

  * Local message wiped.
  * Delete API called.

No local persistence.

---

## 9. Translation

* After decryption:

  * Detect original language locally.
  * Translate locally using on-device translation framework.
* Show translated version.
* Small caption:
  "Originally written in [Language]."

If translation unavailable:

* Show original only.

Server never translates.

---

## 10. Privacy Guarantees

The system must:

* Store no message content after expiration.
* Store no readable message content ever.
* Store only hashed phone identifiers.
* Store public keys only.
* Store minimal metadata.

No:

* Analytics tracking libraries.
* Third-party ad SDKs.
* Behavioral tracking.

---

## 11. Account Deletion

User can delete account anytime.

Upon deletion:

* Remove hashed phone.
* Remove public key.
* Invalidate tokens.
* Do NOT attempt to retrieve sent messages.
* Any messages already in pool remain until expiration (anonymous).

Display:
You’ve left the relay.

Return to onboarding.

---

## 12. Non-Goals (Do NOT Implement)

* No chat threads.
* No replies.
* No reactions.
* No read receipts.
* No message status indicators.
* No premium tier.
* No ghost archive.
* No statistics.
* No user profiles.
* No follower system.
* No notifications.

---

## 13. UI Tone

Visual:

* Off-white background.
* Minimal typography.
* Large readable text.
* Generous spacing.
* No gradients.
* No heavy branding.

Language:

* Calm.
* Direct.
* Human.
* No exclamation marks.
* No hype.

---

## 14. MVP Scope Lock

If AI suggests adding:

* “Message retry”
* “Message history”
* “Delivery analytics”
* “Engagement tracking”
* “Push reminders”
* “Premium archive”
* “AI moderation”

Reject it.

---

1. Backend:

   * Custom API hosted on Railway.
   * PostgreSQL database.
   * No Firebase.
   * No Supabase.

2. SMS Verification:

   * Twilio.
   * After verification, phone number is hashed + salted.
   * Raw phone number is immediately discarded.
   * No Firebase Auth.

3. Encryption Model:

   * No user public/private keypairs.
   * No asymmetric encryption between users.
   * No E2E.

   We use envelope encryption:

   * On message creation:

     * Server generates random AES-256-GCM key per message.
     * Encrypts message with AES-256-GCM.
     * Uses Google Cloud KMS to encrypt the AES key.
     * Stores ciphertext + encrypted_message_key + timestamps.

   * On retrieval:

     * Server uses KMS to decrypt message key.
     * Decrypts message.
     * Sends plaintext to client over HTTPS.
     * Immediately deletes message after successful delivery.

4. Key Management:

   * One KMS master key per UTC day.
   * New key generated daily.
   * Previous day's key scheduled for destruction after 26 hours.
   * No key backups.
   * No long-term retention.

5. Expiry:

   * Messages auto-delete after 24 hours.
   * Cleanup job runs every 10 minutes.

6. Scope:

   * No user keypairs.
   * No cryptographic signing.
   * No E2E.
   * No analytics.
   * No logs of decrypted content.

   # 🌿 First Launch

**Relay.cafe**

> Once a day,
> you may send a message.
> Once a day,
> you may receive one.

> Messages exist for 24 hours.
> They are never stored.

[ Continue ]

---

# 🔐 Sign In Screen

> Sign in to enter the relay.

(Apple button)

Small secondary line (optional):

> Your identity is not shown to others.

---

# 🏠 Home Screen

[ Write today’s message ]
[ Open today’s message ]

No extra text.

---

# ✍️ Write Screen (Empty State)

Small text above input:

> It may be read once.
> Or not at all.

---

# 📤 After Sending

Fade out input.

Center text:

> Sent.

Nothing else.

No confirmation details.
No status.

---

# 🚫 Send Token Already Used

If user tries to send again:

> You’ve already sent today.

---

# 📥 Receive — Loading State

Blank screen.
2–3 second pause.
No spinner if possible.
Just space.

---

# 📭 No Message Available

If pool empty:

> The relay is quiet today.

Alternative (if you want slightly more human tone):

> There is no message waiting right now.

But I personally prefer:

> The relay is quiet today.

It’s poetic without being dramatic.

---

# 📖 Message Display

Main text centered or comfortably spaced.

Below in small, soft text:

> Originally written in Spanish.

(Replace with detected language.)

---

# 🌍 Translation Unavailable

If translation fails:

> Translation unavailable.
> You may read the original.

Keep it neutral.

---

# ❌ Receive Token Already Used

If user tries to receive again:

> You’ve already received today.

---

# 🕛 New Day Reset (Optional subtle line)

On first open after UTC reset:

> A new day has begun.

Or say nothing and just reset silently.
Silence might be stronger.

---

# 🗑 Account Deletion Confirmation

Before deletion:

> Your account will be permanently removed.
> This cannot be undone.

Buttons:
[ Cancel ]
[ Delete account ]

---

# 👋 After Account Deletion

> You’ve left the relay.

Return to onboarding.

---

# ⚠️ Network Error

Keep it calm.

> Connection unavailable.
> Please try again.

No error codes.
No technical detail.

---

# 🛑 Rate Limit / Abuse Protection

If temporary restriction needed:

> Please try again later.

Never mention spam.
Never mention detection.
Keep it neutral.

---

# 🌒 Edge Case: Message Expired Mid-Flow (Very Rare)

If user somehow opens expired message:

> This message is no longer available.

Keep it quiet.

---

# 🧠 Tone Rules (For You & The Agent)

* No exclamation marks.
* No emojis.
* No urgency.
* No gamification language.
* No statistics.
* No “Congratulations”.
* No numbers except daily limits.
* No technical explanations in UI.

Every message should feel:

Calm.
Neutral.
Human.
Light.

**Visual and motion system**

* Typography system
* Layout spacing
* Color palette
* Motion timing
* Interaction feel

Everything soft. Everything restrained.

---

# 🌿 Visual Identity System (v1)

## 🎨 Color Palette

Keep it extremely limited.

### Background

* Warm off-white
  Example: `#F6F4EF`
  (Slightly warm paper tone)

Alternative for dark mode:

* Very soft charcoal
  `#1C1C1C`
* Text: `#EDEBE6`

No gradients.
No accent colors.

---

## 🖋 Typography

Use native system fonts.

### Option 1 (Recommended)

* **SF Pro Text** (default system font)
* No custom fonts in v1.

Why?

* Native
* Clean
* Legible
* No branding noise

---

### Hierarchy

#### Title (Relay.cafe)

* 28–32pt
* Regular weight (not bold)
* Generous top spacing

#### Body text

* 17–19pt
* Regular weight
* Line spacing: 1.4–1.5x

#### Secondary text

* 13–14pt
* Slightly reduced opacity (70%)
* Never too faint

No bold emphasis in body copy.

Let whitespace create hierarchy.

---

# 📐 Layout Philosophy

Everything centered or comfortably padded.

Minimum horizontal padding:

* 24–32pt

Vertical spacing:

* Generous.
* Never cramped.

Buttons should feel like text buttons, not big filled UI elements.

Example:

```
Write today’s message
```

Not:
[ BIG BLUE BUTTON ]

Keep them minimal:

* Text only
* Light underline on tap
* Subtle opacity change

---

# 🌫 Motion & Animation

Motion should feel like:

Breathing.
Not sliding.

---

## ⏳ Loading Before Receiving

When user taps “Open today’s message”:

* Screen clears.
* 2.0–2.5 second pause.
* No spinner.
* No progress bar.

Then:

Message fades in.

Fade duration:
0.6 seconds.

Ease:
easeInOut.

No bounce.
No spring.

---

## ✉️ After Sending

User taps Send.

Text fades out.
Screen clears.
Show:

> Sent.

Fade in 0.4 seconds.
Fade out after 1.5 seconds.
Return to home.

Very quiet.

---

## 📖 Closing a Message

When user taps back:

Message fades out 0.3 seconds.
Then delete call happens.

Do not animate destruction dramatically.

Gone should feel natural, not theatrical.

---

# 🧘 Interaction Feel

No haptic feedback.
No sound.
No vibration.

Silence is part of the product.

---

# 🌗 Dark Mode

Support it.

But keep it soft.

No pure black.
No neon white.

Dark mode should feel like:
Reading in a dim room.

---

# 📱 Button Behavior

When send token used:

Disable button.
Lower opacity slightly (60–70%).
Keep layout stable.
No shifting UI.

---

# 🌍 Translation Display

Message text first.

Then 16–20pt vertical spacing.

Then:

> Originally written in Portuguese.

Small.
Muted.
Not emphasized.

---

# 🧠 What We Are Avoiding

* Card UI
* Shadows
* Rounded content containers
* Borders
* Icons
* Illustrations
* Avatars
* Animations that feel “delightful”
* Confetti
* Gradients
* System blue buttons everywhere

---

# 🌿 App Store Description (Soft Tone)

Here’s a draft in your voice:

---

Relay.cafe

Once a day, you may send a message.
Once a day, you may receive one.

Messages exist for 24 hours.
They are never stored.
They are never shown twice.

No profiles.
No history.
No replies.
No metrics.

Just a signal, passing once.

---

Minimal. Quiet. Clear.

---

You’ve now defined:

* Product philosophy
* Encryption model
* Key lifecycle
* Authentication method
* Backend stack
* UX voice
* Visual identity
* Motion system

### Relay.cafe – UX State Clarification (Daily Reset & Reopen Behavior)

We are clarifying daily state behavior and home screen logic.

1. The app uses strict UTC-based daily tokens:

   * 1 send token per UTC day.
   * 1 receive token per UTC day.
   * Tokens reset silently at 00:00 UTC.
   * No countdown timers.
   * No visible reset announcement.
   * No notifications.

2. When user reopens the app after already using their tokens (e.g., 5 minutes later):

   * Home screen layout must remain stable.
   * Buttons remain visible but disabled if already used.
   * Under each disabled button, show:

     * "You’ve already sent today."
     * "You’ve already received today."
   * Do NOT show countdown.
   * Do NOT show time until reset.
   * Do NOT show encouragement to return tomorrow.
   * Do NOT show “new day” messaging.

3. When a new UTC day begins:

   * Tokens reset silently.
   * Buttons become active again.
   * No announcement.
   * No celebratory message.
   * No text such as “A new day has begun.”

4. The home screen must look identical every day unless token state changes.

   * No dynamic backgrounds.
   * No time-of-day themes.
   * No variation.
   * No gamification.
   * No streak indicators.
   * No daily counters.

5. The app should feel:

   * Quiet.
   * Stable.
   * Minimal.
   * Non-reactive.
   * Non-addictive.

6. Explicitly avoid:

   * Engagement mechanics.
   * Habit loop reinforcement.
   * Behavioral nudges.
   * Psychological triggers tied to daily reset.

The system should behave like a static space that changes only based on token availability, not based on time-of-day styling or emotional cues.

Daily Token & Expiration Clarification:

Send/receive tokens reset at 00:00 UTC.

Message expiration is strictly 24 hours from creation timestamp.

Tokens and message expiration are independent systems.

It is allowed for a user to have multiple active messages if they send just before and just after UTC reset.

Do NOT enforce “one active message per user.”

Do NOT modify expiration based on daily reset.

No coupling between token reset and message TTL.

---

### Cleanup Architecture Decision – Final

We are choosing database-level expiration cleanup.

Do NOT implement Railway cron hitting an internal API endpoint.

Do NOT create an `/internal/cleanup` HTTP endpoint.

Do NOT add CRON_SECRET.

Expiration is strictly a data lifecycle rule and belongs at the database layer.

Implementation requirements:

1. Messages must be permanently deleted when:
   `expires_at <= NOW()`.

2. Cleanup must run every 5–10 minutes.

3. Use database-level scheduling (pg_cron if available, or Railway scheduled SQL if supported).

4. The cleanup job must:

   * Execute a direct SQL DELETE.
   * Not fetch rows into application memory.
   * Not decrypt anything.
   * Not log deleted message IDs.
   * Not archive expired messages.
   * Not soft-delete.

5. Add an index to ensure cleanup performance:

   ```sql
   CREATE INDEX idx_messages_expires_at ON messages (expires_at);
   ```

6. Expiration is final. There is no recovery, no archive table, no logging of content.

This keeps the system minimal and reduces operational surface area.

Do not propose alternative cron services unless database scheduling is technically unavailable.

### Relay.cafe – UI Refinement & Error Handling Fixes

Apply the following visual and UX adjustments. Maintain the minimal philosophy. Do not add decorative elements.

---

## 1. Remove Raw Apple Error Codes

The current sign-in screen displays system error text like:

`com.apple.AuthenticationServices.AuthorizationError 1000`

This must never be shown to the user.

Replace all raw framework/system error output with:

> Unable to sign in.
> Please try again.

Do not expose error codes, stack traces, or system identifiers in UI.

---

## 2. Onboarding Spacing Refinement

Adjust layout:

* Increase vertical spacing between “Relay.cafe” and body text slightly.
* Add slightly more spacing between the two conceptual blocks:

Current:

```
Once a day,
you may send a message.
Once a day,
you may receive one.
```

Refine to visually separate the two ideas with more vertical breathing room.

Do not change wording.

---

## 3. Disabled Button Opacity Adjustment

When a token is used:

* Disabled button opacity should be ~60–65%.
* It must still be readable.
* Do not make it too faint.
* Maintain layout stability (no movement).

Example:
“You’ve already sent today.” remains below the disabled button.

---

## 4. Compose Screen Layout Adjustment

* Slightly increase top padding so guidance text:

  > It may be read once.
  > Or not at all.

  does not feel cramped against the safe area.

* Ensure text input area has comfortable breathing room.

---

## 5. Send Button Behavior

* “Send” must be disabled when input is empty.
* It becomes active only when text length > 0.
* No color change to bright accent.
* Keep minimal styling.
* Only subtle opacity change.

---

## 6. Error Message Positioning (Compose Screen)

For:

> Message not sent.
> Please try again.

Adjust spacing so the error message sits closer to the composed text.

Avoid large empty white gaps between message content and error state.

Keep tone calm and consistent.

---

## 7. Background Gradient Adjustment

Current background gradient is slightly too noticeable.

Refine to:

* Very subtle warm tone variation.
* Gradient should feel like ambient light, not a design element.
* Avoid visible banding or decorative feel.

No strong color transitions.

---

## 8. Safe Area Padding

Ensure onboarding and compose screens:

* Have slightly more top padding under dynamic island.
* Content should feel comfortably centered vertically.
* Avoid crowding the top edge.

---

## Important Constraints

* Do NOT add new UI elements.
* Do NOT introduce icons.
* Do NOT add animations.
* Do NOT add color accents.
* Do NOT change wording.
* Maintain minimalist aesthetic.

### Relay.cafe – Time-Based State Enforcement (Foreground + Expiration Handling)

We must enforce time-based rules even if the app remains open or in background.

The UI must never rely on static state.

Implement the following:

---

## 1. App Foreground Revalidation

When the app becomes active (`scenePhase == .active`):

Revalidate all time-based state:

* Recalculate current UTC day.
* Recalculate send token availability.
* Recalculate receive token availability.
* If a message is currently displayed:

  * Check its `expires_at` timestamp.
  * If `now >= expires_at`, invalidate immediately.

Do NOT rely on cached state from previous session.

---

## 2. Message Expiration While Displayed

When displaying a message:

* Store `expires_at` (server-provided timestamp) in memory only.
* Do not persist to disk.
* Do not rely on client-generated expiration time.

On foreground entry:

```swift
if Date() >= expiresAt {
    invalidateMessage()
}
```

If expired:

* Fade out message (subtle, 0.3–0.4 seconds).

* Replace with:

  "This message is no longer available."

* Remove message from memory.

No dramatic animation.
No warning.
No countdown.

---

## 3. Midnight UTC Reset Handling

If app remains open across 00:00 UTC:

On next foreground activation:

* Recompute daily tokens.
* Update button states.
* Do NOT show “new day” message.
* Do NOT show countdown.
* Reset silently.

---

## 4. Optional Lightweight Safety Check (While Active)

If desired, add a lightweight timer (max every 60 seconds) while message is visible to re-check expiration.

Do NOT:

* Poll aggressively.
* Make network calls.
* Create performance-heavy loops.

This is only a guard.

---

## 5. Constraints

* Do NOT persist message content locally.
* Do NOT allow message to survive past expiration due to UI state.
* Do NOT trust only client clock — use server-provided expiration timestamp.
* Time rules must override view state.

The system must enforce:
Messages exist for 24 hours.
No exceptions.

---

### Relay.cafe – Strict Implementation Mode

You are no longer allowed to propose architecture changes or alternative designs.

You must implement exactly what is specified.

Do NOT:

* Suggest additional services.
* Suggest alternative encryption models.
* Suggest different cron strategies.
* Suggest feature improvements.
* Suggest UX enhancements.
* Suggest scalability optimizations.
* Suggest refactors unless explicitly requested.

You must:

* Follow the current spec exactly.
* Implement only the requested change.
* Keep changes minimal.
* Avoid introducing new abstractions.
* Avoid adding new files unless necessary.
* Avoid modifying unrelated code.

If something is unclear:

* Ask a short clarification question.
* Do not invent behavior.

When implementing time-based logic:

* Follow the specified UTC reset model.
* Do not introduce rolling 24h per-user logic.
* Do not introduce countdown timers.
* Do not introduce background workers unless explicitly requested.

When implementing UI:

* Do not add animations unless specified.
* Do not add color accents.
* Do not expose system error codes.
* Keep text exactly as defined.

Treat this as a minimalist system.
Restraint is part of the design.

For each task:

1. Briefly restate the task.
2. Implement only that.
3. Do not expand scope.

We are optimizing for correctness and simplicity, not feature richness.

---

This forces the agent into execution mode instead of creative mode.

You are the architect.
It is the implementer.

---

Relay.cafe – Final Message Layout Decision 

We are finalizing the received message layout.

Do NOT change this in future refinements.

Message Positioning Rules

Horizontal alignment

The received message text must be left-aligned.

It must NOT be centered horizontally.

Use consistent horizontal padding (24–32pt).

Vertical positioning

The message must NOT be perfectly vertically centered.

It should sit slightly above vertical center.

There should be more visual space below the message than above.

Avoid mathematical symmetry.

Translation hint

Remains left-aligned.

Positioned directly below the message.

Muted/secondary styling.

No visual containers or separators.

Close button

Centered horizontally near the bottom of the screen.

Visually secondary to the message.

No strong accent styling.

Explicitly Avoid

Centering the message horizontally.

Perfect vertical centering.

Card UI.

Containers, borders, or decorative frames.

Additional alignment adjustments for “visual balance.”

Any layout changes not explicitly requested.

The message screen must feel like:

A written note.

Human.

Slightly asymmetrical.

Not staged or system-generated.

Preserve restraint.

Relay.cafe – Final Message Layout Decision 

We are finalizing the received message layout.

Do NOT change this in future refinements.

Message Positioning Rules

Horizontal alignment

The received message text must be left-aligned.

It must NOT be centered horizontally.

Use consistent horizontal padding (24–32pt).

Vertical positioning

The message must NOT be perfectly vertically centered.

It should sit slightly above vertical center.

There should be more visual space below the message than above.

Avoid mathematical symmetry.

Translation hint

Remains left-aligned.

Positioned directly below the message.

Muted/secondary styling.

No visual containers or separators.

Close button

Centered horizontally near the bottom of the screen.

Visually secondary to the message.

No strong accent styling.

Explicitly Avoid

Centering the message horizontally.

Perfect vertical centering.

Card UI.

Containers, borders, or decorative frames.

Additional alignment adjustments for “visual balance.”

Any layout changes not explicitly requested.

The message screen must feel like:

A written note.

Human.

Slightly asymmetrical.

Not staged or system-generated.

Preserve restraint.

Good. Keep this tight and decisive.

Send this to the agent:

---

### Relay.cafe – Critical Fix: KMS Retention + Receive Atomicity

We are fixing two correctness issues.

Do not propose alternatives. Implement exactly as specified.

---

## 1. KMS Key Retention Policy

Key destruction at 26h is incorrect.

Requirement:

```
key_retention >= MESSAGE_TTL + key_rotation_period + safety_buffer
```

For production:

* MESSAGE_TTL = 24h
* rotation_period = 24h
* safety_buffer = 2h

Therefore:

* Minimum key retention = 50 hours.

Update key lifecycle logic so old key versions are NOT destroyed before 50 hours.

Do not reduce this.

---

## 2. Receive Flow Must Be Atomic

Current behavior deletes message before decryption. This is incorrect.

Fix the receive flow:

* Begin DB transaction.
* SELECT message FOR UPDATE SKIP LOCKED.
* Attempt unwrapKey.
* Attempt decryptMessage.
* Only if both succeed:

  * DELETE the message.
  * Mark receiveUsed = true.
  * COMMIT.
* If unwrap or decrypt fails:

  * ROLLBACK.
  * Do NOT delete message.
  * Do NOT consume receive token.
  * Return 500.

Deletion must depend on successful decryption.

---

## 3. Do NOT:

* Delete message before decrypt.
* Consume receive token before successful decrypt.
* Destroy KMS keys earlier than required retention window.

These are correctness guarantees.

Implement only these fixes.

---

That keeps it minimal and unambiguous.

This is a real integrity fix — not feature creep.

Relay.cafe – Enable Text Selection (No UI Changes)

We are enabling text selection on received messages.

Implement the following:
	1.	Allow standard iOS text selection on the message text.
	•	Users should be able to long-press and copy text using native system behavior.
	•	Do NOT add a visible “Copy” button.
	•	Do NOT add a share button.
	•	Do NOT add export UI.
	2.	Do NOT modify layout, alignment, or styling.
	3.	Do NOT change expiration logic.
	•	Message expiration remains based only on TTL and time checks.
	•	Copying text does NOT invalidate the message.
	4.	Do NOT add any visual indication that copying is possible.

This is purely enabling native text selection for usability in case translation is needed.

Keep implementation minimal.

Relay.cafe – Translation Behavior Final Confirmation

We are finalizing the translation behavior for v1.

Confirm and enforce the following:
	1.	Translation must use TranslationSession(installedSource:target:) only.
	•	Do NOT call prepareTranslation().
	•	Do NOT trigger any system download prompt.
	•	Do NOT attempt to download language models automatically.
	2.	Behavior must be:
	•	Language differs + model installed → auto-translate and show:
“Originally written in [Language].”
	•	Language differs + model NOT installed → do NOT attempt translation.
Set translationFailed = true and show:
“Translation unavailable.\nYou may read the original.”
	•	Same language → no translation attempt, no caption.
	•	iOS 17 → no translation, original text only.
	3.	Confirm that:
	•	installedSource uses detected language code.
	•	target uses the user’s preferred language code.
	•	If mapping to Locale.Language fails, skip translation safely.
	4.	Do NOT add:
	•	A “Download language” button.
	•	A translation settings toggle.
	•	Any UI that can trigger model download.
	5.	Confirm that translation failure does not:
	•	Block message display.
	•	Crash the view.
	•	Trigger Sentry errors unnecessarily.

Return a short confirmation summary.

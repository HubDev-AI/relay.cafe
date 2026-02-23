Relay.cafe – Privacy & Data Collection Audit (Full Code Review)

Perform a full audit of the entire codebase (API + iOS app) to identify all forms of data collection, storage, transmission, and third-party sharing.

This is for App Store Privacy disclosure accuracy.

Be precise and exhaustive.

⸻

1. Apple Sign-In

Check:
	•	Do we store the Apple email address?
	•	Do we store the Apple full name?
	•	Do we persist the raw Apple identity token?
	•	Do we only store a hashed Apple sub ID?

If email or name is stored anywhere (DB, logs, session, cache), list the exact location.

⸻

2. User Identifiers

Identify all stored identifiers:
	•	Apple sub ID
	•	Session tokens
	•	Device fingerprint (if any)
	•	Any UUID tied to a user
	•	Any persistent device-level ID

List:
	•	Where it is stored
	•	Whether it is linked to a user
	•	Whether it is logged

⸻

3. Message Data

Confirm:
	•	Are messages ever stored in plaintext?
	•	Are decrypted messages logged anywhere?
	•	Are decrypted messages stored temporarily in memory only?
	•	Is any message content written to logs, error tracking, or console output?

Search for:
	•	console.log
	•	logger.*
	•	Sentry.capture*
	•	Any debugging statements containing message content

⸻

4. IP Address Handling

Check:
	•	Do we log IP addresses?
	•	Are IP addresses stored in DB?
	•	Are they retained long-term?
	•	Are they tied to user accounts?

Specify:
	•	Table name (if stored)
	•	Retention duration
	•	Purpose

⸻

5. Sentry Integration

Audit Sentry configuration:
	•	Is Sentry capturing request bodies?
	•	Is Sentry capturing headers?
	•	Is Sentry capturing Authorization tokens?
	•	Is Sentry capturing message text?
	•	Is PII scrubbing enabled?

List:
	•	What is sent to Sentry
	•	What fields are automatically included
	•	Whether IP addresses are transmitted to Sentry

⸻

6. Logs

Search entire backend for:
	•	console.log
	•	console.error
	•	logger usage
	•	debug output

Confirm:
	•	No sensitive data (message text, tokens, Apple ID, email) is logged.

⸻

7. Analytics

Confirm:
	•	No analytics SDK is included.
	•	No tracking SDK.
	•	No advertising SDK.
	•	No device fingerprinting library.

Search for:
	•	Firebase
	•	Amplitude
	•	Mixpanel
	•	Segment
	•	Google Analytics
	•	AppsFlyer
	•	Adjust
	•	Facebook SDK

⸻

8. Push Notifications

Confirm:
	•	Are we collecting device push tokens?
	•	Are push tokens stored?
	•	Are push tokens sent to backend?

⸻

9. Data Sharing

Identify any third-party services used:
	•	GCP KMS
	•	Railway
	•	Sentry

Confirm:
	•	What data is transmitted to each
	•	Whether any user-generated content is shared

⸻

10. Retention

For each data type found, list:
	•	What it is
	•	Where it is stored
	•	How long it is retained
	•	Whether user can delete it
	•	Whether it is linked to identity

⸻

Output Format

Produce a structured report:

Data Category
	•	Collected? (Yes/No)
	•	Stored? (Yes/No)
	•	Shared? (Yes/No)
	•	Linked to user? (Yes/No)
	•	Retention duration

Do not speculate.
Only report what is found in code.

⸻

This audit must be accurate enough to complete the App Store Privacy questionnaire.


---------

Perfect. Since you are:
	•	Using Sentry for error reporting only
	•	No tracing
	•	No profiling
	•	No performance spans
	•	No analytics SDK
	•	Removing device_fingerprint (as we decided)

Here is your updated, final, shorter, precise App Store Privacy declaration guide.

⸻

✅ Final App Store Privacy Selections (Relay.cafe)

1️⃣ Does your app collect data?

Yes.

Because you collect:
	•	User ID (hashed Apple identifier)
	•	User Content (messages)
	•	Crash Data (Sentry)

⸻

2️⃣ Data Types to Declare

🔹 Identifiers → User ID
	•	Collected: Yes
	•	Linked to User: Yes
	•	Used for Tracking: No
	•	Shared: No
	•	Purpose: App Functionality

Reason:
apple_id_hash uniquely identifies the user account.

⸻

🔹 User Content → Other User Content
	•	Collected: Yes
	•	Linked to User: No
	•	Used for Tracking: No
	•	Shared: No
	•	Purpose: App Functionality

Reason:
Messages are encrypted at rest and structurally unlinkable to the sender. They are automatically deleted after 24 hours.

⸻

🔹 Diagnostics → Crash Data
	•	Collected: Yes
	•	Linked to User: Yes
	•	Used for Tracking: No
	•	Shared: Yes (Sentry)
	•	Purpose: App Functionality

Reason:
Crash/error events are sent to Sentry. No message text is included, but userId is attached for debugging context.

Do NOT select:
	•	Performance Data
	•	Other Diagnostic Data
(because you are not using tracing or profiling)

⸻

3️⃣ Data Used to Track You?

No.

You do not:
	•	Use advertising identifiers
	•	Use IDFA
	•	Use ATT
	•	Use cross-app tracking
	•	Share data with data brokers

⸻

4️⃣ Data Shared with Third Parties?

Only:
	•	Crash Data → Shared with Sentry

Infrastructure providers (Railway, GCP KMS) do not count as third-party data sharing under Apple’s definition.

⸻

🔥 Final Summary

Your App Store Privacy will list:
	•	Identifiers → User ID (Linked)
	•	User Content → Other User Content (Not Linked)
	•	Diagnostics → Crash Data (Linked, Shared with Sentry)

No Device ID.
No Tracking.
No Analytics.
No Ads.

⸻

🌿 Human-Readable Summary (Internal Truth)

Relay.cafe:
	•	Stores a hashed Apple identifier for accounts.
	•	Processes messages to deliver them; messages are encrypted at rest and deleted after 24 hours.
	•	Sends crash/error reports to Sentry without including message content.
	•	Does not track users.

⸻

This is clean.
Minimal.
Accurate.
Defensible.

You’re in very good shape for submission.

If you want next, we can go through the App Store review checklist so nothing blocks approval.
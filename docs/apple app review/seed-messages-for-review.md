# Seeding Messages for App Store Review

When Apple's App Review team tests the app, they need pre-populated messages
to verify the "receive a message" flow. Run this before each submission.

## Prerequisites

- Railway CLI linked to production: `railway status`
- Local GCP credentials for **production** project (`relay-cafe-prod`)
- `bun` installed
- Working directory: `relay-cafe-api/`

## Steps

### 1. Get production env vars

```bash
# Get the production DATABASE_URL
railway run printenv DATABASE_URL

# Get production GCP credentials (base64-encoded)
railway run printenv GCP_CREDENTIALS_B64 | base64 -d > /tmp/relay-prod-gcp-creds.json
```

### 2. Create two senders (if they don't already exist)

Two senders so the reviewer sees messages from different people.

```bash
export DATABASE_URL="<PROD_DATABASE_URL>"

bun run scripts/qa-seed.ts create-sender ReviewSenderA
bun run scripts/qa-seed.ts create-sender ReviewSenderB
```

Save the returned sender IDs.

### 3. Seed messages (7-day TTL)

Set `MESSAGE_TTL_SECONDS=604800` (7 days) so messages survive the full review window.

```bash
export DATABASE_URL="<PROD_DATABASE_URL>"
export GOOGLE_APPLICATION_CREDENTIALS=/tmp/relay-prod-gcp-creds.json
export GCP_PROJECT_ID=relay-cafe-prod
export GCP_KMS_LOCATION=global
export GCP_KMS_KEY_RING=relay-cafe
export GCP_KMS_KEY_NAME=message-key
export MESSAGE_TTL_SECONDS=604800

SENDER_A="<SENDER_A_ID>"
SENDER_B="<SENDER_B_ID>"

# Sender A messages
bun run scripts/qa-seed.ts create-message $SENDER_A "Every day is a chance to learn something new. Keep going."
bun run scripts/qa-seed.ts create-message $SENDER_A "You are stronger than you think. Take it one step at a time."
bun run scripts/qa-seed.ts create-message $SENDER_A "The world is full of possibilities. What will you explore today?"
bun run scripts/qa-seed.ts create-message $SENDER_A "Sometimes the smallest act of kindness can make the biggest difference."
bun run scripts/qa-seed.ts create-message $SENDER_A "Take a deep breath. You are exactly where you need to be."

# Sender B messages
bun run scripts/qa-seed.ts create-message $SENDER_B "A little progress each day adds up to big results."
bun run scripts/qa-seed.ts create-message $SENDER_B "Be the reason someone smiles today."
bun run scripts/qa-seed.ts create-message $SENDER_B "You don't have to be perfect to be amazing."
bun run scripts/qa-seed.ts create-message $SENDER_B "The best time to start is now."
bun run scripts/qa-seed.ts create-message $SENDER_B "Kindness is free. Sprinkle it everywhere."
```

### 4. Clean up credentials

```bash
rm /tmp/relay-prod-gcp-creds.json
```

## Important notes

- **Must use production GCP project** (`relay-cafe-prod`), not `relay-cafe-dev`.
  Messages encrypted with the dev key cannot be decrypted by the production backend.
- Messages expire after `MESSAGE_TTL_SECONDS` (set to 604800 = 7 days above).
  Re-seed if review takes longer than expected.
- With `DEMO_MODE=true` on the server, the reviewer has unlimited send/receive tokens.
  No need to reset tokens manually.
- List all users to find user IDs:
  ```bash
  DATABASE_URL="<PROD_DATABASE_URL>" bun run scripts/qa-seed.ts list-users
  ```

# Demo Mode for App Store Review

Server-side flag that disables daily token limits so the Apple reviewer
can send and receive unlimited messages during testing.

## What it does

- Send tokens: **unlimited** (normally 1/day)
- Receive tokens: **unlimited** (normally 1/day)
- Status endpoint: always returns `sendUsed: false`, `receiveUsed: false`
- Everything else unchanged: content filter, blocking, reporting, suspension, message expiry, cleanup crons

## How to enable

Set the environment variable on Railway (production):

```bash
railway variables set DEMO_MODE=true
```

The API will log `[demo] DEMO_MODE is ON — token limits disabled` on startup.

## How to disable (after approval)

```bash
railway variables unset DEMO_MODE
```

Restart the service. Token limits immediately resume.

## Full review submission checklist

### Before submitting

1. **Enable demo mode** on production:
   ```bash
   railway variables set DEMO_MODE=true
   ```

2. **Seed messages** from 2 sender accounts with 7-day TTL.
   See: `docs/apple app review/seed-messages-for-review.md`

3. **Write App Review Notes** in App Store Connect:
   > This app uses Sign in with Apple exclusively — no username/password.
   > The reviewer can sign in with any Apple ID.
   >
   > How to test:
   > 1. Tap "Sign in with Apple" on the welcome screen
   > 2. Accept the Terms of Use checkbox, then proceed
   > 3. On the Home screen, tap "Receive" to read a message
   > 4. Tap "Send" to compose and send a message
   > 5. Messages can be sent and received multiple times for testing
   >
   > The message pool is pre-populated with demo content.

4. **Submit for review**

### After approval

1. **Disable demo mode**:
   ```bash
   railway variables unset DEMO_MODE
   ```

2. **Clean up demo data** from production DB:
   ```bash
   # Get prod DATABASE_URL
   railway run printenv DATABASE_URL

   # Connect and clean up
   DATABASE_URL="<PROD_DATABASE_URL>" bun run scripts/qa-seed.ts clear-all
   ```
   Or selectively delete only seed senders and their messages.

3. **Verify** token limits are working:
   ```bash
   railway logs
   # Should NOT show "[demo] DEMO_MODE is ON"
   ```

## If review takes longer than 7 days

Re-seed messages following the seed doc. The existing `DEMO_MODE=true` stays active.

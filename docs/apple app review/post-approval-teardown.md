# Post-Approval Teardown

Step-by-step instructions to disable demo mode and clean up production
after the App Store review is approved.

## 1. Disable demo mode

Remove the `DEMO_MODE` environment variable from Railway production:

```bash
railway variables unset DEMO_MODE
```

Railway will automatically redeploy. Wait for the deploy to finish, then
verify the log does NOT show the demo banner:

```bash
railway logs -n 10
# Should show: "relay-cafe-api running on :3000"
# Should NOT show: "[demo] DEMO_MODE is ON"
```

## 2. Clean up demo data from production DB

Get the production DATABASE_URL:

```bash
railway run printenv DATABASE_URL
```

### Option A: Nuclear reset (if no real users yet)

Deletes ALL data — users, messages, tokens, reports, everything:

```bash
cd relay-cafe-api
DATABASE_URL="<PROD_DATABASE_URL>" bun run scripts/qa-seed.ts clear-all
```

### Option B: Selective cleanup (if real users exist)

Only delete the two seed sender accounts and their messages.
The sender IDs created for this review cycle:

- **ReviewSenderA:** `52393056-05f1-4802-baf5-b87a14cdfe29`
- **ReviewSenderB:** `cfb88fb1-36da-4457-940a-ffd84ae32f98`

Connect to production Postgres and run:

```sql
-- Delete messages from seed senders
DELETE FROM messages WHERE sender_user_id IN (
  '52393056-05f1-4802-baf5-b87a14cdfe29',
  'cfb88fb1-36da-4457-940a-ffd84ae32f98'
);

-- Delete delivery log entries from seed senders
DELETE FROM delivery_log WHERE sender_user_id IN (
  '52393056-05f1-4802-baf5-b87a14cdfe29',
  'cfb88fb1-36da-4457-940a-ffd84ae32f98'
);

-- Delete reports against seed senders
DELETE FROM reports WHERE sender_user_id IN (
  '52393056-05f1-4802-baf5-b87a14cdfe29',
  'cfb88fb1-36da-4457-940a-ffd84ae32f98'
);

-- Delete the seed sender user records (cascades sessions, daily_tokens, blocked_senders)
DELETE FROM users WHERE id IN (
  '52393056-05f1-4802-baf5-b87a14cdfe29',
  'cfb88fb1-36da-4457-940a-ffd84ae32f98'
);
```

## 3. Verify normal operation

After teardown, confirm:

1. **Token limits work:** Send a message, try sending again — should get 429 "Already sent today."
2. **Receive limits work:** Receive a message, try again — should get 429 "Already received today."
3. **Status endpoint:** `GET /v1/me/status` should return `sendUsed: true` after sending.
4. **No seed data remains:**
   ```bash
   DATABASE_URL="<PROD_DATABASE_URL>" bun run scripts/qa-seed.ts list-users
   ```
   Should not show ReviewSenderA or ReviewSenderB.

## 4. Optional: remove demo mode code

Once the app is approved and stable, the `DEMO_MODE` code can optionally
be removed in a future cleanup PR. It is harmless to leave in place — when
the env var is absent, all code paths behave identically to before demo mode
was added.

Files that reference `isDemoMode()`:
- `relay-cafe-api/src/lib/demo.ts`
- `relay-cafe-api/src/routes/messages.ts`
- `relay-cafe-api/src/routes/me.ts`
- `relay-cafe-api/src/index.ts`

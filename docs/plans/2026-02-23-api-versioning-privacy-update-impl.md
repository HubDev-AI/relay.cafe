# API Versioning + Privacy Update — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `/v1` prefix to all API routes (clean break) and update the landing page privacy copy to say "encrypted in transit and at rest".

**Architecture:** Create a Hono sub-app for v1, mount all business routes under it, keep `/health` at root. Update all integration test paths to match.

**Tech Stack:** Hono (sub-app routing), Bun test runner, static HTML

**Design doc:** `docs/plans/2026-02-23-api-versioning-privacy-update-design.md`

---

### Task 1: Add v1 sub-app to `src/app.ts`

**Files:**
- Modify: `relay-cafe-api/src/app.ts`

**Step 1: Restructure app.ts with v1 sub-app**

Replace lines 43-46 (the route registrations) with a v1 sub-app:

```typescript
// After line 41 (end of /health handler), replace lines 43-46 with:

const v1 = new Hono()
v1.route('/auth', authRouter)
v1.use('/me/*', authMiddleware)
v1.route('/me', meRouter)
v1.use('/messages/*', authMiddleware)
v1.route('/messages', messagesRouter)

app.route('/v1', v1)
```

Note: `/me` routes also need auth middleware — currently `meRouter` relies on `authMiddleware` being applied. Check current behavior to confirm.

**Step 2: Verify auth middleware scoping**

Check if `/me` routes currently have auth middleware. Look at:
- `src/routes/me.ts` — does it apply its own auth?
- Current `app.ts` line 45 only applies to `/messages/*`

If `/me` has its own auth check in the router, don't add `v1.use('/me/*', authMiddleware)`. If not, add it.

**Step 3: Run tests to see what breaks**

Run: `cd relay-cafe-api && bun test`

Expected: All integration tests FAIL with 404s because paths changed from `/auth` to `/v1/auth`, etc.

**Step 4: Commit**

```bash
git add relay-cafe-api/src/app.ts
git commit -m "feat: add v1 API versioning with Hono sub-app"
```

---

### Task 2: Update test helper and all integration test paths

**Files:**
- Modify: `relay-cafe-api/tests/helpers/http.ts` (no changes needed — paths are passed by callers)
- Modify: `relay-cafe-api/tests/integration/auth.test.ts`
- Modify: `relay-cafe-api/tests/integration/me.test.ts`
- Modify: `relay-cafe-api/tests/integration/messages-send.test.ts`
- Modify: `relay-cafe-api/tests/integration/messages-receive.test.ts`
- Modify: `relay-cafe-api/tests/integration/messages-concurrent.test.ts`
- Modify: `relay-cafe-api/tests/integration/time-boundaries.test.ts`

**Step 1: Update all route paths in test files**

In every integration test file, prefix API paths with `/v1`:
- `'/auth/apple'` → `'/v1/auth/apple'`
- `'/me/status'` → `'/v1/me/status'`
- `'/me'` → `'/v1/me'` (for DELETE)
- `'/messages'` → `'/v1/messages'`
- `'/messages/today'` → `'/v1/messages/today'`

Do NOT change `/health` paths if any tests use it (it stays at root).

Also update `describe` block strings to reflect new paths:
- `'GET /me/status'` → `'GET /v1/me/status'`
- `'POST /messages'` → `'POST /v1/messages'`
- etc.

**Step 2: Run tests**

Run: `cd relay-cafe-api && bun test`

Expected: All tests PASS with the new `/v1` paths.

**Step 3: Commit**

```bash
git add relay-cafe-api/tests/
git commit -m "test: update integration test paths for v1 API versioning"
```

---

### Task 3: Add a test for unversioned paths returning 404

**Files:**
- Modify: `relay-cafe-api/tests/integration/auth.test.ts` (or create a small dedicated test)

**Step 1: Write the failing test**

Add a test that confirms old paths are gone:

```typescript
describe('unversioned routes', () => {
  test('GET /messages/today returns 404', async () => {
    const { status } = await requestJSON('/messages/today')
    expect(status).toBe(404)
  })

  test('GET /me/status returns 404', async () => {
    const { status } = await requestJSON('/me/status')
    expect(status).toBe(404)
  })

  test('GET /health still works at root', async () => {
    const { status } = await requestJSON('/health')
    expect(status).toBe(200)
  })
})
```

**Step 2: Run test**

Run: `cd relay-cafe-api && bun test`

Expected: All PASS (old paths already 404 after Task 1).

**Step 3: Commit**

```bash
git add relay-cafe-api/tests/
git commit -m "test: verify unversioned routes return 404 and /health stays at root"
```

---

### Task 4: Update landing page privacy copy

**Files:**
- Modify: `relay-cafe-site/index.html:101`

**Step 1: Update the privacy section**

Change line 101 from:
```html
        Messages are encrypted in transit.<br>
```
to:
```html
        Messages are encrypted in transit and at rest.<br>
```

**Step 2: Verify visually**

Open `relay-cafe-site/index.html` in a browser to confirm the text reads correctly.

**Step 3: Commit**

```bash
git add relay-cafe-site/index.html
git commit -m "content: update privacy section to reflect encryption at rest"
```

---

### Task 5: Final verification and squash

**Step 1: Run full test suite**

Run: `cd relay-cafe-api && bun test`

Expected: All tests PASS.

**Step 2: Verify route structure**

Quickly check that the app responds correctly:
- `GET /health` → 200
- `GET /v1/me/status` (with auth) → 200
- `GET /messages/today` (no v1) → 404

**Step 3: Review all changes**

Run: `git diff dev --stat` to see all files changed.

Confirm:
- `src/app.ts` — restructured with v1 sub-app
- `tests/` — paths updated
- `relay-cafe-site/index.html` — privacy copy updated

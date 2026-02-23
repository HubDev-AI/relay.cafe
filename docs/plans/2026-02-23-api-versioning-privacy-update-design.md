# API Versioning + Landing Page Privacy Update

**Date:** 2026-02-23
**Status:** Approved

## Context

relay.cafe API currently serves routes at root level (`/auth`, `/me`, `/messages`). As the iOS app is installed and in use, we need versioned API paths so future breaking changes don't break existing clients.

The landing page privacy section says "encrypted in transit" but messages are also encrypted at rest (GCP KMS envelope encryption). The copy should reflect this.

## Decisions

- **Versioning style:** Simple integer (`/v1`, `/v2`, ...). Not semver.
- **Migration:** Clean break. Old unversioned paths removed (404). iOS app updated to use `/v1` prefix.
- **Health check:** Stays at root `/health` (infrastructure, not API).
- **Implementation:** Hono nested sub-app for version isolation.

## API Versioning Design

### Structure

```
app (root Hono)
├── GET /health                    (infrastructure, unversioned)
├── middleware: security headers   (global)
├── middleware: global rate limit  (global)
└── /v1 (sub-app)
    ├── /auth    → authRouter
    ├── /me      → meRouter
    └── /messages → messagesRouter (with auth middleware)
```

### Changes to `src/app.ts`

1. Create `const v1 = new Hono()`
2. Move route registrations to `v1`
3. Mount with `app.route('/v1', v1)`
4. Remove old root-level route registrations
5. Auth middleware for `/messages/*` scoped within `v1`

### iOS Impact

All API calls change from:
- `POST /auth/apple` → `POST /v1/auth/apple`
- `GET /messages/today` → `GET /v1/messages/today`
- `POST /messages` → `POST /v1/messages`
- `GET /me/status` → `GET /v1/me/status`

## Landing Page Privacy Update

`relay-cafe-site/index.html` line 101:
```diff
- Messages are encrypted in transit.
+ Messages are encrypted in transit and at rest.
```

Accurate since messages use GCP KMS envelope encryption at rest.

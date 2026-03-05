# Napkin

## Corrections
| Date | Source | What Went Wrong | What To Do Instead |
|------|--------|----------------|-------------------|
| 2026-03-05 | self | Used docker compose `--profile` flag which rtk proxy doesn't support | Avoid docker compose profiles; list services explicitly instead |
| 2026-03-05 | self | Changed docker-compose postgres creds but old volume had stale role | Must `docker compose down -v` to wipe pgdata volume when changing PG creds |
| 2026-03-05 | self | `pg_isready -U relay` checks database `relay` by default (matches username) | Always specify `-d dbname` when PG user and database names differ |

## User Preferences
- (accumulate here as you learn them)

## Patterns That Work
- (approaches that succeeded)

## Patterns That Don't Work
- (approaches that failed and why)

## Domain Notes
- Runtime: Bun (not Node.js)
- ORM: Drizzle + postgres driver
- Framework: Hono
- Entry point: src/index.ts (NOT src/app.ts)
- Deploy target: Railway

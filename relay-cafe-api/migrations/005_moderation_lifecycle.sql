-- 005_moderation_lifecycle.sql
-- 1. Replace boolean suspended with suspension_until
-- 2. Add moderation state to deleted_accounts
-- 3. Reports FK: CASCADE → SET NULL
-- NOTE: 30 days in the UPDATE below must match SUSPENSION_DURATION_DAYS in moderationConfig.ts

-- 1. Replace boolean suspended with suspension_until
ALTER TABLE users ADD COLUMN suspension_until TIMESTAMPTZ;
UPDATE users SET suspension_until = NOW() + INTERVAL '30 days' WHERE suspended = TRUE;
ALTER TABLE users DROP COLUMN IF EXISTS suspended;

-- 2. Add moderation state to deleted_accounts
ALTER TABLE deleted_accounts ADD COLUMN strike_count INT NOT NULL DEFAULT 0;
ALTER TABLE deleted_accounts ADD COLUMN suspension_until TIMESTAMPTZ;

-- 3. Reports FK: CASCADE → SET NULL (columns must become nullable first)
ALTER TABLE reports ALTER COLUMN reporter_user_id DROP NOT NULL;
ALTER TABLE reports ALTER COLUMN sender_user_id DROP NOT NULL;

-- Drop both possible naming conventions (Drizzle vs PostgreSQL default)
ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_reporter_user_id_users_id_fk;
ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_reporter_user_id_fkey;
ALTER TABLE reports ADD CONSTRAINT reports_reporter_user_id_users_id_fk
  FOREIGN KEY (reporter_user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_sender_user_id_users_id_fk;
ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_sender_user_id_fkey;
ALTER TABLE reports ADD CONSTRAINT reports_sender_user_id_users_id_fk
  FOREIGN KEY (sender_user_id) REFERENCES users(id) ON DELETE SET NULL;

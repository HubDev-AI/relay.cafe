-- 004_fix_blocks_and_cascades.sql
-- 1. Change blocked_senders to use apple_id_hash (persists across account deletion)
-- 2. Add ON DELETE CASCADE to all user FK references

-- 1. Rebuild blocked_senders with apple_id_hash instead of user_id
ALTER TABLE blocked_senders DROP CONSTRAINT blocked_senders_pkey;
ALTER TABLE blocked_senders DROP CONSTRAINT blocked_senders_blocked_sender_user_id_users_id_fk;
DROP INDEX IF EXISTS idx_blocked_sender;
ALTER TABLE blocked_senders DROP COLUMN blocked_sender_user_id;
ALTER TABLE blocked_senders ADD COLUMN blocked_apple_id_hash TEXT NOT NULL;
ALTER TABLE blocked_senders ADD PRIMARY KEY (blocker_user_id, blocked_apple_id_hash);
CREATE INDEX idx_blocked_apple_id_hash ON blocked_senders(blocked_apple_id_hash);

-- 2. Add ON DELETE CASCADE to messages.sender_user_id
ALTER TABLE messages DROP CONSTRAINT messages_sender_user_id_users_id_fk;
ALTER TABLE messages ADD CONSTRAINT messages_sender_user_id_users_id_fk
  FOREIGN KEY (sender_user_id) REFERENCES users(id) ON DELETE CASCADE;

-- 3. Add ON DELETE CASCADE to delivery_log FKs
ALTER TABLE delivery_log DROP CONSTRAINT delivery_log_sender_user_id_users_id_fk;
ALTER TABLE delivery_log ADD CONSTRAINT delivery_log_sender_user_id_users_id_fk
  FOREIGN KEY (sender_user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE delivery_log DROP CONSTRAINT delivery_log_recipient_user_id_users_id_fk;
ALTER TABLE delivery_log ADD CONSTRAINT delivery_log_recipient_user_id_users_id_fk
  FOREIGN KEY (recipient_user_id) REFERENCES users(id) ON DELETE CASCADE;

-- 4. Add ON DELETE CASCADE to reports FKs
ALTER TABLE reports DROP CONSTRAINT reports_reporter_user_id_users_id_fk;
ALTER TABLE reports ADD CONSTRAINT reports_reporter_user_id_users_id_fk
  FOREIGN KEY (reporter_user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE reports DROP CONSTRAINT reports_sender_user_id_users_id_fk;
ALTER TABLE reports ADD CONSTRAINT reports_sender_user_id_users_id_fk
  FOREIGN KEY (sender_user_id) REFERENCES users(id) ON DELETE CASCADE;

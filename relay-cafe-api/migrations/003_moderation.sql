-- 003_moderation.sql
-- Pre-requisite: DELETE FROM messages (run manually before migration)

-- 1. Add sender_user_id to messages
ALTER TABLE messages ADD COLUMN sender_user_id UUID NOT NULL REFERENCES users(id);
CREATE INDEX idx_messages_sender ON messages(sender_user_id);

-- 2. Add moderation columns to users
ALTER TABLE users ADD COLUMN suspended BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN strike_count INT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN last_strike_at TIMESTAMPTZ;

-- 3. delivery_log
CREATE TABLE delivery_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL UNIQUE,
  sender_user_id UUID NOT NULL REFERENCES users(id),
  recipient_user_id UUID NOT NULL REFERENCES users(id),
  delivered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_delivery_recipient ON delivery_log(recipient_user_id);

-- 4. reports
CREATE TABLE reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL,
  reporter_user_id UUID NOT NULL REFERENCES users(id),
  sender_user_id UUID NOT NULL REFERENCES users(id),
  action_taken TEXT NOT NULL,
  strike_count_after INT NOT NULL,
  reviewed BOOLEAN NOT NULL DEFAULT FALSE,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(message_id, reporter_user_id)
);
CREATE INDEX idx_reports_sender ON reports(sender_user_id);

-- 5. blocked_senders
CREATE TABLE blocked_senders (
  blocker_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_sender_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (blocker_user_id, blocked_sender_user_id)
);
CREATE INDEX idx_blocked_sender ON blocked_senders(blocked_sender_user_id);

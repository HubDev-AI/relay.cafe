-- Index for efficient expired message cleanup (runs in all environments)
CREATE INDEX IF NOT EXISTS idx_messages_expires_at ON messages (expires_at);

-- Run this once in Railway's PostgreSQL console after first deploy.
-- pg_cron is pre-installed on Railway managed PostgreSQL.
--
-- Enable the extension:
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule cleanup: delete expired messages every 10 minutes.
-- Direct SQL DELETE — no app memory, no decryption, no logging.
SELECT cron.schedule(
  'cleanup-expired-messages',
  '*/10 * * * *',
  'DELETE FROM messages WHERE expires_at <= NOW()'
);

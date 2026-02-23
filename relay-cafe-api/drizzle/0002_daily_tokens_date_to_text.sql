-- Change daily_tokens.date from DATE to TEXT to support arbitrary period keys
-- (e.g. YYYY-MM-DD for production, numeric period IDs for testing).
ALTER TABLE daily_tokens ALTER COLUMN date TYPE text;

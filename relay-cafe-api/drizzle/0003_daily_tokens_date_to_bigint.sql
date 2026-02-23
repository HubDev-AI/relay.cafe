-- Migrate daily_tokens.date from TEXT to BIGINT (epoch day number).
-- Existing rows with 'YYYY-MM-DD' format get converted to epoch day.
-- Existing rows with numeric strings stay as-is.

-- Step 1: Add temp column
ALTER TABLE daily_tokens ADD COLUMN date_new bigint;

-- Step 2: Convert existing data
UPDATE daily_tokens SET date_new = CASE
  WHEN date ~ '^\d{4}-\d{2}-\d{2}$' THEN EXTRACT(EPOCH FROM date::date)::bigint / 86400
  ELSE date::bigint
END;

-- Step 3: Drop old, rename new
ALTER TABLE daily_tokens DROP CONSTRAINT daily_tokens_pkey;
ALTER TABLE daily_tokens DROP COLUMN date;
ALTER TABLE daily_tokens RENAME COLUMN date_new TO date;
ALTER TABLE daily_tokens ALTER COLUMN date SET NOT NULL;
ALTER TABLE daily_tokens ADD PRIMARY KEY (user_id, date);

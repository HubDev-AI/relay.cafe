CREATE TABLE deleted_accounts (
  apple_id_hash TEXT PRIMARY KEY,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cooldown_until TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_deleted_accounts_cooldown ON deleted_accounts (cooldown_until);

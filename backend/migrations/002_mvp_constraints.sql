ALTER TABLE imports
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

UPDATE imports
SET expires_at = created_at + interval '30 minutes'
WHERE expires_at IS NULL;

ALTER TABLE imports
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '30 minutes');
ALTER TABLE imports
  ALTER COLUMN expires_at SET NOT NULL;

ALTER TABLE pair_members
  ADD COLUMN IF NOT EXISTS left_at TIMESTAMPTZ;

ALTER TABLE pair_members DROP CONSTRAINT IF EXISTS pair_members_user_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS pair_members_active_user_idx
  ON pair_members (user_id)
  WHERE left_at IS NULL;

CREATE INDEX IF NOT EXISTS imports_expiry_idx ON imports (expires_at) WHERE status = 'preview';
CREATE INDEX IF NOT EXISTS telegram_init_data_uses_expiry_idx ON telegram_init_data_uses (expires_at);
CREATE INDEX IF NOT EXISTS pair_members_active_pair_idx ON pair_members (pair_id) WHERE left_at IS NULL;

ALTER TABLE daily_logs
  ADD CONSTRAINT daily_logs_sleep_hours_check CHECK (sleep_hours IS NULL OR (sleep_hours >= 0 AND sleep_hours <= 24));

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION nova_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id BIGINT NOT NULL UNIQUE,
  username TEXT,
  display_name TEXT,
  notifications_consented_at TIMESTAMPTZ,
  notification_prefs JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE pairs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'dissolved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE pair_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_id UUID NOT NULL REFERENCES pairs (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'partner')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (pair_id, user_id),
  UNIQUE (pair_id, role),
  UNIQUE (user_id)
);

CREATE TABLE pair_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_id UUID NOT NULL REFERENCES pairs (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_by UUID REFERENCES users (id) ON DELETE SET NULL,
  used_at TIMESTAMPTZ,
  used_by UUID REFERENCES users (id) ON DELETE SET NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sharing_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_id UUID NOT NULL REFERENCES pairs (id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN (
    'cycle',
    'symptoms',
    'mood',
    'sleep',
    'energy',
    'wellbeing',
    'sexual_activity',
    'notes'
  )),
  granted BOOLEAN NOT NULL DEFAULT FALSE,
  changed_by UUID REFERENCES users (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (pair_id, category)
);

CREATE TABLE cycle_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE,
  source TEXT NOT NULL DEFAULT 'manual',
  source_author TEXT,
  source_record_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (period_end IS NULL OR period_end >= period_start),
  UNIQUE (owner_user_id, period_start)
);

CREATE UNIQUE INDEX cycle_entries_source_key
  ON cycle_entries (owner_user_id, source_record_key)
  WHERE source_record_key IS NOT NULL;

CREATE TABLE daily_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  log_date DATE NOT NULL,
  symptoms JSONB NOT NULL DEFAULT '[]'::jsonb,
  mood TEXT,
  sleep_hours NUMERIC(4, 1),
  sleep_quality TEXT,
  energy TEXT,
  wellbeing TEXT,
  sexual_activity TEXT,
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  source_author TEXT,
  source_record_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, log_date)
);

CREATE UNIQUE INDEX daily_logs_source_key
  ON daily_logs (owner_user_id, source_record_key)
  WHERE source_record_key IS NOT NULL;

CREATE TABLE partner_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_id UUID NOT NULL REFERENCES pairs (id) ON DELETE CASCADE,
  author_user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  observed_on DATE NOT NULL,
  mood TEXT,
  fatigue TEXT,
  sleepiness TEXT,
  appetite TEXT,
  behavior_changes TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES users (id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  object_type TEXT,
  object_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('preview', 'confirmed', 'expired')),
  added_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  unknown_fields_report JSONB NOT NULL DEFAULT '[]'::jsonb,
  not_imported_report JSONB NOT NULL DEFAULT '[]'::jsonb,
  preview JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE telegram_init_data_uses (
  data_hash TEXT PRIMARY KEY,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX audit_events_created_idx ON audit_events (created_at DESC);
CREATE INDEX daily_logs_owner_date_idx ON daily_logs (owner_user_id, log_date);
CREATE INDEX cycle_entries_owner_start_idx ON cycle_entries (owner_user_id, period_start);
CREATE INDEX partner_observations_author_idx ON partner_observations (author_user_id, observed_on DESC);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION nova_set_updated_at();
CREATE TRIGGER pairs_set_updated_at
  BEFORE UPDATE ON pairs
  FOR EACH ROW EXECUTE FUNCTION nova_set_updated_at();
CREATE TRIGGER pair_members_set_updated_at
  BEFORE UPDATE ON pair_members
  FOR EACH ROW EXECUTE FUNCTION nova_set_updated_at();
CREATE TRIGGER pair_invites_set_updated_at
  BEFORE UPDATE ON pair_invites
  FOR EACH ROW EXECUTE FUNCTION nova_set_updated_at();
CREATE TRIGGER sharing_permissions_set_updated_at
  BEFORE UPDATE ON sharing_permissions
  FOR EACH ROW EXECUTE FUNCTION nova_set_updated_at();
CREATE TRIGGER cycle_entries_set_updated_at
  BEFORE UPDATE ON cycle_entries
  FOR EACH ROW EXECUTE FUNCTION nova_set_updated_at();
CREATE TRIGGER daily_logs_set_updated_at
  BEFORE UPDATE ON daily_logs
  FOR EACH ROW EXECUTE FUNCTION nova_set_updated_at();
CREATE TRIGGER partner_observations_set_updated_at
  BEFORE UPDATE ON partner_observations
  FOR EACH ROW EXECUTE FUNCTION nova_set_updated_at();
CREATE TRIGGER imports_set_updated_at
  BEFORE UPDATE ON imports
  FOR EACH ROW EXECUTE FUNCTION nova_set_updated_at();

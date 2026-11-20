CREATE TABLE IF NOT EXISTS tip_deliveries (
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  sent_on DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, sent_on)
);

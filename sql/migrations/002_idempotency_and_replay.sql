-- Replay-nonce store for HMAC signed request idempotency (Layer 1).
-- Prevents replay of signed requests within the TTL window.

CREATE TABLE IF NOT EXISTS replay_nonces (
  nonce        TEXT        PRIMARY KEY,
  consumed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_replay_nonces_consumed_at
  ON replay_nonces (consumed_at);

-- Prune query (run periodically):
-- DELETE FROM replay_nonces WHERE consumed_at < NOW() - INTERVAL '120 seconds';

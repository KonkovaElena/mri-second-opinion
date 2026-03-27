-- 003_transition_journal.sql
-- Append-only transition journal for durable provenance of every state change.

CREATE TABLE IF NOT EXISTS transition_journal (
  journal_id        UUID PRIMARY KEY,
  case_id           TEXT NOT NULL REFERENCES case_records(case_id) ON DELETE CASCADE,
  sequence          INTEGER NOT NULL,
  transition_type   TEXT NOT NULL,
  from_status       TEXT,
  to_status         TEXT NOT NULL,
  actor             TEXT NOT NULL CHECK (actor IN ('system', 'clinician', 'integration')),
  source            TEXT NOT NULL,
  detail            TEXT NOT NULL DEFAULT '',
  timestamp         TIMESTAMPTZ NOT NULL DEFAULT now(),
  state_snapshot    JSONB,
  UNIQUE (case_id, sequence)
);

CREATE INDEX idx_transition_journal_case_id ON transition_journal (case_id);
CREATE INDEX idx_transition_journal_timestamp ON transition_journal (timestamp);
CREATE INDEX idx_transition_journal_type ON transition_journal (transition_type);

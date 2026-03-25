CREATE TABLE IF NOT EXISTS case_records (
  case_id TEXT PRIMARY KEY,
  study_uid TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_case_records_status ON case_records (status);
CREATE INDEX IF NOT EXISTS idx_case_records_updated_at ON case_records (updated_at DESC);
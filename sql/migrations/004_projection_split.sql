CREATE TABLE IF NOT EXISTS case_summary_projection (
  case_id TEXT PRIMARY KEY REFERENCES case_records(case_id) ON DELETE CASCADE,
  study_uid TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_case_summary_projection_status
  ON case_summary_projection(status);

CREATE INDEX IF NOT EXISTS idx_case_summary_projection_updated_at
  ON case_summary_projection(updated_at DESC);

CREATE TABLE IF NOT EXISTS workflow_job_projection (
  case_id TEXT PRIMARY KEY REFERENCES case_records(case_id) ON DELETE CASCADE,
  updated_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workflow_job_projection_updated_at
  ON workflow_job_projection(updated_at DESC);

CREATE TABLE IF NOT EXISTS artifact_reference_projection (
  case_id TEXT PRIMARY KEY REFERENCES case_records(case_id) ON DELETE CASCADE,
  updated_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_artifact_reference_projection_updated_at
  ON artifact_reference_projection(updated_at DESC);

INSERT INTO case_summary_projection (case_id, study_uid, status, updated_at, payload)
SELECT
  case_id,
  study_uid,
  status,
  updated_at,
  jsonb_build_object(
    'caseId', payload ->> 'caseId',
    'patientAlias', payload ->> 'patientAlias',
    'studyUid', payload ->> 'studyUid',
    'workflowFamily', payload ->> 'workflowFamily',
    'status', payload ->> 'status',
    'createdAt', payload ->> 'createdAt',
    'updatedAt', payload ->> 'updatedAt',
    'indication', payload -> 'indication',
    'sequenceInventory', COALESCE(payload -> 'sequenceInventory', '[]'::jsonb),
    'operationLog', COALESCE(payload -> 'operationLog', '[]'::jsonb),
    'review', COALESCE(
      payload -> 'review',
      jsonb_build_object('reviewerId', '', 'reviewerRole', NULL, 'comments', NULL, 'reviewedAt', NULL)
    ),
    'finalizedBy', payload -> 'finalizedBy',
    'report', CASE
      WHEN payload -> 'report' IS NULL THEN NULL
      ELSE jsonb_build_object(
        'reviewStatus', payload -> 'report' ->> 'reviewStatus',
        'versionPins', COALESCE(payload -> 'report' -> 'versionPins', '{}'::jsonb),
        'qcDisposition', payload -> 'report' ->> 'qcDisposition',
        'generatedAt', payload -> 'report' -> 'provenance' ->> 'generatedAt',
        'workflowVersion', payload -> 'report' -> 'provenance' ->> 'workflowVersion'
      )
    END
  )
FROM case_records
ON CONFLICT (case_id) DO UPDATE SET
  study_uid = EXCLUDED.study_uid,
  status = EXCLUDED.status,
  updated_at = EXCLUDED.updated_at,
  payload = EXCLUDED.payload;

INSERT INTO workflow_job_projection (case_id, updated_at, payload)
SELECT
  case_id,
  updated_at,
  jsonb_build_object(
    'caseId', payload ->> 'caseId',
    'updatedAt', payload ->> 'updatedAt',
    'jobs', COALESCE(payload -> 'workflowQueue', '[]'::jsonb)
  )
FROM case_records
ON CONFLICT (case_id) DO UPDATE SET
  updated_at = EXCLUDED.updated_at,
  payload = EXCLUDED.payload;

INSERT INTO artifact_reference_projection (case_id, updated_at, payload)
SELECT
  case_id,
  updated_at,
  jsonb_build_object(
    'caseId', payload ->> 'caseId',
    'updatedAt', payload ->> 'updatedAt',
    'reportArtifactRefs', COALESCE(payload -> 'report' -> 'artifacts', '[]'::jsonb),
    'qcArtifactRefs', COALESCE(payload -> 'workerArtifacts' -> 'qcSummary' -> 'artifactRefs', '[]'::jsonb),
    'artifactManifest', COALESCE(payload -> 'workerArtifacts' -> 'artifactManifest', '[]'::jsonb),
    'structuralRun', payload -> 'workerArtifacts' -> 'structuralRun',
    'reportGeneratedAt', payload -> 'report' -> 'provenance' ->> 'generatedAt',
    'workflowVersion', payload -> 'report' -> 'provenance' ->> 'workflowVersion'
  )
FROM case_records
ON CONFLICT (case_id) DO UPDATE SET
  updated_at = EXCLUDED.updated_at,
  payload = EXCLUDED.payload;
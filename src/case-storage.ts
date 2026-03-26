import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { CaseRecord, PersistedCaseSnapshot } from "./cases";
import {
  buildPersistedCaseProjections,
  normalizeArtifactReferenceProjection,
  normalizeCaseSummaryProjection,
  normalizeWorkflowJobProjection,
  type ArtifactReferenceProjection,
  type CaseSummaryProjection,
  type WorkflowJobProjection,
} from "./case-projections";

interface LoadedCaseSnapshot {
  revision: number;
  cases: CaseRecord[];
  caseSummaries: CaseSummaryProjection[];
  workflowJobs: WorkflowJobProjection[];
  artifactReferences: ArtifactReferenceProjection[];
}

function cloneCase<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function loadPersistedCaseSnapshot(snapshotFilePath?: string) {
  if (!snapshotFilePath || !existsSync(snapshotFilePath)) {
    return {
      revision: 0,
      cases: [] as CaseRecord[],
      caseSummaries: [] as CaseSummaryProjection[],
      workflowJobs: [] as WorkflowJobProjection[],
      artifactReferences: [] as ArtifactReferenceProjection[],
    };
  }

  const raw = readFileSync(snapshotFilePath, "utf8");
  if (raw.trim().length === 0) {
    return {
      revision: 0,
      cases: [] as CaseRecord[],
      caseSummaries: [] as CaseSummaryProjection[],
      workflowJobs: [] as WorkflowJobProjection[],
      artifactReferences: [] as ArtifactReferenceProjection[],
    };
  }

  const parsed = JSON.parse(raw) as PersistedCaseSnapshot;
  if (
    (parsed.version !== "0.1.0" && parsed.version !== "0.2.0")
    || typeof parsed.revision !== "number"
    || !Array.isArray(parsed.cases)
  ) {
    throw new Error(`Invalid case snapshot format in ${snapshotFilePath}`);
  }

  const cases = parsed.cases.map((caseRecord) => ({
    ...caseRecord,
    lastInferenceFingerprint: caseRecord.lastInferenceFingerprint ?? null,
    workflowQueue: Array.isArray(caseRecord.workflowQueue)
      ? caseRecord.workflowQueue.map((entry) => ({
          ...entry,
          resolvedAt: entry.resolvedAt ?? null,
        }))
      : [],
    workerArtifacts: caseRecord.workerArtifacts ?? undefined,
  }));
  const derivedProjections = buildPersistedCaseProjections(cases);

  return {
    revision: parsed.revision,
    cases,
    caseSummaries: Array.isArray(parsed.caseSummaries)
      ? parsed.caseSummaries.map(normalizeCaseSummaryProjection)
      : derivedProjections.caseSummaries,
    workflowJobs: Array.isArray(parsed.workflowJobs)
      ? parsed.workflowJobs.map(normalizeWorkflowJobProjection)
      : derivedProjections.workflowJobs,
    artifactReferences: Array.isArray(parsed.artifactReferences)
      ? parsed.artifactReferences.map(normalizeArtifactReferenceProjection)
      : derivedProjections.artifactReferences,
  };
}

export function savePersistedCaseSnapshot(
  snapshotFilePath: string | undefined,
  currentRevision: number,
  snapshotPayload: {
    cases: Iterable<CaseRecord>;
    caseSummaries: Iterable<CaseSummaryProjection>;
    workflowJobs: Iterable<WorkflowJobProjection>;
    artifactReferences: Iterable<ArtifactReferenceProjection>;
  },
) {
  if (!snapshotFilePath) {
    return currentRevision;
  }

  const directory = dirname(snapshotFilePath);
  const lockFile = `${snapshotFilePath}.lock`;
  let lockHandle: number | null = null;

  mkdirSync(directory, { recursive: true });

  try {
    lockHandle = openSync(lockFile, "wx");
  } catch {
    throw new Error(`Case store is busy for ${snapshotFilePath}`);
  }

  try {
    if (existsSync(snapshotFilePath)) {
      const currentRaw = readFileSync(snapshotFilePath, "utf8");
      if (currentRaw.trim().length > 0) {
        const currentSnapshot = JSON.parse(currentRaw) as PersistedCaseSnapshot;
        if (currentSnapshot.revision !== currentRevision) {
          throw new Error(`Concurrent case store modification detected for ${snapshotFilePath}`);
        }
      } else if (currentRevision !== 0) {
        throw new Error(`Concurrent case store modification detected for ${snapshotFilePath}`);
      }
    } else if (currentRevision !== 0) {
      throw new Error(`Concurrent case store modification detected for ${snapshotFilePath}`);
    }

    const snapshot: PersistedCaseSnapshot = {
      version: "0.2.0",
      revision: currentRevision + 1,
      cases: Array.from(snapshotPayload.cases, (caseRecord) => cloneCase(caseRecord)),
      caseSummaries: Array.from(snapshotPayload.caseSummaries, (projection) => cloneCase(projection)),
      workflowJobs: Array.from(snapshotPayload.workflowJobs, (projection) => cloneCase(projection)),
      artifactReferences: Array.from(snapshotPayload.artifactReferences, (projection) => cloneCase(projection)),
    };
    const tmpFile = `${snapshotFilePath}.${process.pid}.${randomUUID()}.tmp`;

    writeFileSync(tmpFile, JSON.stringify(snapshot, null, 2), "utf8");
    renameSync(tmpFile, snapshotFilePath);
    return snapshot.revision;
  } finally {
    if (lockHandle !== null) {
      closeSync(lockHandle);
    }
    unlinkSync(lockFile);
  }
}
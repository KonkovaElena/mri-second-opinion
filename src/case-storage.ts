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
import type { CaseRecord, DeliveryJobRecord, InferenceJobRecord, PersistedCaseSnapshot } from "./case-contracts";
import { cloneCase } from "./case-common";
import { normalizeStoredCaseRecord } from "./case-sqlite-storage";

export function loadPersistedCaseSnapshot(snapshotFilePath?: string) {
  if (!snapshotFilePath || !existsSync(snapshotFilePath)) {
    return {
      revision: 0,
      cases: [] as CaseRecord[],
      deliveryJobs: [] as DeliveryJobRecord[],
      inferenceJobs: [] as InferenceJobRecord[],
    };
  }

  const raw = readFileSync(snapshotFilePath, "utf8");
  if (raw.trim().length === 0) {
    return {
      revision: 0,
      cases: [] as CaseRecord[],
      deliveryJobs: [] as DeliveryJobRecord[],
      inferenceJobs: [] as InferenceJobRecord[],
    };
  }

  const parsed = JSON.parse(raw) as PersistedCaseSnapshot;
  if (parsed.version !== "0.1.0" || typeof parsed.revision !== "number" || !Array.isArray(parsed.cases)) {
    throw new Error(`Invalid case snapshot format in ${snapshotFilePath}`);
  }

  return {
    revision: parsed.revision,
    cases: parsed.cases.map((caseRecord) => normalizeStoredCaseRecord(caseRecord)),
    deliveryJobs: Array.isArray(parsed.deliveryJobs)
      ? parsed.deliveryJobs.map((deliveryJob) => ({
          ...deliveryJob,
          attemptCount: deliveryJob.attemptCount ?? 0,
          workerId: deliveryJob.workerId ?? null,
          claimedAt: deliveryJob.claimedAt ?? null,
          completedAt: deliveryJob.completedAt ?? null,
          lastError: deliveryJob.lastError ?? null,
        }))
      : ([] as DeliveryJobRecord[]),
    inferenceJobs: Array.isArray(parsed.inferenceJobs)
      ? parsed.inferenceJobs.map((inferenceJob) => ({
          ...inferenceJob,
          attemptCount: inferenceJob.attemptCount ?? 0,
          workerId: inferenceJob.workerId ?? null,
          claimedAt: inferenceJob.claimedAt ?? null,
          completedAt: inferenceJob.completedAt ?? null,
          lastError: inferenceJob.lastError ?? null,
          leaseId: inferenceJob.leaseId ?? null,
          leaseExpiresAt: inferenceJob.leaseExpiresAt ?? null,
        }))
      : ([] as InferenceJobRecord[]),
  };
}

export function savePersistedCaseSnapshot(
  snapshotFilePath: string | undefined,
  currentRevision: number,
  cases: Iterable<CaseRecord>,
  deliveryJobs: Iterable<DeliveryJobRecord>,
  inferenceJobs: Iterable<InferenceJobRecord>,
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
      version: "0.1.0",
      revision: currentRevision + 1,
      cases: Array.from(cases, (caseRecord) => cloneCase(caseRecord)),
      deliveryJobs: Array.from(deliveryJobs, (deliveryJob) => cloneCase(deliveryJob)),
      inferenceJobs: Array.from(inferenceJobs, (inferenceJob) => cloneCase(inferenceJob)),
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
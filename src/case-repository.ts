import type { CaseRecord, MemoryCaseServiceOptions } from "./cases";
import {
  buildArtifactReferenceProjection,
  buildCaseSummaryProjection,
  buildWorkflowJobProjection,
  type ArtifactReferenceProjection,
  type CaseSummaryProjection,
  type WorkflowJobProjection,
} from "./case-projections";
import {
  loadPersistedCaseSnapshot,
  savePersistedCaseSnapshot,
} from "./case-storage";

export interface CaseRepository {
  list(): Promise<CaseRecord[]>;
  listSummaries(): Promise<CaseSummaryProjection[]>;
  listWorkflowJobs(): Promise<WorkflowJobProjection[]>;
  listArtifactReferences(): Promise<ArtifactReferenceProjection[]>;
  get(caseId: string): Promise<CaseRecord | undefined>;
  upsert(
    caseRecord: CaseRecord,
    options?: {
      expectedUpdatedAt?: string | null;
    },
  ): Promise<void>;
  delete(caseId: string): Promise<void>;
  findByStudyUid(studyUid: string): Promise<CaseRecord | null>;
}

function cloneCase<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class SnapshotCaseRepository {
  private readonly cases = new Map<string, CaseRecord>();
  private readonly caseSummaries = new Map<string, CaseSummaryProjection>();
  private readonly workflowJobs = new Map<string, WorkflowJobProjection>();
  private readonly artifactReferences = new Map<string, ArtifactReferenceProjection>();
  private snapshotRevision = 0;

  constructor(private readonly options: MemoryCaseServiceOptions = {}) {
    const snapshot = loadPersistedCaseSnapshot(this.options.snapshotFilePath);
    this.snapshotRevision = snapshot.revision;

    for (const caseRecord of snapshot.cases) {
      this.cases.set(caseRecord.caseId, caseRecord);
    }
    for (const projection of snapshot.caseSummaries) {
      this.caseSummaries.set(projection.caseId, projection);
    }
    for (const projection of snapshot.workflowJobs) {
      this.workflowJobs.set(projection.caseId, projection);
    }
    for (const projection of snapshot.artifactReferences) {
      this.artifactReferences.set(projection.caseId, projection);
    }
  }

  async list() {
    return Array.from(this.cases.values())
      .map(cloneCase)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async listSummaries() {
    return Array.from(this.caseSummaries.values())
      .map(cloneCase)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async listWorkflowJobs() {
    return Array.from(this.workflowJobs.values())
      .map(cloneCase)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async listArtifactReferences() {
    return Array.from(this.artifactReferences.values())
      .map(cloneCase)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async get(caseId: string) {
    const caseRecord = this.cases.get(caseId);
    return caseRecord ? cloneCase(caseRecord) : undefined;
  }

  async upsert(
    caseRecord: CaseRecord,
    options?: {
      expectedUpdatedAt?: string | null;
    },
  ) {
    const previous = this.cases.get(caseRecord.caseId);

    if (
      typeof options?.expectedUpdatedAt !== "undefined" &&
      previous &&
      previous.updatedAt !== options.expectedUpdatedAt
    ) {
      throw new Error("Concurrent case store modification detected");
    }

    this.cases.set(caseRecord.caseId, cloneCase(caseRecord));
    this.caseSummaries.set(caseRecord.caseId, buildCaseSummaryProjection(caseRecord));
    this.workflowJobs.set(caseRecord.caseId, buildWorkflowJobProjection(caseRecord));
    this.artifactReferences.set(caseRecord.caseId, buildArtifactReferenceProjection(caseRecord));

    try {
      this.snapshotRevision = savePersistedCaseSnapshot(
        this.options.snapshotFilePath,
        this.snapshotRevision,
        {
          cases: this.cases.values(),
          caseSummaries: this.caseSummaries.values(),
          workflowJobs: this.workflowJobs.values(),
          artifactReferences: this.artifactReferences.values(),
        },
      );
    } catch (error) {
      if (previous) {
        this.cases.set(caseRecord.caseId, previous);
        this.caseSummaries.set(caseRecord.caseId, buildCaseSummaryProjection(previous));
        this.workflowJobs.set(caseRecord.caseId, buildWorkflowJobProjection(previous));
        this.artifactReferences.set(caseRecord.caseId, buildArtifactReferenceProjection(previous));
      } else {
        this.cases.delete(caseRecord.caseId);
        this.caseSummaries.delete(caseRecord.caseId);
        this.workflowJobs.delete(caseRecord.caseId);
        this.artifactReferences.delete(caseRecord.caseId);
      }
      throw error;
    }
  }

  async delete(caseId: string) {
    const previous = this.cases.get(caseId);
    if (!previous) {
      return;
    }

    this.cases.delete(caseId);
    this.caseSummaries.delete(caseId);
    this.workflowJobs.delete(caseId);
    this.artifactReferences.delete(caseId);

    try {
      this.snapshotRevision = savePersistedCaseSnapshot(
        this.options.snapshotFilePath,
        this.snapshotRevision,
        {
          cases: this.cases.values(),
          caseSummaries: this.caseSummaries.values(),
          workflowJobs: this.workflowJobs.values(),
          artifactReferences: this.artifactReferences.values(),
        },
      );
    } catch (error) {
      this.cases.set(caseId, previous);
      this.caseSummaries.set(caseId, buildCaseSummaryProjection(previous));
      this.workflowJobs.set(caseId, buildWorkflowJobProjection(previous));
      this.artifactReferences.set(caseId, buildArtifactReferenceProjection(previous));
      throw error;
    }
  }

  async findByStudyUid(studyUid: string) {
    const caseRecord = Array.from(this.cases.values()).find((entry) => entry.studyUid === studyUid) ?? null;
    return caseRecord ? cloneCase(caseRecord) : null;
  }
}
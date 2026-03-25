import type { CaseRecord, MemoryCaseServiceOptions } from "./cases";
import {
  loadPersistedCaseSnapshot,
  savePersistedCaseSnapshot,
} from "./case-storage";

export interface CaseRepository {
  list(): Promise<CaseRecord[]>;
  get(caseId: string): Promise<CaseRecord | undefined>;
  upsert(caseRecord: CaseRecord): Promise<void>;
  delete(caseId: string): Promise<void>;
  findByStudyUid(studyUid: string): Promise<CaseRecord | null>;
}

function cloneCase<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class SnapshotCaseRepository {
  private readonly cases = new Map<string, CaseRecord>();
  private snapshotRevision = 0;

  constructor(private readonly options: MemoryCaseServiceOptions = {}) {
    const snapshot = loadPersistedCaseSnapshot(this.options.snapshotFilePath);
    this.snapshotRevision = snapshot.revision;

    for (const caseRecord of snapshot.cases) {
      this.cases.set(caseRecord.caseId, caseRecord);
    }
  }

  async list() {
    return Array.from(this.cases.values())
      .map(cloneCase)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async get(caseId: string) {
    const caseRecord = this.cases.get(caseId);
    return caseRecord ? cloneCase(caseRecord) : undefined;
  }

  async upsert(caseRecord: CaseRecord) {
    const previous = this.cases.get(caseRecord.caseId);
    this.cases.set(caseRecord.caseId, cloneCase(caseRecord));

    try {
      this.snapshotRevision = savePersistedCaseSnapshot(
        this.options.snapshotFilePath,
        this.snapshotRevision,
        this.cases.values(),
      );
    } catch (error) {
      if (previous) {
        this.cases.set(caseRecord.caseId, previous);
      } else {
        this.cases.delete(caseRecord.caseId);
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

    try {
      this.snapshotRevision = savePersistedCaseSnapshot(
        this.options.snapshotFilePath,
        this.snapshotRevision,
        this.cases.values(),
      );
    } catch (error) {
      this.cases.set(caseId, previous);
      throw error;
    }
  }

  async findByStudyUid(studyUid: string) {
    const caseRecord = Array.from(this.cases.values()).find((entry) => entry.studyUid === studyUid) ?? null;
    return caseRecord ? cloneCase(caseRecord) : null;
  }
}
import type { CaseRecord, MemoryCaseServiceOptions } from "./cases";
import {
  loadPersistedCaseSnapshot,
  savePersistedCaseSnapshot,
} from "./case-storage";

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

  list() {
    return Array.from(this.cases.values())
      .map(cloneCase)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  get(caseId: string) {
    return this.cases.get(caseId);
  }

  getSnapshot(caseId: string) {
    const caseRecord = this.cases.get(caseId);
    return caseRecord ? cloneCase(caseRecord) : null;
  }

  set(caseRecord: CaseRecord) {
    this.cases.set(caseRecord.caseId, caseRecord);
  }

  delete(caseId: string) {
    this.cases.delete(caseId);
  }

  size() {
    return this.cases.size;
  }

  values() {
    return this.cases.values();
  }

  findByStudyUid(studyUid: string) {
    return Array.from(this.cases.values()).find((caseRecord) => caseRecord.studyUid === studyUid) ?? null;
  }

  save() {
    this.snapshotRevision = savePersistedCaseSnapshot(
      this.options.snapshotFilePath,
      this.snapshotRevision,
      this.cases.values(),
    );
  }
}
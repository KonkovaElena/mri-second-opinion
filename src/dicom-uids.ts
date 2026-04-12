import { createHash } from "node:crypto";

export const MAX_DICOM_UID_CHARACTERS = 64;

const DICOM_UID_PATTERN = /^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*))*$/u;

export function isValidDicomUid(value: string) {
  const trimmed = value.trim();

  return trimmed.length > 0
    && trimmed.length <= MAX_DICOM_UID_CHARACTERS
    && DICOM_UID_PATTERN.test(trimmed);
}

export function normalizeDicomUid(value: string | null | undefined) {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return isValidDicomUid(trimmed) ? trimmed : undefined;
}

export function createDeterministicDicomUid(seed: string) {
  const digest = createHash("sha256").update(seed, "utf-8").digest();
  const bytes = Buffer.from(digest.subarray(0, 16));

  // Stamp the digest as a UUID-like 128-bit value before converting it to the
  // 2.25 OID form. This keeps the generated identifier bounded and numeric.
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const decimalValue = BigInt(`0x${bytes.toString("hex")}`);
  return `2.25.${decimalValue.toString(10)}`;
}

export function resolveStudyInstanceUid(studyUid: string, explicitStudyInstanceUid?: string) {
  return normalizeDicomUid(explicitStudyInstanceUid)
    ?? normalizeDicomUid(studyUid)
    ?? createDeterministicDicomUid(`study:${studyUid}`);
}

export function resolveSeriesInstanceUid(
  studyInstanceUid: string,
  index: number,
  explicitSeriesInstanceUid?: string,
  hints: Array<string | undefined> = [],
) {
  return normalizeDicomUid(explicitSeriesInstanceUid)
    ?? createDeterministicDicomUid(
      [
        "series",
        studyInstanceUid,
        String(index + 1),
        ...hints.map((value) => value?.trim() ?? ""),
      ].join("|"),
    );
}
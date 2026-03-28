import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalizeArtifactReference,
  createPlannedArtifactPersistenceTargets,
  type ArtifactStorageOverride,
} from "./case-artifacts";

export interface ArtifactPayloadInput {
  artifactRef: string;
  contentType: string;
  contentBase64: string;
}

const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

function decodeBase64Payload(contentBase64: string) {
  const trimmed = contentBase64.trim();

  if (!BASE64_PATTERN.test(trimmed)) {
    throw new Error("Artifact payload content must be base64 encoded");
  }

  return Buffer.from(trimmed, "base64");
}

export function getDefaultArtifactStoreRoot(caseStoreFilePath?: string) {
  if (caseStoreFilePath && caseStoreFilePath.trim().length > 0) {
    return resolve(dirname(caseStoreFilePath), "artifacts");
  }

  return resolve(__dirname, "..", ".mri-data", "artifacts");
}

export function persistArtifactPayloads(input: {
  artifactStoreRoot: string;
  caseId: string;
  artifactPayloads: ArtifactPayloadInput[];
}): ArtifactStorageOverride[] {
  return input.artifactPayloads.map((artifactPayload) => {
    const [target] = createPlannedArtifactPersistenceTargets({
      caseId: input.caseId,
      artifactTypes: [artifactPayload.artifactRef],
    });
    const bytes = decodeBase64Payload(artifactPayload.contentBase64);
    const filePath = resolve(input.artifactStoreRoot, ...target.plannedStorageKey.split("/"));

    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, bytes);

    return {
      artifactRef: artifactPayload.artifactRef,
      storageUri: canonicalizeArtifactReference(filePath),
      mimeType: artifactPayload.contentType.trim() || target.mimeType,
    };
  });
}

export function readPersistedArtifact(storageUri: string) {
  if (!storageUri.startsWith("file://")) {
    return null;
  }

  try {
    const filePath = fileURLToPath(storageUri);
    return {
      filePath,
      content: readFileSync(filePath),
    };
  } catch {
    return null;
  }
}
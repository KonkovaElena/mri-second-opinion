import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ArtifactReference, StructuralArtifactType } from "./cases";

export interface ArtifactStoreConfig {
  provider: "local-file" | "s3-compatible";
  basePath: string;
  endpoint: string | null;
  bucket: string | null;
}

export function createDefaultArtifactStoreConfig(): ArtifactStoreConfig {
  return {
    provider: "local-file",
    basePath: resolve(__dirname, "..", ".mri-data", "artifacts"),
    endpoint: null,
    bucket: null,
  };
}

function normalizeObjectKey(storageRef: string) {
  return storageRef
    .trim()
    .replace(/^[a-z]+:\/\//i, "")
    .replace(/[^a-z0-9._/-]+/gi, "-")
    .replace(/\/+/g, "/")
    .replace(/^[-/]+/, "")
    || "artifact";
}

function inferMediaType(artifactType: StructuralArtifactType) {
  switch (artifactType) {
    case "qc-summary":
      return "application/json";
    case "metrics-json":
      return "application/json";
    case "overlay-preview":
      return "image/png";
    case "report-preview":
      return "application/pdf";
    default:
      return "application/octet-stream";
  }
}

function buildArtifactUri(storageRef: string, artifactStore: ArtifactStoreConfig) {
  const objectKey = normalizeObjectKey(storageRef);

  if (artifactStore.provider === "s3-compatible") {
    const bucket = artifactStore.bucket ?? "mri-second-opinion-artifacts";
    if (artifactStore.endpoint) {
      return `${artifactStore.endpoint.replace(/\/+$/, "")}/${bucket}/${objectKey}`;
    }

    return `s3://${bucket}/${objectKey}`;
  }

  return pathToFileURL(resolve(artifactStore.basePath, objectKey)).toString();
}

export function createArtifactReference(input: {
  artifactId: string;
  artifactType: StructuralArtifactType;
  storageRef: string;
  producer: string;
  attemptId: string;
  artifactStore: ArtifactStoreConfig;
}): ArtifactReference {
  const uri = buildArtifactUri(input.storageRef, input.artifactStore);
  const checksum = createHash("sha256")
    .update(`${input.artifactId}|${input.storageRef}|${input.producer}|${input.attemptId}|${uri}`)
    .digest("hex");

  return {
    artifactId: input.artifactId,
    uri,
    checksum: `sha256:${checksum}`,
    mediaType: inferMediaType(input.artifactType),
    sizeBytes: null,
    producer: input.producer,
    attemptId: input.attemptId,
  };
}
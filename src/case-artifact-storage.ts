import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, posix, relative, resolve } from "node:path";
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

export type ArtifactStoreProvider = "local-file" | "s3-compatible";

export type ArtifactDownloadResult =
  | {
      kind: "buffer";
      content: Buffer;
    }
  | {
      kind: "redirect";
      url: string;
    };

export interface ArtifactStore {
  persistArtifactPayloads(input: {
    caseId: string;
    artifactPayloads: ArtifactPayloadInput[];
  }): Promise<ArtifactStorageOverride[]>;
  resolveArtifactDownload(storageUri: string): Promise<ArtifactDownloadResult | null>;
}

export interface CreateArtifactStoreOptions {
  provider?: ArtifactStoreProvider;
  caseStoreFilePath?: string;
  basePath?: string;
  bucket?: string;
  endpoint?: string;
  region?: string;
  forcePathStyle?: boolean;
  presignTtlSeconds?: number;
  s3Client?: S3Client;
  signGetObjectUrl?: (input: { bucket: string; key: string }) => Promise<string>;
}

const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const OBJECT_STORE_URI_PREFIX = "object-store://case-artifacts/";
const DEFAULT_ARTIFACT_STORE_REGION = "us-east-1";
const DEFAULT_ARTIFACT_PRESIGN_TTL_SECONDS = 900;

function decodeBase64Payload(contentBase64: string) {
  const trimmed = contentBase64.trim();

  if (!BASE64_PATTERN.test(trimmed)) {
    throw new Error("Artifact payload content must be base64 encoded");
  }

  return Buffer.from(trimmed, "base64");
}

function normalizeObjectStoreKey(basePath: string, plannedStorageKey: string) {
  const normalizedBasePath = basePath
    .replace(/\\/gu, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  return posix.join(...normalizedBasePath, plannedStorageKey);
}

function normalizeObjectStoreBasePath(basePath: string) {
  return basePath
    .replace(/\\/gu, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .join("/");
}

function isWithinResolvedRoot(rootPath: string, candidatePath: string) {
  const resolvedRoot = resolve(rootPath);
  const resolvedCandidate = resolve(candidatePath);
  const relativePath = relative(resolvedRoot, resolvedCandidate);

  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function toObjectStoreUri(key: string) {
  return canonicalizeArtifactReference(`${OBJECT_STORE_URI_PREFIX}${key}`);
}

function parseObjectStoreUri(storageUri: string) {
  const canonical = canonicalizeArtifactReference(storageUri);

  if (!canonical.startsWith(OBJECT_STORE_URI_PREFIX)) {
    return null;
  }

  const key = canonical.slice(OBJECT_STORE_URI_PREFIX.length).trim();
  return key.length > 0 ? key : null;
}

export function getDefaultArtifactStoreRoot(caseStoreFilePath?: string) {
  if (caseStoreFilePath && caseStoreFilePath.trim().length > 0) {
    return resolve(dirname(caseStoreFilePath), "artifacts");
  }

  return resolve(__dirname, "..", ".mri-data", "artifacts");
}

class LocalFileArtifactStore implements ArtifactStore {
  constructor(private readonly artifactStoreRoot: string) {}

  async persistArtifactPayloads(input: {
    caseId: string;
    artifactPayloads: ArtifactPayloadInput[];
  }): Promise<ArtifactStorageOverride[]> {
    return input.artifactPayloads.map((artifactPayload) => {
      const [target] = createPlannedArtifactPersistenceTargets({
        caseId: input.caseId,
        artifactTypes: [artifactPayload.artifactRef],
      });
      const bytes = decodeBase64Payload(artifactPayload.contentBase64);
      const filePath = resolve(this.artifactStoreRoot, ...target.plannedStorageKey.split("/"));

      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, bytes);

      return {
        artifactRef: artifactPayload.artifactRef,
        storageUri: canonicalizeArtifactReference(filePath),
        mimeType: artifactPayload.contentType.trim() || target.mimeType,
      };
    });
  }

  async resolveArtifactDownload(storageUri: string) {
    if (!storageUri.startsWith("file://")) {
      return null;
    }

    try {
      const filePath = resolve(fileURLToPath(storageUri));

      if (!isWithinResolvedRoot(this.artifactStoreRoot, filePath)) {
        return null;
      }

      return {
        kind: "buffer" as const,
        content: readFileSync(filePath),
      };
    } catch {
      return null;
    }
  }
}

class S3CompatibleArtifactStore implements ArtifactStore {
  private readonly s3Client: S3Client;
  private readonly normalizedBasePath: string;
  private readonly region: string;
  private readonly endpoint?: string;
  private readonly forcePathStyle: boolean;
  private readonly presignTtlSeconds: number;

  constructor(
    private readonly options: {
      basePath: string;
      bucket: string;
      endpoint?: string;
      region?: string;
      forcePathStyle?: boolean;
      presignTtlSeconds?: number;
      s3Client?: S3Client;
      signGetObjectUrl?: (input: { bucket: string; key: string }) => Promise<string>;
    },
  ) {
    this.normalizedBasePath = normalizeObjectStoreBasePath(options.basePath);
    this.region = options.region ?? DEFAULT_ARTIFACT_STORE_REGION;
    this.endpoint = options.endpoint;
    this.forcePathStyle = options.forcePathStyle ?? Boolean(options.endpoint);
    this.presignTtlSeconds = options.presignTtlSeconds ?? DEFAULT_ARTIFACT_PRESIGN_TTL_SECONDS;
    this.s3Client =
      options.s3Client ??
      new S3Client({
        region: this.region,
        ...(this.endpoint ? { endpoint: this.endpoint } : {}),
        forcePathStyle: this.forcePathStyle,
      });
  }

  async persistArtifactPayloads(input: {
    caseId: string;
    artifactPayloads: ArtifactPayloadInput[];
  }): Promise<ArtifactStorageOverride[]> {
    const persisted: ArtifactStorageOverride[] = [];

    for (const artifactPayload of input.artifactPayloads) {
      const [target] = createPlannedArtifactPersistenceTargets({
        caseId: input.caseId,
        artifactTypes: [artifactPayload.artifactRef],
      });
      const bytes = decodeBase64Payload(artifactPayload.contentBase64);
      const key = normalizeObjectStoreKey(this.options.basePath, target.plannedStorageKey);

      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.options.bucket,
          Key: key,
          Body: bytes,
          ContentType: artifactPayload.contentType.trim() || target.mimeType,
        }),
      );

      persisted.push({
        artifactRef: artifactPayload.artifactRef,
        storageUri: toObjectStoreUri(key),
        mimeType: artifactPayload.contentType.trim() || target.mimeType,
      });
    }

    return persisted;
  }

  async resolveArtifactDownload(storageUri: string) {
    const key = parseObjectStoreUri(storageUri);

    if (!key) {
      return null;
    }

    if (
      this.normalizedBasePath.length > 0 &&
      key !== this.normalizedBasePath &&
      !key.startsWith(`${this.normalizedBasePath}/`)
    ) {
      return null;
    }

    const url = this.options.signGetObjectUrl
      ? await this.options.signGetObjectUrl({ bucket: this.options.bucket, key })
      : await getSignedUrl(
          this.s3Client,
          new GetObjectCommand({
            Bucket: this.options.bucket,
            Key: key,
          }),
          { expiresIn: this.presignTtlSeconds },
        );

    return {
      kind: "redirect" as const,
      url,
    };
  }
}

export function createArtifactStore(options: CreateArtifactStoreOptions = {}): ArtifactStore {
  const provider = options.provider ?? "local-file";

  if (provider === "s3-compatible") {
    if (!options.bucket || options.bucket.trim().length === 0) {
      throw new Error("MRI_ARTIFACT_STORE_BUCKET is required for s3-compatible artifact storage");
    }

    return new S3CompatibleArtifactStore({
      basePath: options.basePath && options.basePath.trim().length > 0 ? options.basePath : "case-artifacts",
      bucket: options.bucket,
      endpoint: options.endpoint,
      region: options.region,
      forcePathStyle: options.forcePathStyle,
      presignTtlSeconds: options.presignTtlSeconds,
      s3Client: options.s3Client,
      signGetObjectUrl: options.signGetObjectUrl,
    });
  }

  return new LocalFileArtifactStore(
    options.basePath && options.basePath.trim().length > 0
      ? resolve(options.basePath)
      : getDefaultArtifactStoreRoot(options.caseStoreFilePath),
  );
}
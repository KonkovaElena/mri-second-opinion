import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { createApp } from "../src/app";
import { createArtifactStore, type ArtifactStore } from "../src/case-artifact-storage";

const DEFAULT_INTERNAL_API_TOKEN = "test-internal-token-secret-001";
const DEFAULT_OPERATOR_API_TOKEN = "test-operator-token-secret-001";
const DEFAULT_REVIEWER_JWT_SECRET = "reviewer-jwt-secret-0123456789abcdef";

function isInternalProtectedPath(path: string) {
  return /^\/api\/internal(\/|$)/.test(path);
}

function isOperatorProtectedPath(path: string) {
  return /^\/api\/(cases|operations|delivery)(\/|$)/.test(path);
}

function withImplicitAuth(path: string, headers: HeadersInit | undefined) {
  const normalizedHeaders = new Headers(headers ?? {});

  if (isInternalProtectedPath(path) && !normalizedHeaders.has("authorization")) {
    normalizedHeaders.set("authorization", `Bearer ${DEFAULT_INTERNAL_API_TOKEN}`);
  }

  if (isOperatorProtectedPath(path) && !normalizedHeaders.has("x-api-key")) {
    normalizedHeaders.set("x-api-key", DEFAULT_OPERATOR_API_TOKEN);
  }

  return normalizedHeaders;
}

function createTestStoreFile() {
  const tempDir = mkdtempSync(join(tmpdir(), "mri-second-opinion-object-store-"));
  return {
    tempDir,
    caseStoreFile: join(tempDir, "cases.sqlite"),
  };
}

async function withServer(
  caseStoreFile: string,
  artifactStore: ArtifactStore,
  run: (helpers: { baseUrl: string }) => Promise<void>,
  configOverrides: Partial<Parameters<typeof createApp>[0]> = {},
) {
  const app = createApp(
    {
      nodeEnv: "test",
      port: 0,
      caseStoreFile,
      caseStoreMode: "sqlite",
      artifactStoreProvider: "local-file",
      artifactStoreBasePath: join(tmpdir(), "unused-artifact-store"),
      artifactStoreRegion: "us-east-1",
      artifactStoreForcePathStyle: false,
      artifactStorePresignTtlSeconds: 900,
      internalApiToken: DEFAULT_INTERNAL_API_TOKEN,
      operatorApiToken: DEFAULT_OPERATOR_API_TOKEN,
      persistenceMode: "snapshot",
      reviewerJwtSecret: DEFAULT_REVIEWER_JWT_SECRET,
      reviewerAllowedRoles: ["clinician", "radiologist", "neuroradiologist"],
      jsonBodyLimit: "1mb",
      publicApiRateLimitWindowMs: 900000,
      publicApiRateLimitMaxRequests: 300,
      clockSkewToleranceMs: 60000,
      replayStoreTtlMs: 120000,
      replayStoreMaxEntries: 10000,
      serverHeadersTimeoutMs: 30000,
      serverRequestTimeoutMs: 120000,
      serverSocketTimeoutMs: 120000,
      serverKeepAliveTimeoutMs: 5000,
      serverMaxRequestsPerSocket: 100,
      gracefulShutdownTimeoutMs: 10000,
      ...configOverrides,
    },
    { artifactStore },
  );
  const server = createServer(app);

  await new Promise<void>((resolve) => {
    server.listen(0, resolve);
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await run({ baseUrl });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
    await app.locals.caseService.close();
  }
}

test("artifact route redirects to a presigned URL for object-store-backed artifacts", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();
  const fakeStore: ArtifactStore = {
    async persistArtifactPayloads({ caseId, artifactPayloads }) {
      return artifactPayloads.map((artifactPayload) => ({
        artifactRef: artifactPayload.artifactRef,
        storageUri: `object-store://case-artifacts/prefix/${caseId}/qc-summary.json`,
        mimeType: artifactPayload.contentType,
      }));
    },
    async resolveArtifactDownload(storageUri) {
      return {
        kind: "redirect",
        url: `https://artifacts.example.test/download?ref=${encodeURIComponent(storageUri)}`,
      };
    },
  };

  try {
    await withServer(caseStoreFile, fakeStore, async ({ baseUrl }) => {
      const created = await fetch(`${baseUrl}/api/cases`, {
        method: "POST",
        headers: withImplicitAuth("/api/cases", {
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          patientAlias: "synthetic-patient-object-store-001",
          studyUid: "1.2.840.object-store.1",
          sequenceInventory: ["T1w", "FLAIR"],
        }),
      });
      const createdBody = await created.json();
      assert.equal(created.status, 201);

      const caseId = createdBody.case.caseId as string;
      const inferred = await fetch(`${baseUrl}/api/internal/inference-callback`, {
        method: "POST",
        headers: withImplicitAuth("/api/internal/inference-callback", {
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          caseId,
          qcDisposition: "pass",
          findings: ["Object-store redirect verification."],
          measurements: [{ label: "brain_volume_ml", value: 1010 }],
          artifacts: ["artifact://qc-summary"],
          artifactPayloads: [
            {
              artifactRef: "artifact://qc-summary",
              contentType: "application/json",
              contentBase64: Buffer.from(JSON.stringify({ source: "object-store" }), "utf-8").toString("base64"),
            },
          ],
          generatedSummary: "Object-store artifact draft.",
        }),
      });

      assert.equal(inferred.status, 200);

      const detail = await fetch(`${baseUrl}/api/cases/${caseId}`, {
        headers: withImplicitAuth(`/api/cases/${caseId}`, undefined),
      });
      const detailBody = await detail.json();
      assert.equal(detail.status, 200);

      const artifact = detailBody.case.artifactManifest[0];
      assert.equal(artifact.storageUri, `/api/cases/${caseId}/artifacts/${artifact.artifactId}`);

      const download = await fetch(`${baseUrl}${artifact.storageUri}`, {
        headers: withImplicitAuth(artifact.storageUri, undefined),
        redirect: "manual",
      });

      assert.equal(download.status, 302);
      assert.match(download.headers.get("location") ?? "", /^https:\/\/artifacts\.example\.test\/download\?/u);
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("artifact route rejects local-file artifact refs outside the configured artifact root", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();
  const artifactRoot = join(tempDir, "artifacts");
  const outsideFile = join(tempDir, "escape.txt");
  writeFileSync(outsideFile, "outside-root-artifact", "utf-8");

  const artifactStore = createArtifactStore({
    provider: "local-file",
    caseStoreFile,
    basePath: artifactRoot,
  });

  try {
    await withServer(
      caseStoreFile,
      artifactStore,
      async ({ baseUrl }) => {
        const created = await fetch(`${baseUrl}/api/cases`, {
          method: "POST",
          headers: withImplicitAuth("/api/cases", {
            "content-type": "application/json",
          }),
          body: JSON.stringify({
            patientAlias: "synthetic-patient-local-boundary-001",
            studyUid: "1.2.840.local-boundary.1",
            sequenceInventory: ["T1w", "FLAIR"],
          }),
        });
        const createdBody = await created.json();
        assert.equal(created.status, 201);

        const caseId = createdBody.case.caseId as string;
        const inferred = await fetch(`${baseUrl}/api/internal/inference-callback`, {
          method: "POST",
          headers: withImplicitAuth("/api/internal/inference-callback", {
            "content-type": "application/json",
          }),
          body: JSON.stringify({
            caseId,
            qcDisposition: "pass",
            findings: ["Local-file boundary verification."],
            measurements: [{ label: "brain_volume_ml", value: 990 }],
            artifacts: [pathToFileURL(outsideFile).href],
            generatedSummary: "Boundary probe artifact draft.",
          }),
        });

        assert.equal(inferred.status, 200);

        const detail = await fetch(`${baseUrl}/api/cases/${caseId}`, {
          headers: withImplicitAuth(`/api/cases/${caseId}`, undefined),
        });
        const detailBody = await detail.json();
        assert.equal(detail.status, 200);

        const artifact = detailBody.case.artifactManifest[0];
        assert.equal(artifact.storageUri, `/api/cases/${caseId}/artifacts/${artifact.artifactId}`);

        const download = await fetch(`${baseUrl}${artifact.storageUri}`, {
          headers: withImplicitAuth(artifact.storageUri, undefined),
        });
        const downloadBody = await download.json();

        assert.equal(download.status, 404);
        assert.equal(downloadBody.code, "ARTIFACT_NOT_AVAILABLE");
      },
      {
        artifactStoreProvider: "local-file",
        artifactStoreBasePath: artifactRoot,
      },
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("artifact route rejects object-store refs outside the configured base path", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();
  const artifactStore = createArtifactStore({
    provider: "s3-compatible",
    basePath: "prefix",
    bucket: "case-artifacts",
    signGetObjectUrl: async ({ key }) => `https://artifacts.example.test/download?key=${encodeURIComponent(key)}`,
  });

  try {
    await withServer(
      caseStoreFile,
      artifactStore,
      async ({ baseUrl }) => {
        const created = await fetch(`${baseUrl}/api/cases`, {
          method: "POST",
          headers: withImplicitAuth("/api/cases", {
            "content-type": "application/json",
          }),
          body: JSON.stringify({
            patientAlias: "synthetic-patient-object-boundary-001",
            studyUid: "1.2.840.object-boundary.1",
            sequenceInventory: ["T1w", "FLAIR"],
          }),
        });
        const createdBody = await created.json();
        assert.equal(created.status, 201);

        const caseId = createdBody.case.caseId as string;
        const inferred = await fetch(`${baseUrl}/api/internal/inference-callback`, {
          method: "POST",
          headers: withImplicitAuth("/api/internal/inference-callback", {
            "content-type": "application/json",
          }),
          body: JSON.stringify({
            caseId,
            qcDisposition: "pass",
            findings: ["Object-store boundary verification."],
            measurements: [{ label: "brain_volume_ml", value: 995 }],
            artifacts: ["object-store://case-artifacts/outside/qc-summary.json"],
            generatedSummary: "Boundary probe object-store artifact draft.",
          }),
        });

        assert.equal(inferred.status, 200);

        const detail = await fetch(`${baseUrl}/api/cases/${caseId}`, {
          headers: withImplicitAuth(`/api/cases/${caseId}`, undefined),
        });
        const detailBody = await detail.json();
        assert.equal(detail.status, 200);

        const artifact = detailBody.case.artifactManifest[0];
        assert.equal(artifact.storageUri, `/api/cases/${caseId}/artifacts/${artifact.artifactId}`);

        const download = await fetch(`${baseUrl}${artifact.storageUri}`, {
          headers: withImplicitAuth(artifact.storageUri, undefined),
          redirect: "manual",
        });
        const downloadBody = await download.json();

        assert.equal(download.status, 404);
        assert.equal(downloadBody.code, "ARTIFACT_NOT_AVAILABLE");
      },
      {
        artifactStoreProvider: "s3-compatible",
        artifactStoreBasePath: "prefix",
        artifactStoreBucket: "case-artifacts",
      },
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
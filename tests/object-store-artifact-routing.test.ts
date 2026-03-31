import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../src/app";
import type { ArtifactStore } from "../src/case-artifact-storage";

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
      persistenceMode: "snapshot",
      reviewerIdentitySource: "request-body",
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
        headers: {
          "content-type": "application/json",
        },
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
        headers: {
          "content-type": "application/json",
        },
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

      const detail = await fetch(`${baseUrl}/api/cases/${caseId}`);
      const detailBody = await detail.json();
      assert.equal(detail.status, 200);

      const artifact = detailBody.case.artifactManifest[0];
      assert.equal(artifact.storageUri, `/api/cases/${caseId}/artifacts/${artifact.artifactId}`);

      const download = await fetch(`${baseUrl}${artifact.storageUri}`, {
        redirect: "manual",
      });

      assert.equal(download.status, 302);
      assert.match(download.headers.get("location") ?? "", /^https:\/\/artifacts\.example\.test\/download\?/u);
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
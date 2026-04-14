import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createApp } from "../src/app";

const DEFAULT_INTERNAL_API_TOKEN = "dispatch-internal-token-0001";
const DEFAULT_REVIEWER_JWT_SECRET = "reviewer-jwt-secret-0123456789abcdef";
const DEFAULT_OPERATOR_API_TOKEN = "test-operator-token-secret-001";

function createTestStoreFile() {
  const tempDir = mkdtempSync(join(tmpdir(), "mri-second-opinion-evidence-"));
  return {
    tempDir,
    caseStoreFile: join(tempDir, "cases.sqlite"),
  };
}

function isReviewerProtectedPath(path: string) {
  return /\/api\/cases\/[^/]+\/(review|finalize)$/.test(path);
}

function isInternalProtectedPath(path: string) {
  return /^\/api\/internal(\/|$)/.test(path);
}

function isOperatorProtectedPath(path: string) {
  return /^\/api\/(cases|operations|delivery)(\/|$)/.test(path);
}

function createReviewerJwt(payload: {
  reviewerId: string;
  reviewerRole?: string;
  exp?: number;
  secret?: string;
}) {
  const encodedHeader = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" }), "utf-8").toString("base64url");
  const encodedPayload = Buffer.from(
    JSON.stringify({
      sub: payload.reviewerId,
      ...(payload.reviewerRole ? { role: payload.reviewerRole } : {}),
      exp: payload.exp ?? Math.floor(Date.now() / 1000) + 60,
    }),
    "utf-8",
  ).toString("base64url");
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac("sha256", payload.secret ?? DEFAULT_REVIEWER_JWT_SECRET)
    .update(signingInput)
    .digest("base64url");

  return `${signingInput}.${signature}`;
}

function createReviewerAuthHeaders(reviewerId: string, reviewerRole?: string, secret?: string) {
  return {
    authorization: `Bearer ${createReviewerJwt({ reviewerId, reviewerRole, secret })}`,
  };
}

function withImplicitAuth(path: string, headers: HeadersInit | undefined) {
  const normalizedHeaders = new Headers(headers ?? {});

  if (isInternalProtectedPath(path) && !normalizedHeaders.has("authorization")) {
    normalizedHeaders.set("authorization", `Bearer ${DEFAULT_INTERNAL_API_TOKEN}`);
  }

  if (isOperatorProtectedPath(path) && !normalizedHeaders.has("x-api-key")) {
    normalizedHeaders.set("x-api-key", DEFAULT_OPERATOR_API_TOKEN);
  }

  if (isReviewerProtectedPath(path) && !normalizedHeaders.has("authorization")) {
    const reviewerHeaders = createReviewerAuthHeaders("implicit-test-reviewer", "neuroradiologist");
    for (const [name, value] of Object.entries(reviewerHeaders)) {
      normalizedHeaders.set(name, value);
    }
  }

  return normalizedHeaders;
}

async function startServer(caseStoreFile: string) {
  const app = createApp({
    nodeEnv: "test",
    port: 0,
    caseStoreFile,
    caseStoreMode: "sqlite",
    internalApiToken: DEFAULT_INTERNAL_API_TOKEN,
    operatorApiToken: DEFAULT_OPERATOR_API_TOKEN,
    reviewerJwtSecret: DEFAULT_REVIEWER_JWT_SECRET,
    reviewerAllowedRoles: ["clinician", "radiologist", "neuroradiologist"],
  });
  const server = createServer(app);

  await new Promise<void>((resolve) => {
    server.listen(0, resolve);
  });

  const address = server.address() as AddressInfo;
  return {
    app,
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function stopServer(server: Server, shutdown: () => Promise<void>) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

  await shutdown();
}

async function withServer<T>(
  caseStoreFile: string,
  run: (helpers: {
    jsonRequest: (path: string, init?: RequestInit) => Promise<{ response: Response; body: any }>;
  }) => Promise<T>,
) {
  const { app, server, baseUrl } = await startServer(caseStoreFile);

  try {
    return await run({
      jsonRequest: async (path: string, init?: RequestInit) => {
        const headers = withImplicitAuth(path, {
          ...(init?.headers ?? {}),
        });

        if (typeof init?.body !== "undefined" && !headers.has("content-type")) {
          headers.set("content-type", "application/json");
        }

        const response = await fetch(`${baseUrl}${path}`, {
          ...init,
          headers,
        });
        const bodyText = await response.text();
        return {
          response,
          body: bodyText.length > 0 ? JSON.parse(bodyText) : null,
        };
      },
    });
  } finally {
    await stopServer(server, async () => {
      await app.locals.caseService.close();
    });
  }
}

test("evidence bundle endpoint returns machine-readable case evidence and finalized export links", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(caseStoreFile, async ({ jsonRequest }) => {
      const created = await jsonRequest("/api/cases", {
        method: "POST",
        body: JSON.stringify({
          patientAlias: "evidence-shape-check",
          studyUid: "1.2.840.20001",
          sequenceInventory: ["T1w", "FLAIR"],
          indication: "evidence bundle validation",
        }),
      });
      assert.equal(created.response.status, 201);
      const caseId = created.body.case.caseId as string;

      const inference = await jsonRequest("/api/internal/inference-callback", {
        method: "POST",
        body: JSON.stringify({
          caseId,
          qcDisposition: "pass",
          findings: ["No major structural abnormality."],
          measurements: [{ label: "brain_volume_ml", value: 1102 }],
          artifacts: ["artifact://evidence-report"],
        }),
      });
      assert.equal(inference.response.status, 200);

      const review = await jsonRequest(`/api/cases/${caseId}/review`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      assert.equal(review.response.status, 200);

      const finalized = await jsonRequest(`/api/cases/${caseId}/finalize`, {
        method: "POST",
        body: JSON.stringify({ finalSummary: "Evidence bundle proof finalized." }),
      });
      assert.equal(finalized.response.status, 200);

      const evidenceBundle = await jsonRequest(`/api/cases/${caseId}/evidence-bundle`);
      assert.equal(evidenceBundle.response.status, 200);
      assert.equal(evidenceBundle.body.evidenceBundle.evidenceBundleSchemaVersion, "0.1.0");
      assert.equal(evidenceBundle.body.evidenceBundle.case.caseId, caseId);
      assert.equal(Array.isArray(evidenceBundle.body.evidenceBundle.evidenceCards), true);
      assert.equal(typeof evidenceBundle.body.evidenceBundle.planEnvelope.planSchemaVersion, "string");
      assert.equal(evidenceBundle.body.evidenceBundle.report.caseId, caseId);
      assert.equal(
        evidenceBundle.body.evidenceBundle.exports.dicomSr,
        `/api/cases/${caseId}/exports/dicom-sr`,
      );
      assert.equal(
        evidenceBundle.body.evidenceBundle.exports.fhirDiagnosticReport,
        `/api/cases/${caseId}/exports/fhir-diagnostic-report`,
      );
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
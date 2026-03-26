import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../src/app";
import {
  canonicalizeRequest,
  computeSignature,
  HMAC_HEADER_TIMESTAMP,
  HMAC_HEADER_NONCE,
  HMAC_HEADER_SIGNATURE,
} from "../src/hmac-auth";

function createTestStoreFile() {
  const tempDir = mkdtempSync(join(tmpdir(), "mri-second-opinion-"));
  return {
    tempDir,
    caseStoreFile: join(tempDir, "cases.json"),
  };
}

function loadWorkerTranscriptFixture() {
  return JSON.parse(
    readFileSync(join(__dirname, "fixtures", "worker-inference-transcript.json"), "utf-8"),
  ) as {
    createCase: {
      patientAlias: string;
      studyUid: string;
      sequenceInventory: string[];
      indication?: string;
    };
    claim: {
      workerId: string;
      stage: "inference";
      leaseSeconds: number;
    };
    heartbeat: {
      leaseSeconds: number;
    };
    callback: {
      qcDisposition: "pass" | "warn" | "reject";
      findings: string[];
      measurements: Array<{ label: string; value: number; unit?: string }>;
      artifacts: string[];
      issues?: string[];
      generatedSummary?: string;
    };
  };
}

async function startServer(
  caseStoreFile: string,
  options?: {
    internalApiToken?: string;
    hmacSecret?: string;
    reviewerIdentitySource?: "request-body";
  },
) {
  const server = createServer(
    createApp({
      nodeEnv: "test",
      port: 0,
      caseStoreFile,
      databaseUrl: undefined,
      internalApiToken: options?.internalApiToken,
      hmacSecret: options?.hmacSecret,
      clockSkewToleranceMs: 60_000,
      replayStoreTtlMs: 120_000,
      replayStoreMaxEntries: 10_000,
      persistenceMode: "snapshot",
      reviewerIdentitySource: options?.reviewerIdentitySource ?? "request-body",
    }),
  );

  await new Promise<void>((resolve) => {
    server.listen(0, resolve);
  });

  const address = server.address() as AddressInfo;
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function stopServer(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function createSignedHeaders(path: string, body: string, hmacSecret: string) {
  return {
    "content-type": "application/json",
    ...signedHeaders("POST", path, body, hmacSecret),
  };
}

async function withServer<T>(
  caseStoreFile: string,
  optionsOrRun:
    | {
        internalApiToken?: string;
      }
    | ((helpers: {
        jsonRequest: (path: string, init?: RequestInit) => Promise<{ response: Response; body: any }>;
        textRequest: (path: string, init?: RequestInit) => Promise<{ response: Response; body: string }>;
      }) => Promise<T>),
  run: (helpers: {
    jsonRequest: (path: string, init?: RequestInit) => Promise<{ response: Response; body: any }>;
    textRequest: (path: string, init?: RequestInit) => Promise<{ response: Response; body: string }>;
  }) => Promise<T>,
) {
  const options = typeof optionsOrRun === "function" ? {} : optionsOrRun;
  const effectiveRun = typeof optionsOrRun === "function" ? optionsOrRun : run;
  const { server, baseUrl } = await startServer(caseStoreFile, options);

  try {
    return await effectiveRun({
      jsonRequest: async (path: string, init?: RequestInit) => {
        const response = await fetch(`${baseUrl}${path}`, {
          ...init,
          headers: {
            "content-type": "application/json",
            ...(init?.headers ?? {}),
          },
        });
        const bodyText = await response.text();
        const body = bodyText.length > 0 ? JSON.parse(bodyText) : null;
        return { response, body };
      },
      textRequest: async (path: string, init?: RequestInit) => {
        const response = await fetch(`${baseUrl}${path}`, init);
        return { response, body: await response.text() };
      },
    });
  } finally {
    await stopServer(server);
  }
}

test("operator surface exposes queue, case detail, review, and report preview bindings", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(caseStoreFile, {}, async ({ jsonRequest, textRequest }) => {
      const created = await jsonRequest("/api/cases", {
        method: "POST",
        body: JSON.stringify({
          patientAlias: "operator-patient-001",
          studyUid: "1.2.840.operator.1",
          sequenceInventory: ["T1w", "FLAIR"],
        }),
      });
      const caseId = created.body.case.caseId as string;

      await jsonRequest("/api/internal/inference-callback", {
        method: "POST",
        body: JSON.stringify({
          caseId,
          qcDisposition: "pass",
          findings: ["No acute intracranial abnormality."],
          measurements: [{ label: "brain_volume_ml", value: 1112 }],
          artifacts: ["artifact://overlay-preview", "artifact://report"],
          generatedSummary: "Operator preview draft.",
        }),
      });

      const page = await textRequest(`/operator?caseId=${encodeURIComponent(caseId)}`);

      assert.equal(page.response.status, 200);
      assert.equal(page.response.headers.get("content-type")?.includes("text/html"), true);
      assert.equal(page.body.includes("Queue Dashboard"), true);
      assert.equal(page.body.includes("Case Detail"), true);
      assert.equal(page.body.includes("Review Workspace"), true);
      assert.equal(page.body.includes("Report Preview"), true);
      assert.equal(page.body.includes("Retry Delivery"), true);
      assert.equal(page.body.includes("/api/operations/summary"), true);
      assert.equal(page.body.includes(`/api/cases/${caseId}`), true);
      assert.equal(page.body.includes(`/api/cases/${caseId}/review`), true);
      assert.equal(page.body.includes(`/api/cases/${caseId}/finalize`), true);
      assert.equal(page.body.includes(`/api/cases/${caseId}/report`), true);
      assert.equal(page.body.includes(`/api/delivery/${caseId}/retry`), true);
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("internal routes reject requests without bearer token when internal auth is enabled", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  const server = createServer(
    createApp({
      nodeEnv: "test",
      port: 0,
      caseStoreFile,
      databaseUrl: undefined,
      internalApiToken: "secret-token",
      persistenceMode: "snapshot",
    }),
  );

  try {
    await new Promise<void>((resolve) => {
      server.listen(0, resolve);
    });

    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/api/internal/ingest`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        patientAlias: "unauthorized-patient",
        studyUid: "1.2.840.internal.unauthorized",
        sequenceInventory: ["T1w"],
      }),
    });

    const body = await response.json();
    assert.equal(response.status, 401);
    assert.equal(body.code, "UNAUTHORIZED_INTERNAL_ROUTE");
  } finally {
    await stopServer(server);
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("inference callback rejects requests without bearer token when internal auth is enabled", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(caseStoreFile, { internalApiToken: "secret-token" }, async ({ jsonRequest }) => {
      const created = await jsonRequest("/api/cases", {
        method: "POST",
        body: JSON.stringify({
          patientAlias: "callback-auth-patient",
          studyUid: "1.2.840.internal.callback-auth",
          sequenceInventory: ["T1w"],
        }),
      });

      const response = await jsonRequest("/api/internal/inference-callback", {
        method: "POST",
        body: JSON.stringify({
          caseId: created.body.case.caseId,
          qcDisposition: "pass",
          findings: ["No acute abnormality."],
          measurements: [{ label: "brain_volume_ml", value: 1034 }],
          artifacts: ["artifact://report-preview"],
        }),
      });

      assert.equal(response.response.status, 401);
      assert.equal(response.body.code, "UNAUTHORIZED_INTERNAL_ROUTE");
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("delivery callback rejects requests without bearer token when internal auth is enabled", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(caseStoreFile, { internalApiToken: "secret-token" }, async ({ jsonRequest }) => {
      const created = await jsonRequest("/api/cases", {
        method: "POST",
        body: JSON.stringify({
          patientAlias: "delivery-auth-patient",
          studyUid: "1.2.840.internal.delivery-auth",
          sequenceInventory: ["T1w", "FLAIR"],
        }),
      });
      const caseId = created.body.case.caseId as string;

      await jsonRequest("/api/internal/inference-callback", {
        method: "POST",
        headers: {
          authorization: "Bearer secret-token",
        },
        body: JSON.stringify({
          caseId,
          qcDisposition: "pass",
          findings: ["No acute abnormality."],
          measurements: [{ label: "brain_volume_ml", value: 1101 }],
          artifacts: ["artifact://report-preview"],
        }),
      });

      await jsonRequest(`/api/cases/${caseId}/review`, {
        method: "POST",
        body: JSON.stringify({
          reviewerId: "clinician-auth",
        }),
      });

      await jsonRequest(`/api/cases/${caseId}/finalize`, {
        method: "POST",
        body: JSON.stringify({
          clinicianId: "clinician-auth",
          deliveryOutcome: "pending",
        }),
      });

      const response = await jsonRequest("/api/internal/delivery-callback", {
        method: "POST",
        body: JSON.stringify({
          caseId,
          deliveryStatus: "delivered",
        }),
      });

      assert.equal(response.response.status, 401);
      assert.equal(response.body.code, "UNAUTHORIZED_INTERNAL_ROUTE");
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("internal routes accept requests with the configured bearer token", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  const server = createServer(
    createApp({
      nodeEnv: "test",
      port: 0,
      caseStoreFile,
      databaseUrl: undefined,
      internalApiToken: "secret-token",
      persistenceMode: "snapshot",
    }),
  );

  try {
    await new Promise<void>((resolve) => {
      server.listen(0, resolve);
    });

    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/api/internal/ingest`, {
      method: "POST",
      headers: {
        authorization: "Bearer secret-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        patientAlias: "authorized-patient",
        studyUid: "1.2.840.internal.authorized",
        sequenceInventory: ["T1w"],
      }),
    });

    const body = await response.json();
    assert.equal(response.status, 201);
    assert.equal(body.case.studyUid, "1.2.840.internal.authorized");
  } finally {
    await stopServer(server);
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("delivery callback accepts requests with the configured bearer token", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(caseStoreFile, { internalApiToken: "secret-token" }, async ({ jsonRequest }) => {
      const created = await jsonRequest("/api/cases", {
        method: "POST",
        body: JSON.stringify({
          patientAlias: "delivery-authorized-patient",
          studyUid: "1.2.840.internal.delivery-authorized",
          sequenceInventory: ["T1w", "FLAIR"],
        }),
      });
      const caseId = created.body.case.caseId as string;

      await jsonRequest("/api/internal/inference-callback", {
        method: "POST",
        headers: {
          authorization: "Bearer secret-token",
        },
        body: JSON.stringify({
          caseId,
          qcDisposition: "pass",
          findings: ["No acute abnormality."],
          measurements: [{ label: "brain_volume_ml", value: 1120 }],
          artifacts: ["artifact://report-preview"],
        }),
      });

      await jsonRequest(`/api/cases/${caseId}/review`, {
        method: "POST",
        body: JSON.stringify({
          reviewerId: "clinician-auth",
        }),
      });

      await jsonRequest(`/api/cases/${caseId}/finalize`, {
        method: "POST",
        body: JSON.stringify({
          clinicianId: "clinician-auth",
          deliveryOutcome: "pending",
        }),
      });

      const response = await jsonRequest("/api/internal/delivery-callback", {
        method: "POST",
        headers: {
          authorization: "Bearer secret-token",
        },
        body: JSON.stringify({
          caseId,
          deliveryStatus: "delivered",
        }),
      });

      assert.equal(response.response.status, 200);
      assert.equal(response.body.case.status, "DELIVERED");
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("dispatch claim route rejects requests without bearer token when internal auth is enabled", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(caseStoreFile, { internalApiToken: "secret-token" }, async ({ jsonRequest }) => {
      const response = await jsonRequest("/api/internal/dispatch/claim", {
        method: "POST",
        body: JSON.stringify({
          workerId: "worker-auth-missing",
          stage: "inference",
        }),
      });

      assert.equal(response.response.status, 401);
      assert.equal(response.body.code, "UNAUTHORIZED_INTERNAL_ROUTE");
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("dispatch claim route returns inference dispatch payload for queued work", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(caseStoreFile, { internalApiToken: "secret-token" }, async ({ jsonRequest }) => {
      const created = await jsonRequest("/api/cases", {
        method: "POST",
        body: JSON.stringify({
          patientAlias: "dispatch-api-inference",
          studyUid: "1.2.840.dispatch.api.inference",
          sequenceInventory: ["T1w", "FLAIR"],
          indication: "memory decline",
        }),
      });

      const response = await jsonRequest("/api/internal/dispatch/claim", {
        method: "POST",
        headers: {
          authorization: "Bearer secret-token",
        },
        body: JSON.stringify({
          workerId: "worker-api-inference",
          stage: "inference",
          leaseSeconds: 120,
        }),
      });

      assert.equal(response.response.status, 200);
      assert.equal(response.body.dispatch.caseId, created.body.case.caseId);
      assert.equal(response.body.dispatch.stage, "inference");
      assert.equal(response.body.dispatch.workerId, "worker-api-inference");
      assert.equal(response.body.dispatch.workflowPackage.packageId, "brain-structural-fastsurfer");
      assert.equal(response.body.dispatch.studyContext.studyUid, "1.2.840.dispatch.api.inference");
      assert.equal(response.body.dispatch.planEnvelope.caseRef.caseId, created.body.case.caseId);
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("dispatch claim route returns delivery dispatch payload for finalized work", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(caseStoreFile, { internalApiToken: "secret-token" }, async ({ jsonRequest }) => {
      const created = await jsonRequest("/api/cases", {
        method: "POST",
        body: JSON.stringify({
          patientAlias: "dispatch-api-delivery",
          studyUid: "1.2.840.dispatch.api.delivery",
          sequenceInventory: ["T1w", "FLAIR"],
        }),
      });
      const caseId = created.body.case.caseId as string;

      await jsonRequest("/api/internal/inference-callback", {
        method: "POST",
        headers: {
          authorization: "Bearer secret-token",
        },
        body: JSON.stringify({
          caseId,
          qcDisposition: "pass",
          findings: ["No acute abnormality."],
          measurements: [{ label: "brain_volume_ml", value: 1099 }],
          artifacts: ["artifact://overlay-preview", "artifact://report-preview"],
          generatedSummary: "Dispatch API delivery test.",
        }),
      });

      await jsonRequest(`/api/cases/${caseId}/review`, {
        method: "POST",
        body: JSON.stringify({
          reviewerId: "clinician-dispatch-api",
        }),
      });

      await jsonRequest(`/api/cases/${caseId}/finalize`, {
        method: "POST",
        body: JSON.stringify({
          clinicianId: "clinician-dispatch-api",
          finalSummary: "Finalized for dispatch contract test.",
        }),
      });

      const response = await jsonRequest("/api/internal/dispatch/claim", {
        method: "POST",
        headers: {
          authorization: "Bearer secret-token",
        },
        body: JSON.stringify({
          workerId: "worker-api-delivery",
          stage: "delivery",
          leaseSeconds: 120,
        }),
      });

      assert.equal(response.response.status, 200);
      assert.equal(response.body.dispatch.caseId, caseId);
      assert.equal(response.body.dispatch.stage, "delivery");
      assert.equal(response.body.dispatch.report.reviewStatus, "finalized");
      assert.equal(response.body.dispatch.report.versionPins.finalizedReleaseVersion, 1);
      assert.equal(response.body.dispatch.artifactManifest.length, 2);
      assert.equal(response.body.dispatch.structuralRun.packageId, "brain-structural-fastsurfer");
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("public case lifecycle reaches delivery failure and retry path", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(caseStoreFile, {}, async ({ jsonRequest }) => {
      const created = await jsonRequest("/api/cases", {
        method: "POST",
        body: JSON.stringify({
          patientAlias: "synthetic-patient-001",
          studyUid: "1.2.840.0.1",
          sequenceInventory: ["T1w", "FLAIR"],
          indication: "memory complaints",
        }),
      });

      assert.equal(created.response.status, 201);
      assert.equal(created.body.case.status, "SUBMITTED");

      const caseId = created.body.case.caseId as string;

      const inferred = await jsonRequest("/api/internal/inference-callback", {
        method: "POST",
        body: JSON.stringify({
          caseId,
          qcDisposition: "warn",
          findings: ["Mild generalized cortical volume loss."],
          measurements: [{ label: "hippocampal_z_score", value: -1.4 }],
          artifacts: ["artifact://overlay-preview", "artifact://qc-summary"],
          issues: ["Motion artifact warning."],
          generatedSummary: "Structural draft generated with mild volume-loss finding.",
        }),
      });

      assert.equal(inferred.response.status, 200);
      assert.equal(inferred.body.case.status, "AWAITING_REVIEW");

      const reviewed = await jsonRequest(`/api/cases/${caseId}/review`, {
        method: "POST",
        body: JSON.stringify({
          reviewerId: "clinician-01",
          reviewerRole: "neuroradiologist",
          comments: "Findings acceptable for release after manual review.",
          finalImpression: "No acute intracranial abnormality. Mild chronic volume loss.",
        }),
      });

      assert.equal(reviewed.response.status, 200);
      assert.equal(reviewed.body.case.status, "REVIEWED");

      const finalized = await jsonRequest(`/api/cases/${caseId}/finalize`, {
        method: "POST",
        body: JSON.stringify({
          clinicianId: "clinician-01",
          finalSummary: "Clinician-reviewed summary locked and queued for delivery.",
          deliveryOutcome: "failed",
        }),
      });

      assert.equal(finalized.response.status, 200);
      assert.equal(finalized.body.case.status, "DELIVERY_FAILED");

      const report = await jsonRequest(`/api/cases/${caseId}/report`);
      assert.equal(report.response.status, 200);
      assert.equal(report.body.reviewStatus, "finalized");
      assert.equal(report.body.finalImpression, "No acute intracranial abnormality. Mild chronic volume loss.");

      const retry = await jsonRequest(`/api/delivery/${caseId}/retry`, {
        method: "POST",
        body: JSON.stringify({}),
      });

      assert.equal(retry.response.status, 200);
      assert.equal(retry.body.case.status, "DELIVERY_PENDING");

      const summary = await jsonRequest("/api/operations/summary");
      assert.equal(summary.response.status, 200);
      assert.equal(summary.body.totalCases, 1);
      assert.equal(summary.body.byStatus.DELIVERY_PENDING, 1);
      assert.equal(summary.body.reviewRequiredCount, 0);
      assert.equal(Array.isArray(summary.body.retryHistory), true);
      assert.equal(summary.body.retryHistory.length, 1);
      assert.equal(summary.body.queue.totalActive, 1);
      assert.equal(summary.body.queue.byStage.inference, 0);
      assert.equal(summary.body.queue.byStage.delivery, 1);
      assert.equal(Array.isArray(summary.body.queue.active), true);
      assert.equal(summary.body.queue.active[0].caseId, caseId);
      assert.equal(summary.body.queue.active[0].stage, "delivery");
      assert.equal(summary.body.queue.active[0].status, "queued");
      assert.equal(summary.body.queueHealth.queued, 1);
      assert.equal(summary.body.queueHealth.inFlight, 0);
      assert.equal(summary.body.queueHealth.abandoned, 0);
      assert.equal(summary.body.queueHealth.deadLetter, 0);
      assert.equal(summary.body.queueHealth.retry, 1);
      assert.equal(summary.body.workerHealth.activeWorkers, 0);
      assert.equal(summary.body.workerHealth.staleLeases, 0);
      assert.equal(summary.body.workerHealth.byStage.inference, 0);
      assert.equal(summary.body.workerHealth.byStage.delivery, 0);
      assert.equal(summary.body.retryHistory[0].caseId, caseId);
      assert.equal(summary.body.retryHistory[0].operationType, "delivery-retry-requested");

      const detail = await jsonRequest(`/api/cases/${caseId}`);
      assert.equal(detail.response.status, 200);
      assert.equal(Array.isArray(detail.body.case.operationLog), true);
      assert.equal(detail.body.case.operationLog.some((entry: { operationType: string }) => entry.operationType === "case-created"), true);
      assert.equal(detail.body.case.operationLog.some((entry: { operationType: string }) => entry.operationType === "delivery-retry-requested"), true);
      assert.equal(detail.body.case.workerArtifacts.studyContext.studyUid, "1.2.840.0.1");
      assert.equal(detail.body.case.workerArtifacts.studyContext.workflowFamily, "brain-structural");
      assert.equal(detail.body.case.workerArtifacts.qcSummary.disposition, "warn");
      assert.equal(detail.body.case.workerArtifacts.qcSummary.issues[0], "Motion artifact warning.");
      assert.equal(detail.body.case.workerArtifacts.findingsPayload.summary, "Structural draft generated with mild volume-loss finding.");
      assert.equal(detail.body.case.workerArtifacts.findingsPayload.findings[0], "Mild generalized cortical volume loss.");
      assert.equal(detail.body.case.workerArtifacts.structuralRun.packageId, "brain-structural-fastsurfer");
      assert.equal(detail.body.case.workerArtifacts.structuralRun.packageVersion, "0.1.0");
      assert.equal(detail.body.case.workerArtifacts.structuralRun.status, "succeeded");
      assert.equal(
        detail.body.case.workerArtifacts.structuralRun.artifacts.some((artifact: { artifactType: string }) => artifact.artifactType === "overlay-preview"),
        true,
      );
      assert.equal(
        detail.body.case.evidenceCards.some((card: { cardType: string }) => card.cardType === "branch-execution"),
        true,
      );
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("read-side surfaces preserve submitted and delivery-pending queue invariants", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(caseStoreFile, {}, async ({ jsonRequest }) => {
      const submitted = await jsonRequest("/api/cases", {
        method: "POST",
        body: JSON.stringify({
          patientAlias: "invariant-submitted",
          studyUid: "1.2.840.invariant.submitted",
          sequenceInventory: ["T1w", "FLAIR"],
        }),
      });
      const submittedCaseId = submitted.body.case.caseId as string;

      const pending = await jsonRequest("/api/cases", {
        method: "POST",
        body: JSON.stringify({
          patientAlias: "invariant-delivery",
          studyUid: "1.2.840.invariant.delivery",
          sequenceInventory: ["T1w", "FLAIR"],
        }),
      });
      const pendingCaseId = pending.body.case.caseId as string;

      await jsonRequest("/api/internal/inference-callback", {
        method: "POST",
        body: JSON.stringify({
          caseId: pendingCaseId,
          qcDisposition: "pass",
          findings: ["No acute abnormality."],
          measurements: [{ label: "brain_volume_ml", value: 1107 }],
          artifacts: ["artifact://report-preview"],
        }),
      });
      await jsonRequest(`/api/cases/${pendingCaseId}/review`, {
        method: "POST",
        body: JSON.stringify({ reviewerId: "clinician-invariant" }),
      });
      await jsonRequest(`/api/cases/${pendingCaseId}/finalize`, {
        method: "POST",
        body: JSON.stringify({ clinicianId: "clinician-invariant" }),
      });

      const submittedDetail = await jsonRequest(`/api/cases/${submittedCaseId}`);
      const pendingDetail = await jsonRequest(`/api/cases/${pendingCaseId}`);
      const summary = await jsonRequest("/api/operations/summary");

      assert.equal(submittedDetail.body.case.status, "SUBMITTED");
      assert.deepEqual(
        submittedDetail.body.case.workflowQueue
          .filter((entry: { status: string }) => entry.status === "queued" || entry.status === "claimed")
          .map((entry: { stage: string }) => entry.stage),
        ["inference"],
      );

      assert.equal(pendingDetail.body.case.status, "DELIVERY_PENDING");
      assert.equal(pendingDetail.body.case.report.reviewStatus, "finalized");
      assert.deepEqual(
        pendingDetail.body.case.workflowQueue
          .filter((entry: { status: string }) => entry.status === "queued" || entry.status === "claimed")
          .map((entry: { stage: string }) => entry.stage),
        ["delivery"],
      );

      assert.equal(summary.body.byStatus.SUBMITTED, 1);
      assert.equal(summary.body.byStatus.DELIVERY_PENDING, 1);
      assert.equal(summary.body.queue.byStage.inference, 1);
      assert.equal(summary.body.queue.byStage.delivery, 1);
      assert.equal(summary.body.queueHealth.queued, 2);
      assert.equal(summary.body.queueHealth.inFlight, 0);
      assert.equal(summary.body.queueHealth.abandoned, 0);
      assert.equal(summary.body.workerHealth.activeWorkers, 0);
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("operations summary surfaces in-flight and abandoned worker diagnostics", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(caseStoreFile, {}, async ({ jsonRequest }) => {
      const created = await jsonRequest("/api/cases", {
        method: "POST",
        body: JSON.stringify({
          patientAlias: "ops-health-claim",
          studyUid: "1.2.840.ops.health.claim",
          sequenceInventory: ["T1w", "FLAIR"],
        }),
      });

      const claim = await jsonRequest("/api/internal/dispatch/claim", {
        method: "POST",
        body: JSON.stringify({
          workerId: "worker-ops-health",
          stage: "inference",
          leaseSeconds: 1,
        }),
      });

      assert.equal(claim.response.status, 200);

      const activeSummary = await jsonRequest("/api/operations/summary");

      assert.equal(activeSummary.response.status, 200);
      assert.equal(activeSummary.body.queueHealth.queued, 0);
      assert.equal(activeSummary.body.queueHealth.inFlight, 1);
      assert.equal(activeSummary.body.queueHealth.abandoned, 0);
      assert.equal(activeSummary.body.workerHealth.activeWorkers, 1);
      assert.equal(activeSummary.body.workerHealth.byStage.inference, 1);
      assert.equal(activeSummary.body.workerHealth.staleLeases, 0);

      await sleep(1_100);

      const abandonedSummary = await jsonRequest("/api/operations/summary");

      assert.equal(abandonedSummary.response.status, 200);
      assert.equal(abandonedSummary.body.queueHealth.inFlight, 0);
      assert.equal(abandonedSummary.body.queueHealth.abandoned, 1);
      assert.equal(abandonedSummary.body.workerHealth.activeWorkers, 0);
      assert.equal(abandonedSummary.body.workerHealth.staleLeases, 1);
      assert.equal(abandonedSummary.body.workerHealth.byStage.inference, 0);
      assert.equal(abandonedSummary.body.queue.recent.some((entry: { caseId: string; status: string }) => entry.caseId === created.body.case.caseId && entry.status === "claimed"), true);
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("case detail exposes workflow package, execution envelope, and artifact manifest after inference", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(caseStoreFile, {}, async ({ jsonRequest }) => {
      const created = await jsonRequest("/api/cases", {
        method: "POST",
        body: JSON.stringify({
          patientAlias: "contract-surface-patient",
          studyUid: "1.2.840.contract.surface",
          sequenceInventory: ["T1w", "FLAIR"],
        }),
      });
      const caseId = created.body.case.caseId as string;

      await jsonRequest("/api/internal/inference-callback", {
        method: "POST",
        body: JSON.stringify({
          caseId,
          qcDisposition: "pass",
          findings: ["No acute abnormality."],
          measurements: [{ label: "brain_volume_ml", value: 1130 }],
          artifacts: ["artifact://metrics-json", "artifact://report-preview"],
          generatedSummary: "Execution contract visibility check.",
        }),
      });

      const detail = await jsonRequest(`/api/cases/${caseId}`);

      assert.equal(detail.response.status, 200);
      assert.equal(detail.body.case.workerArtifacts.workflowPackage.packageId, "brain-structural-fastsurfer");
      assert.equal(detail.body.case.workerArtifacts.workflowPackage.packageVersion, "0.1.0");
      assert.equal(detail.body.case.workerArtifacts.structuralExecution.status, "succeeded");
      assert.equal(detail.body.case.workerArtifacts.structuralExecution.branchId, "structural");
      assert.deepEqual(detail.body.case.workerArtifacts.structuralExecution.artifactIds, ["artifact-1", "artifact-2"]);
      assert.deepEqual(
        detail.body.case.workerArtifacts.artifactManifest.map((artifact: { artifactType: string }) => artifact.artifactType),
        ["metrics-json", "report-preview"],
      );
      assert.equal(detail.body.case.report.provenance.workflowVersion, "brain-structural-fastsurfer@0.1.0");
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("internal ingest rejects a case when T1w is missing", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(caseStoreFile, {}, async ({ jsonRequest }) => {
      const created = await jsonRequest("/api/internal/ingest", {
        method: "POST",
        body: JSON.stringify({
          patientAlias: "synthetic-patient-002",
          studyUid: "1.2.840.0.2",
          sequenceInventory: ["FLAIR"],
        }),
      });

      assert.equal(created.response.status, 201);
      assert.equal(created.body.case.status, "QC_REJECTED");
      assert.equal(created.body.case.planEnvelope.packageResolution.selectedPackage, null);
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("review cannot run before inference finishes", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(caseStoreFile, {}, async ({ jsonRequest }) => {
      const created = await jsonRequest("/api/cases", {
        method: "POST",
        body: JSON.stringify({
          patientAlias: "synthetic-patient-003",
          studyUid: "1.2.840.0.3",
          sequenceInventory: ["T1w"],
        }),
      });

      const caseId = created.body.case.caseId as string;

      const reviewAttempt = await jsonRequest(`/api/cases/${caseId}/review`, {
        method: "POST",
        body: JSON.stringify({
          reviewerId: "clinician-02",
        }),
      });

      assert.equal(reviewAttempt.response.status, 409);
      assert.equal(reviewAttempt.body.code, "INVALID_TRANSITION");
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("review rejects missing reviewer identity", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(caseStoreFile, {}, async ({ jsonRequest }) => {
      const created = await jsonRequest("/api/cases", {
        method: "POST",
        body: JSON.stringify({
          patientAlias: "missing-reviewer",
          studyUid: "1.2.840.missing.reviewer",
          sequenceInventory: ["T1w", "FLAIR"],
        }),
      });
      const caseId = created.body.case.caseId as string;

      await jsonRequest("/api/internal/inference-callback", {
        method: "POST",
        body: JSON.stringify({
          caseId,
          qcDisposition: "pass",
          findings: ["No acute abnormality."],
          measurements: [{ label: "brain_volume_ml", value: 1110 }],
          artifacts: ["artifact://report-preview"],
        }),
      });

      const reviewAttempt = await jsonRequest(`/api/cases/${caseId}/review`, {
        method: "POST",
        body: JSON.stringify({ comments: "Missing identity should fail." }),
      });

      assert.equal(reviewAttempt.response.status, 400);
      assert.equal(reviewAttempt.body.code, "INVALID_INPUT");
      assert.equal(reviewAttempt.body.error, "reviewerId is required");
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("finalize rejects missing clinician identity", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(caseStoreFile, {}, async ({ jsonRequest }) => {
      const created = await jsonRequest("/api/cases", {
        method: "POST",
        body: JSON.stringify({
          patientAlias: "missing-finalizer",
          studyUid: "1.2.840.missing.finalizer",
          sequenceInventory: ["T1w", "FLAIR"],
        }),
      });
      const caseId = created.body.case.caseId as string;

      await jsonRequest("/api/internal/inference-callback", {
        method: "POST",
        body: JSON.stringify({
          caseId,
          qcDisposition: "pass",
          findings: ["No acute abnormality."],
          measurements: [{ label: "brain_volume_ml", value: 1111 }],
          artifacts: ["artifact://report-preview"],
        }),
      });

      await jsonRequest(`/api/cases/${caseId}/review`, {
        method: "POST",
        body: JSON.stringify({ reviewerId: "clinician-finalize" }),
      });

      const finalizeAttempt = await jsonRequest(`/api/cases/${caseId}/finalize`, {
        method: "POST",
        body: JSON.stringify({ finalSummary: "Missing clinician identity should fail." }),
      });

      assert.equal(finalizeAttempt.response.status, 400);
      assert.equal(finalizeAttempt.body.code, "INVALID_INPUT");
      assert.equal(finalizeAttempt.body.error, "clinicianId is required");
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("finalize cannot run before a valid review exists", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(caseStoreFile, {}, async ({ jsonRequest }) => {
      const created = await jsonRequest("/api/cases", {
        method: "POST",
        body: JSON.stringify({
          patientAlias: "finalize-without-review",
          studyUid: "1.2.840.finalize.without.review",
          sequenceInventory: ["T1w", "FLAIR"],
        }),
      });
      const caseId = created.body.case.caseId as string;

      await jsonRequest("/api/internal/inference-callback", {
        method: "POST",
        body: JSON.stringify({
          caseId,
          qcDisposition: "pass",
          findings: ["No acute abnormality."],
          measurements: [{ label: "brain_volume_ml", value: 1112 }],
          artifacts: ["artifact://report-preview"],
        }),
      });

      const finalizeAttempt = await jsonRequest(`/api/cases/${caseId}/finalize`, {
        method: "POST",
        body: JSON.stringify({
          clinicianId: "clinician-pre-review",
          finalSummary: "Should fail before review.",
        }),
      });

      assert.equal(finalizeAttempt.response.status, 409);
      assert.equal(finalizeAttempt.body.code, "INVALID_TRANSITION");
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("public review rejects internal bearer credentials", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(caseStoreFile, { internalApiToken: "secret-token" }, async ({ jsonRequest }) => {
      const created = await jsonRequest("/api/cases", {
        method: "POST",
        body: JSON.stringify({
          patientAlias: "bearer-review-reject",
          studyUid: "1.2.840.bearer.review.reject",
          sequenceInventory: ["T1w", "FLAIR"],
        }),
      });
      const caseId = created.body.case.caseId as string;

      await jsonRequest("/api/internal/inference-callback", {
        method: "POST",
        headers: { authorization: "Bearer secret-token" },
        body: JSON.stringify({
          caseId,
          qcDisposition: "pass",
          findings: ["No acute abnormality."],
          measurements: [{ label: "brain_volume_ml", value: 1113 }],
          artifacts: ["artifact://report-preview"],
        }),
      });

      const reviewAttempt = await jsonRequest(`/api/cases/${caseId}/review`, {
        method: "POST",
        headers: { authorization: "Bearer secret-token" },
        body: JSON.stringify({ reviewerId: "clinician-bearer" }),
      });

      assert.equal(reviewAttempt.response.status, 403);
      assert.equal(reviewAttempt.body.code, "MACHINE_CREDENTIAL_REJECTED");
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("public finalize rejects HMAC-signed machine credentials", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();
  const hmacSecret = "12345678901234567890123456789012";

  try {
    const { server, baseUrl } = await startServer(caseStoreFile, { hmacSecret });

    try {
      const createResponse = await fetch(`${baseUrl}/api/cases`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          patientAlias: "hmac-finalize-reject",
          studyUid: "1.2.840.hmac.finalize.reject",
          sequenceInventory: ["T1w", "FLAIR"],
        }),
      });
      const created = await createResponse.json();
      const caseId = created.case.caseId as string;

      const inferenceBody = JSON.stringify({
        caseId,
        qcDisposition: "pass",
        findings: ["No acute abnormality."],
        measurements: [{ label: "brain_volume_ml", value: 1114 }],
        artifacts: ["artifact://report-preview"],
      });
      await fetch(`${baseUrl}/api/internal/inference-callback`, {
        method: "POST",
        headers: createSignedHeaders("/api/internal/inference-callback", inferenceBody, hmacSecret),
        body: inferenceBody,
      });

      await fetch(`${baseUrl}/api/cases/${caseId}/review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reviewerId: "clinician-hmac" }),
      });

      const finalizeBody = JSON.stringify({
        clinicianId: "clinician-hmac",
        finalSummary: "Should reject HMAC credential on human route.",
      });
      const finalizeResponse = await fetch(`${baseUrl}/api/cases/${caseId}/finalize`, {
        method: "POST",
        headers: createSignedHeaders(`/api/cases/${caseId}/finalize`, finalizeBody, hmacSecret),
        body: finalizeBody,
      });
      const finalizeResult = await finalizeResponse.json();

      assert.equal(finalizeResponse.status, 403);
      assert.equal(finalizeResult.code, "MACHINE_CREDENTIAL_REJECTED");
    } finally {
      await stopServer(server);
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("root metadata reports HMAC when both internal auth modes are configured", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();
  const hmacSecret = "12345678901234567890123456789012";

  try {
    const { server, baseUrl } = await startServer(caseStoreFile, {
      internalApiToken: "secret-token",
      hmacSecret,
    });

    try {
      const response = await fetch(`${baseUrl}/`);
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(body.internalRouteAuth.enabled, true);
      assert.equal(body.internalRouteAuth.scheme, "hmac-sha256");
      assert.equal(body.clinicianReviewPolicy.reviewerIdentitySource, "request-body");
      assert.equal(body.clinicianReviewPolicy.machineCredentialsRejected, true);
    } finally {
      await stopServer(server);
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("case records survive app restart when a case store file is configured", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    let createdCaseId = "";

    await withServer(caseStoreFile, {}, async ({ jsonRequest }) => {
      const created = await jsonRequest("/api/cases", {
        method: "POST",
        body: JSON.stringify({
          patientAlias: "synthetic-patient-004",
          studyUid: "1.2.840.0.4",
          sequenceInventory: ["T1w", "SWI"],
        }),
      });

      assert.equal(created.response.status, 201);
      createdCaseId = created.body.case.caseId as string;
    });

    await withServer(caseStoreFile, {}, async ({ jsonRequest }) => {
      const list = await jsonRequest("/api/cases");
      assert.equal(list.response.status, 200);
      assert.equal(list.body.cases.length, 1);
      assert.equal(list.body.cases[0].caseId, createdCaseId);
      assert.equal(list.body.cases[0].status, "SUBMITTED");

      const detail = await jsonRequest(`/api/cases/${createdCaseId}`);
      assert.equal(detail.response.status, 200);
      assert.equal(detail.body.case.studyUid, "1.2.840.0.4");
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("duplicate inference callback is treated as a safe replay", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(caseStoreFile, {}, async ({ jsonRequest }) => {
      const created = await jsonRequest("/api/cases", {
        method: "POST",
        body: JSON.stringify({
          patientAlias: "synthetic-patient-005",
          studyUid: "1.2.840.0.5",
          sequenceInventory: ["T1w", "FLAIR"],
        }),
      });

      const caseId = created.body.case.caseId as string;
      const payload = {
        caseId,
        qcDisposition: "pass",
        findings: ["No acute finding."],
        measurements: [{ label: "brain_parenchyma_ml", value: 1123 }],
        artifacts: ["artifact://preview"],
        generatedSummary: "Draft generated.",
      };

      const first = await jsonRequest("/api/internal/inference-callback", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      assert.equal(first.response.status, 200);
      assert.equal(first.body.case.status, "AWAITING_REVIEW");

      const second = await jsonRequest("/api/internal/inference-callback", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      assert.equal(second.response.status, 200);
      assert.equal(second.body.case.status, "AWAITING_REVIEW");

      const detail = await jsonRequest(`/api/cases/${caseId}`);
      assert.equal(detail.body.case.history.filter((entry: { to: string }) => entry.to === "AWAITING_REVIEW").length, 1);
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("conflicting inference callback is rejected instead of being silently ignored", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(caseStoreFile, async ({ jsonRequest }) => {
      const created = await jsonRequest("/api/cases", {
        method: "POST",
        body: JSON.stringify({
          patientAlias: "synthetic-patient-005b",
          studyUid: "1.2.840.0.5b",
          sequenceInventory: ["T1w", "FLAIR"],
        }),
      });

      const caseId = created.body.case.caseId as string;

      const first = await jsonRequest("/api/internal/inference-callback", {
        method: "POST",
        body: JSON.stringify({
          caseId,
          qcDisposition: "pass",
          findings: ["No acute finding."],
          measurements: [{ label: "brain_parenchyma_ml", value: 1123 }],
          artifacts: ["artifact://preview"],
          generatedSummary: "Draft generated.",
        }),
      });
      assert.equal(first.response.status, 200);

      const conflicting = await jsonRequest("/api/internal/inference-callback", {
        method: "POST",
        body: JSON.stringify({
          caseId,
          qcDisposition: "warn",
          findings: ["Unexpected conflicting finding."],
          measurements: [{ label: "brain_parenchyma_ml", value: 999 }],
          artifacts: ["artifact://different-preview"],
          generatedSummary: "Conflicting draft generated.",
        }),
      });

      assert.equal(conflicting.response.status, 409);
      assert.equal(conflicting.body.code, "INFERENCE_CONFLICT");
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("delivery callback marks finalized cases as delivered", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(caseStoreFile, async ({ jsonRequest }) => {
      const created = await jsonRequest("/api/cases", {
        method: "POST",
        body: JSON.stringify({
          patientAlias: "synthetic-patient-006",
          studyUid: "1.2.840.0.6",
          sequenceInventory: ["T1w", "FLAIR"],
        }),
      });
      const caseId = created.body.case.caseId as string;

      await jsonRequest("/api/internal/inference-callback", {
        method: "POST",
        body: JSON.stringify({
          caseId,
          qcDisposition: "pass",
          findings: ["Stable structural study."],
          measurements: [{ label: "whole_brain_ml", value: 1111 }],
          artifacts: ["artifact://qc", "artifact://report"],
        }),
      });

      await jsonRequest(`/api/cases/${caseId}/review`, {
        method: "POST",
        body: JSON.stringify({
          reviewerId: "clinician-03",
        }),
      });

      const finalized = await jsonRequest(`/api/cases/${caseId}/finalize`, {
        method: "POST",
        body: JSON.stringify({
          clinicianId: "clinician-03",
          finalSummary: "Ready for outbound delivery.",
        }),
      });
      assert.equal(finalized.response.status, 200);
      assert.equal(finalized.body.case.status, "DELIVERY_PENDING");

      const delivered = await jsonRequest("/api/internal/delivery-callback", {
        method: "POST",
        body: JSON.stringify({
          caseId,
          deliveryStatus: "delivered",
          detail: "Sent to downstream RIS bridge.",
        }),
      });
      assert.equal(delivered.response.status, 200);
      assert.equal(delivered.body.case.status, "DELIVERED");

      const summary = await jsonRequest("/api/operations/summary");
      assert.equal(summary.body.byStatus.DELIVERED, 1);
      assert.equal(summary.body.deliveryFailures, 0);
      assert.equal(Array.isArray(summary.body.recentOperations), true);
      assert.equal(summary.body.recentOperations.some((entry: { operationType: string; caseId: string }) => entry.caseId === caseId && entry.operationType === "delivery-succeeded"), true);

      const detail = await jsonRequest(`/api/cases/${caseId}`);
      assert.equal(detail.body.case.operationLog.some((entry: { operationType: string }) => entry.operationType === "delivery-succeeded"), true);
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("duplicate delivery callback is treated as a safe replay", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(caseStoreFile, async ({ jsonRequest }) => {
      const created = await jsonRequest("/api/cases", {
        method: "POST",
        body: JSON.stringify({
          patientAlias: "synthetic-patient-006b",
          studyUid: "1.2.840.0.6b",
          sequenceInventory: ["T1w", "FLAIR"],
        }),
      });
      const caseId = created.body.case.caseId as string;

      await jsonRequest("/api/internal/inference-callback", {
        method: "POST",
        body: JSON.stringify({
          caseId,
          qcDisposition: "pass",
          findings: ["Stable structural study."],
          measurements: [{ label: "whole_brain_ml", value: 1111 }],
          artifacts: ["artifact://qc", "artifact://report"],
        }),
      });

      await jsonRequest(`/api/cases/${caseId}/review`, {
        method: "POST",
        body: JSON.stringify({ reviewerId: "clinician-03b" }),
      });

      await jsonRequest(`/api/cases/${caseId}/finalize`, {
        method: "POST",
        body: JSON.stringify({ clinicianId: "clinician-03b", finalSummary: "Ready for outbound delivery." }),
      });

      const first = await jsonRequest("/api/internal/delivery-callback", {
        method: "POST",
        body: JSON.stringify({
          caseId,
          deliveryStatus: "delivered",
          detail: "Sent to downstream RIS bridge.",
        }),
      });
      assert.equal(first.response.status, 200);
      assert.equal(first.body.case.status, "DELIVERED");

      const replay = await jsonRequest("/api/internal/delivery-callback", {
        method: "POST",
        body: JSON.stringify({
          caseId,
          deliveryStatus: "delivered",
          detail: "Sent to downstream RIS bridge.",
        }),
      });
      assert.equal(replay.response.status, 200);
      assert.equal(replay.body.case.status, "DELIVERED");

      const detail = await jsonRequest(`/api/cases/${caseId}`);
      assert.equal(detail.body.case.history.filter((entry: { to: string }) => entry.to === "DELIVERED").length, 1);
      assert.equal(detail.body.case.operationLog.some((entry: { operationType: string }) => entry.operationType === "delivery-replayed"), true);
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("repeated public create for the same study is idempotent but conflicting payloads are rejected", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(caseStoreFile, async ({ jsonRequest }) => {
      const payload = {
        patientAlias: "idempotent-patient",
        studyUid: "1.2.840.idempotent.public",
        sequenceInventory: ["T1w", "FLAIR"],
        indication: "memory complaints",
      };

      const first = await jsonRequest("/api/cases", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      assert.equal(first.response.status, 201);

      const replay = await jsonRequest("/api/cases", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      assert.equal(replay.response.status, 201);
      assert.equal(replay.body.case.caseId, first.body.case.caseId);

      const conflict = await jsonRequest("/api/cases", {
        method: "POST",
        body: JSON.stringify({
          ...payload,
          patientAlias: "different-patient",
        }),
      });
      assert.equal(conflict.response.status, 409);
      assert.equal(conflict.body.code, "DUPLICATE_STUDY_UID");
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("repeated internal ingest for the same study is idempotent", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(caseStoreFile, async ({ jsonRequest }) => {
      const payload = {
        patientAlias: "idempotent-ingest",
        studyUid: "1.2.840.idempotent.ingest",
        sequenceInventory: ["T1w", "FLAIR"],
      };

      const first = await jsonRequest("/api/internal/ingest", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      assert.equal(first.response.status, 201);

      const replay = await jsonRequest("/api/internal/ingest", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      assert.equal(replay.response.status, 201);
      assert.equal(replay.body.case.caseId, first.body.case.caseId);

      const list = await jsonRequest("/api/cases");
      assert.equal(list.body.cases.length, 1);
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("public create rejects malformed transport input with a 400 error", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(caseStoreFile, async ({ jsonRequest }) => {
      const malformed = await jsonRequest("/api/cases", {
        method: "POST",
        body: JSON.stringify({
          patientAlias: "missing-sequences",
          studyUid: "1.2.840.invalid",
        }),
      });

      assert.equal(malformed.response.status, 400);
      assert.equal(malformed.body.code, "INVALID_INPUT");
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("malformed JSON body is normalized into the API error envelope", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    const { server, baseUrl } = await startServer(caseStoreFile);

    try {
      const response = await fetch(`${baseUrl}/api/cases`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: "{bad-json",
      });

      const body = JSON.parse(await response.text());
      assert.equal(response.status, 400);
      assert.equal(body.code, "INVALID_INPUT");
      assert.equal(body.error, "Malformed JSON body");
    } finally {
      await stopServer(server);
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("observability endpoints expose the expected runtime baseline", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(caseStoreFile, async ({ jsonRequest }) => {
      const root = await jsonRequest("/");
      assert.equal(root.response.status, 200);
      assert.equal(root.body.status, "wave1-api");
      assert.equal(root.body.persistenceMode, "snapshot");
      assert.equal(root.body.api.internal.includes("POST /api/internal/delivery-callback"), true);

      const health = await jsonRequest("/healthz");
      assert.equal(health.response.status, 200);
      assert.equal(health.body.status, "ok");

      const ready = await jsonRequest("/readyz");
      assert.equal(ready.response.status, 200);
      assert.equal(ready.body.mode, "wave1-api");
      assert.equal(ready.body.persistenceMode, "snapshot");

      const metrics = await fetch(`${new URL(root.response.url).origin}/metrics`);
      const metricsBody = await metrics.text();
      assert.equal(metrics.status, 200);
      assert.equal(metricsBody.includes("mri_standalone_api_info"), true);
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("observability endpoints can advertise postgres mode without touching workflow routes", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  const server = createServer(
    createApp({
      nodeEnv: "test",
      port: 0,
      caseStoreFile,
      databaseUrl: "postgresql://demo:demo@127.0.0.1:5432/mri_second_opinion",
      persistenceMode: "postgres",
    }),
  );

  try {
    await new Promise<void>((resolve) => {
      server.listen(0, resolve);
    });

    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const root = await fetch(`${baseUrl}/`);
    const rootBody = JSON.parse(await root.text());
    assert.equal(root.status, 200);
    assert.equal(rootBody.persistenceMode, "postgres");

    const ready = await fetch(`${baseUrl}/readyz`);
    const readyBody = JSON.parse(await ready.text());
    assert.equal(ready.status, 200);
    assert.equal(readyBody.persistenceMode, "postgres");
  } finally {
    await stopServer(server);
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("read-side endpoints expose case detail, report, and summary shapes", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(caseStoreFile, async ({ jsonRequest }) => {
      const created = await jsonRequest("/api/cases", {
        method: "POST",
        body: JSON.stringify({
          patientAlias: "shape-check",
          studyUid: "1.2.840.shape.1",
          sequenceInventory: ["T1w", "FLAIR"],
        }),
      });
      const caseId = created.body.case.caseId as string;

      await jsonRequest("/api/internal/inference-callback", {
        method: "POST",
        body: JSON.stringify({
          caseId,
          qcDisposition: "pass",
          findings: ["No major structural abnormality."],
          measurements: [{ label: "brain_volume_ml", value: 1102 }],
          artifacts: ["artifact://shape-report"],
        }),
      });

      await jsonRequest(`/api/cases/${caseId}/review`, {
        method: "POST",
        body: JSON.stringify({ reviewerId: "clinician-shape" }),
      });

      await jsonRequest(`/api/cases/${caseId}/finalize`, {
        method: "POST",
        body: JSON.stringify({ clinicianId: "clinician-shape", finalSummary: "Shape proof finalized." }),
      });

      const list = await jsonRequest("/api/cases");
      assert.equal(list.response.status, 200);
      assert.equal(Array.isArray(list.body.cases), true);
      assert.equal(list.body.cases.some((entry: { caseId: string }) => entry.caseId === caseId), true);
      const listEntry = list.body.cases.find((entry: { caseId: string }) => entry.caseId === caseId);
      assert.equal(Array.isArray(listEntry.sequenceInventory), true);
      assert.equal("history" in listEntry, false);
      assert.equal("transitionJournal" in listEntry, false);
      assert.equal("workerArtifacts" in listEntry, false);
      assert.equal("evidenceCards" in listEntry, false);
      assert.equal("planEnvelope" in listEntry, false);

      const summaryView = await jsonRequest(`/api/cases/${caseId}?view=summary`);
      assert.equal(summaryView.response.status, 200);
      assert.equal(summaryView.body.case.caseId, caseId);
      assert.equal(Array.isArray(summaryView.body.case.sequenceInventory), true);
      assert.equal(typeof summaryView.body.case.report.reviewStatus, "string");
      assert.equal("history" in summaryView.body.case, false);
      assert.equal("transitionJournal" in summaryView.body.case, false);
      assert.equal("workerArtifacts" in summaryView.body.case, false);
      assert.equal("evidenceCards" in summaryView.body.case, false);
      assert.equal("planEnvelope" in summaryView.body.case, false);

      const detail = await jsonRequest(`/api/cases/${caseId}`);
      assert.equal(detail.response.status, 200);
      assert.equal(Array.isArray(detail.body.case.operationLog), true);
      assert.equal(Array.isArray(detail.body.case.history), true);
      assert.equal(typeof detail.body.case.planEnvelope.planSchemaVersion, "string");

      const report = await jsonRequest(`/api/cases/${caseId}/report`);
      assert.equal(report.response.status, 200);
      assert.equal(typeof report.body.reportSchemaVersion, "string");
      assert.deepEqual(report.body.versionPins, {
        machineDraftVersion: 1,
        reviewedReleaseVersion: 1,
        finalizedReleaseVersion: 1,
      });
      assert.equal(Array.isArray(report.body.findings), true);
      assert.equal(Array.isArray(report.body.measurements), true);
      assert.equal(typeof report.body.provenance.workflowVersion, "string");

      const summary = await jsonRequest("/api/operations/summary");
      assert.equal(summary.response.status, 200);
      assert.equal(typeof summary.body.byStatus.DELIVERY_PENDING, "number");
      assert.equal(typeof summary.body.reviewRequiredCount, "number");
      assert.equal(typeof summary.body.deliveryFailures, "number");
      assert.equal(Array.isArray(summary.body.recentOperations), true);
      assert.equal(Array.isArray(summary.body.retryHistory), true);
      assert.equal(typeof summary.body.queueHealth.queued, "number");
      assert.equal(typeof summary.body.queueHealth.inFlight, "number");
      assert.equal(typeof summary.body.queueHealth.abandoned, "number");
      assert.equal(typeof summary.body.queueHealth.deadLetter, "number");
      assert.equal(typeof summary.body.queueHealth.retry, "number");
      assert.equal(typeof summary.body.workerHealth.activeWorkers, "number");
      assert.equal(typeof summary.body.workerHealth.staleLeases, "number");
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("detail endpoint rejects unsupported read views", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(caseStoreFile, async ({ jsonRequest }) => {
      const created = await jsonRequest("/api/cases", {
        method: "POST",
        body: JSON.stringify({
          patientAlias: "invalid-view",
          studyUid: "1.2.840.invalid-view.1",
          sequenceInventory: ["T1w", "FLAIR"],
        }),
      });
      const caseId = created.body.case.caseId as string;

      const response = await jsonRequest(`/api/cases/${caseId}?view=heavy`);
      assert.equal(response.response.status, 400);
      assert.equal(response.body.code, "INVALID_INPUT");
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("mutation routes generate and persist correlation ids when the header is missing", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(caseStoreFile, {}, async ({ jsonRequest }) => {
      const created = await jsonRequest("/api/cases", {
        method: "POST",
        body: JSON.stringify({
          patientAlias: "correlation-generated-patient",
          studyUid: "1.2.840.correlation.generated",
          sequenceInventory: ["T1w", "FLAIR"],
        }),
      });

      const correlationId = created.response.headers.get("x-correlation-id");

      assert.equal(created.response.status, 201);
      assert.equal(typeof correlationId, "string");
      assert.equal((correlationId ?? "").length > 0, true);
      assert.equal(created.body.case.operationLog[0].correlationId, correlationId);

      const detail = await jsonRequest(`/api/cases/${created.body.case.caseId}`);

      assert.equal(detail.response.status, 200);
      assert.equal(detail.body.case.operationLog[0].correlationId, correlationId);
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// HMAC Signed Request Tests (PR-02)
// ---------------------------------------------------------------------------

const TEST_HMAC_SECRET = "a]y#9Kp2$TzW!mXvN@bR4dLf7gHjQsU&eC";

function signedHeaders(
  method: string,
  path: string,
  body: string,
  secret: string = TEST_HMAC_SECRET,
  timestamp?: string,
  nonce?: string,
): Record<string, string> {
  const ts = timestamp ?? new Date().toISOString();
  const n = nonce ?? `test-nonce-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const canonical = canonicalizeRequest(method, path, ts, n, Buffer.from(body));
  const sig = computeSignature(secret, canonical);
  return {
    [HMAC_HEADER_TIMESTAMP]: ts,
    [HMAC_HEADER_NONCE]: n,
    [HMAC_HEADER_SIGNATURE]: sig,
  };
}

async function startHmacServer(caseStoreFile: string, hmacSecret: string = TEST_HMAC_SECRET) {
  const server = createServer(
    createApp({
      nodeEnv: "test",
      port: 0,
      caseStoreFile,
      databaseUrl: undefined,
      hmacSecret,
      clockSkewToleranceMs: 60_000,
      replayStoreTtlMs: 120_000,
      replayStoreMaxEntries: 10_000,
      persistenceMode: "snapshot",
    } as any),
  );

  await new Promise<void>((resolve) => {
    server.listen(0, resolve);
  });

  const address = server.address() as AddressInfo;
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

test("HMAC: rejects internal route when signature headers are missing", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    const { server, baseUrl } = await startHmacServer(caseStoreFile);

    try {
      const response = await fetch(`${baseUrl}/api/internal/ingest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          patientAlias: "hmac-missing-patient",
          studyUid: "1.2.840.hmac.missing",
          sequenceInventory: ["T1w"],
        }),
      });

      const body = await response.json();
      assert.equal(response.status, 401);
      assert.equal(body.code, "UNAUTHORIZED_INTERNAL_ROUTE");
    } finally {
      await stopServer(server);
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("HMAC: rejects internal route with invalid signature", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    const { server, baseUrl } = await startHmacServer(caseStoreFile);

    try {
      const bodyStr = JSON.stringify({
        patientAlias: "hmac-bad-sig-patient",
        studyUid: "1.2.840.hmac.badsig",
        sequenceInventory: ["T1w"],
      });

      const headers = signedHeaders("POST", "/api/internal/ingest", bodyStr);
      // Corrupt the signature
      headers[HMAC_HEADER_SIGNATURE] = "0".repeat(64);

      const response = await fetch(`${baseUrl}/api/internal/ingest`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: bodyStr,
      });

      const body = await response.json();
      assert.equal(response.status, 401);
      assert.equal(body.code, "UNAUTHORIZED_INTERNAL_ROUTE");
    } finally {
      await stopServer(server);
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("HMAC: rejects internal route with stale timestamp", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    const { server, baseUrl } = await startHmacServer(caseStoreFile);

    try {
      const bodyStr = JSON.stringify({
        patientAlias: "hmac-stale-patient",
        studyUid: "1.2.840.hmac.stale",
        sequenceInventory: ["T1w"],
      });

      const staleTimestamp = new Date(Date.now() - 120_000).toISOString();
      const headers = signedHeaders("POST", "/api/internal/ingest", bodyStr, TEST_HMAC_SECRET, staleTimestamp);

      const response = await fetch(`${baseUrl}/api/internal/ingest`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: bodyStr,
      });

      const body = await response.json();
      assert.equal(response.status, 401);
      assert.equal(body.code, "UNAUTHORIZED_INTERNAL_ROUTE");
    } finally {
      await stopServer(server);
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("HMAC: accepts internal route with valid signature", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    const { server, baseUrl } = await startHmacServer(caseStoreFile);

    try {
      const bodyStr = JSON.stringify({
        patientAlias: "hmac-valid-patient",
        studyUid: "1.2.840.hmac.valid",
        sequenceInventory: ["T1w"],
      });

      const headers = signedHeaders("POST", "/api/internal/ingest", bodyStr);

      const response = await fetch(`${baseUrl}/api/internal/ingest`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: bodyStr,
      });

      const body = await response.json();
      assert.equal(response.status, 201);
      assert.equal(body.case.studyUid, "1.2.840.hmac.valid");
    } finally {
      await stopServer(server);
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("HMAC: dispatch/claim route accepts valid signature", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    const { server, baseUrl } = await startHmacServer(caseStoreFile);

    try {
      // First create a case via public route
      const createResp = await fetch(`${baseUrl}/api/cases`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          patientAlias: "hmac-dispatch-patient",
          studyUid: "1.2.840.hmac.dispatch",
          sequenceInventory: ["T1w", "FLAIR"],
        }),
      });
      const createBody = await createResp.json();
      const caseId = createBody.case.caseId;

      // Dispatch/claim with HMAC
      const claimBody = JSON.stringify({ workerId: "test-worker-1", stage: "inference" });
      const headers = signedHeaders("POST", "/api/internal/dispatch/claim", claimBody);

      const response = await fetch(`${baseUrl}/api/internal/dispatch/claim`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: claimBody,
      });

      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.dispatch.caseId, caseId);
    } finally {
      await stopServer(server);
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("HMAC: worker transcript can claim, heartbeat, and complete inference with lease context", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();
  const transcript = loadWorkerTranscriptFixture();
  const workerCorrelationId = "corr-worker-transcript-001";

  try {
    const { server, baseUrl } = await startHmacServer(caseStoreFile);

    try {
      const createResponse = await fetch(`${baseUrl}/api/cases`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(transcript.createCase),
      });
      const created = await createResponse.json();
      const caseId = created.case.caseId as string;

      const claimBody = JSON.stringify(transcript.claim);
      const claimResponse = await fetch(`${baseUrl}/api/internal/dispatch/claim`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-correlation-id": workerCorrelationId,
          ...signedHeaders("POST", "/api/internal/dispatch/claim", claimBody),
        },
        body: claimBody,
      });
      const claimResult = await claimResponse.json();

      assert.equal(claimResponse.status, 200);
      assert.equal(claimResult.dispatch.caseId, caseId);
      assert.equal(claimResult.dispatch.stage, "inference");

      const heartbeatBody = JSON.stringify({
        caseId,
        leaseId: claimResult.dispatch.leaseId,
        workerId: transcript.claim.workerId,
        stage: transcript.claim.stage,
        leaseSeconds: transcript.heartbeat.leaseSeconds,
      });
      const heartbeatResponse = await fetch(`${baseUrl}/api/internal/dispatch/heartbeat`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-correlation-id": workerCorrelationId,
          ...signedHeaders("POST", "/api/internal/dispatch/heartbeat", heartbeatBody),
        },
        body: heartbeatBody,
      });
      const heartbeatResult = await heartbeatResponse.json();

      assert.equal(heartbeatResponse.status, 200);
      assert.equal(heartbeatResult.dispatch.leaseId, claimResult.dispatch.leaseId);
      assert.equal(heartbeatResult.dispatch.lastHeartbeatAt !== null, true);
      assert.equal(heartbeatResult.dispatch.claimExpiresAt > claimResult.dispatch.claimExpiresAt, true);

      const callbackBody = JSON.stringify({
        caseId,
        leaseId: claimResult.dispatch.leaseId,
        workerId: transcript.claim.workerId,
        ...transcript.callback,
      });
      const callbackResponse = await fetch(`${baseUrl}/api/internal/inference-callback`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-correlation-id": workerCorrelationId,
          ...signedHeaders("POST", "/api/internal/inference-callback", callbackBody),
        },
        body: callbackBody,
      });
      const callbackResult = await callbackResponse.json();

      assert.equal(callbackResponse.status, 200);
      assert.equal(callbackResult.case.status, "AWAITING_REVIEW");
      assert.equal(callbackResult.case.report.reviewStatus, "draft");

      const detailResponse = await fetch(`${baseUrl}/api/cases/${caseId}`);
      const detailResult = await detailResponse.json();

      assert.equal(detailResponse.status, 200);
      assert.equal(
        detailResult.case.operationLog.some(
          (entry: { operationType: string; correlationId?: string }) =>
            entry.operationType === "inference-dispatch-claimed" && entry.correlationId === workerCorrelationId,
        ),
        true,
      );
      assert.equal(
        detailResult.case.operationLog.some(
          (entry: { operationType: string; correlationId?: string }) =>
            entry.operationType === "inference-dispatch-heartbeat" && entry.correlationId === workerCorrelationId,
        ),
        true,
      );
      assert.equal(
        detailResult.case.operationLog.some(
          (entry: { operationType: string; correlationId?: string }) =>
            entry.operationType === "inference-completed" && entry.correlationId === workerCorrelationId,
        ),
        true,
      );
      assert.equal(detailResult.case.report.artifacts.length, transcript.callback.artifacts.length);
    } finally {
      await stopServer(server);
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("HMAC: inference callback rejects lease context from another worker", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    const { server, baseUrl } = await startHmacServer(caseStoreFile);

    try {
      const createResponse = await fetch(`${baseUrl}/api/cases`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          patientAlias: "hmac-worker-mismatch",
          studyUid: "1.2.840.hmac.worker.mismatch",
          sequenceInventory: ["T1w", "FLAIR"],
        }),
      });
      const created = await createResponse.json();
      const caseId = created.case.caseId as string;

      const claimBody = JSON.stringify({ workerId: "worker-match", stage: "inference" });
      const claimResponse = await fetch(`${baseUrl}/api/internal/dispatch/claim`, {
        method: "POST",
        headers: { "content-type": "application/json", ...signedHeaders("POST", "/api/internal/dispatch/claim", claimBody) },
        body: claimBody,
      });
      const claimResult = await claimResponse.json();

      assert.equal(claimResponse.status, 200);

      const callbackBody = JSON.stringify({
        caseId,
        leaseId: claimResult.dispatch.leaseId,
        workerId: "worker-mismatch",
        qcDisposition: "pass",
        findings: ["No acute abnormality."],
        measurements: [{ label: "brain_volume_ml", value: 1140 }],
        artifacts: ["artifact://report-preview"],
      });
      const callbackResponse = await fetch(`${baseUrl}/api/internal/inference-callback`, {
        method: "POST",
        headers: { "content-type": "application/json", ...signedHeaders("POST", "/api/internal/inference-callback", callbackBody) },
        body: callbackBody,
      });
      const callbackResult = await callbackResponse.json();

      assert.equal(callbackResponse.status, 409);
      assert.equal(callbackResult.code, "DISPATCH_LEASE_OWNER_MISMATCH");
    } finally {
      await stopServer(server);
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Nonce Replay Rejection Tests (PR-03)
// ---------------------------------------------------------------------------

test("replay: second request with the same nonce is rejected with 409", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    const { server, baseUrl } = await startHmacServer(caseStoreFile);

    try {
      const fixedNonce = "replay-test-nonce-001";
      const bodyStr = JSON.stringify({
        patientAlias: "replay-patient-1",
        studyUid: "1.2.840.replay.first",
        sequenceInventory: ["T1w"],
      });

      const headers1 = signedHeaders("POST", "/api/internal/ingest", bodyStr, TEST_HMAC_SECRET, undefined, fixedNonce);

      // First request — should succeed
      const resp1 = await fetch(`${baseUrl}/api/internal/ingest`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers1 },
        body: bodyStr,
      });
      assert.equal(resp1.status, 201, "first request should succeed");

      // Second request with SAME nonce — should be rejected as replay
      const headers2 = signedHeaders("POST", "/api/internal/ingest", bodyStr, TEST_HMAC_SECRET, undefined, fixedNonce);

      const resp2 = await fetch(`${baseUrl}/api/internal/ingest`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers2 },
        body: bodyStr,
      });
      const body2 = await resp2.json();
      assert.equal(resp2.status, 409, "replayed nonce should return 409");
      assert.equal(body2.code, "REPLAY_DETECTED");
    } finally {
      await stopServer(server);
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("replay: different nonce on same endpoint succeeds (nonce-level, not endpoint-level)", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    const { server, baseUrl } = await startHmacServer(caseStoreFile);

    try {
      const bodyA = JSON.stringify({
        patientAlias: "replay-patient-a",
        studyUid: "1.2.840.replay.a",
        sequenceInventory: ["T1w"],
      });
      const headersA = signedHeaders("POST", "/api/internal/ingest", bodyA, TEST_HMAC_SECRET, undefined, "unique-nonce-a");

      const respA = await fetch(`${baseUrl}/api/internal/ingest`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headersA },
        body: bodyA,
      });
      assert.equal(respA.status, 201, "first unique nonce should succeed");

      const bodyB = JSON.stringify({
        patientAlias: "replay-patient-b",
        studyUid: "1.2.840.replay.b",
        sequenceInventory: ["T1w"],
      });
      const headersB = signedHeaders("POST", "/api/internal/ingest", bodyB, TEST_HMAC_SECRET, undefined, "unique-nonce-b");

      const respB = await fetch(`${baseUrl}/api/internal/ingest`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headersB },
        body: bodyB,
      });
      assert.equal(respB.status, 201, "second unique nonce should also succeed");
    } finally {
      await stopServer(server);
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("replay: nonce replay is checked on dispatch/claim route too", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    const { server, baseUrl } = await startHmacServer(caseStoreFile);

    try {
      // Seed a case so dispatch/claim has work
      const createResp = await fetch(`${baseUrl}/api/cases`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          patientAlias: "replay-dispatch-patient",
          studyUid: "1.2.840.replay.dispatch",
          sequenceInventory: ["T1w"],
        }),
      });
      assert.equal(createResp.status, 201);

      const fixedNonce = "replay-dispatch-nonce-001";
      const claimBody = JSON.stringify({ workerId: "w1", stage: "inference" });
      const headers1 = signedHeaders("POST", "/api/internal/dispatch/claim", claimBody, TEST_HMAC_SECRET, undefined, fixedNonce);

      // First claim — should succeed
      const resp1 = await fetch(`${baseUrl}/api/internal/dispatch/claim`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers1 },
        body: claimBody,
      });
      assert.equal(resp1.status, 200, "first dispatch/claim should succeed");

      // Replay same nonce on dispatch/claim — should be 409
      const headers2 = signedHeaders("POST", "/api/internal/dispatch/claim", claimBody, TEST_HMAC_SECRET, undefined, fixedNonce);

      const resp2 = await fetch(`${baseUrl}/api/internal/dispatch/claim`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers2 },
        body: claimBody,
      });
      const body2 = await resp2.json();
      assert.equal(resp2.status, 409, "replayed nonce on dispatch should return 409");
      assert.equal(body2.code, "REPLAY_DETECTED");
    } finally {
      await stopServer(server);
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Transition Journal Tests (PR-04)
// ---------------------------------------------------------------------------

test("journal: full workflow produces monotonic journal entries for every transition", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(caseStoreFile, {}, async ({ jsonRequest }) => {
      // 1. Create case
      const created = await jsonRequest("/api/cases", {
        method: "POST",
        body: JSON.stringify({
          patientAlias: "journal-patient-001",
          studyUid: "1.2.840.journal.001",
          sequenceInventory: ["T1w", "FLAIR"],
        }),
      });
      assert.equal(created.response.status, 201);
      const caseId = created.body.case.caseId as string;

      // After create: should already have initial journal entries
      const afterCreate = await jsonRequest(`/api/cases/${caseId}`);
      const journalAfterCreate = afterCreate.body.case.transitionJournal;
      assert.equal(Array.isArray(journalAfterCreate), true, "transitionJournal is an array");
      assert.ok(journalAfterCreate.length >= 1, "at least one journal entry after creation");

      // 2. Ingest (internal route)
      await jsonRequest("/api/internal/ingest", {
        method: "POST",
        body: JSON.stringify({
          patientAlias: "journal-patient-001",
          studyUid: "1.2.840.journal.001",
          sequenceInventory: ["T1w", "FLAIR"],
        }),
      });

      // 3. Complete inference
      await jsonRequest("/api/internal/inference-callback", {
        method: "POST",
        body: JSON.stringify({
          caseId,
          qcDisposition: "pass",
          findings: ["No acute intracranial abnormality."],
          measurements: [{ label: "brain_volume_ml", value: 1100 }],
          artifacts: ["artifact://overlay-preview", "artifact://report"],
          generatedSummary: "Journal test inference.",
        }),
      });

      // 4. Clinician review
      await jsonRequest(`/api/cases/${caseId}/review`, {
        method: "POST",
        body: JSON.stringify({ reviewerId: "clinician-journal-test" }),
      });

      // 5. Finalize (pending delivery)
      await jsonRequest(`/api/cases/${caseId}/finalize`, {
        method: "POST",
        body: JSON.stringify({ clinicianId: "clinician-journal-test", deliveryOutcome: "pending" }),
      });

      // 6. Delivery callback → delivered
      await jsonRequest("/api/internal/delivery-callback", {
        method: "POST",
        body: JSON.stringify({ caseId, deliveryStatus: "delivered" }),
      });

      // Fetch final case
      const finalCase = await jsonRequest(`/api/cases/${caseId}`);
      const journal = finalCase.body.case.transitionJournal;

      // Verify journal has entries
      assert.ok(journal.length >= 5, `expected ≥5 journal entries, got ${journal.length}`);

      // Verify monotonic sequence numbers
      for (let i = 0; i < journal.length; i++) {
        assert.equal(journal[i].sequence, i + 1, `entry ${i} should have sequence ${i + 1}`);
      }

      // Verify all entries have required fields
      for (const entry of journal) {
        assert.equal(typeof entry.journalId, "string", "journalId is string");
        assert.equal(typeof entry.caseId, "string", "caseId is string");
        assert.equal(typeof entry.transitionType, "string", "transitionType is string");
        assert.equal(typeof entry.toStatus, "string", "toStatus is string");
        assert.equal(typeof entry.actor, "string", "actor is string");
        assert.equal(typeof entry.timestamp, "string", "timestamp is string");
        assert.ok(entry.stateSnapshot !== undefined, "stateSnapshot present");
      }

      // Verify transition types appear in expected order
      const types = journal.map((e: any) => e.transitionType);
      assert.ok(types.includes("inference-completed"), "has inference-completed");
      assert.ok(types.includes("clinician-reviewed"), "has clinician-reviewed");
      assert.ok(types.includes("delivery-succeeded"), "has delivery-succeeded");
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("journal: state snapshots capture current status and queue summary", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(caseStoreFile, {}, async ({ jsonRequest }) => {
      const created = await jsonRequest("/api/cases", {
        method: "POST",
        body: JSON.stringify({
          patientAlias: "journal-snapshot-patient",
          studyUid: "1.2.840.journal.snap",
          sequenceInventory: ["T1w", "FLAIR"],
        }),
      });
      const caseId = created.body.case.caseId as string;

      // Push through inference
      await jsonRequest("/api/internal/inference-callback", {
        method: "POST",
        body: JSON.stringify({
          caseId,
          qcDisposition: "pass",
          findings: ["Normal."],
          measurements: [{ label: "brain_volume_ml", value: 1050 }],
          artifacts: ["artifact://report"],
          generatedSummary: "Snapshot test.",
        }),
      });

      const detail = await jsonRequest(`/api/cases/${caseId}`);
      const journal = detail.body.case.transitionJournal;

      // Find the inference-completed entry
      const inferenceEntry = journal.find((e: any) => e.transitionType === "inference-completed");
      assert.ok(inferenceEntry, "inference-completed entry exists");

      const snap = inferenceEntry.stateSnapshot;
      assert.equal(typeof snap.status, "string", "snapshot has status");
      assert.equal(Array.isArray(snap.queueSummary), true, "snapshot has queueSummary array");
      assert.equal(typeof snap.hasReport, "boolean", "snapshot has hasReport boolean");
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("journal: replay events produce journal entries", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(caseStoreFile, {}, async ({ jsonRequest }) => {
      const created = await jsonRequest("/api/cases", {
        method: "POST",
        body: JSON.stringify({
          patientAlias: "journal-replay-patient",
          studyUid: "1.2.840.journal.replay",
          sequenceInventory: ["T1w", "FLAIR"],
        }),
      });
      const caseId = created.body.case.caseId as string;

      // First inference
      const inferencePayload = {
        caseId,
        qcDisposition: "pass",
        findings: ["Normal."],
        measurements: [{ label: "brain_volume_ml", value: 1050 }],
        artifacts: ["artifact://report"],
        generatedSummary: "Replay test inference.",
      };
      await jsonRequest("/api/internal/inference-callback", {
        method: "POST",
        body: JSON.stringify(inferencePayload),
      });

      // Second inference (replay — identical payload)
      await jsonRequest("/api/internal/inference-callback", {
        method: "POST",
        body: JSON.stringify(inferencePayload),
      });

      const detail = await jsonRequest(`/api/cases/${caseId}`);
      const journal = detail.body.case.transitionJournal;
      const replayEntries = journal.filter((e: any) => e.transitionType === "inference-replayed");
      assert.ok(replayEntries.length >= 1, "at least one inference-replayed journal entry");
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("journal: survives server restart via snapshot persistence", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    // First server session — create case and push through inference
    let caseId: string;
    {
      const { server, baseUrl } = await startServer(caseStoreFile);
      try {
        const createResp = await fetch(`${baseUrl}/api/cases`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            patientAlias: "journal-persist-patient",
            studyUid: "1.2.840.journal.persist",
            sequenceInventory: ["T1w", "FLAIR"],
          }),
        });
        const createBody = await createResp.json();
        caseId = createBody.case.caseId;

        await fetch(`${baseUrl}/api/internal/inference-callback`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            caseId,
            qcDisposition: "pass",
            findings: ["Normal."],
            measurements: [{ label: "brain_volume_ml", value: 1050 }],
            artifacts: ["artifact://report"],
            generatedSummary: "Persistence test.",
          }),
        });

        // Verify journal exists before shutdown
        const detailResp = await fetch(`${baseUrl}/api/cases/${caseId}`);
        const detailBody = await detailResp.json();
        const journalBefore = detailBody.case.transitionJournal;
        assert.ok(journalBefore.length >= 2, `journal has entries before restart: ${journalBefore.length}`);
      } finally {
        await stopServer(server);
      }
    }

    // Second server session — verify journal survives
    {
      const { server, baseUrl } = await startServer(caseStoreFile);
      try {
        const detailResp = await fetch(`${baseUrl}/api/cases/${caseId}`);
        const detailBody = await detailResp.json();
        const journalAfter = detailBody.case.transitionJournal;
        assert.ok(journalAfter.length >= 2, `journal survives restart: ${journalAfter.length} entries`);

        // Verify entries retain structure
        assert.equal(typeof journalAfter[0].journalId, "string");
        assert.equal(typeof journalAfter[0].transitionType, "string");
        assert.equal(journalAfter[0].sequence, 1, "first entry has sequence 1");
      } finally {
        await stopServer(server);
      }
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("journal: dispatch claim produces journal entry", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(caseStoreFile, {}, async ({ jsonRequest }) => {
      const created = await jsonRequest("/api/cases", {
        method: "POST",
        body: JSON.stringify({
          patientAlias: "journal-dispatch-patient",
          studyUid: "1.2.840.journal.dispatch",
          sequenceInventory: ["T1w", "FLAIR"],
        }),
      });
      const caseId = created.body.case.caseId as string;

      // Claim the case for inference
      const claim = await jsonRequest("/api/internal/dispatch/claim", {
        method: "POST",
        body: JSON.stringify({ workerId: "w1", stage: "inference" }),
      });
      assert.equal(claim.response.status, 200);

      const detail = await jsonRequest(`/api/cases/${caseId}`);
      const journal = detail.body.case.transitionJournal;
      const claimEntries = journal.filter((e: any) => e.transitionType.includes("dispatch-claimed"));
      assert.ok(claimEntries.length >= 1, "at least one dispatch-claimed journal entry");
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
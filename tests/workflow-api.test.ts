import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../src/app";

function createTestStoreFile() {
  const tempDir = mkdtempSync(join(tmpdir(), "mri-second-opinion-"));
  return {
    tempDir,
    caseStoreFile: join(tempDir, "cases.json"),
  };
}

async function startServer(caseStoreFile: string) {
  const server = createServer(
    createApp({
      nodeEnv: "test",
      port: 0,
      caseStoreFile,
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

async function withServer<T>(
  caseStoreFile: string,
  run: (helpers: {
    jsonRequest: (path: string, init?: RequestInit) => Promise<{ response: Response; body: any }>;
  }) => Promise<T>,
) {
  const { server, baseUrl } = await startServer(caseStoreFile);

  try {
    return await run({
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
    });
  } finally {
    await stopServer(server);
  }
}

test("public case lifecycle reaches delivery failure and retry path", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(caseStoreFile, async ({ jsonRequest }) => {
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
      assert.equal(summary.body.retryHistory[0].caseId, caseId);
      assert.equal(summary.body.retryHistory[0].operationType, "delivery-retry-requested");

      const detail = await jsonRequest(`/api/cases/${caseId}`);
      assert.equal(detail.response.status, 200);
      assert.equal(Array.isArray(detail.body.case.operationLog), true);
      assert.equal(detail.body.case.operationLog.some((entry: { operationType: string }) => entry.operationType === "case-created"), true);
      assert.equal(detail.body.case.operationLog.some((entry: { operationType: string }) => entry.operationType === "delivery-retry-requested"), true);
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("internal ingest rejects a case when T1w is missing", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(caseStoreFile, async ({ jsonRequest }) => {
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
    await withServer(caseStoreFile, async ({ jsonRequest }) => {
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

test("case records survive app restart when a case store file is configured", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    let createdCaseId = "";

    await withServer(caseStoreFile, async ({ jsonRequest }) => {
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

    await withServer(caseStoreFile, async ({ jsonRequest }) => {
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
    await withServer(caseStoreFile, async ({ jsonRequest }) => {
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
        body: JSON.stringify({ finalSummary: "Ready for outbound delivery." }),
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
      assert.equal(root.body.api.internal.includes("POST /api/internal/delivery-callback"), true);

      const health = await jsonRequest("/healthz");
      assert.equal(health.response.status, 200);
      assert.equal(health.body.status, "ok");

      const ready = await jsonRequest("/readyz");
      assert.equal(ready.response.status, 200);
      assert.equal(ready.body.mode, "wave1-api");

      const metrics = await fetch(`${new URL(root.response.url).origin}/metrics`);
      const metricsBody = await metrics.text();
      assert.equal(metrics.status, 200);
      assert.equal(metricsBody.includes("mri_standalone_api_info"), true);
    });
  } finally {
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
        body: JSON.stringify({ finalSummary: "Shape proof finalized." }),
      });

      const list = await jsonRequest("/api/cases");
      assert.equal(list.response.status, 200);
      assert.equal(Array.isArray(list.body.cases), true);
      assert.equal(list.body.cases.some((entry: { caseId: string }) => entry.caseId === caseId), true);

      const detail = await jsonRequest(`/api/cases/${caseId}`);
      assert.equal(detail.response.status, 200);
      assert.equal(Array.isArray(detail.body.case.operationLog), true);
      assert.equal(Array.isArray(detail.body.case.history), true);
      assert.equal(typeof detail.body.case.planEnvelope.planSchemaVersion, "string");

      const report = await jsonRequest(`/api/cases/${caseId}/report`);
      assert.equal(report.response.status, 200);
      assert.equal(typeof report.body.reportSchemaVersion, "string");
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
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { newDb } from "pg-mem";
import { createApp } from "../src/app";
import {
  HMAC_HEADER_NONCE,
  HMAC_HEADER_SIGNATURE,
  HMAC_HEADER_TIMESTAMP,
  canonicalizeRequest,
  computeSignature,
  serializeSignedJsonPayload,
} from "../src/hmac-auth";

function createTestStoreFile() {
  const tempDir = mkdtempSync(join(tmpdir(), "mri-second-opinion-"));
  return {
    tempDir,
    caseStoreFile: join(tempDir, "cases.sqlite"),
  };
}

function createPostgresTestStore() {
  const tempDir = mkdtempSync(join(tmpdir(), "mri-second-opinion-postgres-"));
  const database = newDb();
  const adapter = database.adapters.createPg();

  return {
    tempDir,
    caseStoreFile: join(tempDir, "cases.sqlite"),
    caseStoreDatabaseUrl: "postgresql://unit.test/mri_second_opinion",
    caseStoreSchema: "mri_wave1",
    postgresPoolFactory: () => new adapter.Pool(),
  };
}

async function startServer(
  caseStoreFile: string,
  configOverrides: Partial<Parameters<typeof createApp>[0]> = {},
) {
  const app = createApp({
    nodeEnv: "test",
    port: 0,
    caseStoreFile,
    caseStoreMode: "sqlite",
    ...configOverrides,
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

async function startPostgresServer(
  store: ReturnType<typeof createPostgresTestStore>,
  configOverrides: Partial<Parameters<typeof createApp>[0]> = {},
) {
  const app = createApp(
    {
      nodeEnv: "test",
      port: 0,
      caseStoreFile: store.caseStoreFile,
      caseStoreMode: "postgres",
      caseStoreDatabaseUrl: store.caseStoreDatabaseUrl,
      caseStoreSchema: store.caseStoreSchema,
      ...configOverrides,
    },
    {
      postgresPoolFactory: store.postgresPoolFactory,
    },
  );
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
    baseUrl: string;
    jsonRequest: (path: string, init?: RequestInit) => Promise<{ response: Response; body: any }>;
    textRequest: (path: string, init?: RequestInit) => Promise<{ response: Response; body: string }>;
  }) => Promise<T>,
  configOverrides: Partial<Parameters<typeof createApp>[0]> = {},
) {
  const { app, server, baseUrl } = await startServer(caseStoreFile, configOverrides);

  try {
    return await run({
      baseUrl,
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
        const response = await fetch(`${baseUrl}${path}`, {
          ...init,
          headers: {
            ...(init?.headers ?? {}),
          },
        });
        const body = await response.text();
        return { response, body };
      },
    });
  } finally {
    await stopServer(server, async () => {
      await app.locals.caseService.close();
    });
  }
}

async function withPostgresServer<T>(
  store: ReturnType<typeof createPostgresTestStore>,
  run: (helpers: {
    baseUrl: string;
    jsonRequest: (path: string, init?: RequestInit) => Promise<{ response: Response; body: any }>;
    textRequest: (path: string, init?: RequestInit) => Promise<{ response: Response; body: string }>;
  }) => Promise<T>,
  configOverrides: Partial<Parameters<typeof createApp>[0]> = {},
) {
  const { app, server, baseUrl } = await startPostgresServer(store, configOverrides);

  try {
    return await run({
      baseUrl,
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
        const response = await fetch(`${baseUrl}${path}`, {
          ...init,
          headers: {
            ...(init?.headers ?? {}),
          },
        });
        const body = await response.text();
        return { response, body };
      },
    });
  } finally {
    await stopServer(server, async () => {
      await app.locals.caseService.close();
    });
  }
}

const DEFAULT_INTERNAL_API_TOKEN = "dispatch-internal-token-0001";
const DEFAULT_HMAC_SECRET = "dispatch-hmac-secret-0123456789abcdef";

type PythonLaunch = {
  command: string;
  args: string[];
};

let cachedPythonLaunch: PythonLaunch | null = null;

function resolvePythonLaunch(): PythonLaunch {
  if (cachedPythonLaunch) {
    return cachedPythonLaunch;
  }

  const configured = process.env.MRI_WORKER_PYTHON?.trim();
  const candidates: PythonLaunch[] = [];

  if (configured) {
    candidates.push({ command: configured, args: [] });
  }

  if (process.platform === "win32") {
    candidates.push({ command: "py", args: ["-3"] });
  }

  candidates.push({ command: "python3", args: [] });
  candidates.push({ command: "python", args: [] });

  for (const candidate of candidates) {
    const probe = spawnSync(candidate.command, [...candidate.args, "--version"], {
      encoding: "utf-8",
    });

    if (probe.status === 0) {
      cachedPythonLaunch = candidate;
      return candidate;
    }
  }

  throw new Error("Unable to locate a Python 3 executable for the MRI worker test.");
}

async function runPythonWorker(
  baseUrl: string,
  envOverrides: Record<string, string> = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const python = resolvePythonLaunch();

  return await new Promise((resolve, reject) => {
    const child = spawn(python.command, [...python.args, join(process.cwd(), "worker", "main.py")], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        MRI_API_BASE_URL: baseUrl,
        MRI_INTERNAL_HMAC_SECRET: DEFAULT_HMAC_SECRET,
        MRI_WORKER_ID: "python-worker-test",
        MRI_WORKER_STAGE: "inference",
        ...envOverrides,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({
        exitCode: exitCode ?? -1,
        stdout,
        stderr,
      });
    });
  });
}

function serializePayloadWithPython(payload: unknown): string {
  const python = resolvePythonLaunch();
  const script = [
    "import json, sys",
    "payload = json.loads(sys.stdin.read())",
    "sys.stdout.write(json.dumps(payload, separators=(',', ':')))",
  ].join("; ");
  const result = spawnSync(python.command, [...python.args, "-c", script], {
    input: JSON.stringify(payload),
    encoding: "utf-8",
  });

  if (result.status !== 0) {
    throw new Error(`Python JSON serialization probe failed: ${result.stderr}`);
  }

  return result.stdout;
}

function createSignedDispatchRequest(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    bearerToken?: string;
    hmacSecret?: string;
    timestamp?: string;
    nonce?: string;
  } = {},
): RequestInit {
  const method = options.method ?? "POST";
  const payload = typeof options.body === "undefined" ? {} : options.body;
  const rawBody = serializeSignedJsonPayload(payload);
  const timestamp = options.timestamp ?? new Date().toISOString();
  const nonce = options.nonce ?? "dispatch-nonce-001";
  const hmacSecret = options.hmacSecret ?? DEFAULT_HMAC_SECRET;
  const bearerToken = options.bearerToken ?? DEFAULT_INTERNAL_API_TOKEN;
  const signature = computeSignature(hmacSecret, canonicalizeRequest(method, path, timestamp, nonce, rawBody));

  return {
    method,
    headers: {
      authorization: `Bearer ${bearerToken}`,
      "content-type": "application/json",
      [HMAC_HEADER_TIMESTAMP]: timestamp,
      [HMAC_HEADER_NONCE]: nonce,
      [HMAC_HEADER_SIGNATURE]: signature,
    },
    body: rawBody.toString("utf-8"),
  };
}

async function signedJsonRequest(
  baseUrl: string,
  path: string,
  options: Parameters<typeof createSignedDispatchRequest>[1] = {},
) {
  const response = await fetch(`${baseUrl}${path}`, createSignedDispatchRequest(path, options));
  const bodyText = await response.text();
  const body = bodyText.length > 0 ? JSON.parse(bodyText) : null;
  return { response, body };
}

async function createReviewedCase(
  jsonRequest: (path: string, init?: RequestInit) => Promise<{ response: Response; body: any }>,
  overrides: {
    patientAlias?: string;
    studyUid?: string;
    studyInstanceUid?: string;
    accessionNumber?: string;
    internalApiToken?: string;
  } = {},
) {
  const created = await jsonRequest("/api/cases", {
    method: "POST",
    body: JSON.stringify({
      patientAlias: overrides.patientAlias ?? "synthetic-patient-queue-001",
      studyUid: overrides.studyUid ?? "1.2.840.0.queue.1",
      sequenceInventory: ["T1w", "FLAIR"],
      indication: "queue verification",
      studyContext: {
        studyInstanceUid: overrides.studyInstanceUid ?? "2.25.queue.1",
        accessionNumber: overrides.accessionNumber ?? "ACC-QUEUE-001",
        studyDate: "2026-03-27",
        sourceArchive: "pacs-demo",
        dicomWebBaseUrl: "https://dicom.example.test/studies/2.25.queue.1",
        metadataSummary: ["Queue demo study"],
        series: [
          {
            seriesInstanceUid: "2.25.queue.1.1",
            seriesDescription: "Sag T1 MPRAGE",
            modality: "MR",
            sequenceLabel: "T1w",
            instanceCount: 176,
          },
          {
            seriesInstanceUid: "2.25.queue.1.2",
            seriesDescription: "Ax FLAIR",
            modality: "MR",
            sequenceLabel: "FLAIR",
            instanceCount: 42,
          },
        ],
      },
    }),
  });

  assert.equal(created.response.status, 201);
  const caseId = created.body.case.caseId as string;

  const inferred = await jsonRequest("/api/internal/inference-callback", {
    method: "POST",
    headers:
      overrides.internalApiToken === undefined
        ? undefined
        : {
            authorization: `Bearer ${overrides.internalApiToken}`,
          },
    body: JSON.stringify({
      caseId,
      qcDisposition: "warn",
      findings: ["Mild generalized cortical volume loss."],
      measurements: [{ label: "hippocampal_z_score", value: -1.4 }],
      artifacts: ["artifact://overlay-preview", "artifact://qc-summary"],
      issues: ["Motion artifact warning."],
      generatedSummary: "Structural draft generated with mild volume-loss finding.",
      qcSummary: {
        summary: "Motion degraded but interpretable.",
        checks: [
          {
            checkId: "motion",
            status: "warn",
            detail: "Mild motion artifact in axial series.",
          },
        ],
        metrics: [
          {
            name: "snr",
            value: 18.7,
            unit: "ratio",
          },
        ],
      },
    }),
  });

  assert.equal(inferred.response.status, 200);
  assert.equal(inferred.body.case.status, "AWAITING_REVIEW");

  const reviewed = await jsonRequest(`/api/cases/${caseId}/review`, {
    method: "POST",
    body: JSON.stringify({
      reviewerId: "clinician-queue",
      reviewerRole: "neuroradiologist",
      comments: "Queue path reviewed.",
      finalImpression: "No acute intracranial abnormality. Queue-ready summary.",
    }),
  });

  assert.equal(reviewed.response.status, 200);
  assert.equal(reviewed.body.case.status, "REVIEWED");

  return { caseId };
}

test("signed JSON serialization matches the python worker contract", () => {
  const payload = {
    workerId: "contract-worker-001",
    stage: "inference",
    leaseSeconds: 90,
    studyContext: {
      series: ["T1w", "FLAIR"],
      measurements: {
        sliceThickness: 1.5,
        contrast: false,
      },
    },
  };

  const tsBody = serializeSignedJsonPayload(payload).toString("utf-8");
  const pythonBody = serializePayloadWithPython(payload);

  assert.equal(tsBody, pythonBody);
  assert.equal(
    tsBody,
    "{\"workerId\":\"contract-worker-001\",\"stage\":\"inference\",\"leaseSeconds\":90,\"studyContext\":{\"series\":[\"T1w\",\"FLAIR\"],\"measurements\":{\"sliceThickness\":1.5,\"contrast\":false}}}",
  );
});

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
          studyContext: {
            studyInstanceUid: "2.25.12345",
            accessionNumber: "ACC-001",
            studyDate: "2026-03-27",
            sourceArchive: "pacs-demo",
            dicomWebBaseUrl: "https://dicom.example.test/studies/2.25.12345",
            metadataSummary: ["3 series imported", "Axial T1 present"],
            series: [
              {
                seriesInstanceUid: "2.25.12345.1",
                seriesDescription: "Sag T1 MPRAGE",
                modality: "MR",
                sequenceLabel: "T1w",
                instanceCount: 176,
              },
              {
                seriesInstanceUid: "2.25.12345.2",
                seriesDescription: "Ax FLAIR",
                modality: "MR",
                sequenceLabel: "FLAIR",
                instanceCount: 42,
              },
            ],
          },
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
          qcSummary: {
            summary: "Motion degraded but interpretable.",
            checks: [
              {
                checkId: "motion",
                status: "warn",
                detail: "Mild motion artifact in axial series.",
              },
            ],
            metrics: [
              {
                name: "snr",
                value: 18.7,
                unit: "ratio",
              },
            ],
          },
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
      assert.equal(report.body.report.reviewStatus, "finalized");
      assert.equal(report.body.report.finalImpression, "No acute intracranial abnormality. Mild chronic volume loss.");
      assert.equal(Array.isArray(report.body.report.artifacts), true);
      assert.equal(report.body.report.artifacts.length, 2);
      assert.equal(report.body.report.artifacts[0].archiveLocator.studyInstanceUid, "2.25.12345");
      assert.equal(report.body.report.artifacts[1].artifactType, "qc-summary");
      assert.equal(report.body.report.artifacts[0].viewerReady, true);
      assert.equal(report.body.report.artifacts[0].viewerDescriptor.viewerMode, "dicom-overlay");
      assert.equal(report.body.report.artifacts[0].retrievalUrl, null);

      const retry = await jsonRequest(`/api/delivery/${caseId}/retry`, {
        method: "POST",
        body: JSON.stringify({}),
      });

      assert.equal(retry.response.status, 200);
      assert.equal(retry.body.case.status, "DELIVERY_PENDING");

      const summary = await jsonRequest("/api/operations/summary");
      assert.equal(summary.response.status, 200);
      assert.equal(summary.body.summary.totals.totalCases, 1);
      assert.equal(summary.body.summary.byStatus.DELIVERY_PENDING, 1);
      assert.equal(summary.body.summary.totals.reviewRequiredCount, 0);
      assert.equal(Array.isArray(summary.body.summary.retryHistory), true);
      assert.equal(summary.body.summary.retryHistory.length, 1);
      assert.equal(summary.body.summary.retryHistory[0].caseId, caseId);
      assert.equal(summary.body.summary.retryHistory[0].operationType, "delivery-retry-requested");

      const detail = await jsonRequest(`/api/cases/${caseId}`);
      assert.equal(detail.response.status, 200);
      assert.equal(detail.body.case.studyContext.studyInstanceUid, "2.25.12345");
      assert.equal(detail.body.case.studyContext.series.length, 2);
      assert.equal(detail.body.case.planSummary.qcDisposition, "warn");
      assert.deepEqual(detail.body.case.planSummary.metadataSummary, ["3 series imported", "Axial T1 present"]);
      assert.equal(Array.isArray(detail.body.case.artifactManifest), true);
      assert.equal(detail.body.case.artifactManifest.length, 2);
      assert.equal(detail.body.case.artifactManifest[0].archiveLocator.studyInstanceUid, "2.25.12345");
      assert.equal(detail.body.case.artifactManifest[1].artifactType, "qc-summary");
      assert.equal(detail.body.case.artifactManifest[0].retrievalUrl, null);
      assert.equal(detail.body.case.qcSummary.summary, "Motion degraded but interpretable.");
      assert.equal(detail.body.case.qcSummary.checks[0].status, "warn");
      assert.equal(detail.body.case.qcSummary.metrics[0].name, "snr");
      assert.equal(Array.isArray(detail.body.case.operationLog), true);
      assert.equal(detail.body.case.operationLog.some((entry: { operationType: string }) => entry.operationType === "case-created"), true);
      assert.equal(detail.body.case.operationLog.some((entry: { operationType: string }) => entry.operationType === "delivery-retry-requested"), true);
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("case detail exposes persisted execution contracts after restart", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    let caseId = "";
    let claimedAt: string | null = null;

    await withServer(caseStoreFile, async ({ jsonRequest }) => {
      const created = await jsonRequest("/api/cases", {
        method: "POST",
        body: JSON.stringify({
          patientAlias: "synthetic-patient-execution-contract-001",
          studyUid: "1.2.840.execution.contract.1",
          sequenceInventory: ["T1w", "FLAIR"],
          studyContext: {
            studyInstanceUid: "2.25.execution.contract.1",
            accessionNumber: "ACC-EXEC-001",
            studyDate: "2026-03-28",
            sourceArchive: "pacs-demo",
            dicomWebBaseUrl: "https://dicom.example.test/studies/2.25.execution.contract.1",
            metadataSummary: ["Execution contract demo study"],
            series: [
              {
                seriesInstanceUid: "2.25.execution.contract.1.1",
                seriesDescription: "Sag T1 MPRAGE",
                modality: "MR",
                sequenceLabel: "T1w",
                instanceCount: 176,
              },
            ],
          },
        }),
      });

      assert.equal(created.response.status, 201);
      caseId = created.body.case.caseId as string;

      const claim = await jsonRequest("/api/internal/inference-jobs/claim-next", {
        method: "POST",
        body: JSON.stringify({ workerId: "execution-contract-worker" }),
      });

      assert.equal(claim.response.status, 200);
      assert.equal(claim.body.job.caseId, caseId);
      claimedAt = claim.body.job.claimedAt as string;

      const inferred = await jsonRequest("/api/internal/inference-callback", {
        method: "POST",
        body: JSON.stringify({
          caseId,
          qcDisposition: "pass",
          findings: ["Execution contract API verification."],
          measurements: [{ label: "brain_volume_ml", value: 1114 }],
          artifacts: ["artifact://overlay-preview", "artifact://qc-summary"],
          generatedSummary: "Execution contract API draft.",
          qcSummary: {
            summary: "API execution contract QC summary.",
            checks: [
              {
                checkId: "motion",
                status: "pass",
                detail: "No meaningful motion artifact.",
              },
            ],
            metrics: [
              {
                name: "snr",
                value: 22.1,
                unit: "ratio",
              },
            ],
          },
        }),
      });

      assert.equal(inferred.response.status, 200);
      assert.equal(inferred.body.case.status, "AWAITING_REVIEW");
    });

    await withServer(caseStoreFile, async ({ jsonRequest }) => {
      const detail = await jsonRequest(`/api/cases/${caseId}`);

      assert.equal(detail.response.status, 200);
      assert.equal(detail.body.case.packageManifest.packageId, "brain-structural-fastsurfer");
      assert.equal(detail.body.case.packageManifest.packageVersion, "0.1.0");
      assert.equal(detail.body.case.packageManifest.outputContracts.artifacts.length, 4);
      assert.equal(detail.body.case.structuralExecution.packageId, "brain-structural-fastsurfer");
      assert.equal(detail.body.case.structuralExecution.executionStatus, "completed");
      assert.equal(detail.body.case.structuralExecution.dispatchedAt, claimedAt);
      assert.equal(detail.body.case.structuralExecution.resourceClass, "light-gpu");
      assert.equal(detail.body.case.structuralExecution.artifactIds.length, 2);
      assert.equal(detail.body.case.artifactManifest[0].producingPackageId, "brain-structural-fastsurfer");
      assert.equal(detail.body.case.artifactManifest[0].producingPackageVersion, "0.1.0");
      assert.equal(detail.body.case.artifactManifest[0].workflowFamily, "brain-structural");
      assert.deepEqual(detail.body.case.artifactManifest[0].exportCompatibilityTags, ["internal-json", "rendered-report"]);

      const report = await jsonRequest(`/api/cases/${caseId}/report`);

      assert.equal(report.response.status, 200);
      assert.equal(report.body.report.provenance.workflowVersion, "brain-structural-fastsurfer@0.1.0");
      assert.equal(report.body.report.artifacts[0].producingPackageId, "brain-structural-fastsurfer");
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("artifact payloads are persisted and retrievable across sqlite restarts", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    let caseId = "";

    await withServer(caseStoreFile, async ({ jsonRequest }) => {
      const created = await jsonRequest("/api/cases", {
        method: "POST",
        body: JSON.stringify({
          patientAlias: "synthetic-patient-artifact-persist-001",
          studyUid: "1.2.840.artifact.persist.1",
          sequenceInventory: ["T1w", "FLAIR"],
          studyContext: {
            studyInstanceUid: "2.25.artifact.persist.1",
            accessionNumber: "ACC-ART-001",
            studyDate: "2026-03-28",
            sourceArchive: "pacs-demo",
            dicomWebBaseUrl: "https://dicom.example.test/studies/2.25.artifact.persist.1",
            metadataSummary: ["Artifact payload persistence demo"],
            series: [
              {
                seriesInstanceUid: "2.25.artifact.persist.1.1",
                seriesDescription: "Sag T1 MPRAGE",
                modality: "MR",
                sequenceLabel: "T1w",
                instanceCount: 176,
              },
            ],
          },
        }),
      });

      assert.equal(created.response.status, 201);
      caseId = created.body.case.caseId as string;

      const inferred = await jsonRequest("/api/internal/inference-callback", {
        method: "POST",
        body: JSON.stringify({
          caseId,
          qcDisposition: "pass",
          findings: ["Persisted artifact payload verification."],
          measurements: [{ label: "brain_volume_ml", value: 1108 }],
          artifacts: ["artifact://overlay-preview", "artifact://qc-summary"],
          artifactPayloads: [
            {
              artifactRef: "artifact://overlay-preview",
              contentType: "image/png",
              contentBase64: Buffer.from("PNG-DEMO-ARTIFACT", "utf-8").toString("base64"),
            },
            {
              artifactRef: "artifact://qc-summary",
              contentType: "application/json",
              contentBase64: Buffer.from(JSON.stringify({ summary: "qc-ok", checks: 1 }), "utf-8").toString("base64"),
            },
          ],
          generatedSummary: "Artifact payload draft generated.",
        }),
      });

      assert.equal(inferred.response.status, 200);
      assert.equal(inferred.body.case.status, "AWAITING_REVIEW");
    });

    await withServer(caseStoreFile, async ({ baseUrl, jsonRequest }) => {
      const detail = await jsonRequest(`/api/cases/${caseId}`);

      assert.equal(detail.response.status, 200);
      const overlayArtifact = detail.body.case.artifactManifest.find(
        (artifact: { artifactType: string }) => artifact.artifactType === "overlay-preview",
      );
      const qcArtifact = detail.body.case.artifactManifest.find(
        (artifact: { artifactType: string }) => artifact.artifactType === "qc-summary",
      );

      assert.equal(typeof overlayArtifact.retrievalUrl, "string");
      assert.equal(overlayArtifact.storageUri, overlayArtifact.retrievalUrl);
      assert.equal(typeof qcArtifact.retrievalUrl, "string");
      assert.equal(qcArtifact.storageUri, qcArtifact.retrievalUrl);

      const overlayResponse = await fetch(`${baseUrl}${overlayArtifact.retrievalUrl}`);
      assert.equal(overlayResponse.status, 200);
      assert.equal(overlayResponse.headers.get("content-type"), "image/png");
      assert.equal(Buffer.from(await overlayResponse.arrayBuffer()).toString("utf-8"), "PNG-DEMO-ARTIFACT");

      const qcResponse = await fetch(`${baseUrl}${qcArtifact.retrievalUrl}`);
      assert.equal(qcResponse.status, 200);
      assert.equal(qcResponse.headers.get("content-type"), "application/json");
      assert.deepEqual(JSON.parse(await qcResponse.text()), { summary: "qc-ok", checks: 1 });
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("postgres-backed cases retain artifact retrieval metadata after restart", async () => {
  const store = createPostgresTestStore();

  try {
    let caseId = "";

    await withPostgresServer(store, async ({ jsonRequest }) => {
      const created = await jsonRequest("/api/cases", {
        method: "POST",
        body: JSON.stringify({
          patientAlias: "synthetic-patient-artifact-postgres-001",
          studyUid: "1.2.840.artifact.postgres.1",
          sequenceInventory: ["T1w", "FLAIR"],
        }),
      });

      assert.equal(created.response.status, 201);
      caseId = created.body.case.caseId as string;

      const inferred = await jsonRequest("/api/internal/inference-callback", {
        method: "POST",
        body: JSON.stringify({
          caseId,
          qcDisposition: "pass",
          findings: ["Postgres artifact metadata verification."],
          measurements: [{ label: "brain_volume_ml", value: 1099 }],
          artifacts: ["artifact://qc-summary"],
          artifactPayloads: [
            {
              artifactRef: "artifact://qc-summary",
              contentType: "application/json",
              contentBase64: Buffer.from(JSON.stringify({ source: "postgres" }), "utf-8").toString("base64"),
            },
          ],
          generatedSummary: "Postgres artifact draft generated.",
        }),
      });

      assert.equal(inferred.response.status, 200);
      assert.equal(inferred.body.case.status, "AWAITING_REVIEW");
    });

    await withPostgresServer(store, async ({ baseUrl, jsonRequest }) => {
      const detail = await jsonRequest(`/api/cases/${caseId}`);
      assert.equal(detail.response.status, 200);

      const artifact = detail.body.case.artifactManifest[0];
      assert.equal(typeof artifact.retrievalUrl, "string");
      assert.equal(artifact.storageUri, artifact.retrievalUrl);

      const artifactResponse = await fetch(`${baseUrl}${artifact.retrievalUrl}`);
      assert.equal(artifactResponse.status, 200);
      assert.equal(artifactResponse.headers.get("content-type"), "application/json");
      assert.deepEqual(JSON.parse(await artifactResponse.text()), { source: "postgres" });
    });
  } finally {
    rmSync(store.tempDir, { recursive: true, force: true });
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

test("internal routes stay open when no bearer token is configured", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(caseStoreFile, async ({ jsonRequest }) => {
      const created = await jsonRequest("/api/internal/ingest", {
        method: "POST",
        body: JSON.stringify({
          patientAlias: "synthetic-patient-auth-open-001",
          studyUid: "1.2.840.auth.open.1",
          sequenceInventory: ["T1w", "FLAIR"],
        }),
      });

      assert.equal(created.response.status, 201);
      assert.equal(created.body.case.status, "SUBMITTED");
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("internal routes require a bearer token when configured", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(
      caseStoreFile,
      async ({ jsonRequest }) => {
        const created = await jsonRequest("/api/internal/ingest", {
          method: "POST",
          body: JSON.stringify({
            patientAlias: "synthetic-patient-auth-001",
            studyUid: "1.2.840.auth.1",
            sequenceInventory: ["T1w", "FLAIR"],
          }),
        });

        assert.equal(created.response.status, 401);
        assert.equal(created.body.code, "UNAUTHORIZED");
        assert.equal(created.body.error, "Internal API bearer token is missing or invalid");
        assert.equal(created.response.headers.get("x-request-id"), created.body.requestId);
      },
      {
        internalApiToken: "internal-token-001",
      },
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("internal routes reject an invalid bearer token", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(
      caseStoreFile,
      async ({ jsonRequest }) => {
        const created = await jsonRequest("/api/internal/ingest", {
          method: "POST",
          headers: {
            authorization: "Bearer wrong-token",
          },
          body: JSON.stringify({
            patientAlias: "synthetic-patient-auth-002",
            studyUid: "1.2.840.auth.2",
            sequenceInventory: ["T1w", "FLAIR"],
          }),
        });

        assert.equal(created.response.status, 401);
        assert.equal(created.body.code, "UNAUTHORIZED");
        assert.equal(created.body.error, "Internal API bearer token is missing or invalid");
        assert.equal(created.response.headers.get("x-request-id"), created.body.requestId);
      },
      {
        internalApiToken: "internal-token-002",
      },
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("internal routes accept a valid bearer token and public routes stay open", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(
      caseStoreFile,
      async ({ jsonRequest }) => {
        const publicCreated = await jsonRequest("/api/cases", {
          method: "POST",
          body: JSON.stringify({
            patientAlias: "synthetic-patient-public-001",
            studyUid: "1.2.840.public.1",
            sequenceInventory: ["T1w", "FLAIR"],
          }),
        });

        assert.equal(publicCreated.response.status, 201);

        const internalCreated = await jsonRequest("/api/internal/ingest", {
          method: "POST",
          headers: {
            authorization: "Bearer internal-token-003",
          },
          body: JSON.stringify({
            patientAlias: "synthetic-patient-auth-003",
            studyUid: "1.2.840.auth.3",
            sequenceInventory: ["T1w", "FLAIR"],
          }),
        });

        assert.equal(internalCreated.response.status, 201);
        assert.equal(internalCreated.body.case.status, "SUBMITTED");
      },
      {
        internalApiToken: "internal-token-003",
      },
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("dispatch routes require HMAC headers when a secret is configured", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(
      caseStoreFile,
      async ({ jsonRequest }) => {
        const created = await jsonRequest("/api/cases", {
          method: "POST",
          body: JSON.stringify({
            patientAlias: "synthetic-patient-dispatch-auth-001",
            studyUid: "1.2.840.dispatch.auth.1",
            sequenceInventory: ["T1w", "FLAIR"],
          }),
        });

        assert.equal(created.response.status, 201);

        const claim = await jsonRequest("/api/internal/dispatch/claim", {
          method: "POST",
          headers: {
            authorization: `Bearer ${DEFAULT_INTERNAL_API_TOKEN}`,
          },
          body: JSON.stringify({
            workerId: "dispatch-worker-missing-hmac",
          }),
        });

        assert.equal(claim.response.status, 401);
        assert.equal(claim.body.code, "HMAC_VERIFICATION_FAILED");
        assert.match(claim.body.error, /X-MRI-Timestamp, X-MRI-Nonce, and X-MRI-Signature headers are required/);
        assert.equal(claim.response.headers.get("x-request-id"), claim.body.requestId);
      },
      {
        internalApiToken: DEFAULT_INTERNAL_API_TOKEN,
        hmacSecret: DEFAULT_HMAC_SECRET,
      },
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("dispatch routes reject replayed nonce", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(
      caseStoreFile,
      async ({ baseUrl }) => {
        // Create a case so dispatch/claim has work to do
        const created = await fetch(`${baseUrl}/api/cases`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            patientAlias: "synthetic-patient-replay-001",
            studyUid: "1.2.840.replay.1",
            sequenceInventory: ["T1w", "FLAIR"],
          }),
        });
        assert.equal(created.status, 201);

        const fixedNonce = "replay-nonce-unique-001";
        const claimPath = "/api/internal/dispatch/claim";

        // First request with this nonce should succeed (200 or empty dispatch)
        const first = await signedJsonRequest(baseUrl, claimPath, {
          body: { workerId: "replay-worker-001" },
          nonce: fixedNonce,
        });
        assert.notEqual(first.response.status, 401, "First request should not be rejected");

        // Replay the same nonce — must be rejected
        const replay = await signedJsonRequest(baseUrl, claimPath, {
          body: { workerId: "replay-worker-001" },
          nonce: fixedNonce,
        });
        assert.equal(replay.response.status, 401, "Replayed nonce must be rejected");
        assert.equal(replay.body.code, "HMAC_VERIFICATION_FAILED");
        assert.match(replay.body.error, /Nonce already consumed/);
      },
      {
        internalApiToken: DEFAULT_INTERNAL_API_TOKEN,
        hmacSecret: DEFAULT_HMAC_SECRET,
      },
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("review workbench shell is served with real static assets", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(caseStoreFile, async ({ textRequest }) => {
      const page = await textRequest("/workbench");
      assert.equal(page.response.status, 200);
      assert.match(page.response.headers.get("content-type") ?? "", /text\/html/);
      assert.match(page.body, /MRI Review Workbench/);
      assert.match(page.body, /\/workbench\/review-workbench\.css/);
      assert.match(page.body, /\/workbench\/review-workbench\.js/);

      const script = await textRequest("/workbench/review-workbench.js");
      assert.equal(script.response.status, 200);
      assert.match(script.response.headers.get("content-type") ?? "", /javascript/);
      assert.match(script.body, /loadCases|renderQueue|review/i);

      const stylesheet = await textRequest("/workbench/review-workbench.css");
      assert.equal(stylesheet.response.status, 200);
      assert.match(stylesheet.response.headers.get("content-type") ?? "", /text\/css/);
      assert.match(stylesheet.body, /\.workbench|--surface|font-family/i);
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("request ids are generated and echoed on probe responses", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(caseStoreFile, async ({ baseUrl }) => {
      const generatedProbe = await fetch(`${baseUrl}/healthz`);
      const generatedBody = await generatedProbe.json();

      assert.equal(generatedProbe.status, 200);
      assert.equal(typeof generatedProbe.headers.get("x-request-id"), "string");
      assert.equal(generatedProbe.headers.get("x-request-id"), generatedBody.requestId);
      assert.equal(generatedBody.status, "ok");

      const explicitRequestId = "req-readyz-0001";
      const echoedProbe = await fetch(`${baseUrl}/readyz`, {
        headers: {
          "x-request-id": explicitRequestId,
        },
      });
      const echoedBody = await echoedProbe.json();

      assert.equal(echoedProbe.status, 200);
      assert.equal(echoedProbe.headers.get("x-request-id"), explicitRequestId);
      assert.equal(echoedBody.requestId, explicitRequestId);
      assert.equal(echoedBody.status, "ready");
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("schema validation rejects empty sequence inventory before workflow logic", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(caseStoreFile, async ({ jsonRequest }) => {
      const created = await jsonRequest("/api/cases", {
        method: "POST",
        body: JSON.stringify({
          patientAlias: "synthetic-patient-validation-001",
          studyUid: "1.2.840.validation.1",
          sequenceInventory: [],
        }),
      });

      assert.equal(created.response.status, 400);
      assert.equal(created.body.code, "INVALID_INPUT");
      assert.equal(created.body.error, "sequenceInventory must not be empty");
      assert.equal(typeof created.body.requestId, "string");
      assert.equal(created.response.headers.get("x-request-id"), created.body.requestId);
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("malformed JSON returns a request-scoped invalid input response", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(caseStoreFile, async ({ baseUrl }) => {
      const response = await fetch(`${baseUrl}/api/cases`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: '{"patientAlias":"broken-json"',
      });
      const body = await response.json();

      assert.equal(response.status, 400);
      assert.equal(body.code, "INVALID_INPUT");
      assert.equal(body.error, "Malformed JSON body");
      assert.equal(typeof body.requestId, "string");
      assert.equal(response.headers.get("x-request-id"), body.requestId);
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("health and readiness probes expose live storage semantics", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(caseStoreFile, async ({ jsonRequest }) => {
      const created = await jsonRequest("/api/cases", {
        method: "POST",
        body: JSON.stringify({
          patientAlias: "synthetic-patient-probe-001",
          studyUid: "1.2.840.probe.1",
          sequenceInventory: ["T1w", "FLAIR"],
        }),
      });
      assert.equal(created.response.status, 201);

      const health = await jsonRequest("/healthz", {
        method: "GET",
      });
      assert.equal(health.response.status, 200);
      assert.equal(health.body.status, "ok");
      assert.equal(health.body.service, "mri-second-opinion");
      assert.equal(health.body.storage.mode, "sqlite");
      assert.equal(health.body.storage.persistenceMode, "snapshot");
      assert.equal(health.body.checks.caseStore, "configured");
      assert.equal(health.response.headers.get("x-request-id"), health.body.requestId);

      const ready = await jsonRequest("/readyz", {
        method: "GET",
      });
      assert.equal(ready.response.status, 200);
      assert.equal(ready.body.status, "ready");
      assert.equal(ready.body.storage.mode, "sqlite");
      assert.equal(ready.body.storage.persistenceMode, "snapshot");
      assert.equal(ready.body.summary.totalCases, 1);
      assert.equal(typeof ready.body.summary.totalDeliveryJobs, "number");
      assert.equal(typeof ready.body.summary.totalInferenceJobs, "number");
      assert.equal(ready.body.checks.caseStore, "reachable");
      assert.equal(ready.response.headers.get("x-request-id"), ready.body.requestId);
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("delivery jobs are persisted, restart-safe, and worker-claimable", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    let caseId = "";

    await withServer(caseStoreFile, async ({ jsonRequest }) => {
      const prepared = await createReviewedCase(jsonRequest);
      caseId = prepared.caseId;

      const finalized = await jsonRequest(`/api/cases/${caseId}/finalize`, {
        method: "POST",
        body: JSON.stringify({
          finalSummary: "Clinician-reviewed summary locked and queued for delivery.",
        }),
      });

      assert.equal(finalized.response.status, 200);
      assert.equal(finalized.body.case.status, "DELIVERY_PENDING");

      const jobs = await jsonRequest("/api/internal/delivery-jobs");
      assert.equal(jobs.response.status, 200);
      assert.equal(Array.isArray(jobs.body.jobs), true);
      assert.equal(jobs.body.jobs.length, 1);
      assert.equal(jobs.body.jobs[0].caseId, caseId);
      assert.equal(jobs.body.jobs[0].status, "queued");
    });

    await withServer(caseStoreFile, async ({ jsonRequest }) => {
      const jobsAfterRestart = await jsonRequest("/api/internal/delivery-jobs");
      assert.equal(jobsAfterRestart.response.status, 200);
      assert.equal(jobsAfterRestart.body.jobs.length, 1);
      assert.equal(jobsAfterRestart.body.jobs[0].caseId, caseId);
      assert.equal(jobsAfterRestart.body.jobs[0].status, "queued");

      const claim = await jsonRequest("/api/internal/delivery-jobs/claim-next", {
        method: "POST",
        body: JSON.stringify({ workerId: "delivery-worker-1" }),
      });
      assert.equal(claim.response.status, 200);
      assert.equal(claim.body.job.caseId, caseId);
      assert.equal(claim.body.job.status, "claimed");
      assert.equal(claim.body.job.workerId, "delivery-worker-1");

      const completed = await jsonRequest("/api/internal/delivery-callback", {
        method: "POST",
        body: JSON.stringify({
          caseId,
          deliveryStatus: "delivered",
          detail: "Outbound delivery worker completed the job.",
        }),
      });
      assert.equal(completed.response.status, 200);
      assert.equal(completed.body.case.status, "DELIVERED");

      const jobsAfterCompletion = await jsonRequest("/api/internal/delivery-jobs");
      assert.equal(jobsAfterCompletion.response.status, 200);
      assert.equal(jobsAfterCompletion.body.jobs.length, 1);
      assert.equal(jobsAfterCompletion.body.jobs[0].status, "delivered");
      assert.equal(jobsAfterCompletion.body.jobs[0].attemptCount, 1);
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("inference jobs are persisted, restart-safe, and worker-claimable over HTTP", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    let caseId = "";

    await withServer(caseStoreFile, async ({ jsonRequest }) => {
      const created = await jsonRequest("/api/cases", {
        method: "POST",
        body: JSON.stringify({
          patientAlias: "synthetic-patient-inference-queue",
          studyUid: "1.2.840.0.queue.inference",
          sequenceInventory: ["T1w", "FLAIR"],
        }),
      });

      assert.equal(created.response.status, 201);
      caseId = created.body.case.caseId;

      const jobs = await jsonRequest("/api/internal/inference-jobs");
      assert.equal(jobs.response.status, 200);
      assert.equal(Array.isArray(jobs.body.jobs), true);
      assert.equal(jobs.body.jobs.length, 1);
      assert.equal(jobs.body.jobs[0].caseId, caseId);
      assert.equal(jobs.body.jobs[0].status, "queued");
    });

    await withServer(caseStoreFile, async ({ jsonRequest }) => {
      const jobsAfterRestart = await jsonRequest("/api/internal/inference-jobs");
      assert.equal(jobsAfterRestart.response.status, 200);
      assert.equal(jobsAfterRestart.body.jobs.length, 1);
      assert.equal(jobsAfterRestart.body.jobs[0].caseId, caseId);
      assert.equal(jobsAfterRestart.body.jobs[0].status, "queued");

      const claim = await jsonRequest("/api/internal/inference-jobs/claim-next", {
        method: "POST",
        body: JSON.stringify({ workerId: "inference-worker-1" }),
      });
      assert.equal(claim.response.status, 200);
      assert.equal(claim.body.job.caseId, caseId);
      assert.equal(claim.body.job.status, "claimed");
      assert.equal(claim.body.job.workerId, "inference-worker-1");
      assert.equal(claim.body.execution.claim.jobId, claim.body.job.jobId);
      assert.equal(claim.body.execution.claim.caseId, caseId);
      assert.equal(claim.body.execution.claim.workerId, "inference-worker-1");
      assert.equal(claim.body.execution.caseContext.studyUid, "1.2.840.0.queue.inference");
      assert.deepEqual(claim.body.execution.caseContext.sequenceInventory, ["T1w", "FLAIR"]);
      assert.equal(claim.body.execution.studyContext.studyInstanceUid, "1.2.840.0.queue.inference");
      assert.equal(claim.body.execution.dispatchProfile.resourceClass, "light-gpu");
      assert.equal(claim.body.execution.dispatchProfile.retryTier, "standard");
      assert.equal(claim.body.execution.packageManifest.packageId, "brain-structural-fastsurfer");
      assert.deepEqual(claim.body.execution.requiredArtifacts, [
        "qc-summary",
        "metrics-json",
        "overlay-preview",
        "report-preview",
      ]);
      assert.equal(Array.isArray(claim.body.execution.persistenceTargets), true);
      assert.equal(claim.body.execution.persistenceTargets.length, 4);
      assert.equal(claim.body.execution.persistenceTargets[0].artifactType, "qc-summary");
      assert.equal(
        claim.body.execution.persistenceTargets[0].plannedStorageUri,
        `object-store://case-artifacts/${caseId}/qc-summary.json`,
      );

      const inferred = await jsonRequest("/api/internal/inference-callback", {
        method: "POST",
        body: JSON.stringify({
          caseId,
          qcDisposition: "pass",
          findings: ["Inference queue completed over HTTP."],
          measurements: [{ label: "brain_volume_ml", value: 1099 }],
          artifacts: ["artifact://qc", "artifact://report"],
          generatedSummary: "Inference queue draft over HTTP.",
        }),
      });
      assert.equal(inferred.response.status, 200);
      assert.equal(inferred.body.case.status, "AWAITING_REVIEW");

      const jobsAfterCompletion = await jsonRequest("/api/internal/inference-jobs");
      assert.equal(jobsAfterCompletion.response.status, 200);
      assert.equal(jobsAfterCompletion.body.jobs.length, 1);
      assert.equal(jobsAfterCompletion.body.jobs[0].status, "completed");
      assert.equal(jobsAfterCompletion.body.jobs[0].attemptCount, 1);
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("dispatch routes work with both bearer token and HMAC configured (dual auth)", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(
      caseStoreFile,
      async ({ baseUrl, jsonRequest }) => {
        // Create a case so dispatch/claim returns data
        const created = await jsonRequest("/api/cases", {
          method: "POST",
          body: JSON.stringify({
            patientAlias: "synthetic-patient-dual-auth-001",
            studyUid: "1.2.840.dual.auth.1",
            sequenceInventory: ["T1w", "FLAIR"],
          }),
        });
        assert.equal(created.response.status, 201);

        // Signed request with both Bearer and HMAC should succeed
        const claim = await signedJsonRequest(baseUrl, "/api/internal/dispatch/claim", {
          body: { workerId: "dual-auth-worker-001" },
        });
        assert.equal(claim.response.status, 200, "Dual-auth claim must succeed");
        assert.notEqual(claim.body.dispatch, null, "Should return a dispatch assignment");

        // Heartbeat with both auth layers should also succeed
        const heartbeat = await signedJsonRequest(baseUrl, "/api/internal/dispatch/heartbeat", {
          body: { leaseId: claim.body.dispatch.leaseId },
          nonce: "dual-auth-heartbeat-nonce-001",
        });
        assert.equal(heartbeat.response.status, 200, "Dual-auth heartbeat must succeed");

        // Bearer-only (no HMAC) on dispatch route should be rejected
        const bearerOnly = await jsonRequest("/api/internal/dispatch/claim", {
          method: "POST",
          headers: {
            authorization: `Bearer ${DEFAULT_INTERNAL_API_TOKEN}`,
          },
          body: JSON.stringify({ workerId: "bearer-only-worker-001" }),
        });
        assert.equal(bearerOnly.response.status, 401, "Bearer-only must be rejected on dispatch routes");

        // Non-dispatch internal route should work with bearer alone
        const jobs = await jsonRequest("/api/internal/inference-jobs", {
          method: "GET",
          headers: {
            authorization: `Bearer ${DEFAULT_INTERNAL_API_TOKEN}`,
          },
        });
        assert.equal(jobs.response.status, 200, "Bearer-only must work on non-dispatch internal routes");
      },
      {
        internalApiToken: DEFAULT_INTERNAL_API_TOKEN,
        hmacSecret: DEFAULT_HMAC_SECRET,
      },
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("python worker derives metadata-backed outputs from the dispatch execution contract under dual auth", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(
      caseStoreFile,
      async ({ baseUrl, jsonRequest }) => {
        const created = await jsonRequest("/api/cases", {
          method: "POST",
          body: JSON.stringify({
            patientAlias: "synthetic-python-worker-001",
            studyUid: "1.2.840.python.worker.1",
            sequenceInventory: ["T1w", "FLAIR"],
            indication: "memory complaints",
            studyContext: {
              studyInstanceUid: "2.25.python.worker.study.001",
              accessionNumber: "PY-WORKER-001",
              studyDate: "2026-03-29",
              sourceArchive: "demo-orthanc",
              dicomWebBaseUrl: "https://demo.example.test/dicom/studies/2.25.python.worker.study.001",
              metadataSummary: ["Synthetic worker study", "Two MR series available"],
              series: [
                {
                  seriesInstanceUid: "2.25.python.worker.study.001.1",
                  seriesDescription: "Sag T1",
                  modality: "MR",
                  sequenceLabel: "T1w",
                  instanceCount: 176,
                },
                {
                  seriesInstanceUid: "2.25.python.worker.study.001.2",
                  seriesDescription: "Ax FLAIR",
                  modality: "MR",
                  sequenceLabel: "FLAIR",
                  instanceCount: 34,
                },
              ],
            },
          }),
        });

        assert.equal(created.response.status, 201);
        const caseId = created.body.case.caseId as string;

        const worker = await runPythonWorker(baseUrl, {
          MRI_WORKER_ID: "python-worker-contract-001",
          MRI_INTERNAL_API_TOKEN: DEFAULT_INTERNAL_API_TOKEN,
        });

        assert.equal(worker.exitCode, 0, `${worker.stderr}\n${worker.stdout}`);
        assert.match(worker.stdout, /"leaseId"/);
        assert.match(worker.stdout, /"caseId"/);

        const detail = await jsonRequest(`/api/cases/${caseId}`);
        assert.equal(detail.response.status, 200);
        assert.equal(detail.body.case.status, "AWAITING_REVIEW");
        assert.equal(detail.body.case.qcSummary.disposition, "pass");
        assert.equal(detail.body.case.artifactManifest.length, 4);
        assert.match(detail.body.case.reportSummary.processingSummary, /Metadata-derived draft/);

        const report = await jsonRequest(`/api/cases/${caseId}/report`);
        assert.equal(report.response.status, 200);
        assert.match(report.body.report.processingSummary, /2\.25\.python\.worker\.study\.001/);
        assert.match(report.body.report.findings[0], /Metadata-derived structural triage/);
        assert.match(report.body.report.findings[1], /T1w, FLAIR/);
        assert.match(report.body.report.issues[0], /no voxel-level inference executed/i);
        assert.equal(report.body.report.artifacts.length, 4);

        const qcArtifact = detail.body.case.artifactManifest.find(
          (artifact: { artifactType: string }) => artifact.artifactType === "qc-summary",
        );
        assert.notEqual(qcArtifact, undefined);
        assert.match(qcArtifact.storageUri, new RegExp(`/api/cases/${caseId}/artifacts/`));

        const qcResponse = await fetch(`${baseUrl}${qcArtifact.storageUri}`);
        assert.equal(qcResponse.status, 200);
        assert.match(qcResponse.headers.get("content-type") ?? "", /application\/json/);
        const qcBody = await qcResponse.json();
        assert.equal(qcBody.caseId, caseId);
        assert.equal(qcBody.workerId, "python-worker-contract-001");
        assert.equal(qcBody.studyInstanceUid, "2.25.python.worker.study.001");
        assert.match(qcBody.summary, /Metadata-derived draft/);
      },
      {
        internalApiToken: DEFAULT_INTERNAL_API_TOKEN,
        hmacSecret: DEFAULT_HMAC_SECRET,
      },
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("python worker marks delivery jobs complete when stage=delivery", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(
      caseStoreFile,
      async ({ baseUrl, jsonRequest }) => {
        const prepared = await createReviewedCase(jsonRequest, {
          patientAlias: "synthetic-python-delivery-001",
          studyUid: "1.2.840.python.delivery.1",
          studyInstanceUid: "2.25.python.delivery.study.001",
          accessionNumber: "PY-DELIVERY-001",
          internalApiToken: DEFAULT_INTERNAL_API_TOKEN,
        });

        const finalized = await jsonRequest(`/api/cases/${prepared.caseId}/finalize`, {
          method: "POST",
          body: JSON.stringify({
            finalSummary: "Clinician-reviewed summary locked and queued for delivery.",
          }),
        });

        assert.equal(finalized.response.status, 200);
        assert.equal(finalized.body.case.status, "DELIVERY_PENDING");

        const worker = await runPythonWorker(baseUrl, {
          MRI_WORKER_ID: "python-worker-delivery-001",
          MRI_WORKER_STAGE: "delivery",
          MRI_INTERNAL_API_TOKEN: DEFAULT_INTERNAL_API_TOKEN,
        });

        assert.equal(worker.exitCode, 0, `${worker.stderr}\n${worker.stdout}`);

        const detail = await jsonRequest(`/api/cases/${prepared.caseId}`);
        assert.equal(detail.response.status, 200);
        assert.equal(detail.body.case.status, "DELIVERED");
        assert.equal(
          detail.body.case.operationLog.some((entry: { operationType: string }) => entry.operationType === "delivery-succeeded"),
          true,
        );

        const jobs = await jsonRequest("/api/internal/delivery-jobs", {
          method: "GET",
          headers: {
            authorization: `Bearer ${DEFAULT_INTERNAL_API_TOKEN}`,
          },
        });

        assert.equal(jobs.response.status, 200);
        const deliveryJob = jobs.body.jobs.find((job: { caseId: string }) => job.caseId === prepared.caseId);
        assert.notEqual(deliveryJob, undefined);
        assert.equal(deliveryJob.status, "delivered");
        assert.equal(deliveryJob.workerId, "python-worker-delivery-001");
      },
      {
        internalApiToken: DEFAULT_INTERNAL_API_TOKEN,
        hmacSecret: DEFAULT_HMAC_SECRET,
      },
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("dispatch claim leases survive sqlite restart and can be renewed over HTTP", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    let caseId = "";
    let jobId = "";
    let leaseId = "";
    let leaseExpiresAt = "";

    await withServer(
      caseStoreFile,
      async ({ baseUrl, jsonRequest }) => {
        const created = await jsonRequest("/api/cases", {
          method: "POST",
          body: JSON.stringify({
            patientAlias: "synthetic-patient-dispatch-sqlite-001",
            studyUid: "1.2.840.dispatch.sqlite.1",
            sequenceInventory: ["T1w", "FLAIR"],
          }),
        });

        assert.equal(created.response.status, 201);
        caseId = created.body.case.caseId as string;

        const claim = await signedJsonRequest(baseUrl, "/api/internal/dispatch/claim", {
          body: {
            workerId: "dispatch-worker-sqlite-001",
          },
        });

        assert.equal(claim.response.status, 200);
        assert.notEqual(claim.body.dispatch, null);
        assert.equal(claim.body.dispatch.caseId, caseId);
        assert.equal(claim.body.dispatch.jobId, claim.body.execution.claim.jobId);
        assert.equal(claim.body.execution.claim.workerId, "dispatch-worker-sqlite-001");
        assert.equal(claim.body.execution.workflowFamily, "brain-structural");
        assert.equal(claim.body.execution.selectedPackage, "brain-structural-fastsurfer");
        assert.equal(claim.body.execution.caseContext.studyUid, "1.2.840.dispatch.sqlite.1");
        assert.equal(claim.body.execution.dispatchProfile.resourceClass, "light-gpu");
        assert.equal(claim.body.execution.dispatchProfile.retryTier, "standard");
        assert.equal(claim.body.execution.packageManifest.packageId, "brain-structural-fastsurfer");
        assert.deepEqual(claim.body.execution.requiredArtifacts, [
          "qc-summary",
          "metrics-json",
          "overlay-preview",
          "report-preview",
        ]);
        assert.equal(claim.body.execution.persistenceTargets.length, 4);
        assert.equal(claim.body.execution.persistenceTargets[0].artifactType, "qc-summary");
        assert.equal(
          claim.body.execution.persistenceTargets[0].plannedStorageUri,
          `object-store://case-artifacts/${caseId}/qc-summary.json`,
        );
        assert.equal(typeof claim.body.dispatch.leaseId, "string");
        assert.equal(typeof claim.body.dispatch.leaseExpiresAt, "string");

        jobId = claim.body.dispatch.jobId as string;
        leaseId = claim.body.dispatch.leaseId as string;
        leaseExpiresAt = claim.body.dispatch.leaseExpiresAt as string;
      },
      {
        internalApiToken: DEFAULT_INTERNAL_API_TOKEN,
        hmacSecret: DEFAULT_HMAC_SECRET,
      },
    );

    await withServer(
      caseStoreFile,
      async ({ baseUrl }) => {
        const heartbeat = await signedJsonRequest(baseUrl, "/api/internal/dispatch/heartbeat", {
          body: {
            leaseId,
            progress: "halfway",
          },
        });

        assert.equal(heartbeat.response.status, 200);
        assert.equal(heartbeat.body.leaseId, leaseId);
        assert.equal(heartbeat.body.jobId, jobId);
        assert.equal(typeof heartbeat.body.leaseExpiresAt, "string");
        assert.equal(new Date(heartbeat.body.leaseExpiresAt).getTime() > new Date(leaseExpiresAt).getTime(), true);
      },
      {
        internalApiToken: DEFAULT_INTERNAL_API_TOKEN,
        hmacSecret: DEFAULT_HMAC_SECRET,
      },
    );

    await withServer(
      caseStoreFile,
      async ({ jsonRequest }) => {
        const detail = await jsonRequest(`/api/cases/${caseId}`);

        assert.equal(detail.response.status, 200);
        assert.equal(detail.body.case.caseId, caseId);
      },
      {
        internalApiToken: DEFAULT_INTERNAL_API_TOKEN,
        hmacSecret: DEFAULT_HMAC_SECRET,
      },
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("expired claimed inference jobs can be requeued over HTTP", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    let caseId = "";

    await withServer(caseStoreFile, async ({ jsonRequest }) => {
      const created = await jsonRequest("/api/cases", {
        method: "POST",
        body: JSON.stringify({
          patientAlias: "synthetic-patient-inference-requeue",
          studyUid: "1.2.840.0.queue.inference.requeue",
          sequenceInventory: ["T1w", "FLAIR"],
        }),
      });

      assert.equal(created.response.status, 201);
      caseId = created.body.case.caseId;

      const claim = await jsonRequest("/api/internal/inference-jobs/claim-next", {
        method: "POST",
        body: JSON.stringify({ workerId: "stale-http-worker" }),
      });
      assert.equal(claim.response.status, 200);
      assert.equal(claim.body.job.caseId, caseId);
      assert.equal(claim.body.job.status, "claimed");
    });

    await withServer(caseStoreFile, async ({ jsonRequest }) => {
      const requeue = await jsonRequest("/api/internal/inference-jobs/requeue-expired", {
        method: "POST",
        body: JSON.stringify({ maxClaimAgeMs: 0 }),
      });
      assert.equal(requeue.response.status, 200);
      assert.equal(Array.isArray(requeue.body.jobs), true);
      assert.equal(requeue.body.jobs.length, 1);
      assert.equal(requeue.body.jobs[0].caseId, caseId);
      assert.equal(requeue.body.jobs[0].status, "queued");
      assert.equal(requeue.body.jobs[0].workerId, null);

      const jobs = await jsonRequest("/api/internal/inference-jobs");
      assert.equal(jobs.response.status, 200);
      assert.equal(jobs.body.jobs.length, 1);
      assert.equal(jobs.body.jobs[0].status, "queued");

      const reclaimed = await jsonRequest("/api/internal/inference-jobs/claim-next", {
        method: "POST",
        body: JSON.stringify({ workerId: "fresh-http-worker" }),
      });
      assert.equal(reclaimed.response.status, 200);
      assert.equal(reclaimed.body.job.caseId, caseId);
      assert.equal(reclaimed.body.job.status, "claimed");
      assert.equal(reclaimed.body.job.workerId, "fresh-http-worker");
      assert.equal(reclaimed.body.job.attemptCount, 2);
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("requeue-expired defaults maxClaimAgeMs when the request body is empty", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    let caseId = "";

    await withServer(caseStoreFile, async ({ jsonRequest }) => {
      const created = await jsonRequest("/api/cases", {
        method: "POST",
        body: JSON.stringify({
          patientAlias: "synthetic-patient-inference-requeue-empty-body",
          studyUid: "1.2.840.0.queue.inference.requeue.empty",
          sequenceInventory: ["T1w", "FLAIR"],
        }),
      });

      assert.equal(created.response.status, 201);
      caseId = created.body.case.caseId;

      const claim = await jsonRequest("/api/internal/inference-jobs/claim-next", {
        method: "POST",
        body: JSON.stringify({ workerId: "stale-empty-body-worker" }),
      });
      assert.equal(claim.response.status, 200);
      assert.equal(claim.body.job.caseId, caseId);
      assert.equal(claim.body.job.status, "claimed");
    });

    await withServer(caseStoreFile, async ({ baseUrl, jsonRequest }) => {
      const requeueResponse = await fetch(`${baseUrl}/api/internal/inference-jobs/requeue-expired`, {
        method: "POST",
      });
      const requeueBody = await requeueResponse.json();

      assert.equal(requeueResponse.status, 200);
      assert.equal(Array.isArray(requeueBody.jobs), true);
      assert.equal(requeueBody.jobs.length, 1);
      assert.equal(requeueBody.jobs[0].caseId, caseId);
      assert.equal(requeueBody.jobs[0].status, "queued");

      const reclaimed = await jsonRequest("/api/internal/inference-jobs/claim-next", {
        method: "POST",
        body: JSON.stringify({ workerId: "fresh-empty-body-worker" }),
      });
      assert.equal(reclaimed.response.status, 200);
      assert.equal(reclaimed.body.job.caseId, caseId);
      assert.equal(reclaimed.body.job.status, "claimed");
      assert.equal(reclaimed.body.job.workerId, "fresh-empty-body-worker");
      assert.equal(reclaimed.body.job.attemptCount, 2);
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("postgres delivery jobs are persisted, restart-safe, and worker-claimable over HTTP", async () => {
  const store = createPostgresTestStore();

  try {
    let caseId = "";

    await withPostgresServer(store, async ({ jsonRequest }) => {
      const prepared = await createReviewedCase(jsonRequest, {
        patientAlias: "synthetic-patient-postgres-queue",
        studyUid: "1.2.840.0.queue.postgres",
        studyInstanceUid: "2.25.queue.postgres",
        accessionNumber: "ACC-QUEUE-POSTGRES",
      });
      caseId = prepared.caseId;

      const finalized = await jsonRequest(`/api/cases/${caseId}/finalize`, {
        method: "POST",
        body: JSON.stringify({
          finalSummary: "Clinician-reviewed summary locked and queued for postgres delivery.",
        }),
      });

      assert.equal(finalized.response.status, 200);
      assert.equal(finalized.body.case.status, "DELIVERY_PENDING");

      const jobs = await jsonRequest("/api/internal/delivery-jobs");
      assert.equal(jobs.response.status, 200);
      assert.equal(Array.isArray(jobs.body.jobs), true);
      assert.equal(jobs.body.jobs.length, 1);
      assert.equal(jobs.body.jobs[0].caseId, caseId);
      assert.equal(jobs.body.jobs[0].status, "queued");
    });

    await withPostgresServer(store, async ({ jsonRequest }) => {
      const jobsAfterRestart = await jsonRequest("/api/internal/delivery-jobs");
      assert.equal(jobsAfterRestart.response.status, 200);
      assert.equal(jobsAfterRestart.body.jobs.length, 1);
      assert.equal(jobsAfterRestart.body.jobs[0].caseId, caseId);
      assert.equal(jobsAfterRestart.body.jobs[0].status, "queued");

      const claim = await jsonRequest("/api/internal/delivery-jobs/claim-next", {
        method: "POST",
        body: JSON.stringify({ workerId: "delivery-worker-postgres" }),
      });
      assert.equal(claim.response.status, 200);
      assert.equal(claim.body.job.caseId, caseId);
      assert.equal(claim.body.job.status, "claimed");
      assert.equal(claim.body.job.workerId, "delivery-worker-postgres");

      const completed = await jsonRequest("/api/internal/delivery-callback", {
        method: "POST",
        body: JSON.stringify({
          caseId,
          deliveryStatus: "delivered",
          detail: "Outbound delivery worker completed the postgres job.",
        }),
      });
      assert.equal(completed.response.status, 200);
      assert.equal(completed.body.case.status, "DELIVERED");

      const jobsAfterCompletion = await jsonRequest("/api/internal/delivery-jobs");
      assert.equal(jobsAfterCompletion.response.status, 200);
      assert.equal(jobsAfterCompletion.body.jobs.length, 1);
      assert.equal(jobsAfterCompletion.body.jobs[0].status, "delivered");
      assert.equal(jobsAfterCompletion.body.jobs[0].attemptCount, 1);
    });
  } finally {
    rmSync(store.tempDir, { recursive: true, force: true });
  }
});

test("dispatch claim leases survive postgres restart and can be renewed over HTTP", async () => {
  const store = createPostgresTestStore();

  try {
    let caseId = "";
    let jobId = "";
    let leaseId = "";
    let leaseExpiresAt = "";

    await withPostgresServer(
      store,
      async ({ baseUrl, jsonRequest }) => {
        const created = await jsonRequest("/api/cases", {
          method: "POST",
          body: JSON.stringify({
            patientAlias: "synthetic-patient-dispatch-postgres-001",
            studyUid: "1.2.840.dispatch.postgres.1",
            sequenceInventory: ["T1w", "FLAIR"],
          }),
        });

        assert.equal(created.response.status, 201);
        caseId = created.body.case.caseId as string;

        const claim = await signedJsonRequest(baseUrl, "/api/internal/dispatch/claim", {
          body: {
            workerId: "dispatch-worker-postgres-001",
          },
        });

        assert.equal(claim.response.status, 200);
        assert.notEqual(claim.body.dispatch, null);
        assert.equal(claim.body.dispatch.caseId, caseId);
        assert.equal(claim.body.dispatch.jobId, claim.body.execution.claim.jobId);
        assert.equal(claim.body.execution.claim.workerId, "dispatch-worker-postgres-001");
        assert.equal(claim.body.execution.workflowFamily, "brain-structural");
        assert.equal(claim.body.execution.selectedPackage, "brain-structural-fastsurfer");
        assert.equal(claim.body.execution.caseContext.studyUid, "1.2.840.dispatch.postgres.1");
        assert.equal(claim.body.execution.dispatchProfile.resourceClass, "light-gpu");
        assert.equal(claim.body.execution.dispatchProfile.retryTier, "standard");
        assert.equal(claim.body.execution.packageManifest.packageId, "brain-structural-fastsurfer");
        assert.deepEqual(claim.body.execution.requiredArtifacts, [
          "qc-summary",
          "metrics-json",
          "overlay-preview",
          "report-preview",
        ]);
        assert.equal(claim.body.execution.persistenceTargets.length, 4);
        assert.equal(claim.body.execution.persistenceTargets[0].artifactType, "qc-summary");
        assert.equal(
          claim.body.execution.persistenceTargets[0].plannedStorageUri,
          `object-store://case-artifacts/${caseId}/qc-summary.json`,
        );
        assert.equal(typeof claim.body.dispatch.leaseId, "string");
        assert.equal(typeof claim.body.dispatch.leaseExpiresAt, "string");

        jobId = claim.body.dispatch.jobId as string;
        leaseId = claim.body.dispatch.leaseId as string;
        leaseExpiresAt = claim.body.dispatch.leaseExpiresAt as string;
      },
      {
        internalApiToken: DEFAULT_INTERNAL_API_TOKEN,
        hmacSecret: DEFAULT_HMAC_SECRET,
      },
    );

    await withPostgresServer(
      store,
      async ({ baseUrl, jsonRequest }) => {
        const heartbeat = await signedJsonRequest(baseUrl, "/api/internal/dispatch/heartbeat", {
          body: {
            leaseId,
            progress: "persisted-postgres",
          },
        });

        assert.equal(heartbeat.response.status, 200);
        assert.equal(heartbeat.body.leaseId, leaseId);
        assert.equal(heartbeat.body.jobId, jobId);
        assert.equal(typeof heartbeat.body.leaseExpiresAt, "string");
        assert.equal(new Date(heartbeat.body.leaseExpiresAt).getTime() > new Date(leaseExpiresAt).getTime(), true);

        const detail = await jsonRequest(`/api/cases/${caseId}`);
        assert.equal(detail.response.status, 200);
        assert.equal(detail.body.case.caseId, caseId);
      },
      {
        internalApiToken: DEFAULT_INTERNAL_API_TOKEN,
        hmacSecret: DEFAULT_HMAC_SECRET,
      },
    );
  } finally {
    rmSync(store.tempDir, { recursive: true, force: true });
  }
});

test("delivery callback is rejected when no active persisted job exists", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    let caseId = "";

    await withServer(caseStoreFile, async ({ jsonRequest }) => {
      const prepared = await createReviewedCase(jsonRequest, {
        patientAlias: "synthetic-patient-missing-job",
        studyUid: "1.2.840.0.queue.missing-job",
        studyInstanceUid: "2.25.queue.missing-job",
        accessionNumber: "ACC-QUEUE-MISSING-JOB",
      });
      caseId = prepared.caseId;

      const finalized = await jsonRequest(`/api/cases/${caseId}/finalize`, {
        method: "POST",
        body: JSON.stringify({
          finalSummary: "Queued for delivery before simulated queue loss.",
        }),
      });

      assert.equal(finalized.response.status, 200);
      assert.equal(finalized.body.case.status, "DELIVERY_PENDING");
    });

    const database = new DatabaseSync(caseStoreFile);
    try {
      database.prepare("DELETE FROM delivery_jobs WHERE case_id = ?").run(caseId);
    } finally {
      database.close();
    }

    await withServer(caseStoreFile, async ({ jsonRequest }) => {
      const callback = await jsonRequest("/api/internal/delivery-callback", {
        method: "POST",
        body: JSON.stringify({
          caseId,
          deliveryStatus: "delivered",
          detail: "Callback should be rejected because the persisted queue row is missing.",
        }),
      });

      assert.equal(callback.response.status, 409);
      assert.equal(callback.body.code, "DELIVERY_JOB_NOT_ACTIVE");

      const detail = await jsonRequest(`/api/cases/${caseId}`);
      assert.equal(detail.response.status, 200);
      assert.equal(detail.body.case.status, "DELIVERY_PENDING");

      const jobs = await jsonRequest("/api/internal/delivery-jobs");
      assert.equal(jobs.response.status, 200);
      assert.equal(jobs.body.jobs.length, 0);
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("stale worker claim returns null over HTTP instead of surfacing a store conflict", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(caseStoreFile, async ({ jsonRequest }) => {
      const prepared = await createReviewedCase(jsonRequest, {
        patientAlias: "synthetic-patient-http-stale-claim",
        studyUid: "1.2.840.0.queue.http-stale-claim",
        studyInstanceUid: "2.25.queue.http-stale-claim",
        accessionNumber: "ACC-QUEUE-HTTP-STALE",
      });

      const finalized = await jsonRequest(`/api/cases/${prepared.caseId}/finalize`, {
        method: "POST",
        body: JSON.stringify({
          finalSummary: "Queued for two-server stale claim verification.",
        }),
      });

      assert.equal(finalized.response.status, 200);
      assert.equal(finalized.body.case.status, "DELIVERY_PENDING");
    });

    const primary = await startServer(caseStoreFile);
    const secondary = await startServer(caseStoreFile);

    const jsonRequest = async (baseUrl: string, path: string, init?: RequestInit) => {
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
    };

    try {
      const firstClaim = await jsonRequest(primary.baseUrl, "/api/internal/delivery-jobs/claim-next", {
        method: "POST",
        body: JSON.stringify({ workerId: "http-worker-a" }),
      });
      assert.equal(firstClaim.response.status, 200);
      assert.notEqual(firstClaim.body.job, null);
      assert.equal(firstClaim.body.job.status, "claimed");
      assert.equal(firstClaim.body.job.workerId, "http-worker-a");

      const secondClaim = await jsonRequest(secondary.baseUrl, "/api/internal/delivery-jobs/claim-next", {
        method: "POST",
        body: JSON.stringify({ workerId: "http-worker-b" }),
      });
      assert.equal(secondClaim.response.status, 200);
      assert.equal(secondClaim.body.job, null);

      const jobs = await jsonRequest(secondary.baseUrl, "/api/internal/delivery-jobs");
      assert.equal(jobs.response.status, 200);
      assert.equal(jobs.body.jobs.length, 1);
      assert.equal(jobs.body.jobs[0].status, "claimed");
      assert.equal(jobs.body.jobs[0].workerId, "http-worker-a");
    } finally {
      await stopServer(primary.server, async () => {
        await primary.app.locals.caseService.close();
      });
      await stopServer(secondary.server, async () => {
        await secondary.app.locals.caseService.close();
      });
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("overlay artifacts stay non-viewer-ready when series locator data is synthetic", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(caseStoreFile, async ({ jsonRequest }) => {
      const created = await jsonRequest("/api/cases", {
        method: "POST",
        body: JSON.stringify({
          patientAlias: "synthetic-patient-viewer-gap",
          studyUid: "1.2.840.0.viewer-gap",
          sequenceInventory: ["T1w", "FLAIR"],
          studyContext: {
            studyInstanceUid: "2.25.viewer-gap",
            sourceArchive: "pacs-demo",
            dicomWebBaseUrl: "https://dicom.example.test/studies/2.25.viewer-gap",
            series: [
              {
                seriesDescription: "Sag T1 MPRAGE",
                sequenceLabel: "T1w",
              },
            ],
          },
        }),
      });

      const caseId = created.body.case.caseId as string;
      const inferred = await jsonRequest("/api/internal/inference-callback", {
        method: "POST",
        body: JSON.stringify({
          caseId,
          qcDisposition: "pass",
          findings: ["Viewer seam negative-path verification."],
          measurements: [{ label: "brain_parenchyma_ml", value: 1125 }],
          artifacts: ["artifact://overlay-preview"],
          generatedSummary: "Viewer seam negative-path draft.",
        }),
      });

      assert.equal(inferred.response.status, 200);

      const report = await jsonRequest(`/api/cases/${caseId}/report`);
      assert.equal(report.response.status, 200);
      assert.equal(report.body.report.artifacts.length, 1);
      assert.equal(report.body.report.artifacts[0].artifactType, "overlay-preview");
      assert.equal(report.body.report.artifacts[0].archiveLocator.seriesInstanceUids[0], "series-1");
      assert.equal(report.body.report.artifacts[0].viewerReady, false);
      assert.equal(report.body.report.artifacts[0].viewerDescriptor, null);
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
      assert.equal(list.body.meta.totalCases, 1);
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
      assert.equal(summary.body.summary.byStatus.DELIVERED, 1);
      assert.equal(summary.body.summary.totals.deliveryFailures, 0);
      assert.equal(Array.isArray(summary.body.summary.recentOperations), true);
      assert.equal(summary.body.summary.recentOperations.some((entry: { operationType: string; caseId: string }) => entry.caseId === caseId && entry.operationType === "delivery-succeeded"), true);

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
    const { app, server, baseUrl } = await startServer(caseStoreFile);

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
      await stopServer(server, async () => {
        await app.locals.caseService.close();
      });
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
      assert.equal(root.body.api.internal.includes("POST /api/internal/inference-jobs/claim-next"), true);
      assert.equal(root.body.api.internal.includes("POST /api/internal/inference-jobs/requeue-expired"), true);
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
      assert.equal(metricsBody.includes("mri_second_opinion_http_requests_total"), true);
      assert.equal(metricsBody.includes("mri_second_opinion_http_request_duration_seconds"), true);
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
      assert.equal(typeof list.body.meta.totalCases, "number");
      assert.equal(list.body.cases.some((entry: { caseId: string }) => entry.caseId === caseId), true);

      const detail = await jsonRequest(`/api/cases/${caseId}`);
      assert.equal(detail.response.status, 200);
      assert.equal(Array.isArray(detail.body.case.operationLog), true);
      assert.equal(Array.isArray(detail.body.case.history), true);
      assert.equal(typeof detail.body.case.planSummary.selectedPackage, "string");

      const report = await jsonRequest(`/api/cases/${caseId}/report`);
      assert.equal(report.response.status, 200);
      assert.equal(typeof report.body.report.reportSchemaVersion, "string");
      assert.equal(Array.isArray(report.body.report.findings), true);
      assert.equal(Array.isArray(report.body.report.measurements), true);
      assert.equal(typeof report.body.report.provenance.workflowVersion, "string");
      assert.equal(Array.isArray(report.body.report.artifacts), true);

      const summary = await jsonRequest("/api/operations/summary");
      assert.equal(summary.response.status, 200);
      assert.equal(typeof summary.body.summary.byStatus.DELIVERY_PENDING, "number");
      assert.equal(typeof summary.body.summary.totals.reviewRequiredCount, "number");
      assert.equal(typeof summary.body.summary.totals.deliveryFailures, "number");
      assert.equal(Array.isArray(summary.body.summary.recentOperations), true);
      assert.equal(Array.isArray(summary.body.summary.retryHistory), true);
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("deterministic synthetic demo flow covers intake through delivered state", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(caseStoreFile, async ({ jsonRequest }) => {
      const created = await jsonRequest("/api/cases", {
        method: "POST",
        body: JSON.stringify({
          patientAlias: "demo-neuro-001",
          studyUid: "2.25.demo.neuro.001",
          sequenceInventory: ["T1w", "FLAIR"],
          indication: "synthetic demo memory complaints",
          studyContext: {
            studyInstanceUid: "2.25.demo.study.001",
            accessionNumber: "DEMO-001",
            studyDate: "2026-03-27",
            sourceArchive: "demo-orthanc",
            dicomWebBaseUrl: "https://demo.example.test/dicom/studies/2.25.demo.study.001",
            metadataSummary: ["Synthetic demo study", "Two MR series available"],
            series: [
              {
                seriesInstanceUid: "2.25.demo.study.001.1",
                seriesDescription: "Sag T1 demo",
                modality: "MR",
                sequenceLabel: "T1w",
                instanceCount: 160,
              },
              {
                seriesInstanceUid: "2.25.demo.study.001.2",
                seriesDescription: "Ax FLAIR demo",
                modality: "MR",
                sequenceLabel: "FLAIR",
                instanceCount: 36,
              },
            ],
          },
        }),
      });

      assert.equal(created.response.status, 201);
      const caseId = created.body.case.caseId as string;

      const queue = await jsonRequest("/api/cases");
      assert.equal(queue.response.status, 200);
      assert.equal(queue.body.meta.totalCases, 1);
      assert.equal(queue.body.cases[0].caseId, caseId);
      assert.equal(queue.body.cases[0].status, "SUBMITTED");

      const detailBeforeInference = await jsonRequest(`/api/cases/${caseId}`);
      assert.equal(detailBeforeInference.response.status, 200);
      assert.equal(detailBeforeInference.body.case.studyContext.studyInstanceUid, "2.25.demo.study.001");
      assert.equal(detailBeforeInference.body.case.planSummary.selectedPackage, "brain-structural-fastsurfer");

      const inferred = await jsonRequest("/api/internal/inference-callback", {
        method: "POST",
        body: JSON.stringify({
          caseId,
          qcDisposition: "pass",
          findings: ["No acute structural abnormality in synthetic demo study."],
          measurements: [{ label: "whole_brain_ml", value: 1110 }],
          artifacts: ["artifact://overlay-preview", "artifact://report-preview", "artifact://qc-summary"],
          qcSummary: {
            summary: "Synthetic demo QC passed.",
            checks: [{ checkId: "coverage", status: "pass", detail: "Required sequences present." }],
          },
          generatedSummary: "Synthetic demo draft ready for clinician review.",
        }),
      });
      assert.equal(inferred.response.status, 200);
      assert.equal(inferred.body.case.status, "AWAITING_REVIEW");

      const detailAfterInference = await jsonRequest(`/api/cases/${caseId}`);
      assert.equal(detailAfterInference.body.case.reportSummary.reviewStatus, "draft");
      assert.equal(detailAfterInference.body.case.qcSummary.disposition, "pass");

      const reviewed = await jsonRequest(`/api/cases/${caseId}/review`, {
        method: "POST",
        body: JSON.stringify({
          reviewerId: "demo-clinician",
          reviewerRole: "neuroradiologist",
          finalImpression: "Synthetic demo reviewed and accepted.",
        }),
      });
      assert.equal(reviewed.response.status, 200);
      assert.equal(reviewed.body.case.status, "REVIEWED");

      const finalized = await jsonRequest(`/api/cases/${caseId}/finalize`, {
        method: "POST",
        body: JSON.stringify({ finalSummary: "Synthetic demo final summary." }),
      });
      assert.equal(finalized.response.status, 200);
      assert.equal(finalized.body.case.status, "DELIVERY_PENDING");

      const report = await jsonRequest(`/api/cases/${caseId}/report`);
      assert.equal(report.response.status, 200);
      assert.equal(report.body.report.reviewStatus, "finalized");
      assert.equal(report.body.report.artifacts.length, 3);
      assert.equal(report.body.report.artifacts[0].viewerReady, true);

      const delivered = await jsonRequest("/api/internal/delivery-callback", {
        method: "POST",
        body: JSON.stringify({
          caseId,
          deliveryStatus: "delivered",
          detail: "Synthetic demo delivery acknowledged.",
        }),
      });
      assert.equal(delivered.response.status, 200);
      assert.equal(delivered.body.case.status, "DELIVERED");

      const summary = await jsonRequest("/api/operations/summary");
      assert.equal(summary.response.status, 200);
      assert.equal(summary.body.summary.byStatus.DELIVERED, 1);
      assert.equal(summary.body.summary.recentOperations[0].caseId, caseId);
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
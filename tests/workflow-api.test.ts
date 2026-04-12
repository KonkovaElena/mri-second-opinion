import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import type { Pool } from "pg";
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

/** Repo root derived from test file location — does not depend on process.cwd(). */
const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

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

async function cleanupTempDir(tempDir: string) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      rmSync(tempDir, { recursive: true, force: true });
      return;
    } catch (error) {
      const errorCode = (error as NodeJS.ErrnoException).code;
      if (errorCode !== "EPERM" && errorCode !== "EBUSY") {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }

  rmSync(tempDir, { recursive: true, force: true });
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function withPostgresAdminPool<T>(
  store: ReturnType<typeof createPostgresTestStore>,
  run: (pool: Pool) => Promise<T>,
) {
  const pool = store.postgresPoolFactory() as Pool;

  try {
    return await run(pool);
  } finally {
    await pool.end();
  }
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
    internalApiToken: DEFAULT_INTERNAL_API_TOKEN,
    operatorApiToken: DEFAULT_OPERATOR_API_TOKEN,
    reviewerJwtSecret: DEFAULT_REVIEWER_JWT_SECRET,
    reviewerAllowedRoles: ["clinician", "radiologist", "neuroradiologist"],
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

function createTinyNifti1Buffer(
  values: number[],
  dimensions: readonly [number, number, number] = [2, 2, 2],
) {
  const [dimX, dimY, dimZ] = dimensions;
  const voxelCount = dimX * dimY * dimZ;
  assert.equal(values.length, voxelCount, "NIfTI fixture values must match the requested dimensions");

  const headerBytes = 352;
  const buffer = Buffer.alloc(headerBytes + voxelCount * 4);

  buffer.writeInt32LE(348, 0);
  buffer.writeInt16LE(3, 40);
  buffer.writeInt16LE(dimX, 42);
  buffer.writeInt16LE(dimY, 44);
  buffer.writeInt16LE(dimZ, 46);
  buffer.writeInt16LE(1, 48);
  buffer.writeInt16LE(1, 50);
  buffer.writeInt16LE(1, 52);
  buffer.writeInt16LE(1, 54);
  buffer.writeInt16LE(16, 70);
  buffer.writeInt16LE(32, 72);
  buffer.writeFloatLE(1, 76);
  buffer.writeFloatLE(1, 80);
  buffer.writeFloatLE(1, 84);
  buffer.writeFloatLE(1, 88);
  buffer.writeFloatLE(headerBytes, 108);
  buffer.write("n+1\0", 344, "ascii");

  values.forEach((value, index) => {
    buffer.writeFloatLE(value, headerBytes + index * 4);
  });

  return buffer;
}

async function withBinaryFixtureServer(
  payload: Buffer,
  callback: (downloadUrl: string) => Promise<void>,
) {
  const server = createServer((request, response) => {
    if (request.url !== "/fixtures/t1w-volume.nii") {
      response.statusCode = 404;
      response.end();
      return;
    }

    response.statusCode = 200;
    response.setHeader("content-type", "application/octet-stream");
    response.setHeader("content-length", String(payload.length));
    response.end(payload);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, resolve);
  });

  const address = server.address() as AddressInfo;

  try {
    await callback(`http://127.0.0.1:${address.port}/fixtures/t1w-volume.nii`);
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
  }
}

async function withArchiveMetadataServer(
  studyPayloads: Record<string, { statusCode?: number; body?: Record<string, unknown> }>,
  callback: (archiveBaseUrl: string) => Promise<void>,
) {
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");

    if (request.method !== "GET" || !requestUrl.pathname.startsWith("/studies/")) {
      response.statusCode = 404;
      response.end();
      return;
    }

    const studyUid = decodeURIComponent(requestUrl.pathname.slice("/studies/".length));
    const payload = studyPayloads[studyUid];

    if (!payload) {
      response.statusCode = 404;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ error: "study-not-found" }));
      return;
    }

    const statusCode = payload.statusCode ?? 200;
    const body = Buffer.from(JSON.stringify(payload.body ?? {}), "utf-8");
    response.statusCode = statusCode;
    response.setHeader("content-type", "application/json");
    response.setHeader("content-length", String(body.length));
    response.end(body);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, resolve);
  });

  const address = server.address() as AddressInfo;

  try {
    await callback(`http://127.0.0.1:${address.port}`);
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
  }
}

async function withFailingInferenceCallbackProxy(
  upstreamBaseUrl: string,
  interception: {
    statusCode: number;
    body: Record<string, unknown>;
  },
  callback: (proxyBaseUrl: string) => Promise<void>,
) {
  const server = createServer((request, response) => {
    void (async () => {
      const method = request.method ?? "GET";
      const path = request.url ?? "/";
      const chunks: Buffer[] = [];

      for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }

      if (method === "POST" && path === "/api/internal/inference-callback") {
        const body = Buffer.from(JSON.stringify(interception.body), "utf-8");
        response.statusCode = interception.statusCode;
        response.setHeader("content-type", "application/json");
        response.setHeader("content-length", String(body.length));
        response.end(body);
        return;
      }

      const forwardedHeaders = new Headers();
      for (const [name, value] of Object.entries(request.headers)) {
        if (typeof value === "undefined") {
          continue;
        }

        if (name === "host" || name === "connection" || name === "content-length") {
          continue;
        }

        if (Array.isArray(value)) {
          value.forEach((entry) => forwardedHeaders.append(name, entry));
          continue;
        }

        forwardedHeaders.set(name, value);
      }

      const upstreamResponse = await fetch(`${upstreamBaseUrl}${path}`, {
        method,
        headers: forwardedHeaders,
        body: chunks.length > 0 ? Buffer.concat(chunks) : undefined,
      });

      response.statusCode = upstreamResponse.status;
      upstreamResponse.headers.forEach((value, name) => {
        if (name === "connection" || name === "transfer-encoding") {
          return;
        }

        response.setHeader(name, value);
      });

      response.end(Buffer.from(await upstreamResponse.arrayBuffer()));
    })().catch((error: unknown) => {
      response.statusCode = 500;
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : "proxy-request-failed",
        }),
      );
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, resolve);
  });

  const address = server.address() as AddressInfo;

  try {
    await callback(`http://127.0.0.1:${address.port}`);
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
  }
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
      internalApiToken: DEFAULT_INTERNAL_API_TOKEN,
      operatorApiToken: DEFAULT_OPERATOR_API_TOKEN,
      reviewerJwtSecret: DEFAULT_REVIEWER_JWT_SECRET,
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
  const { app, server, baseUrl } = await startServer(caseStoreFile, {
    operatorApiToken: DEFAULT_OPERATOR_API_TOKEN,
    ...configOverrides,
  });

  try {
    return await run({
      baseUrl,
      jsonRequest: async (path: string, init?: RequestInit) => {
        const response = await fetch(`${baseUrl}${path}`, {
          ...init,
          headers: withImplicitAuth(path, {
            "content-type": "application/json",
            ...(init?.headers ?? {}),
          }),
        });
        const bodyText = await response.text();
        const body = bodyText.length > 0 ? JSON.parse(bodyText) : null;
        return { response, body };
      },
      textRequest: async (path: string, init?: RequestInit) => {
        const response = await fetch(`${baseUrl}${path}`, {
          ...init,
          headers: withImplicitAuth(path, {
            ...(init?.headers ?? {}),
          }),
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
  const { app, server, baseUrl } = await startPostgresServer(store, {
    operatorApiToken: DEFAULT_OPERATOR_API_TOKEN,
    ...configOverrides,
  });

  try {
    return await run({
      baseUrl,
      jsonRequest: async (path: string, init?: RequestInit) => {
        const response = await fetch(`${baseUrl}${path}`, {
          ...init,
          headers: withImplicitAuth(path, {
            "content-type": "application/json",
            ...(init?.headers ?? {}),
          }),
        });
        const bodyText = await response.text();
        const body = bodyText.length > 0 ? JSON.parse(bodyText) : null;
        return { response, body };
      },
      textRequest: async (path: string, init?: RequestInit) => {
        const response = await fetch(`${baseUrl}${path}`, {
          ...init,
          headers: withImplicitAuth(path, {
            ...(init?.headers ?? {}),
          }),
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
const DEFAULT_REVIEWER_JWT_SECRET = "reviewer-jwt-secret-0123456789abcdef";
const DEFAULT_OPERATOR_API_TOKEN = "test-operator-token-secret-001";

type PythonLaunch = {
  command: string;
  args: string[];
};

let cachedPythonLaunch: PythonLaunch | null = null;

function isReviewerProtectedPath(path: string) {
  return /\/api\/cases\/[^/]+\/(review|finalize)$/.test(path);
}

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

  if (isReviewerProtectedPath(path) && !normalizedHeaders.has("authorization")) {
    const reviewerHeaders = createReviewerAuthHeaders("implicit-test-reviewer", "neuroradiologist");
    for (const [name, value] of Object.entries(reviewerHeaders)) {
      normalizedHeaders.set(name, value);
    }
  }

  return normalizedHeaders;
}

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
    const child = spawn(python.command, [...python.args, join(REPO_ROOT, "worker", "main.py")], {
      cwd: REPO_ROOT,
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
        }),
      });

      assert.equal(finalized.response.status, 200);
      assert.equal(finalized.body.case.status, "DELIVERY_PENDING");

      const deliveryClaim = await jsonRequest("/api/internal/delivery-jobs/claim-next", {
        method: "POST",
        body: JSON.stringify({ workerId: "delivery-test-worker" }),
      });

      assert.equal(deliveryClaim.response.status, 200);
      assert.equal(deliveryClaim.body.job.caseId, caseId);

      const failedDelivery = await jsonRequest("/api/internal/delivery-callback", {
        method: "POST",
        body: JSON.stringify({
          caseId,
          deliveryStatus: "failed",
          detail: "Simulated outbound delivery failure recorded by delivery callback.",
        }),
      });

      assert.equal(failedDelivery.response.status, 200);
      assert.equal(failedDelivery.body.case.status, "DELIVERY_FAILED");

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
    await cleanupTempDir(tempDir);
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

      const overlayResponse = await fetch(`${baseUrl}${overlayArtifact.retrievalUrl}`, {
        headers: { "x-api-key": DEFAULT_OPERATOR_API_TOKEN },
      });
      assert.equal(overlayResponse.status, 200);
      assert.equal(overlayResponse.headers.get("content-type"), "image/png");
      assert.equal(Buffer.from(await overlayResponse.arrayBuffer()).toString("utf-8"), "PNG-DEMO-ARTIFACT");

      const qcResponse = await fetch(`${baseUrl}${qcArtifact.retrievalUrl}`, {
        headers: { "x-api-key": DEFAULT_OPERATOR_API_TOKEN },
      });
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

      const artifactResponse = await fetch(`${baseUrl}${artifact.retrievalUrl}`, {
        headers: { "x-api-key": DEFAULT_OPERATOR_API_TOKEN },
      });
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
          headers: { "content-type": "application/json", "x-api-key": DEFAULT_OPERATOR_API_TOKEN },
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
      assert.match(page.body, /Viewer Path/i);
      assert.match(page.body, /\/workbench\/review-workbench\.css/);
      assert.match(page.body, /\/workbench\/review-workbench\.js/);

      const script = await textRequest("/workbench/review-workbench.js");
      assert.equal(script.response.status, 200);
      assert.match(script.response.headers.get("content-type") ?? "", /javascript/);
      assert.match(script.body, /loadCases|renderQueue|review/i);
      assert.match(script.body, /viewerPath|archiveStudyUrl|panel=viewer/i);

      const stylesheet = await textRequest("/workbench/review-workbench.css");
      assert.equal(stylesheet.response.status, 200);
      assert.match(stylesheet.response.headers.get("content-type") ?? "", /text\/css/);
      assert.match(stylesheet.body, /\.workbench|--surface|font-family/i);
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("case intake enriches missing study context from archive lookup and exposes viewer path", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withArchiveMetadataServer(
      {
        "1.2.840.lookup.1": {
          body: {
            studyInstanceUid: "2.25.lookup.1",
            accessionNumber: "ACC-LOOKUP-001",
            studyDate: "2026-03-30",
            sourceArchive: "lookup-orthanc",
            dicomWebBaseUrl: "https://archive.example.test/dicom-web/studies/2.25.lookup.1",
            metadataSummary: ["Lookup hydrated study", "Archive returned two MR series"],
            series: [
              {
                seriesInstanceUid: "2.25.lookup.1.1",
                seriesDescription: "Sag T1 archive",
                modality: "MR",
                sequenceLabel: "T1w",
                instanceCount: 180,
              },
              {
                seriesInstanceUid: "2.25.lookup.1.2",
                seriesDescription: "Ax FLAIR archive",
                modality: "MR",
                sequenceLabel: "FLAIR",
                instanceCount: 42,
              },
            ],
          },
        },
      },
      async (archiveBaseUrl) => {
        await withServer(
          caseStoreFile,
          async ({ jsonRequest }) => {
            const created = await jsonRequest("/api/cases", {
              method: "POST",
              body: JSON.stringify({
                patientAlias: "archive-lookup-patient",
                studyUid: "1.2.840.lookup.1",
                sequenceInventory: ["T1w", "FLAIR"],
              }),
            });

            assert.equal(created.response.status, 201);
            const caseId = created.body.case.caseId as string;

            const detailBeforeInference = await jsonRequest(`/api/cases/${caseId}`);
            assert.equal(detailBeforeInference.response.status, 200);
            assert.equal(detailBeforeInference.body.case.studyContext.studyInstanceUid, "2.25.lookup.1");
            assert.equal(detailBeforeInference.body.case.studyContext.sourceArchive, "lookup-orthanc");
            assert.equal(detailBeforeInference.body.case.studyContext.series.length, 2);

            const inferred = await jsonRequest("/api/internal/inference-callback", {
              method: "POST",
              body: JSON.stringify({
                caseId,
                qcDisposition: "pass",
                findings: ["Archive-enriched intake produced a viewer-ready overlay artifact."],
                measurements: [{ label: "whole_brain_ml", value: 1108 }],
                artifacts: ["artifact://overlay-preview", "artifact://report-preview"],
                generatedSummary: "Archive-enriched draft ready for review.",
              }),
            });

            assert.equal(inferred.response.status, 200);

            const report = await jsonRequest(`/api/cases/${caseId}/report`);
            assert.equal(report.response.status, 200);
            const overlayArtifact = report.body.report.artifacts.find(
              (artifact: { artifactType: string }) => artifact.artifactType === "overlay-preview",
            );
            assert.notEqual(overlayArtifact, undefined);
            assert.equal(overlayArtifact.viewerReady, true);
            assert.equal(
              overlayArtifact.viewerPath,
              `/workbench?caseId=${caseId}&panel=viewer&artifactId=${overlayArtifact.artifactId}`,
            );
            assert.equal(
              overlayArtifact.archiveStudyUrl,
              "https://archive.example.test/dicom-web/studies/2.25.lookup.1",
            );
          },
          {
            archiveLookupBaseUrl: archiveBaseUrl,
            archiveLookupSource: "lookup-fallback-source",
          },
        );
      },
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("case intake falls back cleanly when archive lookup cannot resolve the study", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withArchiveMetadataServer({}, async (archiveBaseUrl) => {
      await withServer(
        caseStoreFile,
        async ({ jsonRequest }) => {
          const created = await jsonRequest("/api/cases", {
            method: "POST",
            body: JSON.stringify({
              patientAlias: "archive-fallback-patient",
              studyUid: "1.2.840.lookup.missing",
              sequenceInventory: ["T1w", "FLAIR"],
            }),
          });

          assert.equal(created.response.status, 201);
          const caseId = created.body.case.caseId as string;

          const inferred = await jsonRequest("/api/internal/inference-callback", {
            method: "POST",
            body: JSON.stringify({
              caseId,
              qcDisposition: "pass",
              findings: ["Archive lookup fallback preserved case creation."],
              measurements: [{ label: "whole_brain_ml", value: 1099 }],
              artifacts: ["artifact://overlay-preview"],
              generatedSummary: "Archive fallback draft ready for review.",
            }),
          });

          assert.equal(inferred.response.status, 200);

          const detail = await jsonRequest(`/api/cases/${caseId}`);
          assert.equal(detail.response.status, 200);
          assert.equal(detail.body.case.studyContext.studyInstanceUid, "1.2.840.lookup.missing");

          const report = await jsonRequest(`/api/cases/${caseId}/report`);
          assert.equal(report.response.status, 200);
          assert.equal(report.body.report.artifacts.length, 1);
          assert.equal(report.body.report.artifacts[0].viewerReady, false);
          assert.equal(report.body.report.artifacts[0].viewerPath, null);
          assert.equal(report.body.report.artifacts[0].archiveStudyUrl, null);
        },
        {
          archiveLookupBaseUrl: archiveBaseUrl,
          archiveLookupSource: "lookup-fallback-source",
        },
      );
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
          "x-api-key": DEFAULT_OPERATOR_API_TOKEN,
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
        assert.deepEqual(detail.body.case.structuralExecution.executionContext, {
          computeMode: "metadata-fallback",
          fallbackCode: "missing-volume-input",
          fallbackDetail: "No volumeDownloadUrl was present in the execution contract.",
          sourceSeriesInstanceUid: null,
        });
        assert.match(detail.body.case.reportSummary.processingSummary, /Metadata-derived draft/);

        const report = await jsonRequest(`/api/cases/${caseId}/report`);
        assert.equal(report.response.status, 200);
        assert.match(report.body.report.processingSummary, /2\.25\.python\.worker\.study\.001/);
        assert.deepEqual(report.body.report.executionContext, {
          computeMode: "metadata-fallback",
          fallbackCode: "missing-volume-input",
          fallbackDetail: "No volumeDownloadUrl was present in the execution contract.",
          sourceSeriesInstanceUid: null,
        });
        assert.match(report.body.report.findings[0], /Metadata-derived structural triage/);
        assert.match(report.body.report.findings[1], /T1w, FLAIR/);
        assert.match(report.body.report.issues[0], /no voxel-level inference executed/i);
        assert.equal(report.body.report.artifacts.length, 4);

        const qcArtifact = detail.body.case.artifactManifest.find(
          (artifact: { artifactType: string }) => artifact.artifactType === "qc-summary",
        );
        assert.notEqual(qcArtifact, undefined);
        assert.match(qcArtifact.storageUri, new RegExp(`/api/cases/${caseId}/artifacts/`));

        const qcResponse = await fetch(`${baseUrl}${qcArtifact.storageUri}`, {
          headers: { "x-api-key": DEFAULT_OPERATOR_API_TOKEN },
        });
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

test("python worker performs a voxel-backed pass when a T1w volume URL is present", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();
  const niftiFixture = createTinyNifti1Buffer([0, 0, 1, 2, 3, 4, 5, 6]);

  try {
    await withBinaryFixtureServer(niftiFixture, async (volumeDownloadUrl) => {
      const allowedOrigin = new URL(volumeDownloadUrl).origin;

      await withServer(
        caseStoreFile,
        async ({ baseUrl, jsonRequest }) => {
          const created = await jsonRequest("/api/cases", {
            method: "POST",
            body: JSON.stringify({
              patientAlias: "synthetic-python-worker-volume-001",
              studyUid: "1.2.840.python.worker.volume.1",
              sequenceInventory: ["T1w"],
              indication: "real-volume structural review",
              studyContext: {
                studyInstanceUid: "2.25.python.worker.volume.study.001",
                accessionNumber: "PY-WORKER-VOLUME-001",
                studyDate: "2026-03-29",
                sourceArchive: "fixture-http",
                metadataSummary: ["Tiny NIfTI fixture for Wave 2B"],
                series: [
                  {
                    seriesInstanceUid: "2.25.python.worker.volume.study.001.1",
                    seriesDescription: "Fixture T1w",
                    modality: "MR",
                    sequenceLabel: "T1w",
                    instanceCount: 1,
                    volumeDownloadUrl,
                  },
                ],
              },
            }),
          });

          assert.equal(created.response.status, 201);
          const caseId = created.body.case.caseId as string;

          const worker = await runPythonWorker(baseUrl, {
            MRI_WORKER_ID: "python-worker-volume-001",
            MRI_INTERNAL_API_TOKEN: DEFAULT_INTERNAL_API_TOKEN,
            MRI_WORKER_ALLOWED_VOLUME_ORIGINS: allowedOrigin,
          });

          assert.equal(worker.exitCode, 0, `${worker.stderr}\n${worker.stdout}`);

          const detail = await jsonRequest(`/api/cases/${caseId}`);
          assert.equal(detail.response.status, 200);
          assert.equal(detail.body.case.status, "AWAITING_REVIEW");
          assert.equal(detail.body.case.qcSummary.disposition, "pass");
          assert.equal(detail.body.case.artifactManifest.length, 4);
          assert.deepEqual(detail.body.case.structuralExecution.executionContext, {
            computeMode: "voxel-backed",
            fallbackCode: null,
            fallbackDetail: null,
            sourceSeriesInstanceUid: "2.25.python.worker.volume.study.001.1",
          });
          assert.match(detail.body.case.reportSummary.processingSummary, /voxel-backed/i);

          const report = await jsonRequest(`/api/cases/${caseId}/report`);
          assert.equal(report.response.status, 200);
          assert.match(report.body.report.processingSummary, /voxel-backed/i);
          assert.deepEqual(report.body.report.executionContext, {
            computeMode: "voxel-backed",
            fallbackCode: null,
            fallbackDetail: null,
            sourceSeriesInstanceUid: "2.25.python.worker.volume.study.001.1",
          });
          assert.equal(
            report.body.report.issues.some((issue: string) => /no voxel-level inference executed/i.test(issue)),
            false,
          );
          assert.equal(
            report.body.report.measurements.some(
              (measurement: { label: string }) => measurement.label === "volume_voxel_count",
            ),
            true,
          );

          const overlayArtifact = detail.body.case.artifactManifest.find(
            (artifact: { artifactType: string }) => artifact.artifactType === "overlay-preview",
          );
          assert.notEqual(overlayArtifact, undefined);

          const overlayResponse = await fetch(`${baseUrl}${overlayArtifact.storageUri}`, {
            headers: { "x-api-key": DEFAULT_OPERATOR_API_TOKEN },
          });
          assert.equal(overlayResponse.status, 200);
          assert.match(overlayResponse.headers.get("content-type") ?? "", /image\/svg\+xml/);
          assert.match(await overlayResponse.text(), /<svg/i);
        },
        {
          internalApiToken: DEFAULT_INTERNAL_API_TOKEN,
          hmacSecret: DEFAULT_HMAC_SECRET,
        },
      );
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("python worker records classified fallback metadata when a volume URL cannot be parsed", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();
  const invalidFixture = Buffer.from("not-a-valid-nifti", "utf-8");

  try {
    await withBinaryFixtureServer(invalidFixture, async (volumeDownloadUrl) => {
      const allowedOrigin = new URL(volumeDownloadUrl).origin;

      await withServer(
        caseStoreFile,
        async ({ baseUrl, jsonRequest }) => {
          const created = await jsonRequest("/api/cases", {
            method: "POST",
            body: JSON.stringify({
              patientAlias: "synthetic-python-worker-fallback-001",
              studyUid: "1.2.840.python.worker.fallback.1",
              sequenceInventory: ["T1w"],
              indication: "fallback classification review",
              studyContext: {
                studyInstanceUid: "2.25.python.worker.fallback.study.001",
                accessionNumber: "PY-WORKER-FALLBACK-001",
                studyDate: "2026-03-29",
                sourceArchive: "fixture-http",
                metadataSummary: ["Invalid NIfTI fixture for fallback classification"],
                series: [
                  {
                    seriesInstanceUid: "2.25.python.worker.fallback.study.001.1",
                    seriesDescription: "Broken Fixture T1w",
                    modality: "MR",
                    sequenceLabel: "T1w",
                    instanceCount: 1,
                    volumeDownloadUrl,
                  },
                ],
              },
            }),
          });

          assert.equal(created.response.status, 201);
          const caseId = created.body.case.caseId as string;

          const worker = await runPythonWorker(baseUrl, {
            MRI_WORKER_ID: "python-worker-fallback-001",
            MRI_INTERNAL_API_TOKEN: DEFAULT_INTERNAL_API_TOKEN,
            MRI_WORKER_ALLOWED_VOLUME_ORIGINS: allowedOrigin,
          });

          assert.equal(worker.exitCode, 0, `${worker.stderr}\n${worker.stdout}`);

          const detail = await jsonRequest(`/api/cases/${caseId}`);
          assert.equal(detail.response.status, 200);
          assert.deepEqual(detail.body.case.structuralExecution.executionContext, {
            computeMode: "metadata-fallback",
            fallbackCode: "volume-parse-failed",
            fallbackDetail: "Downloaded NIfTI payload is too small to contain a valid header.",
            sourceSeriesInstanceUid: "2.25.python.worker.fallback.study.001.1",
          });
          assert.match(detail.body.case.reportSummary.processingSummary, /Metadata-derived draft/);

          const report = await jsonRequest(`/api/cases/${caseId}/report`);
          assert.equal(report.response.status, 200);
          assert.deepEqual(report.body.report.executionContext, {
            computeMode: "metadata-fallback",
            fallbackCode: "volume-parse-failed",
            fallbackDetail: "Downloaded NIfTI payload is too small to contain a valid header.",
            sourceSeriesInstanceUid: "2.25.python.worker.fallback.study.001.1",
          });
          assert.equal(
            report.body.report.issues.some((issue: string) => /fell back to metadata-only mode/i.test(issue)),
            true,
          );
        },
        {
          internalApiToken: DEFAULT_INTERNAL_API_TOKEN,
          hmacSecret: DEFAULT_HMAC_SECRET,
        },
      );
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("python worker blocks non-same-origin loopback volume URLs unless the origin is explicitly allowlisted", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();
  const niftiFixture = createTinyNifti1Buffer([0, 0, 1, 2, 3, 4, 5, 6]);

  try {
    await withBinaryFixtureServer(niftiFixture, async (volumeDownloadUrl) => {
      await withServer(
        caseStoreFile,
        async ({ baseUrl, jsonRequest }) => {
          const created = await jsonRequest("/api/cases", {
            method: "POST",
            body: JSON.stringify({
              patientAlias: "synthetic-python-worker-loopback-guard-001",
              studyUid: "1.2.840.python.worker.loopback.guard.1",
              sequenceInventory: ["T1w"],
              indication: "loopback allowlist review",
              studyContext: {
                studyInstanceUid: "2.25.python.worker.loopback.guard.study.001",
                accessionNumber: "PY-WORKER-LOOPBACK-GUARD-001",
                studyDate: "2026-04-07",
                sourceArchive: "fixture-http",
                metadataSummary: ["Loopback absolute URL now requires explicit allowlisting"],
                series: [
                  {
                    seriesInstanceUid: "2.25.python.worker.loopback.guard.study.001.1",
                    seriesDescription: "Loopback Fixture T1w",
                    modality: "MR",
                    sequenceLabel: "T1w",
                    instanceCount: 1,
                    volumeDownloadUrl,
                  },
                ],
              },
            }),
          });

          assert.equal(created.response.status, 201);
          const caseId = created.body.case.caseId as string;

          const worker = await runPythonWorker(baseUrl, {
            MRI_WORKER_ID: "python-worker-loopback-guard-001",
            MRI_INTERNAL_API_TOKEN: DEFAULT_INTERNAL_API_TOKEN,
          });

          assert.equal(worker.exitCode, 0, `${worker.stderr}\n${worker.stdout}`);

          const detail = await jsonRequest(`/api/cases/${caseId}`);
          assert.equal(detail.response.status, 200);
          assert.deepEqual(detail.body.case.structuralExecution.executionContext, {
            computeMode: "metadata-fallback",
            fallbackCode: "volume-download-failed",
            fallbackDetail: "Volume download URL origin is not permitted for worker fetch.",
            sourceSeriesInstanceUid: "2.25.python.worker.loopback.guard.study.001.1",
          });
          assert.match(detail.body.case.reportSummary.processingSummary, /Metadata-derived draft/);
        },
        {
          internalApiToken: DEFAULT_INTERNAL_API_TOKEN,
          hmacSecret: DEFAULT_HMAC_SECRET,
        },
      );
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("python worker falls back without fetching when volume URL origin is not allowed", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(
      caseStoreFile,
      async ({ baseUrl, jsonRequest }) => {
        const created = await jsonRequest("/api/cases", {
          method: "POST",
          body: JSON.stringify({
            patientAlias: "synthetic-python-worker-origin-guard-001",
            studyUid: "1.2.840.python.worker.origin.guard.1",
            sequenceInventory: ["T1w"],
            indication: "worker fetch guard review",
            studyContext: {
              studyInstanceUid: "2.25.python.worker.origin.guard.study.001",
              accessionNumber: "PY-WORKER-ORIGIN-GUARD-001",
              studyDate: "2026-04-03",
              sourceArchive: "external-fixture",
              metadataSummary: ["Disallowed absolute volume URL should not be fetched"],
              series: [
                {
                  seriesInstanceUid: "2.25.python.worker.origin.guard.study.001.1",
                  seriesDescription: "Blocked external T1w",
                  modality: "MR",
                  sequenceLabel: "T1w",
                  instanceCount: 1,
                  volumeDownloadUrl: "https://example.test/blocked-volume.nii",
                },
              ],
            },
          }),
        });

        assert.equal(created.response.status, 201);
        const caseId = created.body.case.caseId as string;

        const worker = await runPythonWorker(baseUrl, {
          MRI_WORKER_ID: "python-worker-origin-guard-001",
          MRI_INTERNAL_API_TOKEN: DEFAULT_INTERNAL_API_TOKEN,
        });

        assert.equal(worker.exitCode, 0, `${worker.stderr}\n${worker.stdout}`);

        const detail = await jsonRequest(`/api/cases/${caseId}`);
        assert.equal(detail.response.status, 200);
        assert.deepEqual(detail.body.case.structuralExecution.executionContext, {
          computeMode: "metadata-fallback",
          fallbackCode: "volume-download-failed",
          fallbackDetail: "Volume download URL origin is not permitted for worker fetch.",
          sourceSeriesInstanceUid: "2.25.python.worker.origin.guard.study.001.1",
        });
        assert.match(detail.body.case.reportSummary.processingSummary, /Metadata-derived draft/);

        const report = await jsonRequest(`/api/cases/${caseId}/report`);
        assert.equal(report.response.status, 200);
        assert.deepEqual(report.body.report.executionContext, {
          computeMode: "metadata-fallback",
          fallbackCode: "volume-download-failed",
          fallbackDetail: "Volume download URL origin is not permitted for worker fetch.",
          sourceSeriesInstanceUid: "2.25.python.worker.origin.guard.study.001.1",
        });
        assert.equal(
          report.body.report.issues.some((issue: string) => /origin is not permitted for worker fetch/i.test(issue)),
          true,
        );
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

test("python worker re-queues the job when inference callback returns an upstream 502", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(
      caseStoreFile,
      async ({ baseUrl, jsonRequest }) => {
        const created = await jsonRequest("/api/cases", {
          method: "POST",
          body: JSON.stringify({
            patientAlias: "synthetic-python-worker-transient-001",
            studyUid: "1.2.840.python.worker.transient.1",
            sequenceInventory: ["T1w", "FLAIR"],
            indication: "transient callback failure classification",
            studyContext: {
              studyInstanceUid: "2.25.python.worker.transient.study.001",
              accessionNumber: "PY-WORKER-TRANSIENT-001",
              studyDate: "2026-03-29",
              sourceArchive: "demo-orthanc",
              metadataSummary: ["Synthetic transient callback failure study"],
              series: [
                {
                  seriesInstanceUid: "2.25.python.worker.transient.study.001.1",
                  seriesDescription: "Sag T1",
                  modality: "MR",
                  sequenceLabel: "T1w",
                  instanceCount: 176,
                },
              ],
            },
          }),
        });

        assert.equal(created.response.status, 201);
        const caseId = created.body.case.caseId as string;

        await withFailingInferenceCallbackProxy(
          baseUrl,
          {
            statusCode: 502,
            body: {
              error: "Synthetic upstream outage.",
            },
          },
          async (proxyBaseUrl) => {
            const worker = await runPythonWorker(proxyBaseUrl, {
              MRI_WORKER_ID: "python-worker-transient-001",
              MRI_INTERNAL_API_TOKEN: DEFAULT_INTERNAL_API_TOKEN,
            });

            assert.equal(worker.exitCode, 1, `${worker.stderr}\n${worker.stdout}`);
            assert.match(worker.stderr, /"event": "inference_failure"/);
            assert.match(worker.stderr, /WORKER_HTTP_502/);
          },
        );

        const jobs = await jsonRequest("/api/internal/inference-jobs", {
          method: "GET",
          headers: {
            authorization: `Bearer ${DEFAULT_INTERNAL_API_TOKEN}`,
          },
        });

        assert.equal(jobs.response.status, 200);
        const job = jobs.body.jobs.find((entry: { caseId: string }) => entry.caseId === caseId);
        assert.notEqual(job, undefined);
        assert.equal(job.status, "queued");
        assert.equal(job.failureClass, "transient");
        assert.match(job.lastError, /WORKER_HTTP_502/);
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

test("python worker marks the job failed when inference callback returns a terminal 400", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(
      caseStoreFile,
      async ({ baseUrl, jsonRequest }) => {
        const created = await jsonRequest("/api/cases", {
          method: "POST",
          body: JSON.stringify({
            patientAlias: "synthetic-python-worker-terminal-001",
            studyUid: "1.2.840.python.worker.terminal.1",
            sequenceInventory: ["T1w", "FLAIR"],
            indication: "terminal callback failure classification",
            studyContext: {
              studyInstanceUid: "2.25.python.worker.terminal.study.001",
              accessionNumber: "PY-WORKER-TERMINAL-001",
              studyDate: "2026-03-29",
              sourceArchive: "demo-orthanc",
              metadataSummary: ["Synthetic terminal callback failure study"],
              series: [
                {
                  seriesInstanceUid: "2.25.python.worker.terminal.study.001.1",
                  seriesDescription: "Sag T1",
                  modality: "MR",
                  sequenceLabel: "T1w",
                  instanceCount: 176,
                },
              ],
            },
          }),
        });

        assert.equal(created.response.status, 201);
        const caseId = created.body.case.caseId as string;

        await withFailingInferenceCallbackProxy(
          baseUrl,
          {
            statusCode: 400,
            body: {
              code: "INVALID_CALLBACK",
              error: "Synthetic callback contract rejection.",
            },
          },
          async (proxyBaseUrl) => {
            const worker = await runPythonWorker(proxyBaseUrl, {
              MRI_WORKER_ID: "python-worker-terminal-001",
              MRI_INTERNAL_API_TOKEN: DEFAULT_INTERNAL_API_TOKEN,
            });

            assert.equal(worker.exitCode, 1, `${worker.stderr}\n${worker.stdout}`);
            assert.match(worker.stderr, /"event": "inference_failure"/);
            assert.match(worker.stderr, /WORKER_HTTP_400/);
          },
        );

        const jobs = await jsonRequest("/api/internal/inference-jobs", {
          method: "GET",
          headers: {
            authorization: `Bearer ${DEFAULT_INTERNAL_API_TOKEN}`,
          },
        });

        assert.equal(jobs.response.status, 200);
        const job = jobs.body.jobs.find((entry: { caseId: string }) => entry.caseId === caseId);
        assert.notEqual(job, undefined);
        assert.equal(job.status, "failed");
        assert.equal(job.failureClass, "terminal");
        assert.match(job.lastError, /WORKER_HTTP_400/);

        const reclaim = await signedJsonRequest(baseUrl, "/api/internal/dispatch/claim", {
          body: { workerId: "python-worker-terminal-retry-001" },
          nonce: "python-worker-terminal-retry-nonce-001",
        });

        assert.equal(reclaim.response.status, 200);
        assert.equal(reclaim.body.dispatch, null);
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
        headers: {
          authorization: `Bearer ${DEFAULT_INTERNAL_API_TOKEN}`,
        },
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

test("automatic inference lease recovery only requeues jobs after lease expiry", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    let caseId = "";
    let jobId = "";
    const { app, server, baseUrl } = await startServer(caseStoreFile, {
      inferenceLeaseRecoveryIntervalMs: 10,
      inferenceLeaseRecoveryMaxClaimAgeMs: 25,
    });

    const jsonRequest = async (path: string, init?: RequestInit) => {
      const response = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers: withImplicitAuth(path, {
          "content-type": "application/json",
          ...(init?.headers ?? {}),
        }),
      });
      const bodyText = await response.text();
      const body = bodyText.length > 0 ? JSON.parse(bodyText) : null;
      return { response, body };
    };

    try {
      const created = await jsonRequest("/api/cases", {
        method: "POST",
        body: JSON.stringify({
          patientAlias: "synthetic-patient-inference-auto-recovery",
          studyUid: "1.2.840.0.queue.inference.auto-recovery",
          sequenceInventory: ["T1w", "FLAIR"],
        }),
      });

      assert.equal(created.response.status, 201);
      caseId = created.body.case.caseId;

      const claim = await jsonRequest("/api/internal/inference-jobs/claim-next", {
        method: "POST",
        body: JSON.stringify({ workerId: "auto-recovery-worker" }),
      });
      assert.equal(claim.response.status, 200);
      assert.equal(claim.body.job.caseId, caseId);
      assert.equal(claim.body.job.status, "claimed");

      jobId = claim.body.job.jobId as string;

      await sleep(80);

      const jobsBeforeExpiry = await jsonRequest("/api/internal/inference-jobs");
      assert.equal(jobsBeforeExpiry.response.status, 200);
      assert.equal(jobsBeforeExpiry.body.jobs.length, 1);
      assert.equal(jobsBeforeExpiry.body.jobs[0].jobId, jobId);
      assert.equal(jobsBeforeExpiry.body.jobs[0].status, "claimed");
      assert.equal(jobsBeforeExpiry.body.jobs[0].workerId, "auto-recovery-worker");

      const liveRepository = (app.locals.caseService as any).repository as {
        setInferenceJob: (job: Record<string, unknown>) => void;
      };
      const currentJob = (await app.locals.caseService.listInferenceJobs()).find(
        (job: { jobId: string }) => job.jobId === jobId,
      );
      assert.notEqual(currentJob, undefined);

      liveRepository.setInferenceJob({
        ...currentJob,
        leaseExpiresAt: new Date(Date.now() - 60_000).toISOString(),
        updatedAt: new Date().toISOString(),
      });

      let requeuedJob: Record<string, unknown> | null = null;

      for (let attempt = 0; attempt < 20; attempt += 1) {
        const jobs = await jsonRequest("/api/internal/inference-jobs");
        assert.equal(jobs.response.status, 200);

        const matched = jobs.body.jobs.find((job: { jobId: string }) => job.jobId === jobId);
        if (matched?.status === "queued") {
          requeuedJob = matched;
          break;
        }

        await sleep(25);
      }

      assert.notEqual(requeuedJob, null);
      assert.equal(requeuedJob?.caseId, caseId);
      assert.equal(requeuedJob?.status, "queued");
      assert.equal(requeuedJob?.workerId, null);
      assert.equal(requeuedJob?.claimedAt, null);
      assert.match(String(requeuedJob?.lastError ?? ""), /claim expired/i);

      const reclaimed = await jsonRequest("/api/internal/inference-jobs/claim-next", {
        method: "POST",
        body: JSON.stringify({ workerId: "fresh-auto-recovery-worker" }),
      });
      assert.equal(reclaimed.response.status, 200);
      assert.equal(reclaimed.body.job.caseId, caseId);
      assert.equal(reclaimed.body.job.status, "claimed");
      assert.equal(reclaimed.body.job.workerId, "fresh-auto-recovery-worker");
      assert.equal(reclaimed.body.job.attemptCount, 2);
    } finally {
      await stopServer(server, async () => {
        await app.locals.caseService.close();
      });
    }
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

test("dispatch heartbeat returns 404 for an unknown persisted postgres lease", async () => {
  const store = createPostgresTestStore();

  try {
    await withPostgresServer(
      store,
      async ({ baseUrl }) => {
        const heartbeat = await signedJsonRequest(baseUrl, "/api/internal/dispatch/heartbeat", {
          body: {
            leaseId: "missing-postgres-lease-id",
            progress: "unknown-postgres-lease",
          },
        });

        assert.equal(heartbeat.response.status, 404);
        assert.equal(heartbeat.body.code, "LEASE_NOT_FOUND");
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

test("dispatch heartbeat returns 409 when a persisted postgres lease is already expired", async () => {
  const store = createPostgresTestStore();

  try {
    let caseId = "";
    let jobId = "";
    let leaseId = "";

    await withPostgresServer(
      store,
      async ({ baseUrl, jsonRequest }) => {
        const created = await jsonRequest("/api/cases", {
          method: "POST",
          body: JSON.stringify({
            patientAlias: "synthetic-patient-dispatch-postgres-expired-001",
            studyUid: "1.2.840.dispatch.postgres.expired.1",
            sequenceInventory: ["T1w", "FLAIR"],
          }),
        });

        assert.equal(created.response.status, 201);
        caseId = created.body.case.caseId as string;

        const claim = await signedJsonRequest(baseUrl, "/api/internal/dispatch/claim", {
          body: {
            workerId: "dispatch-worker-postgres-expired-001",
          },
        });

        assert.equal(claim.response.status, 200);
        assert.notEqual(claim.body.dispatch, null);
        assert.equal(claim.body.dispatch.caseId, caseId);
        assert.equal(typeof claim.body.dispatch.jobId, "string");
        assert.equal(typeof claim.body.dispatch.leaseId, "string");

        jobId = claim.body.dispatch.jobId as string;
        leaseId = claim.body.dispatch.leaseId as string;
      },
      {
        internalApiToken: DEFAULT_INTERNAL_API_TOKEN,
        hmacSecret: DEFAULT_HMAC_SECRET,
      },
    );

    await withPostgresAdminPool(store, async (pool) => {
      await pool.query("UPDATE mri_wave1.inference_jobs SET lease_expires_at = $1 WHERE job_id = $2", [
        new Date(Date.now() - 60_000).toISOString(),
        jobId,
      ]);
    });

    await withPostgresServer(
      store,
      async ({ baseUrl, jsonRequest }) => {
        const heartbeat = await signedJsonRequest(baseUrl, "/api/internal/dispatch/heartbeat", {
          body: {
            leaseId,
            progress: "expired-postgres-lease",
          },
        });

        assert.equal(heartbeat.response.status, 409);
        assert.equal(heartbeat.body.code, "LEASE_EXPIRED");

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
        headers: withImplicitAuth(path, {
          "content-type": "application/json",
          ...(init?.headers ?? {}),
        }),
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
        body: JSON.stringify({}),
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

test("inference replay with reordered arrays is treated as safe replay, not conflict", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(caseStoreFile, async ({ jsonRequest }) => {
      const created = await jsonRequest("/api/cases", {
        method: "POST",
        body: JSON.stringify({
          patientAlias: "synthetic-patient-replay-order",
          studyUid: "1.2.840.0.replay-order",
          sequenceInventory: ["T1w", "FLAIR"],
        }),
      });

      const caseId = created.body.case.caseId as string;

      const first = await jsonRequest("/api/internal/inference-callback", {
        method: "POST",
        body: JSON.stringify({
          caseId,
          qcDisposition: "pass",
          findings: ["Finding A", "Finding B"],
          measurements: [
            { label: "brain_parenchyma_ml", value: 1123 },
            { label: "hippocampus_ml", value: 4.2 },
          ],
          artifacts: ["artifact://preview", "artifact://qc"],
        }),
      });
      assert.equal(first.response.status, 200);

      // Resubmit with arrays in different order — same data
      const reordered = await jsonRequest("/api/internal/inference-callback", {
        method: "POST",
        body: JSON.stringify({
          caseId,
          qcDisposition: "pass",
          findings: ["Finding B", "Finding A"],
          measurements: [
            { label: "hippocampus_ml", value: 4.2 },
            { label: "brain_parenchyma_ml", value: 1123 },
          ],
          artifacts: ["artifact://qc", "artifact://preview"],
        }),
      });

      assert.equal(reordered.response.status, 200, "reordered replay must be accepted, not 409");
      assert.equal(reordered.body.case.status, "AWAITING_REVIEW");
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
        body: JSON.stringify({}),
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
        body: JSON.stringify({}),
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
        headers: withImplicitAuth("/api/cases", {
          "content-type": "application/json",
        }),
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
        body: JSON.stringify({}),
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

// ---------------------------------------------------------------------------
// dispatch/fail — error classification (Wave 2B exit gate #2)
// ---------------------------------------------------------------------------

test("dispatch/fail with transient failure re-queues the inference job", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(
      caseStoreFile,
      async ({ baseUrl, jsonRequest }) => {
        // Create a case so there's a job to claim
        const created = await jsonRequest("/api/cases", {
          method: "POST",
          body: JSON.stringify({
            patientAlias: "fail-transient-001",
            studyUid: "1.2.840.fail.transient.1",
            sequenceInventory: ["T1w", "FLAIR"],
          }),
        });
        assert.equal(created.response.status, 201);
        const caseId = created.body.case.caseId;

        // Claim the inference job via dispatch
        const claim = await signedJsonRequest(baseUrl, "/api/internal/dispatch/claim", {
          body: { workerId: "fail-test-worker-001" },
          nonce: "transient-claim-nonce-001",
        });
        assert.equal(claim.response.status, 200);
        assert.notEqual(claim.body.dispatch, null);
        const { leaseId } = claim.body.dispatch;

        // Report transient failure
        const fail = await signedJsonRequest(baseUrl, "/api/internal/dispatch/fail", {
          body: {
            caseId,
            leaseId,
            failureClass: "transient",
            errorCode: "WORKER_HTTP_ERROR",
            detail: "HTTP 502 from upstream",
          },
          nonce: "transient-fail-nonce-001",
        });
        assert.equal(fail.response.status, 200);
        assert.equal(fail.body.failureClass, "transient");
        assert.equal(fail.body.requeued, true);

        // Verify the inference job is back in "queued" status
        // (it has a backoff delay so immediate re-claim would not find it)
        const jobsList = await jsonRequest("/api/internal/inference-jobs", {
          headers: { authorization: `Bearer ${DEFAULT_INTERNAL_API_TOKEN}` },
        });
        assert.equal(jobsList.response.status, 200);
        const requeued = jobsList.body.jobs.find((j: { caseId: string }) => j.caseId === caseId);
        assert.ok(requeued, "transient failure should re-queue the job");
        assert.equal(requeued.status, "queued");
        assert.equal(requeued.failureClass, "transient");
        assert.ok(requeued.lastError?.includes("WORKER_HTTP_ERROR"));
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

test("dispatch/fail with terminal failure marks job as failed (no re-queue)", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(
      caseStoreFile,
      async ({ baseUrl, jsonRequest }) => {
        const created = await jsonRequest("/api/cases", {
          method: "POST",
          body: JSON.stringify({
            patientAlias: "fail-terminal-001",
            studyUid: "1.2.840.fail.terminal.1",
            sequenceInventory: ["T1w", "FLAIR"],
          }),
        });
        assert.equal(created.response.status, 201);
        const caseId = created.body.case.caseId;

        const claim = await signedJsonRequest(baseUrl, "/api/internal/dispatch/claim", {
          body: { workerId: "fail-test-worker-003" },
          nonce: "terminal-claim-nonce-001",
        });
        assert.equal(claim.response.status, 200);
        const { leaseId } = claim.body.dispatch;

        // Report terminal failure
        const fail = await signedJsonRequest(baseUrl, "/api/internal/dispatch/fail", {
          body: {
            caseId,
            leaseId,
            failureClass: "terminal",
            errorCode: "MISSING_CONFIG",
            detail: "Required secret not found",
          },
          nonce: "terminal-fail-nonce-001",
        });
        assert.equal(fail.response.status, 200);
        assert.equal(fail.body.failureClass, "terminal");
        assert.equal(fail.body.requeued, false);

        // Verify the job is NOT re-queued (no claimable jobs)
        const reClaim = await signedJsonRequest(baseUrl, "/api/internal/dispatch/claim", {
          body: { workerId: "fail-test-worker-004" },
          nonce: "terminal-re-claim-nonce-001",
        });
        assert.equal(reClaim.response.status, 200);
        assert.equal(reClaim.body.dispatch, null, "terminal failure must not re-queue");
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

test("dispatch/fail requires HMAC auth", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(
      caseStoreFile,
      async ({ jsonRequest }) => {
        // Bearer-only (no HMAC) on dispatch/fail should be rejected
        const bearerOnly = await jsonRequest("/api/internal/dispatch/fail", {
          method: "POST",
          headers: {
            authorization: `Bearer ${DEFAULT_INTERNAL_API_TOKEN}`,
          },
          body: JSON.stringify({
            caseId: "fake-case-id",
            leaseId: "fake-lease-id",
            failureClass: "transient",
            errorCode: "TEST_ERROR",
          }),
        });
        assert.equal(bearerOnly.response.status, 401, "Bearer-only must be rejected on dispatch/fail");
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

test("dispatch/fail returns 404 for unknown lease", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(
      caseStoreFile,
      async ({ baseUrl }) => {
        const fail = await signedJsonRequest(baseUrl, "/api/internal/dispatch/fail", {
          body: {
            caseId: "nonexistent-case-id",
            leaseId: "nonexistent-lease-id",
            failureClass: "transient",
            errorCode: "TEST_ERROR",
          },
        });
        assert.equal(fail.response.status, 404);
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

test("dispatch/fail rejects invalid failureClass", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(
      caseStoreFile,
      async ({ baseUrl }) => {
        const fail = await signedJsonRequest(baseUrl, "/api/internal/dispatch/fail", {
          body: {
            caseId: "any-case",
            leaseId: "any-lease",
            failureClass: "bogus",
            errorCode: "TEST_ERROR",
          },
        });
        assert.equal(fail.response.status, 400, "Invalid failureClass must be rejected");
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

// ---------------------------------------------------------------------------
// Wave 3B — Artifact and Report Closure
// ---------------------------------------------------------------------------

test("report-preview artifact is persisted and retrievable with correct MIME type", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(caseStoreFile, async ({ baseUrl, jsonRequest }) => {
      const created = await jsonRequest("/api/cases", {
        method: "POST",
        body: JSON.stringify({
          patientAlias: "wave3b-report-preview-001",
          studyUid: "1.2.840.wave3b.rp.1",
          sequenceInventory: ["T1w", "FLAIR"],
          studyContext: {
            studyInstanceUid: "2.25.wave3b.rp.1",
            accessionNumber: "ACC-3B-RP-001",
            studyDate: "2026-03-30",
            sourceArchive: "pacs-demo",
            dicomWebBaseUrl: "https://dicom.example.test/studies/2.25.wave3b.rp.1",
            metadataSummary: ["Wave 3B report-preview test"],
            series: [
              {
                seriesInstanceUid: "2.25.wave3b.rp.1.1",
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
      const caseId = created.body.case.caseId as string;

      const reportHtml = "<html><body><h1>Structural Report Preview</h1><p>Brain volume: 1105 ml</p></body></html>";

      await jsonRequest("/api/internal/inference-callback", {
        method: "POST",
        body: JSON.stringify({
          caseId,
          qcDisposition: "pass",
          findings: ["Report-preview persistence verification."],
          measurements: [{ label: "brain_volume_ml", value: 1105 }],
          artifacts: ["artifact://overlay-preview", "artifact://report-preview", "artifact://qc-summary"],
          artifactPayloads: [
            {
              artifactRef: "artifact://overlay-preview",
              contentType: "image/png",
              contentBase64: Buffer.from("PNG-3B-TEST", "utf-8").toString("base64"),
            },
            {
              artifactRef: "artifact://report-preview",
              contentType: "text/html",
              contentBase64: Buffer.from(reportHtml, "utf-8").toString("base64"),
            },
            {
              artifactRef: "artifact://qc-summary",
              contentType: "application/json",
              contentBase64: Buffer.from(JSON.stringify({ summary: "pass", checks: 2 }), "utf-8").toString("base64"),
            },
          ],
          generatedSummary: "Wave 3B report preview test draft.",
        }),
      });

      // Retrieve case detail and find the report-preview artifact
      const detail = await jsonRequest(`/api/cases/${caseId}`);
      assert.equal(detail.response.status, 200);

      const reportPreviewArtifact = detail.body.case.artifactManifest.find(
        (a: { artifactType: string }) => a.artifactType === "report-preview",
      );
      assert.ok(reportPreviewArtifact, "report-preview artifact must exist in manifest");
      assert.equal(reportPreviewArtifact.mimeType, "text/html");
      assert.equal(typeof reportPreviewArtifact.retrievalUrl, "string", "report-preview must have a retrievalUrl");

      // Retrieve the artifact content via API
      const rpResponse = await fetch(`${baseUrl}${reportPreviewArtifact.retrievalUrl}`, {
        headers: { "x-api-key": DEFAULT_OPERATOR_API_TOKEN },
      });
      assert.equal(rpResponse.status, 200);
      assert.equal(rpResponse.headers.get("content-type"), "text/html");
      const rpContent = await rpResponse.text();
      assert.equal(rpContent, reportHtml, "report-preview content must round-trip");
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("artifact provenance chain traces back to producing package and archive", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();
  const overlayPayload = Buffer.from("PROV-TEST-OVERLAY", "utf-8");
  const qcPayload = Buffer.from(JSON.stringify({ summary: "pass" }), "utf-8");
  const expectedDigestsByType = new Map([
    ["overlay-preview", createHash("sha256").update(overlayPayload).digest("hex")],
    ["qc-summary", createHash("sha256").update(qcPayload).digest("hex")],
  ]);
  const expectedByteSizesByType = new Map([
    ["overlay-preview", overlayPayload.byteLength],
    ["qc-summary", qcPayload.byteLength],
  ]);

  try {
    await withServer(caseStoreFile, async ({ jsonRequest }) => {
      const created = await jsonRequest("/api/cases", {
        method: "POST",
        body: JSON.stringify({
          patientAlias: "wave3b-provenance-001",
          studyUid: "1.2.840.wave3b.prov.1",
          sequenceInventory: ["T1w", "FLAIR"],
          studyContext: {
            studyInstanceUid: "2.25.wave3b.prov.1",
            accessionNumber: "ACC-3B-PROV-001",
            studyDate: "2026-03-30",
            sourceArchive: "pacs-main",
            dicomWebBaseUrl: "https://archive.hospital.test/dicom/studies/2.25.wave3b.prov.1",
            metadataSummary: ["Wave 3B provenance chain test"],
            series: [
              {
                seriesInstanceUid: "2.25.wave3b.prov.1.1",
                seriesDescription: "Sag T1 MPRAGE",
                modality: "MR",
                sequenceLabel: "T1w",
                instanceCount: 176,
              },
              {
                seriesInstanceUid: "2.25.wave3b.prov.1.2",
                seriesDescription: "Ax FLAIR",
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

      await jsonRequest("/api/internal/inference-callback", {
        method: "POST",
        body: JSON.stringify({
          caseId,
          qcDisposition: "pass",
          findings: ["Provenance chain verification."],
          measurements: [{ label: "brain_volume_ml", value: 1098 }],
          artifacts: ["artifact://overlay-preview", "artifact://qc-summary"],
          artifactPayloads: [
            {
              artifactRef: "artifact://overlay-preview",
              contentType: "image/png",
              contentBase64: overlayPayload.toString("base64"),
            },
            {
              artifactRef: "artifact://qc-summary",
              contentType: "application/json",
              contentBase64: qcPayload.toString("base64"),
            },
          ],
          generatedSummary: "Provenance chain draft.",
        }),
      });

      const detail = await jsonRequest(`/api/cases/${caseId}`);
      assert.equal(detail.response.status, 200);

      const { artifactManifest } = detail.body.case;
      assert.ok(artifactManifest.length >= 2, "at least 2 artifacts expected");

      for (const artifact of artifactManifest) {
        // Producing package provenance
        assert.equal(artifact.producingPackageId, "brain-structural-fastsurfer",
          `artifact ${artifact.artifactId} must reference producing package`);
        assert.equal(typeof artifact.producingPackageVersion, "string",
          `artifact ${artifact.artifactId} must have package version`);
        assert.ok(artifact.producingPackageVersion.length > 0,
          `artifact ${artifact.artifactId} package version must be non-empty`);

        // Archive locator provenance
        assert.equal(artifact.archiveLocator.studyInstanceUid, "2.25.wave3b.prov.1",
          `artifact ${artifact.artifactId} archiveLocator must reference original study`);
        assert.equal(artifact.archiveLocator.sourceArchive, "pacs-main",
          `artifact ${artifact.artifactId} archiveLocator must reference source archive`);
        assert.equal(artifact.archiveLocator.dicomWebBaseUrl,
          "https://archive.hospital.test/dicom/studies/2.25.wave3b.prov.1",
          `artifact ${artifact.artifactId} archiveLocator must carry DICOMWeb URL`);
        assert.ok(artifact.archiveLocator.seriesInstanceUids.length >= 1,
          `artifact ${artifact.artifactId} archiveLocator must list series UIDs`);

        // Temporal provenance
        assert.equal(typeof artifact.generatedAt, "string",
          `artifact ${artifact.artifactId} must have generatedAt timestamp`);
        assert.ok(!Number.isNaN(Date.parse(artifact.generatedAt)),
          `artifact ${artifact.artifactId} generatedAt must be a valid ISO date`);
        assert.equal(typeof artifact.contentSha256, "string",
          `artifact ${artifact.artifactId} must expose contentSha256`);
        assert.equal(artifact.contentSha256, expectedDigestsByType.get(artifact.artifactType),
          `artifact ${artifact.artifactId} must preserve checksum by artifact type`);
        assert.equal(artifact.byteSize, expectedByteSizesByType.get(artifact.artifactType),
          `artifact ${artifact.artifactId} must preserve byteSize by artifact type`);
      }

      // Verify report provenance chain as well
      const report = await jsonRequest(`/api/cases/${caseId}/report`);
      assert.equal(report.response.status, 200);
      assert.equal(typeof report.body.report.provenance.workflowVersion, "string");
      assert.ok(report.body.report.provenance.workflowVersion.length > 0,
        "report provenance must include workflow version");
      assert.equal(typeof report.body.report.provenance.plannerVersion, "string");
      assert.ok(report.body.report.provenance.plannerVersion.length > 0,
        "report provenance must include planner version");
      assert.equal(typeof report.body.report.provenance.generatedAt, "string");
      assert.ok(!Number.isNaN(Date.parse(report.body.report.provenance.generatedAt)),
        "report provenance generatedAt must be a valid ISO date");
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("archive truth is preserved through review, finalize, and report surfaces", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(caseStoreFile, async ({ jsonRequest }) => {
      const created = await jsonRequest("/api/cases", {
        method: "POST",
        body: JSON.stringify({
          patientAlias: "wave3b-archive-truth-001",
          studyUid: "1.2.840.wave3b.at.1",
          sequenceInventory: ["T1w", "FLAIR"],
          studyContext: {
            studyInstanceUid: "2.25.wave3b.at.1",
            accessionNumber: "ACC-3B-AT-001",
            studyDate: "2026-03-30",
            sourceArchive: "hospital-pacs",
            dicomWebBaseUrl: "https://pacs.hospital.test/dicom/studies/2.25.wave3b.at.1",
            metadataSummary: ["Wave 3B archive truth preservation test"],
            series: [
              {
                seriesInstanceUid: "2.25.wave3b.at.1.1",
                seriesDescription: "Sag T1 MPRAGE",
                modality: "MR",
                sequenceLabel: "T1w",
                instanceCount: 176,
              },
              {
                seriesInstanceUid: "2.25.wave3b.at.1.2",
                seriesDescription: "Ax FLAIR",
                modality: "MR",
                sequenceLabel: "FLAIR",
                instanceCount: 40,
              },
            ],
          },
        }),
      });
      assert.equal(created.response.status, 201);
      const caseId = created.body.case.caseId as string;

      await jsonRequest("/api/internal/inference-callback", {
        method: "POST",
        body: JSON.stringify({
          caseId,
          qcDisposition: "pass",
          findings: ["Archive truth preservation check."],
          measurements: [{ label: "brain_volume_ml", value: 1100 }],
          artifacts: ["artifact://overlay-preview", "artifact://report-preview", "artifact://qc-summary"],
          artifactPayloads: [
            {
              artifactRef: "artifact://overlay-preview",
              contentType: "image/png",
              contentBase64: Buffer.from("AT-TEST-OVERLAY", "utf-8").toString("base64"),
            },
            {
              artifactRef: "artifact://report-preview",
              contentType: "text/html",
              contentBase64: Buffer.from("<html><body>Archive truth test</body></html>", "utf-8").toString("base64"),
            },
            {
              artifactRef: "artifact://qc-summary",
              contentType: "application/json",
              contentBase64: Buffer.from(JSON.stringify({ summary: "pass" }), "utf-8").toString("base64"),
            },
          ],
          generatedSummary: "Archive truth preservation draft.",
        }),
      });

      // STAGE 1: Verify archive binding exists after inference (AWAITING_REVIEW)
      const afterInference = await jsonRequest(`/api/cases/${caseId}`);
      assert.equal(afterInference.body.case.status, "AWAITING_REVIEW");
      const overlayAfterInference = afterInference.body.case.artifactManifest.find(
        (a: { artifactType: string }) => a.artifactType === "overlay-preview",
      );
      assert.ok(overlayAfterInference.viewerReady, "overlay must be viewer-ready after inference");
      assert.ok(overlayAfterInference.viewerPath, "overlay must have viewerPath after inference");
      assert.equal(overlayAfterInference.archiveLocator.dicomWebBaseUrl,
        "https://pacs.hospital.test/dicom/studies/2.25.wave3b.at.1");
      assert.ok(overlayAfterInference.archiveStudyUrl, "overlay must have archiveStudyUrl");

      // STAGE 2: Review
      await jsonRequest(`/api/cases/${caseId}/review`, {
        method: "POST",
        body: JSON.stringify({
          finalImpression: "Archive truth confirmed during review.",
        }),
      });
      const afterReview = await jsonRequest(`/api/cases/${caseId}`);
      assert.equal(afterReview.body.case.status, "REVIEWED");
      const overlayAfterReview = afterReview.body.case.artifactManifest.find(
        (a: { artifactType: string }) => a.artifactType === "overlay-preview",
      );
      assert.ok(overlayAfterReview.viewerReady, "overlay must stay viewer-ready after review");
      assert.ok(overlayAfterReview.viewerPath, "overlay must retain viewerPath after review");
      assert.equal(overlayAfterReview.archiveLocator.studyInstanceUid, "2.25.wave3b.at.1",
        "archive locator study UID must survive review");

      // STAGE 3: Finalize
      await jsonRequest(`/api/cases/${caseId}/finalize`, {
        method: "POST",
        body: JSON.stringify({ finalSummary: "Archive truth finalize summary." }),
      });
      const afterFinalize = await jsonRequest(`/api/cases/${caseId}`);
      assert.equal(afterFinalize.body.case.status, "DELIVERY_PENDING");
      const overlayAfterFinalize = afterFinalize.body.case.artifactManifest.find(
        (a: { artifactType: string }) => a.artifactType === "overlay-preview",
      );
      assert.ok(overlayAfterFinalize.viewerReady, "overlay must stay viewer-ready after finalize");
      assert.ok(overlayAfterFinalize.viewerPath, "overlay must retain viewerPath after finalize");
      assert.equal(overlayAfterFinalize.archiveLocator.dicomWebBaseUrl,
        "https://pacs.hospital.test/dicom/studies/2.25.wave3b.at.1",
        "archive locator DICOMWeb URL must survive finalize");

      // STAGE 4: Report surface preserves archive binding
      const report = await jsonRequest(`/api/cases/${caseId}/report`);
      assert.equal(report.response.status, 200);
      assert.ok(Array.isArray(report.body.report.artifacts), "report must expose artifacts array");

      const reportOverlay = report.body.report.artifacts.find(
        (a: { artifactType: string }) => a.artifactType === "overlay-preview",
      );
      assert.ok(reportOverlay, "report surface must include overlay artifact");
      assert.ok(reportOverlay.viewerReady, "report overlay must be viewer-ready");
      assert.equal(reportOverlay.archiveLocator.studyInstanceUid, "2.25.wave3b.at.1",
        "report overlay must carry archive locator");
      assert.equal(reportOverlay.archiveLocator.dicomWebBaseUrl,
        "https://pacs.hospital.test/dicom/studies/2.25.wave3b.at.1",
        "report overlay must carry DICOMWeb URL");
      assert.ok(reportOverlay.viewerPath, "report overlay must have viewerPath");
      assert.ok(reportOverlay.archiveStudyUrl, "report overlay must have archiveStudyUrl");

      const reportPreview = report.body.report.artifacts.find(
        (a: { artifactType: string }) => a.artifactType === "report-preview",
      );
      assert.ok(reportPreview, "report surface must include report-preview artifact");
      assert.equal(reportPreview.archiveLocator.sourceArchive, "hospital-pacs",
        "report-preview must carry source archive in locator");
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("report derivedArtifacts carry full provenance and are not lossy copies", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(caseStoreFile, async ({ jsonRequest }) => {
      const created = await jsonRequest("/api/cases", {
        method: "POST",
        body: JSON.stringify({
          patientAlias: "wave3b-report-artifacts-001",
          studyUid: "1.2.840.wave3b.ra.1",
          sequenceInventory: ["T1w", "FLAIR"],
          studyContext: {
            studyInstanceUid: "2.25.wave3b.ra.1",
            accessionNumber: "ACC-3B-RA-001",
            studyDate: "2026-03-30",
            sourceArchive: "archive-primary",
            dicomWebBaseUrl: "https://archive-primary.test/dicom/studies/2.25.wave3b.ra.1",
            metadataSummary: ["Wave 3B report artifact losslessness test"],
            series: [
              {
                seriesInstanceUid: "2.25.wave3b.ra.1.1",
                seriesDescription: "Sag T1",
                modality: "MR",
                sequenceLabel: "T1w",
                instanceCount: 176,
              },
            ],
          },
        }),
      });
      assert.equal(created.response.status, 201);
      const caseId = created.body.case.caseId as string;

      await jsonRequest("/api/internal/inference-callback", {
        method: "POST",
        body: JSON.stringify({
          caseId,
          qcDisposition: "pass",
          findings: ["Lossless artifact check."],
          measurements: [{ label: "brain_volume_ml", value: 1112 }],
          artifacts: ["artifact://overlay-preview", "artifact://qc-summary"],
          artifactPayloads: [
            {
              artifactRef: "artifact://overlay-preview",
              contentType: "image/png",
              contentBase64: Buffer.from("LOSS-TEST", "utf-8").toString("base64"),
            },
            {
              artifactRef: "artifact://qc-summary",
              contentType: "application/json",
              contentBase64: Buffer.from(JSON.stringify({ ok: true }), "utf-8").toString("base64"),
            },
          ],
          generatedSummary: "Lossless report draft.",
        }),
      });

      // Get case detail and report to compare artifact representations
      const detail = await jsonRequest(`/api/cases/${caseId}`);
      const report = await jsonRequest(`/api/cases/${caseId}/report`);

      assert.equal(detail.response.status, 200);
      assert.equal(report.response.status, 200);

      const detailArtifacts = detail.body.case.artifactManifest;
      const reportArtifacts = report.body.report.artifacts;

      assert.equal(detailArtifacts.length, reportArtifacts.length,
        "report must expose same number of artifacts as case detail");

      for (let i = 0; i < detailArtifacts.length; i++) {
        const da = detailArtifacts[i];
        const ra = reportArtifacts[i];

        // Core identity
        assert.equal(ra.artifactId, da.artifactId, "artifact IDs must match");
        assert.equal(ra.artifactType, da.artifactType, "artifact types must match");

        // Provenance must not be lost
        assert.equal(ra.producingPackageId, da.producingPackageId,
          `producingPackageId must survive report surface for ${da.artifactId}`);
        assert.equal(ra.producingPackageVersion, da.producingPackageVersion,
          `producingPackageVersion must survive report surface for ${da.artifactId}`);
        assert.equal(ra.generatedAt, da.generatedAt,
          `generatedAt must survive report surface for ${da.artifactId}`);
        assert.equal(ra.contentSha256, da.contentSha256,
          `contentSha256 must survive report surface for ${da.artifactId}`);
        assert.equal(ra.byteSize, da.byteSize,
          `byteSize must survive report surface for ${da.artifactId}`);

        // Archive locator must not be lost
        assert.deepEqual(ra.archiveLocator, da.archiveLocator,
          `archiveLocator must survive report surface for ${da.artifactId}`);

        // Viewer descriptor must not be lost
        assert.equal(ra.viewerReady, da.viewerReady,
          `viewerReady must survive report surface for ${da.artifactId}`);
        if (da.viewerDescriptor) {
          assert.deepEqual(ra.viewerDescriptor, da.viewerDescriptor,
            `viewerDescriptor must survive report surface for ${da.artifactId}`);
        }
      }
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

// ═══════════════════════════════════════════════════════════
// Wave 4: Interop export seams (DICOM SR + FHIR)
// ═══════════════════════════════════════════════════════════

test("Wave 4: DICOM SR export returns structurally valid envelope for finalized case", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();
  try {
    await withServer(caseStoreFile, async ({ jsonRequest }) => {
      // Create and complete a case through finalization
      const created = await jsonRequest("/api/cases", {
        method: "POST",
        body: JSON.stringify({
          patientAlias: "DICOMSR-001",
          studyUid: "1.2.840.113619.2.55.3.99.1",
          indication: "MRI brain structural analysis",
          sequenceInventory: ["T1w"],
          studyContext: {
            studyInstanceUid: "1.2.840.113619.2.55.3.99.1",
            sourceArchive: "orthanc-local",
            dicomWebBaseUrl: "http://orthanc:8042/dicom-web",
            series: [{ seriesInstanceUid: "1.2.840.113619.2.55.3.99.1.1", modality: "MR", description: "T1 MPRAGE" }],
          },
        }),
      });
      assert.equal(created.response.status, 201);
      const caseId = created.body.case.caseId as string;

      // Simulate inference callback
      await jsonRequest("/api/internal/inference-callback", {
        method: "POST",
        body: JSON.stringify({
          caseId,
          qcDisposition: "pass",
          findings: ["Normal brain morphometry", "No significant atrophy"],
          measurements: [
            { label: "Total Brain Volume", value: 1250.3, unit: "cm3" },
            { label: "Hippocampal Volume L", value: 3.8, unit: "cm3" },
          ],
          artifacts: [],
          generatedSummary: "Structural MRI analysis complete",
        }),
      });

      // Review
      await jsonRequest(`/api/cases/${caseId}/review`, {
        method: "POST",
        body: JSON.stringify({
          finalImpression: "Normal structural MRI",
        }),
      });

      // Finalize
      await jsonRequest(`/api/cases/${caseId}/finalize`, {
        method: "POST",
        body: JSON.stringify({ finalSummary: "Normal structural MRI locked for export." }),
      });

      // Request DICOM SR export
      const srExport = await jsonRequest(`/api/cases/${caseId}/exports/dicom-sr`);
      assert.equal(srExport.response.status, 200);
      assert.match(srExport.response.headers.get("content-type") ?? "", /application\/json/);

      const sr = srExport.body.dicomSr;

      // Structural validity: DICOM SR envelope
      assert.ok(sr, "response must contain dicomSr envelope");
      assert.equal(sr.sopClassUid, "1.2.840.10008.5.1.4.1.1.88.33",
        "SOP Class UID must be Comprehensive SR");
      assert.equal(sr.modality, "SR", "modality must be SR");
      assert.ok(sr.studyInstanceUid, "must include study instance UID");
      assert.equal(sr.studyInstanceUid, "1.2.840.113619.2.55.3.99.1");

      // Content: findings and measurements
      assert.ok(Array.isArray(sr.contentSequence), "must have contentSequence array");
      const findingsContainer = sr.contentSequence.find((item: any) =>
        item.conceptNameCode?.meaning === "Findings");
      assert.ok(findingsContainer, "must have Findings container");
      assert.ok(findingsContainer.items.length >= 2, "must include at least 2 findings");

      const measurementsContainer = sr.contentSequence.find((item: any) =>
        item.conceptNameCode?.meaning === "Measurements");
      assert.ok(measurementsContainer, "must have Measurements container");
      assert.ok(measurementsContainer.items.length >= 2, "must include at least 2 measurements");

      // Each measurement must have label, value, unit
      for (const m of measurementsContainer.items) {
        assert.ok(m.conceptNameCode?.meaning, "measurement must have label");
        assert.ok(typeof m.numericValue === "number", "measurement must have numeric value");
      }

      // Provenance
      assert.ok(sr.provenance, "must include provenance");
      assert.ok(sr.provenance.generatedAt, "provenance must have generatedAt");
      assert.ok(sr.provenance.workflowVersion, "provenance must have workflowVersion");

      // Disclaimer
      assert.ok(sr.disclaimer, "must include disclaimer");
      assert.match(sr.disclaimer, /research/i, "disclaimer must reference research use");
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Wave 4: FHIR DiagnosticReport export returns valid R4 resource for finalized case", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();
  try {
    await withServer(caseStoreFile, async ({ baseUrl, jsonRequest }) => {
      // Create and complete a case through finalization
      const created = await jsonRequest("/api/cases", {
        method: "POST",
        body: JSON.stringify({
          patientAlias: "FHIR-001",
          studyUid: "1.2.840.113619.2.55.3.99.2",
          indication: "MRI brain structural",
          sequenceInventory: ["T1w"],
          studyContext: {
            studyInstanceUid: "1.2.840.113619.2.55.3.99.2",
            sourceArchive: "orthanc-local",
            dicomWebBaseUrl: "http://orthanc:8042/dicom-web",
            series: [{ seriesInstanceUid: "1.2.840.113619.2.55.3.99.2.1", modality: "MR", description: "T1 MPRAGE" }],
          },
        }),
      });
      assert.equal(created.response.status, 201);
      const caseId = created.body.case.caseId as string;

      // Inference callback
      await jsonRequest("/api/internal/inference-callback", {
        method: "POST",
        body: JSON.stringify({
          caseId,
          qcDisposition: "pass",
          findings: ["Mild left hippocampal volume reduction"],
          measurements: [
            { label: "Hippocampal Volume L", value: 2.9, unit: "cm3" },
            { label: "Hippocampal Volume R", value: 3.5, unit: "cm3" },
          ],
          artifacts: [],
          generatedSummary: "Structural analysis complete",
        }),
      });

      // Review + Finalize
      await jsonRequest(`/api/cases/${caseId}/review`, {
        method: "POST",
        body: JSON.stringify({
          finalImpression: "Mild left hippocampal volume reduction noted",
        }),
      });
      await jsonRequest(`/api/cases/${caseId}/finalize`, {
        method: "POST",
        body: JSON.stringify({ finalSummary: "FHIR export finalized." }),
      });

      // Request FHIR export
      const fhirExport = await jsonRequest(`/api/cases/${caseId}/exports/fhir-diagnostic-report`);
      assert.equal(fhirExport.response.status, 200);
      assert.match(fhirExport.response.headers.get("content-type") ?? "", /application\/json/);

      const dr = fhirExport.body.diagnosticReport;

      // FHIR R4 structural validity
      assert.ok(dr, "response must contain diagnosticReport envelope");
      assert.equal(dr.resourceType, "DiagnosticReport", "resourceType must be DiagnosticReport");
      assert.equal(dr.status, "final", "status must be final for finalized case");

      // Code
      assert.ok(dr.code, "must have code");
      assert.ok(dr.code.coding, "code must have coding array");
      assert.ok(dr.code.coding.length > 0, "code must have at least one coding");
      const coding = dr.code.coding[0];
      assert.ok(coding.system, "coding must have system");
      assert.ok(coding.code, "coding must have code");

      // Subject
      assert.ok(dr.subject, "must have subject reference");
      assert.ok(dr.subject.display, "subject must have display name");

      // Effective date
      assert.ok(dr.effectiveDateTime, "must have effectiveDateTime");

      // Conclusion
      assert.ok(dr.conclusion, "must have conclusion");
      assert.match(dr.conclusion, /hippocampal/i, "conclusion must include clinical finding");

      // Observations (measurements as contained resources)
      assert.ok(Array.isArray(dr.result), "must have result array");
      assert.ok(dr.result.length >= 2, "must have at least 2 observation results");

      if (dr.contained) {
        const observations = dr.contained.filter((r: any) => r.resourceType === "Observation");
        assert.ok(observations.length >= 2, "must contain at least 2 Observation resources");

        for (const obs of observations) {
          assert.equal(obs.resourceType, "Observation");
          assert.equal(obs.status, "final");
          assert.ok(obs.code?.text, "observation must have code text");
          assert.ok(obs.valueQuantity?.value !== undefined, "observation must have valueQuantity.value");
        }
      }

      // Presented form (report attachment)
      assert.ok(Array.isArray(dr.presentedForm), "must have presentedForm");
      assert.ok(dr.presentedForm.length > 0, "presentedForm must not be empty");
      assert.ok(dr.presentedForm[0].contentType, "presentedForm must have contentType");

      // Meta
      assert.ok(dr.meta, "must have meta");
      assert.ok(dr.meta.lastUpdated, "meta must have lastUpdated");

      // Disclaimer extension
      const disclaimerExt = dr.extension?.find((e: any) =>
        e.url?.includes("disclaimer") || e.url?.includes("research-use"));
      assert.ok(disclaimerExt, "must have disclaimer extension");
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Wave 4: export endpoints return 404 for cases without finalized reports", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();
  try {
    await withServer(caseStoreFile, async ({ jsonRequest }) => {
      // Create a case but do NOT finalize
      const created = await jsonRequest("/api/cases", {
        method: "POST",
        body: JSON.stringify({
          patientAlias: "NOEXPORT-001",
          studyUid: "1.2.840.113619.2.55.3.99.9",
          sequenceInventory: ["T1w"],
        }),
      });
      assert.equal(created.response.status, 201);
      const caseId = created.body.case.caseId as string;

      // Both export endpoints must reject unfinalized cases
      const srExport = await jsonRequest(`/api/cases/${caseId}/exports/dicom-sr`);
      assert.equal(srExport.response.status, 404, "DICOM SR export must reject case without report");
      assert.ok(srExport.body.code, "error response must include error code");

      const fhirExport = await jsonRequest(`/api/cases/${caseId}/exports/fhir-diagnostic-report`);
      assert.equal(fhirExport.response.status, 404, "FHIR export must reject case without report");
      assert.ok(fhirExport.body.code, "error response must include error code");
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Wave 4: export endpoints return 404 while report is still awaiting review", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();
  try {
    await withServer(caseStoreFile, async ({ jsonRequest }) => {
      const created = await jsonRequest("/api/cases", {
        method: "POST",
        body: JSON.stringify({
          patientAlias: "DRAFT-EXPORT-001",
          studyUid: "1.2.840.113619.2.55.3.99.10",
          sequenceInventory: ["T1w"],
        }),
      });
      assert.equal(created.response.status, 201);
      const caseId = created.body.case.caseId as string;

      const inferred = await jsonRequest("/api/internal/inference-callback", {
        method: "POST",
        body: JSON.stringify({
          caseId,
          qcDisposition: "pass",
          findings: ["Draft export should stay private until finalization."],
          measurements: [{ label: "hippocampal_z_score", value: -0.8 }],
          artifacts: [],
          generatedSummary: "Draft report generated.",
        }),
      });
      assert.equal(inferred.response.status, 200);
      assert.equal(inferred.body.case.status, "AWAITING_REVIEW");

      const srExport = await jsonRequest(`/api/cases/${caseId}/exports/dicom-sr`);
      assert.equal(srExport.response.status, 404, "DICOM SR export must reject draft report");
      assert.ok(srExport.body.code, "draft rejection must include error code");

      const fhirExport = await jsonRequest(`/api/cases/${caseId}/exports/fhir-diagnostic-report`);
      assert.equal(fhirExport.response.status, 404, "FHIR export must reject draft report");
      assert.ok(fhirExport.body.code, "draft rejection must include error code");
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Wave 4: export endpoints return 404 after review until finalization locks the report", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();
  try {
    await withServer(caseStoreFile, async ({ jsonRequest }) => {
      const prepared = await createReviewedCase(jsonRequest, {
        patientAlias: "REVIEWED-EXPORT-001",
        studyUid: "1.2.840.113619.2.55.3.99.11",
        studyInstanceUid: "2.25.reviewed-export.1",
        accessionNumber: "ACC-REVIEW-EXPORT-001",
      });

      const srExport = await jsonRequest(`/api/cases/${prepared.caseId}/exports/dicom-sr`);
      assert.equal(srExport.response.status, 404, "DICOM SR export must reject reviewed-but-unfinalized report");
      assert.ok(srExport.body.code, "reviewed rejection must include error code");

      const fhirExport = await jsonRequest(`/api/cases/${prepared.caseId}/exports/fhir-diagnostic-report`);
      assert.equal(fhirExport.response.status, 404, "FHIR export must reject reviewed-but-unfinalized report");
      assert.ok(fhirExport.body.code, "reviewed rejection must include error code");
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("bearer-jwt review uses authenticated reviewer identity instead of request-body identity", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(
      caseStoreFile,
      async ({ jsonRequest }) => {
        const created = await jsonRequest("/api/cases", {
          method: "POST",
          body: JSON.stringify({
            patientAlias: "secure-review-patient-001",
            studyUid: "1.2.840.secure.review.1",
            sequenceInventory: ["T1w", "FLAIR"],
          }),
        });
        const caseId = created.body.case.caseId as string;

        await jsonRequest("/api/internal/inference-callback", {
          method: "POST",
          body: JSON.stringify({
            caseId,
            qcDisposition: "pass",
            findings: ["Secure review draft ready."],
            measurements: [{ label: "whole_brain_ml", value: 1112 }],
            artifacts: ["artifact://qc", "artifact://report"],
          }),
        });

        const reviewed = await jsonRequest(`/api/cases/${caseId}/review`, {
          method: "POST",
          headers: createReviewerAuthHeaders("token-clinician-01", "neuroradiologist"),
          body: JSON.stringify({
            comments: "Authenticated review completed.",
            finalImpression: "Authenticated final impression.",
          }),
        });

        assert.equal(reviewed.response.status, 200);
        assert.equal(reviewed.body.case.status, "REVIEWED");
        assert.equal(reviewed.body.case.review.reviewerId, "token-clinician-01");
        assert.equal(reviewed.body.case.review.reviewerRole, "neuroradiologist");
      },
      {
        reviewerJwtSecret: DEFAULT_REVIEWER_JWT_SECRET,
      },
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("bearer-jwt review rejects missing auth and finalize rejects public delivery override", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(
      caseStoreFile,
      async ({ jsonRequest }) => {
        const created = await jsonRequest("/api/cases", {
          method: "POST",
          body: JSON.stringify({
            patientAlias: "secure-review-patient-002",
            studyUid: "1.2.840.secure.review.2",
            sequenceInventory: ["T1w", "FLAIR"],
          }),
        });
        const caseId = created.body.case.caseId as string;

        await jsonRequest("/api/internal/inference-callback", {
          method: "POST",
          body: JSON.stringify({
            caseId,
            qcDisposition: "pass",
            findings: ["Secure finalize draft ready."],
            measurements: [{ label: "whole_brain_ml", value: 1113 }],
            artifacts: ["artifact://qc", "artifact://report"],
          }),
        });

        const unauthenticatedReview = await jsonRequest(`/api/cases/${caseId}/review`, {
          method: "POST",
          headers: {
            authorization: "",
          },
          body: JSON.stringify({ comments: "Missing auth." }),
        });

        assert.equal(unauthenticatedReview.response.status, 401);
        assert.equal(unauthenticatedReview.body.code, "UNAUTHORIZED");

        const reviewed = await jsonRequest(`/api/cases/${caseId}/review`, {
          method: "POST",
          headers: createReviewerAuthHeaders("token-clinician-02", "neuroradiologist"),
          body: JSON.stringify({ comments: "Authenticated review." }),
        });

        assert.equal(reviewed.response.status, 200);

        const invalidFinalize = await jsonRequest(`/api/cases/${caseId}/finalize`, {
          method: "POST",
          headers: createReviewerAuthHeaders("token-clinician-02", "neuroradiologist"),
          body: JSON.stringify({
            finalSummary: "Ready for outbound delivery.",
            deliveryOutcome: "failed",
          }),
        });

        assert.equal(invalidFinalize.response.status, 400);
        assert.equal(invalidFinalize.body.code, "INVALID_INPUT");

        const finalized = await jsonRequest(`/api/cases/${caseId}/finalize`, {
          method: "POST",
          headers: createReviewerAuthHeaders("token-clinician-02", "neuroradiologist"),
          body: JSON.stringify({ finalSummary: "Ready for outbound delivery." }),
        });

        assert.equal(finalized.response.status, 200);
        assert.equal(finalized.body.case.status, "DELIVERY_PENDING");
      },
      {
        reviewerJwtSecret: DEFAULT_REVIEWER_JWT_SECRET,
      },
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("bearer-jwt review and finalize require an allowed reviewer role", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(
      caseStoreFile,
      async ({ jsonRequest }) => {
        const created = await jsonRequest("/api/cases", {
          method: "POST",
          body: JSON.stringify({
            patientAlias: "secure-review-patient-003",
            studyUid: "1.2.840.secure.review.3",
            sequenceInventory: ["T1w", "FLAIR"],
          }),
        });
        const caseId = created.body.case.caseId as string;

        await jsonRequest("/api/internal/inference-callback", {
          method: "POST",
          body: JSON.stringify({
            caseId,
            qcDisposition: "pass",
            findings: ["Secure role-gated review draft ready."],
            measurements: [{ label: "whole_brain_ml", value: 1114 }],
            artifacts: ["artifact://qc", "artifact://report"],
          }),
        });

        const missingRoleReview = await jsonRequest(`/api/cases/${caseId}/review`, {
          method: "POST",
          headers: createReviewerAuthHeaders("token-clinician-03"),
          body: JSON.stringify({ comments: "Missing role claim." }),
        });

        assert.equal(missingRoleReview.response.status, 403);
        assert.equal(missingRoleReview.body.code, "FORBIDDEN");

        const unauthorizedRoleReview = await jsonRequest(`/api/cases/${caseId}/review`, {
          method: "POST",
          headers: createReviewerAuthHeaders("token-clinician-03", "technician"),
          body: JSON.stringify({ comments: "Unauthorized role claim." }),
        });

        assert.equal(unauthorizedRoleReview.response.status, 403);
        assert.equal(unauthorizedRoleReview.body.code, "FORBIDDEN");

        const reviewed = await jsonRequest(`/api/cases/${caseId}/review`, {
          method: "POST",
          headers: createReviewerAuthHeaders("token-clinician-03", "neuroradiologist"),
          body: JSON.stringify({ comments: "Authorized reviewer role." }),
        });

        assert.equal(reviewed.response.status, 200);

        const unauthorizedFinalize = await jsonRequest(`/api/cases/${caseId}/finalize`, {
          method: "POST",
          headers: createReviewerAuthHeaders("token-clinician-03", "technician"),
          body: JSON.stringify({ finalSummary: "Unauthorized finalization attempt." }),
        });

        assert.equal(unauthorizedFinalize.response.status, 403);
        assert.equal(unauthorizedFinalize.body.code, "FORBIDDEN");

        const finalized = await jsonRequest(`/api/cases/${caseId}/finalize`, {
          method: "POST",
          headers: createReviewerAuthHeaders("token-clinician-03", "neuroradiologist"),
          body: JSON.stringify({ finalSummary: "Authorized reviewer finalization." }),
        });

        assert.equal(finalized.response.status, 200);
        assert.equal(finalized.body.case.status, "DELIVERY_PENDING");
      },
      {
        reviewerJwtSecret: DEFAULT_REVIEWER_JWT_SECRET,
      },
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("operator auth rejects requests without x-api-key on protected routes", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(
      caseStoreFile,
      async ({ baseUrl }) => {
        const paths = [
          { path: "/api/cases", method: "GET" },
          { path: "/api/cases", method: "POST" },
          { path: "/api/operations/summary", method: "GET" },
        ];

        for (const { path, method } of paths) {
          const response = await fetch(`${baseUrl}${path}`, {
            method,
            headers: { "content-type": "application/json" },
          });
          assert.equal(
            response.status,
            401,
            `Expected 401 for ${method} ${path} without x-api-key but got ${response.status}`,
          );
        }

        const healthResponse = await fetch(`${baseUrl}/healthz`);
        assert.equal(healthResponse.status, 200, "Health probe should remain unauthenticated");
      },
      {
        operatorApiToken: DEFAULT_OPERATOR_API_TOKEN,
      },
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
test("tenant objects are isolated between tenants on operator endpoints", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(caseStoreFile, async ({ jsonRequest }) => {
      // Create unassigned case (no tenantId)
      const casePublic = await jsonRequest("/api/cases", {
        method: "POST",
        body: JSON.stringify({
          patientAlias: "PublicPatient",
          studyUid: "1.2.3.public",
          sequenceInventory: ["T1w"],
        }),
      });
      assert.equal(casePublic.response.status, 201);

      // Create TenantA case
      const caseA = await jsonRequest("/api/cases", {
        method: "POST",
        body: JSON.stringify({
          patientAlias: "PatientA",
          studyUid: "1.2.3.t.A",
          sequenceInventory: ["T1w"],
          tenantId: "tenant_A",
        }),
      });
      assert.equal(caseA.response.status, 201);
      const caseAId = caseA.body.case.caseId as string;

      // Create TenantB case
      const caseB = await jsonRequest("/api/cases", {
        method: "POST",
        body: JSON.stringify({
          patientAlias: "PatientB",
          studyUid: "1.2.3.t.B",
          sequenceInventory: ["T1w"],
          tenantId: "tenant_B",
        }),
      });
      assert.equal(caseB.response.status, 201);

      // Operator reading without x-tenant-id gets all 3 cases
      const allCases = await jsonRequest("/api/cases");
      assert.equal(allCases.body.cases.length, 3);

      // Operator reading as tenant_A gets only tenant_A cases
      const aCases = await jsonRequest("/api/cases", {
        headers: { "x-tenant-id": "tenant_A" },
      });
      assert.equal(aCases.body.cases.length, 1);
      assert.equal(aCases.body.cases[0].patientAlias, "PatientA");

      // Operator reading caseA with tenant_B scope gets 403
      const bReadA = await jsonRequest(`/api/cases/${caseAId}`, {
        headers: { "x-tenant-id": "tenant_B" },
      });
      assert.equal(bReadA.response.status, 403);
      assert.equal(bReadA.body.code, "FORBIDDEN");
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("operator endpoints reject invalid x-tenant-id header values", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(caseStoreFile, async ({ jsonRequest }) => {
      const created = await jsonRequest("/api/cases", {
        method: "POST",
        body: JSON.stringify({
          patientAlias: "TenantHeaderValidation-001",
          studyUid: "1.2.840.tenant.invalid.1",
          sequenceInventory: ["T1w"],
          tenantId: "tenant_A",
        }),
      });
      assert.equal(created.response.status, 201);

      const invalidList = await jsonRequest("/api/cases", {
        headers: { "x-tenant-id": "tenant bad;drop" },
      });
      assert.equal(invalidList.response.status, 400);
      assert.equal(invalidList.body.code, "INVALID_INPUT");
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("tenant scope enforcement extends to report, export, and artifact routes", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(caseStoreFile, async ({ jsonRequest }) => {
      // Create a tenant-scoped case and push it through inference
      const created = await jsonRequest("/api/cases", {
        method: "POST",
        body: JSON.stringify({
          patientAlias: "TenantScopeDeep-001",
          studyUid: "1.2.840.tenant.scope.deep.1",
          sequenceInventory: ["T1w", "FLAIR"],
          tenantId: "tenant_deep_A",
        }),
      });
      assert.equal(created.response.status, 201);
      const caseId = created.body.case.caseId as string;

      await jsonRequest("/api/internal/inference-callback", {
        method: "POST",
        body: JSON.stringify({
          caseId,
          qcDisposition: "pass",
          findings: ["Tenant scope deep test."],
          measurements: [{ label: "brain_volume_ml", value: 1050 }],
          artifacts: ["artifact://qc-summary"],
          artifactPayloads: [
            {
              artifactRef: "artifact://qc-summary",
              contentType: "application/json",
              contentBase64: Buffer.from(JSON.stringify({ summary: "ok" }), "utf-8").toString("base64"),
            },
          ],
          generatedSummary: "Tenant scope enforcement draft.",
        }),
      });

      // Correct tenant can access report
      const correctReport = await jsonRequest(`/api/cases/${caseId}/report`, {
        headers: { "x-tenant-id": "tenant_deep_A" },
      });
      assert.equal(correctReport.response.status, 200);

      // Wrong tenant gets 403 on report
      const wrongReport = await jsonRequest(`/api/cases/${caseId}/report`, {
        headers: { "x-tenant-id": "tenant_deep_B" },
      });
      assert.equal(wrongReport.response.status, 403);
      assert.equal(wrongReport.body.code, "FORBIDDEN");

      // Wrong tenant gets 403 on artifact
      const detail = await jsonRequest(`/api/cases/${caseId}`, {
        headers: { "x-tenant-id": "tenant_deep_A" },
      });
      const artifact = detail.body.case.artifactManifest[0];
      const wrongArtifact = await jsonRequest(
        `/api/cases/${caseId}/artifacts/${artifact.artifactId}`,
        { headers: { "x-tenant-id": "tenant_deep_B" } },
      );
      assert.equal(wrongArtifact.response.status, 403);

      // Wrong tenant gets 403 on DICOM SR export (need review + finalize first)
      await jsonRequest(`/api/cases/${caseId}/review`, {
        method: "POST",
        body: JSON.stringify({ finalImpression: "Tenant scope confirmed." }),
      });
      await jsonRequest(`/api/cases/${caseId}/finalize`, {
        method: "POST",
        body: JSON.stringify({ finalSummary: "Tenant scope finalized." }),
      });

      const wrongExport = await jsonRequest(`/api/cases/${caseId}/exports/dicom-sr`, {
        headers: { "x-tenant-id": "tenant_deep_B" },
      });
      assert.equal(wrongExport.response.status, 403);

      const wrongFhir = await jsonRequest(`/api/cases/${caseId}/exports/fhir-diagnostic-report`, {
        headers: { "x-tenant-id": "tenant_deep_B" },
      });
      assert.equal(wrongFhir.response.status, 403);
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("reviewer-scoped authorization denies access to cases assigned to a different reviewer", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(caseStoreFile, async ({ jsonRequest }) => {
      // Create a case assigned to reviewer-alpha
      const created = await jsonRequest("/api/cases", {
        method: "POST",
        body: JSON.stringify({
          patientAlias: "ReviewerScope-001",
          studyUid: "1.2.840.reviewer.scope.1",
          sequenceInventory: ["T1w"],
          assignedReviewerId: "reviewer-alpha",
        }),
      });
      assert.equal(created.response.status, 201);
      const caseId = created.body.case.caseId as string;

      // Push through inference to reach AWAITING_REVIEW
      await jsonRequest("/api/internal/inference-callback", {
        method: "POST",
        body: JSON.stringify({
          caseId,
          qcDisposition: "pass",
          findings: ["Reviewer scope test."],
          measurements: [{ label: "brain_volume_ml", value: 1060 }],
          artifacts: ["artifact://qc-summary"],
          artifactPayloads: [
            {
              artifactRef: "artifact://qc-summary",
              contentType: "application/json",
              contentBase64: Buffer.from(JSON.stringify({ summary: "ok" }), "utf-8").toString("base64"),
            },
          ],
          generatedSummary: "Reviewer scope draft.",
        }),
      });

      // reviewer-alpha can review (JWT with sub=reviewer-alpha, role=radiologist)
      const alphaJwt = createReviewerJwt({ reviewerId: "reviewer-alpha", reviewerRole: "radiologist" });
      const alphaReview = await jsonRequest(`/api/cases/${caseId}/review`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${alphaJwt}`,
        },
        body: JSON.stringify({ finalImpression: "Alpha reviewed." }),
      });
      assert.equal(alphaReview.response.status, 200);

      // reviewer-beta attempting to finalize gets 403 (case assigned to reviewer-alpha)
      const betaJwt = createReviewerJwt({ reviewerId: "reviewer-beta", reviewerRole: "radiologist" });
      const betaFinalize = await jsonRequest(`/api/cases/${caseId}/finalize`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${betaJwt}`,
        },
        body: JSON.stringify({ finalSummary: "Beta trying to finalize." }),
      });
      assert.equal(betaFinalize.response.status, 403);
      assert.equal(betaFinalize.body.code, "FORBIDDEN");

      // reviewer-alpha can finalize
      const alphaFinalize = await jsonRequest(`/api/cases/${caseId}/finalize`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${alphaJwt}`,
        },
        body: JSON.stringify({ finalSummary: "Alpha finalized." }),
      });
      assert.equal(alphaFinalize.response.status, 200);
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});



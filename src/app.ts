import express from "express";
import { randomUUID, timingSafeEqual } from "node:crypto";
import type { AppConfig } from "./config";
import { createDefaultArtifactStoreConfig } from "./artifact-store";
import { createDefaultDispatchQueueConfig, createDispatchQueueFromConfig } from "./dispatch-queue";
import { verifySignedRequest, HMAC_HEADER_NONCE, HMAC_HEADER_SIGNATURE } from "./hmac-auth";
import { MemoryReplayStore, type ReplayStore } from "./replay-store";
import {
  MemoryCaseService,
  WorkflowError,
  type CreateCaseInput,
  type FinalizeCaseInput,
  type InferenceCallbackInput,
  type ReviewCaseInput,
} from "./cases";
import { SnapshotCaseRepository } from "./case-repository";
import { PostgresCaseRepository } from "./postgres-case-repository";

const CORRELATION_HEADER = "x-correlation-id";

function requireInternalAuthorization(req: express.Request, config: AppConfig) {
  // HMAC path: if secret is configured, HMAC is mandatory
  if (config.hmacSecret) {
    const rawBody: Buffer = (req as any).rawBody ?? Buffer.alloc(0);
    const result = verifySignedRequest({
      method: req.method,
      path: req.path,
      headers: req.headers as Record<string, string | undefined>,
      rawBody,
      hmacSecret: config.hmacSecret,
      clockSkewToleranceMs: config.clockSkewToleranceMs,
    });
    if (!result.ok) {
      throw new WorkflowError(401, result.message ?? "HMAC verification failed", "UNAUTHORIZED_INTERNAL_ROUTE");
    }
    return;
  }

  // Bearer fallback: dev/test convenience when HMAC is not configured
  if (config.internalApiToken) {
    const header = req.header("authorization") ?? "";
    const expected = `Bearer ${config.internalApiToken}`;
    const headerBuf = Buffer.from(header);
    const expectedBuf = Buffer.from(expected);
    if (headerBuf.length !== expectedBuf.length || !timingSafeEqual(headerBuf, expectedBuf)) {
      throw new WorkflowError(401, "Internal route authorization failed", "UNAUTHORIZED_INTERNAL_ROUTE");
    }
    return;
  }

  // Neither configured — open mode (dev/test only; production warns at startup)
}

function requireNonceNotReplayed(req: express.Request, replayStore: ReplayStore | null) {
  if (!replayStore) return; // replay check only applies when HMAC is active
  const nonce = req.headers[HMAC_HEADER_NONCE];
  if (typeof nonce !== "string" || nonce.length === 0) return; // no nonce = no replay check
  // checkAndRecord is sync-fast for MemoryReplayStore; await at call site
  return replayStore.checkAndRecord(nonce, Date.now()).then((isReplay) => {
    if (isReplay) {
      throw new WorkflowError(409, "Nonce already consumed — possible replay", "REPLAY_DETECTED");
    }
  });
}

/**
 * Reject machine-to-machine credentials on clinician-action routes.
 * Prevents service accounts from impersonating human actors on review/finalize.
 */
function rejectMachineCredentials(req: express.Request, config: AppConfig) {
  // HMAC signature header present → machine credential
  if (req.headers[HMAC_HEADER_SIGNATURE]) {
    throw new WorkflowError(
      403,
      "Machine credentials not accepted on clinician-action routes",
      "MACHINE_CREDENTIAL_REJECTED",
    );
  }

  // Internal bearer token match → machine credential
  if (config.internalApiToken) {
    const header = req.header("authorization") ?? "";
    const expected = `Bearer ${config.internalApiToken}`;
    const headerBuf = Buffer.from(header);
    const expectedBuf = Buffer.from(expected);
    if (headerBuf.length === expectedBuf.length && timingSafeEqual(headerBuf, expectedBuf)) {
      throw new WorkflowError(
        403,
        "Machine credentials not accepted on clinician-action routes",
        "MACHINE_CREDENTIAL_REJECTED",
      );
    }
  }
}

function requireRecord(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new WorkflowError(400, "JSON object body is required", "INVALID_INPUT");
  }

  return body as Record<string, unknown>;
}

function requireStringField(body: Record<string, unknown>, fieldName: string) {
  const value = body[fieldName];
  if (typeof value !== "string") {
    throw new WorkflowError(400, `${fieldName} is required`, "INVALID_INPUT");
  }

  return value;
}

function requireClinicianActionIdentity(
  body: Record<string, unknown>,
  config: AppConfig,
  fieldName: "reviewerId" | "clinicianId",
) {
  if (config.reviewerIdentitySource === "request-body") {
    return requireStringField(body, fieldName);
  }

  throw new WorkflowError(500, "Unsupported reviewer identity source", "INTERNAL_ERROR");
}

function requireStringArrayField(body: Record<string, unknown>, fieldName: string) {
  const value = body[fieldName];
  if (!Array.isArray(value)) {
    throw new WorkflowError(400, `${fieldName} must be an array`, "INVALID_INPUT");
  }

  return value.map((entry) => String(entry));
}

function optionalStringField(body: Record<string, unknown>, fieldName: string) {
  const value = body[fieldName];
  return typeof value === "string" ? value : undefined;
}

function optionalDeliveryOutcome(body: Record<string, unknown>) {
  const value = body.deliveryOutcome;
  if (value === "pending" || value === "failed" || value === "delivered") {
    return value;
  }
  if (typeof value === "undefined") {
    return undefined;
  }

  throw new WorkflowError(400, "deliveryOutcome must be pending, failed, or delivered", "INVALID_INPUT");
}

function requireCaseReadView(value: unknown) {
  if (typeof value === "undefined") {
    return "detail" as const;
  }

  if (value === "detail" || value === "summary") {
    return value;
  }

  throw new WorkflowError(400, "view must be detail or summary", "INVALID_INPUT");
}

function requireMeasurements(body: Record<string, unknown>) {
  const value = body.measurements;
  if (!Array.isArray(value)) {
    throw new WorkflowError(400, "measurements must be an array", "INVALID_INPUT");
  }

  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new WorkflowError(400, "measurement entries must be objects", "INVALID_INPUT");
    }

    const measurement = entry as Record<string, unknown>;
    if (typeof measurement.label !== "string" || typeof measurement.value !== "number") {
      throw new WorkflowError(400, "measurement.label and measurement.value are required", "INVALID_INPUT");
    }

    return {
      label: measurement.label,
      value: measurement.value,
      unit: typeof measurement.unit === "string" ? measurement.unit : undefined,
    };
  });
}

function requireDeliveryStatus(body: Record<string, unknown>) {
  const value = body.deliveryStatus;
  if (value === "delivered" || value === "failed") {
    return value;
  }

  throw new WorkflowError(400, "deliveryStatus must be delivered or failed", "INVALID_INPUT");
}

function requireQueueStage(body: Record<string, unknown>) {
  const value = body.stage;
  if (value === "inference" || value === "delivery") {
    return value;
  }

  throw new WorkflowError(400, "stage must be inference or delivery", "INVALID_INPUT");
}

function requireOptionalLeaseContext(body: Record<string, unknown>) {
  const hasLeaseId = Object.prototype.hasOwnProperty.call(body, "leaseId");
  const hasWorkerId = Object.prototype.hasOwnProperty.call(body, "workerId");

  if (!hasLeaseId && !hasWorkerId) {
    return {};
  }

  return {
    leaseId: requireStringField(body, "leaseId"),
    workerId: requireStringField(body, "workerId"),
  };
}

function resolveCorrelationId(req: express.Request) {
  const header = req.header(CORRELATION_HEADER);
  return typeof header === "string" && header.trim().length > 0 ? header.trim() : randomUUID();
}

function getCorrelationId(res: express.Response) {
  return typeof res.locals.correlationId === "string" ? res.locals.correlationId : randomUUID();
}

function writeStructuredLog(entry: Record<string, unknown>) {
  process.stdout.write(`${JSON.stringify({ service: "mri-second-opinion", ...entry })}\n`);
}

function logMutation(
  req: express.Request,
  res: express.Response,
  input: {
    event: string;
    outcome: "completed" | "failed";
    statusCode: number;
    caseId?: string | null;
    errorCode?: string | null;
  },
) {
  writeStructuredLog({
    ts: new Date().toISOString(),
    type: "workflow-mutation",
    event: input.event,
    correlationId: getCorrelationId(res),
    method: req.method,
    path: req.path,
    caseId: input.caseId ?? null,
    outcome: input.outcome,
    statusCode: input.statusCode,
    errorCode: input.errorCode ?? null,
  });
}

function renderOperatorSurface(caseId: string | undefined) {
  const selectedCaseId = typeof caseId === "string" && caseId.trim().length > 0 ? caseId.trim() : "";
  const caseDetailPath = selectedCaseId ? `/api/cases/${selectedCaseId}` : "/api/cases/:caseId";
  const reviewPath = selectedCaseId ? `/api/cases/${selectedCaseId}/review` : "/api/cases/:caseId/review";
  const finalizePath = selectedCaseId ? `/api/cases/${selectedCaseId}/finalize` : "/api/cases/:caseId/finalize";
  const reportPath = selectedCaseId ? `/api/cases/${selectedCaseId}/report` : "/api/cases/:caseId/report";
  const retryPath = selectedCaseId ? `/api/delivery/${selectedCaseId}/retry` : "/api/delivery/:caseId/retry";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>MRI Operator Surface</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f4efe7;
        --card: #fffaf3;
        --ink: #1d1b18;
        --muted: #62584f;
        --accent: #8f3b2e;
        --accent-soft: #e8c7b6;
        --line: #d7cabd;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: Georgia, "Iowan Old Style", "Palatino Linotype", serif;
        color: var(--ink);
        background:
          radial-gradient(circle at top left, rgba(143, 59, 46, 0.16), transparent 28%),
          linear-gradient(135deg, #f6f1ea 0%, #efe6db 45%, #e7dccf 100%);
      }
      header {
        padding: 32px 24px 16px;
      }
      h1 {
        margin: 0 0 8px;
        font-size: clamp(2rem, 3vw, 3.2rem);
        line-height: 1;
      }
      .subhead {
        color: var(--muted);
        max-width: 72ch;
      }
      main {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 16px;
        padding: 0 24px 24px;
      }
      section {
        background: rgba(255, 250, 243, 0.94);
        border: 1px solid var(--line);
        border-radius: 18px;
        padding: 18px;
        box-shadow: 0 10px 30px rgba(61, 43, 28, 0.08);
        min-height: 220px;
      }
      h2 {
        margin-top: 0;
        font-size: 1.1rem;
        letter-spacing: 0.02em;
      }
      .eyebrow {
        display: inline-block;
        margin-bottom: 8px;
        color: var(--accent);
        font-size: 0.78rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      code, pre, textarea, input, button {
        font-family: "Cascadia Code", Consolas, monospace;
      }
      pre {
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        background: #201c18;
        color: #f9f3ec;
        padding: 12px;
        border-radius: 12px;
        min-height: 120px;
      }
      textarea, input {
        width: 100%;
        border: 1px solid var(--line);
        border-radius: 10px;
        padding: 10px 12px;
        background: #fffdf9;
      }
      textarea { min-height: 90px; resize: vertical; }
      .actions {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        margin-top: 12px;
      }
      button {
        border: 0;
        border-radius: 999px;
        padding: 10px 16px;
        background: var(--accent);
        color: white;
        cursor: pointer;
      }
      button.secondary {
        background: #5b6c7b;
      }
      .meta {
        margin-top: 10px;
        color: var(--muted);
        font-size: 0.92rem;
      }
      .paths {
        list-style: none;
        padding: 0;
        margin: 0;
        display: grid;
        gap: 6px;
      }
      .paths li {
        padding: 10px 12px;
        border-radius: 10px;
        background: rgba(232, 199, 182, 0.35);
      }
    </style>
  </head>
  <body>
    <header>
      <div class="eyebrow">Wave 1 Equivalent Operator Surface</div>
      <h1>MRI Operator Surface</h1>
      <p class="subhead">This page is the current standalone review workspace equivalent. It binds directly to the live workflow endpoints for queue visibility, case detail, clinician review, finalization, and report preview.</p>
    </header>
    <main>
      <section>
        <div class="eyebrow">Operations</div>
        <h2>Queue Dashboard</h2>
        <ul class="paths">
          <li>/api/operations/summary</li>
          <li>/api/cases</li>
        </ul>
        <div class="actions">
          <button id="refresh-queue">Refresh Queue</button>
        </div>
        <pre id="queue-output">Awaiting queue refresh…</pre>
      </section>
      <section>
        <div class="eyebrow">Review</div>
        <h2>Case Detail</h2>
        <input id="case-id" value="${selectedCaseId}" placeholder="Enter caseId" />
        <div class="meta">Bound endpoint: ${caseDetailPath}</div>
        <div class="actions">
          <button id="refresh-case" class="secondary">Load Case Detail</button>
        </div>
        <pre id="case-output">Awaiting case selection…</pre>
      </section>
      <section>
        <div class="eyebrow">Clinician Action</div>
        <h2>Review Workspace</h2>
        <div class="meta">Bound endpoints: ${reviewPath} and ${finalizePath}</div>
        <div class="meta">Retry endpoint: ${retryPath}</div>
        <input id="reviewer-id" value="clinician-demo" placeholder="clinician identity" />
        <textarea id="review-comments" placeholder="Review comments">Reviewed through operator surface.</textarea>
        <div class="actions">
          <button id="send-review">POST Review</button>
          <button id="send-finalize" class="secondary">POST Finalize</button>
          <button id="send-retry" class="secondary">Retry Delivery</button>
        </div>
        <pre id="review-output">Review actions have not been sent.</pre>
      </section>
      <section>
        <div class="eyebrow">Release Surface</div>
        <h2>Report Preview</h2>
        <div class="meta">Bound endpoint: ${reportPath}</div>
        <div class="actions">
          <button id="refresh-report">Load Report Preview</button>
        </div>
        <pre id="report-output">Awaiting report preview…</pre>
      </section>
    </main>
    <script>
      const queuePath = "/api/operations/summary";
      const caseListPath = "/api/cases";
      const getCaseId = () => document.getElementById("case-id").value.trim();
      const casePath = () => getCaseId() ? "/api/cases/" + encodeURIComponent(getCaseId()) : "/api/cases/:caseId";
      const reviewPath = () => getCaseId() ? "/api/cases/" + encodeURIComponent(getCaseId()) + "/review" : "/api/cases/:caseId/review";
      const finalizePath = () => getCaseId() ? "/api/cases/" + encodeURIComponent(getCaseId()) + "/finalize" : "/api/cases/:caseId/finalize";
      const reportPath = () => getCaseId() ? "/api/cases/" + encodeURIComponent(getCaseId()) + "/report" : "/api/cases/:caseId/report";
      const retryPath = () => getCaseId() ? "/api/delivery/" + encodeURIComponent(getCaseId()) + "/retry" : "/api/delivery/:caseId/retry";

      async function loadJson(path, outputId) {
        const response = await fetch(path);
        const text = await response.text();
        document.getElementById(outputId).textContent = text;
      }

      document.getElementById("refresh-queue").addEventListener("click", async () => {
        await loadJson(queuePath, "queue-output");
      });

      document.getElementById("refresh-case").addEventListener("click", async () => {
        await loadJson(casePath(), "case-output");
      });

      document.getElementById("refresh-report").addEventListener("click", async () => {
        await loadJson(reportPath(), "report-output");
      });

      document.getElementById("send-review").addEventListener("click", async () => {
        const response = await fetch(reviewPath(), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            reviewerId: document.getElementById("reviewer-id").value,
            comments: document.getElementById("review-comments").value,
          }),
        });
        document.getElementById("review-output").textContent = await response.text();
      });

      document.getElementById("send-finalize").addEventListener("click", async () => {
        const response = await fetch(finalizePath(), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            clinicianId: document.getElementById("reviewer-id").value,
            finalSummary: "Finalized through operator surface.",
          }),
        });
        document.getElementById("review-output").textContent = await response.text();
      });

      document.getElementById("send-retry").addEventListener("click", async () => {
        const response = await fetch(retryPath(), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        });
        document.getElementById("review-output").textContent = await response.text();
      });

      void loadJson(queuePath, "queue-output");
      if (getCaseId()) {
        void loadJson(casePath(), "case-output");
        void loadJson(reportPath(), "report-output");
      }
    </script>
  </body>
</html>`;
}

export function createApp(config: AppConfig) {
  const app = express();
  const artifactStore = config.artifactStore ?? createDefaultArtifactStoreConfig();
  const repository = config.persistenceMode === "postgres"
    ? new PostgresCaseRepository(config.databaseUrl as string)
    : new SnapshotCaseRepository({
        snapshotFilePath: config.caseStoreFile,
      });
  const dispatchQueue = createDispatchQueueFromConfig(
    config.dispatchQueue ?? createDefaultDispatchQueueConfig(),
    repository,
  );
  const caseService = new MemoryCaseService({
    repository,
    snapshotFilePath: config.caseStoreFile,
    artifactStore,
    dispatchQueue,
  });

  // Replay store: active only when HMAC is configured (nonces exist only in signed requests)
  const replayStore: ReplayStore | null = config.hmacSecret
    ? new MemoryReplayStore({ ttlMs: config.replayStoreTtlMs, maxEntries: config.replayStoreMaxEntries })
    : null;

  app.disable("x-powered-by");
  app.use(express.json({
    limit: "1mb",
    verify: (_req, _res, buf) => { (_req as any).rawBody = buf; },
  }));
  app.use((req, res, next) => {
    const correlationId = resolveCorrelationId(req);
    res.locals.correlationId = correlationId;
    res.setHeader(CORRELATION_HEADER, correlationId);
    next();
  });

  function handleError(res: express.Response, error: unknown) {
    if (error instanceof WorkflowError) {
      res.status(error.statusCode).json({
        error: error.message,
        code: error.code,
      });
      return;
    }

    res.status(500).json({
      error: "Internal server error",
      code: "INTERNAL_ERROR",
    });
  }

  async function executeMutation(
    req: express.Request,
    res: express.Response,
    event: string,
    handler: () => Promise<{ statusCode?: number; body: unknown; caseId?: string | null }>,
  ) {
    try {
      const result = await handler();
      const statusCode = result.statusCode ?? 200;
      logMutation(req, res, {
        event,
        outcome: "completed",
        statusCode,
        caseId: result.caseId ?? null,
      });
      res.status(statusCode).json(result.body);
    } catch (error) {
      logMutation(req, res, {
        event,
        outcome: "failed",
        statusCode: error instanceof WorkflowError ? error.statusCode : 500,
        caseId: typeof req.params.caseId === "string" ? req.params.caseId : null,
        errorCode: error instanceof WorkflowError ? error.code : "INTERNAL_ERROR",
      });
      handleError(res, error);
    }
  }

  app.get("/", (_req, res) => {
    res.json({
      name: "mri-second-opinion",
      status: "wave1-api",
      nodeEnv: config.nodeEnv,
      persistenceMode: config.persistenceMode,
      message: "MRI workflow API baseline is available with durable local state.",
      internalRouteAuth: {
        enabled: Boolean(config.hmacSecret || config.internalApiToken),
        scheme: config.hmacSecret ? "hmac-sha256" : config.internalApiToken ? "bearer" : "none",
      },
      clinicianReviewPolicy: {
        reviewerIdentitySource: config.reviewerIdentitySource,
        machineCredentialsRejected: true,
      },
      artifactStore: {
        provider: artifactStore.provider,
        endpoint: artifactStore.endpoint,
        bucket: artifactStore.bucket,
      },
      queue: {
        provider: (config.dispatchQueue ?? createDefaultDispatchQueueConfig()).provider,
      },
      api: {
        public: [
          "POST /api/cases",
          "GET /api/cases",
          "GET /api/cases/:caseId",
          "POST /api/cases/:caseId/review",
          "POST /api/cases/:caseId/finalize",
          "GET /api/cases/:caseId/report",
          "GET /api/operations/summary",
          "POST /api/delivery/:caseId/retry",
        ],
        internal: [
          "POST /api/internal/dispatch/claim",
          "POST /api/internal/dispatch/heartbeat",
          "POST /api/internal/ingest",
          "POST /api/internal/inference-callback",
          "POST /api/internal/delivery-callback",
        ],
      },
      docs: {
        scope: "docs/scope-lock.md",
        launchReadiness: "docs/launch-readiness-checklist.md",
        verdict: "docs/releases/v1-go-no-go.md",
      },
    });
  });

  app.get("/healthz", (_req, res) => {
    res.status(200).json({
      status: "ok",
      service: "mri-second-opinion",
    });
  });

  app.get("/readyz", (_req, res) => {
    res.status(200).json({
      status: "ready",
      service: "mri-second-opinion",
      mode: "wave1-api",
      persistenceMode: config.persistenceMode,
    });
  });

  app.get("/metrics", (_req, res) => {
    res.type("text/plain").send([
      "# MRI Standalone API baseline metrics placeholder",
      "# No Prometheus metrics are exported yet.",
      'mri_standalone_api_info{service="mri-second-opinion",mode="wave1-api"} 1',
    ].join("\n"));
  });

  app.get("/operator", (req, res) => {
    res.type("text/html").send(renderOperatorSurface(typeof req.query.caseId === "string" ? req.query.caseId : undefined));
  });

  app.post("/api/cases", async (req, res) => {
    await executeMutation(req, res, "case-created", async () => {
      const input = requireRecord(req.body);
      const created = await caseService.createCase({
        patientAlias: requireStringField(input, "patientAlias"),
        studyUid: requireStringField(input, "studyUid"),
        sequenceInventory: requireStringArrayField(input, "sequenceInventory"),
        indication: optionalStringField(input, "indication"),
        correlationId: getCorrelationId(res),
      });

      return { statusCode: 201, body: { case: created }, caseId: created.caseId };
    });
  });

  app.get("/api/cases", async (_req, res) => {
    res.json({ cases: await caseService.listCases() });
  });

  app.get("/api/cases/:caseId", async (req, res) => {
    try {
      const view = requireCaseReadView(req.query.view);
      const caseRecord =
        view === "summary"
          ? await caseService.getCaseSummary(req.params.caseId)
          : await caseService.getCase(req.params.caseId);
      res.json({ case: caseRecord });
    } catch (error) {
      handleError(res, error);
    }
  });

  app.post("/api/cases/:caseId/review", async (req, res) => {
    await executeMutation(req, res, "clinician-reviewed", async () => {
      rejectMachineCredentials(req, config);
      const input = requireRecord(req.body);
      const updated = await caseService.reviewCase(req.params.caseId, {
        reviewerId: requireClinicianActionIdentity(input, config, "reviewerId"),
        reviewerRole: optionalStringField(input, "reviewerRole"),
        comments: optionalStringField(input, "comments"),
        finalImpression: optionalStringField(input, "finalImpression"),
        correlationId: getCorrelationId(res),
      });

      return { body: { case: updated }, caseId: updated.caseId };
    });
  });

  app.post("/api/cases/:caseId/finalize", async (req, res) => {
    await executeMutation(req, res, "case-finalized", async () => {
      rejectMachineCredentials(req, config);
      const input = requireRecord(req.body);
      const updated = await caseService.finalizeCase(req.params.caseId, {
        clinicianId: requireClinicianActionIdentity(input, config, "clinicianId"),
        finalSummary: optionalStringField(input, "finalSummary"),
        deliveryOutcome: optionalDeliveryOutcome(input),
        correlationId: getCorrelationId(res),
      });

      return { body: { case: updated }, caseId: updated.caseId };
    });
  });

  app.get("/api/cases/:caseId/report", async (req, res) => {
    try {
      res.json(await caseService.getReport(req.params.caseId));
    } catch (error) {
      handleError(res, error);
    }
  });

  app.get("/api/operations/summary", async (_req, res) => {
    res.json(await caseService.getOperationsSummary());
  });

  app.post("/api/delivery/:caseId/retry", async (req, res) => {
    await executeMutation(req, res, "delivery-retry-requested", async () => {
      const updated = await caseService.retryDelivery(req.params.caseId, getCorrelationId(res));
      return { body: { case: updated }, caseId: updated.caseId };
    });
  });

  app.post("/api/internal/ingest", async (req, res) => {
    await executeMutation(req, res, "ingest-request", async () => {
      requireInternalAuthorization(req, config);
      await requireNonceNotReplayed(req, replayStore);
      const input = requireRecord(req.body);
      const created = await caseService.ingestCase({
        patientAlias: requireStringField(input, "patientAlias"),
        studyUid: requireStringField(input, "studyUid"),
        sequenceInventory: requireStringArrayField(input, "sequenceInventory"),
        indication: optionalStringField(input, "indication"),
        correlationId: getCorrelationId(res),
      });

      return { statusCode: 201, body: { case: created }, caseId: created.caseId };
    });
  });

  app.post("/api/internal/dispatch/claim", async (req, res) => {
    await executeMutation(req, res, "dispatch-claimed", async () => {
      requireInternalAuthorization(req, config);
      await requireNonceNotReplayed(req, replayStore);
      const input = requireRecord(req.body);
      const dispatch = await caseService.claimNextDispatch({
        workerId: requireStringField(input, "workerId"),
        stage: requireQueueStage(input),
        leaseSeconds: typeof input.leaseSeconds === "number" ? input.leaseSeconds : undefined,
        correlationId: getCorrelationId(res),
      });

      return { body: { dispatch }, caseId: dispatch?.caseId ?? null };
    });
  });

  app.post("/api/internal/dispatch/heartbeat", async (req, res) => {
    await executeMutation(req, res, "dispatch-heartbeat", async () => {
      requireInternalAuthorization(req, config);
      await requireNonceNotReplayed(req, replayStore);
      const input = requireRecord(req.body);
      const dispatch = await caseService.renewDispatchLease(requireStringField(input, "caseId"), {
        leaseId: requireStringField(input, "leaseId"),
        workerId: requireStringField(input, "workerId"),
        stage: requireQueueStage(input),
        leaseSeconds: typeof input.leaseSeconds === "number" ? input.leaseSeconds : undefined,
        correlationId: getCorrelationId(res),
      });

      return { body: { dispatch }, caseId: dispatch.caseId };
    });
  });

  app.post("/api/internal/inference-callback", async (req, res) => {
    await executeMutation(req, res, "inference-callback", async () => {
      requireInternalAuthorization(req, config);
      await requireNonceNotReplayed(req, replayStore);
      const input = requireRecord(req.body);
      const leaseContext = requireOptionalLeaseContext(input);
      const updated = await caseService.completeInference(requireStringField(input, "caseId"), {
        qcDisposition: requireStringField(input, "qcDisposition") as InferenceCallbackInput["qcDisposition"],
        findings: requireStringArrayField(input, "findings"),
        measurements: requireMeasurements(input),
        artifacts: requireStringArrayField(input, "artifacts"),
        issues: Array.isArray(input.issues) ? input.issues.map((entry) => String(entry)) : undefined,
        generatedSummary: optionalStringField(input, "generatedSummary"),
        correlationId: getCorrelationId(res),
        ...leaseContext,
      });

      return { body: { case: updated }, caseId: updated.caseId };
    });
  });

  app.post("/api/internal/delivery-callback", async (req, res) => {
    await executeMutation(req, res, "delivery-callback", async () => {
      requireInternalAuthorization(req, config);
      await requireNonceNotReplayed(req, replayStore);
      const input = requireRecord(req.body);
      const leaseContext = requireOptionalLeaseContext(input);
      const updated = await caseService.completeDelivery(requireStringField(input, "caseId"), {
        deliveryStatus: requireDeliveryStatus(input),
        detail: optionalStringField(input, "detail"),
        correlationId: getCorrelationId(res),
        ...leaseContext,
      });

      return { body: { case: updated }, caseId: updated.caseId };
    });
  });

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof SyntaxError) {
      handleError(res, new WorkflowError(400, "Malformed JSON body", "INVALID_INPUT"));
      return;
    }

    handleError(res, error);
  });

  return app;
}

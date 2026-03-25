import express from "express";
import type { AppConfig } from "./config";
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
        <input id="reviewer-id" value="clinician-demo" placeholder="reviewerId" />
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
          body: JSON.stringify({ finalSummary: "Finalized through operator surface." }),
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
  const repository = config.persistenceMode === "postgres"
    ? new PostgresCaseRepository(config.databaseUrl as string)
    : new SnapshotCaseRepository({
        snapshotFilePath: config.caseStoreFile,
      });
  const caseService = new MemoryCaseService({ repository, snapshotFilePath: config.caseStoreFile });

  app.disable("x-powered-by");
  app.use(express.json());

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

  app.get("/", (_req, res) => {
    res.json({
      name: "mri-second-opinion",
      status: "wave1-api",
      nodeEnv: config.nodeEnv,
      persistenceMode: config.persistenceMode,
      message: "MRI workflow API baseline is available with durable local state.",
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
    try {
      const input = requireRecord(req.body);
      const created = await caseService.createCase({
        patientAlias: requireStringField(input, "patientAlias"),
        studyUid: requireStringField(input, "studyUid"),
        sequenceInventory: requireStringArrayField(input, "sequenceInventory"),
        indication: optionalStringField(input, "indication"),
      });

      res.status(201).json({ case: created });
    } catch (error) {
      handleError(res, error);
    }
  });

  app.get("/api/cases", async (_req, res) => {
    res.json({ cases: await caseService.listCases() });
  });

  app.get("/api/cases/:caseId", async (req, res) => {
    try {
      res.json({ case: await caseService.getCase(req.params.caseId) });
    } catch (error) {
      handleError(res, error);
    }
  });

  app.post("/api/cases/:caseId/review", async (req, res) => {
    try {
      const input = requireRecord(req.body);
      const updated = await caseService.reviewCase(req.params.caseId, {
        reviewerId: requireStringField(input, "reviewerId"),
        reviewerRole: optionalStringField(input, "reviewerRole"),
        comments: optionalStringField(input, "comments"),
        finalImpression: optionalStringField(input, "finalImpression"),
      });

      res.json({ case: updated });
    } catch (error) {
      handleError(res, error);
    }
  });

  app.post("/api/cases/:caseId/finalize", async (req, res) => {
    try {
      const input = requireRecord(req.body);
      const updated = await caseService.finalizeCase(req.params.caseId, {
        finalSummary: optionalStringField(input, "finalSummary"),
        deliveryOutcome: optionalDeliveryOutcome(input),
      });

      res.json({ case: updated });
    } catch (error) {
      handleError(res, error);
    }
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
    try {
      res.json({ case: await caseService.retryDelivery(req.params.caseId) });
    } catch (error) {
      handleError(res, error);
    }
  });

  app.post("/api/internal/ingest", async (req, res) => {
    try {
      const input = requireRecord(req.body);
      const created = await caseService.ingestCase({
        patientAlias: requireStringField(input, "patientAlias"),
        studyUid: requireStringField(input, "studyUid"),
        sequenceInventory: requireStringArrayField(input, "sequenceInventory"),
        indication: optionalStringField(input, "indication"),
      });

      res.status(201).json({ case: created });
    } catch (error) {
      handleError(res, error);
    }
  });

  app.post("/api/internal/inference-callback", async (req, res) => {
    try {
      const input = requireRecord(req.body);

      res.json({
        case: await caseService.completeInference(requireStringField(input, "caseId"), {
          qcDisposition: requireStringField(input, "qcDisposition") as InferenceCallbackInput["qcDisposition"],
          findings: requireStringArrayField(input, "findings"),
          measurements: requireMeasurements(input),
          artifacts: requireStringArrayField(input, "artifacts"),
          issues: Array.isArray(input.issues) ? input.issues.map((entry) => String(entry)) : undefined,
          generatedSummary: optionalStringField(input, "generatedSummary"),
        }),
      });
    } catch (error) {
      handleError(res, error);
    }
  });

  app.post("/api/internal/delivery-callback", async (req, res) => {
    try {
      const input = requireRecord(req.body);

      res.json({
        case: await caseService.completeDelivery(requireStringField(input, "caseId"), {
          deliveryStatus: requireDeliveryStatus(input),
          detail: optionalStringField(input, "detail"),
        }),
      });
    } catch (error) {
      handleError(res, error);
    }
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

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

export function createApp(config: AppConfig) {
  const app = express();
  const caseService = new MemoryCaseService({
    snapshotFilePath: config.caseStoreFile,
  });

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
    });
  });

  app.get("/metrics", (_req, res) => {
    res.type("text/plain").send([
      "# MRI Standalone API baseline metrics placeholder",
      "# No Prometheus metrics are exported yet.",
      'mri_standalone_api_info{service="mri-second-opinion",mode="wave1-api"} 1',
    ].join("\n"));
  });

  app.post("/api/cases", (req, res) => {
    try {
      const input = requireRecord(req.body);
      const created = caseService.createCase({
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

  app.get("/api/cases", (_req, res) => {
    res.json({ cases: caseService.listCases() });
  });

  app.get("/api/cases/:caseId", (req, res) => {
    try {
      res.json({ case: caseService.getCase(req.params.caseId) });
    } catch (error) {
      handleError(res, error);
    }
  });

  app.post("/api/cases/:caseId/review", (req, res) => {
    try {
      const input = requireRecord(req.body);
      const updated = caseService.reviewCase(req.params.caseId, {
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

  app.post("/api/cases/:caseId/finalize", (req, res) => {
    try {
      const input = requireRecord(req.body);
      const updated = caseService.finalizeCase(req.params.caseId, {
        finalSummary: optionalStringField(input, "finalSummary"),
        deliveryOutcome: optionalDeliveryOutcome(input),
      });

      res.json({ case: updated });
    } catch (error) {
      handleError(res, error);
    }
  });

  app.get("/api/cases/:caseId/report", (req, res) => {
    try {
      res.json(caseService.getReport(req.params.caseId));
    } catch (error) {
      handleError(res, error);
    }
  });

  app.get("/api/operations/summary", (_req, res) => {
    res.json(caseService.getOperationsSummary());
  });

  app.post("/api/delivery/:caseId/retry", (req, res) => {
    try {
      res.json({ case: caseService.retryDelivery(req.params.caseId) });
    } catch (error) {
      handleError(res, error);
    }
  });

  app.post("/api/internal/ingest", (req, res) => {
    try {
      const input = requireRecord(req.body);
      const created = caseService.ingestCase({
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

  app.post("/api/internal/inference-callback", (req, res) => {
    try {
      const input = requireRecord(req.body);

      res.json({
        case: caseService.completeInference(requireStringField(input, "caseId"), {
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

  app.post("/api/internal/delivery-callback", (req, res) => {
    try {
      const input = requireRecord(req.body);

      res.json({
        case: caseService.completeDelivery(requireStringField(input, "caseId"), {
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

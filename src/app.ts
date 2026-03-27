import express from "express";
import { resolve } from "node:path";
import type { AppConfig } from "./config";
import type { PostgresPoolFactory } from "./case-postgres-repository";
import {
  MemoryCaseService,
  WorkflowError,
  type CreateCaseInput,
  type FinalizeCaseInput,
  type InferenceCallbackInput,
  type ReviewCaseInput,
} from "./cases";
import {
  presentCaseDetail,
  presentDeliveryJob,
  presentInferenceJob,
  presentCaseListItem,
  presentOperationsSummary,
  presentReport,
} from "./case-presentation";

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

function optionalNumberField(body: Record<string, unknown>, fieldName: string) {
  const value = body[fieldName];
  return typeof value === "number" ? value : undefined;
}

function optionalStudyContext(body: Record<string, unknown>): CreateCaseInput["studyContext"] {
  const value = body.studyContext;
  if (typeof value === "undefined") {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WorkflowError(400, "studyContext must be an object", "INVALID_INPUT");
  }

  const studyContext = value as Record<string, unknown>;
  const rawSeries = studyContext.series;
  if (typeof rawSeries !== "undefined" && !Array.isArray(rawSeries)) {
    throw new WorkflowError(400, "studyContext.series must be an array", "INVALID_INPUT");
  }

  return {
    studyInstanceUid: optionalStringField(studyContext, "studyInstanceUid"),
    accessionNumber: optionalStringField(studyContext, "accessionNumber"),
    studyDate: optionalStringField(studyContext, "studyDate"),
    sourceArchive: optionalStringField(studyContext, "sourceArchive"),
    dicomWebBaseUrl: optionalStringField(studyContext, "dicomWebBaseUrl"),
    metadataSummary: Array.isArray(studyContext.metadataSummary)
      ? studyContext.metadataSummary.map((entry) => String(entry))
      : undefined,
    series: Array.isArray(rawSeries)
      ? rawSeries.map((entry, index) => {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            throw new WorkflowError(400, "studyContext.series entries must be objects", "INVALID_INPUT");
          }

          const series = entry as Record<string, unknown>;
          return {
            seriesInstanceUid: optionalStringField(series, "seriesInstanceUid") ?? `series-${index + 1}`,
            seriesDescription: optionalStringField(series, "seriesDescription"),
            modality: optionalStringField(series, "modality"),
            sequenceLabel: optionalStringField(series, "sequenceLabel"),
            instanceCount: optionalNumberField(series, "instanceCount"),
          };
        })
      : undefined,
  };
}

function optionalQcSummary(body: Record<string, unknown>): InferenceCallbackInput["qcSummary"] {
  const value = body.qcSummary;
  if (typeof value === "undefined") {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WorkflowError(400, "qcSummary must be an object", "INVALID_INPUT");
  }

  const qcSummary = value as Record<string, unknown>;
  const rawChecks = qcSummary.checks;
  const rawMetrics = qcSummary.metrics;
  if (typeof rawChecks !== "undefined" && !Array.isArray(rawChecks)) {
    throw new WorkflowError(400, "qcSummary.checks must be an array", "INVALID_INPUT");
  }
  if (typeof rawMetrics !== "undefined" && !Array.isArray(rawMetrics)) {
    throw new WorkflowError(400, "qcSummary.metrics must be an array", "INVALID_INPUT");
  }

  return {
    summary: optionalStringField(qcSummary, "summary"),
    checks: Array.isArray(rawChecks)
      ? rawChecks.map((entry) => {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            throw new WorkflowError(400, "qcSummary.checks entries must be objects", "INVALID_INPUT");
          }

          const check = entry as Record<string, unknown>;
          const status = optionalStringField(check, "status");
          if (status !== "pass" && status !== "warn" && status !== "reject") {
            throw new WorkflowError(400, "qcSummary.checks[].status must be pass, warn, or reject", "INVALID_INPUT");
          }

          return {
            checkId: requireStringField(check, "checkId"),
            status,
            detail: requireStringField(check, "detail"),
          };
        })
      : undefined,
    metrics: Array.isArray(rawMetrics)
      ? rawMetrics.map((entry) => {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            throw new WorkflowError(400, "qcSummary.metrics entries must be objects", "INVALID_INPUT");
          }

          const metric = entry as Record<string, unknown>;
          if (typeof metric.value !== "number") {
            throw new WorkflowError(400, "qcSummary.metrics[].value must be a number", "INVALID_INPUT");
          }

          return {
            name: requireStringField(metric, "name"),
            value: metric.value,
            unit: optionalStringField(metric, "unit"),
          };
        })
      : undefined,
  };
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

function optionalWorkerId(body: Record<string, unknown>) {
  const value = body.workerId;
  return typeof value === "string" ? value : undefined;
}

export interface CreateAppOptions {
  postgresPoolFactory?: PostgresPoolFactory;
}

export function createApp(config: AppConfig, options: CreateAppOptions = {}) {
  const app = express();
  const caseService = new MemoryCaseService({
    caseStoreFilePath: config.caseStoreFile,
    storageMode: config.caseStoreMode,
    caseStoreDatabaseUrl: config.caseStoreDatabaseUrl,
    caseStoreSchema: config.caseStoreSchema,
    postgresPoolFactory: options.postgresPoolFactory,
  });
  const workbenchRoot = resolve(__dirname, "..", "public", "workbench");
  app.locals.caseService = caseService;

  app.disable("x-powered-by");
  app.use(express.json());
  app.use("/workbench", express.static(workbenchRoot, { index: false }));

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
      ui: {
        reviewWorkbench: "/workbench",
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
          "POST /api/internal/ingest",
          "POST /api/internal/inference-callback",
          "GET /api/internal/inference-jobs",
          "POST /api/internal/inference-jobs/claim-next",
          "POST /api/internal/inference-jobs/requeue-expired",
          "GET /api/internal/delivery-jobs",
          "POST /api/internal/delivery-jobs/claim-next",
          "POST /api/internal/delivery-callback",
        ],
      },
      docs: {
        scope: "docs/scope-lock.md",
        inventory: "docs/scope-inventory.md",
        vocabulary: "docs/public-vocabulary.md",
        launchReadiness: "docs/launch-readiness-checklist.md",
        verdict: "docs/releases/v1-go-no-go.md",
      },
    });
  });

  app.get("/workbench", (_req, res) => {
    res.sendFile(resolve(workbenchRoot, "index.html"));
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

  app.post("/api/cases", async (req, res) => {
    try {
      const input = requireRecord(req.body);
      const created = await caseService.createCase({
        patientAlias: requireStringField(input, "patientAlias"),
        studyUid: requireStringField(input, "studyUid"),
        sequenceInventory: requireStringArrayField(input, "sequenceInventory"),
        indication: optionalStringField(input, "indication"),
        studyContext: optionalStudyContext(input),
      });

      res.status(201).json({ case: created });
    } catch (error) {
      handleError(res, error);
    }
  });

  app.get("/api/cases", async (_req, res) => {
    const cases = (await caseService.listCases()).map((caseRecord) => presentCaseListItem(caseRecord));
    res.json({
      cases,
      meta: {
        totalCases: cases.length,
      },
    });
  });

  app.get("/api/cases/:caseId", async (req, res) => {
    try {
      res.json({ case: presentCaseDetail(await caseService.getCase(req.params.caseId)) });
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
      res.json({ report: presentReport(await caseService.getReport(req.params.caseId)) });
    } catch (error) {
      handleError(res, error);
    }
  });

  app.get("/api/operations/summary", async (_req, res) => {
    res.json({ summary: presentOperationsSummary(await caseService.getOperationsSummary()) });
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
        studyContext: optionalStudyContext(input),
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
          qcSummary: optionalQcSummary(input),
        }),
      });
    } catch (error) {
      handleError(res, error);
    }
  });

  app.get("/api/internal/inference-jobs", async (_req, res) => {
    res.json({
      jobs: (await caseService.listInferenceJobs()).map((inferenceJob) => presentInferenceJob(inferenceJob)),
    });
  });

  app.post("/api/internal/inference-jobs/claim-next", async (req, res) => {
    try {
      const input = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? requireRecord(req.body) : {};
      const claimed = await caseService.claimNextInferenceJob(optionalWorkerId(input));
      res.json({
        job: claimed ? presentInferenceJob(claimed) : null,
      });
    } catch (error) {
      handleError(res, error);
    }
  });

  app.post("/api/internal/inference-jobs/requeue-expired", async (req, res) => {
    try {
      const input = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? requireRecord(req.body) : {};
      const maxClaimAgeMs = typeof input.maxClaimAgeMs === "number" ? input.maxClaimAgeMs : 0;
      res.json({
        jobs: (await caseService.requeueExpiredInferenceJobs(maxClaimAgeMs)).map((inferenceJob) => presentInferenceJob(inferenceJob)),
      });
    } catch (error) {
      handleError(res, error);
    }
  });

  app.get("/api/internal/delivery-jobs", async (_req, res) => {
    res.json({
      jobs: (await caseService.listDeliveryJobs()).map((deliveryJob) => presentDeliveryJob(deliveryJob)),
    });
  });

  app.post("/api/internal/delivery-jobs/claim-next", async (req, res) => {
    try {
      const input = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? requireRecord(req.body) : {};
      const claimed = await caseService.claimNextDeliveryJob(optionalWorkerId(input));
      res.json({
        job: claimed ? presentDeliveryJob(claimed) : null,
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

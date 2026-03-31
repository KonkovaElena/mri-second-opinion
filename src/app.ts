import express from "express";
import helmet from "helmet";
import { resolve } from "node:path";
import { createArchiveLookupClient } from "./archive-lookup";
import { createArtifactStore, type ArtifactStore } from "./case-artifact-storage";
import { WorkflowError } from "./case-contracts";
import type { AppConfig } from "./config";
import type { PostgresPoolFactory } from "./case-postgres-repository";
import { MemoryCaseService } from "./cases";
import {
  presentCaseDetail,
  presentDeliveryJob,
  presentInferenceExecutionContract,
  presentInferenceJob,
  presentCaseListItem,
  presentOperationsSummary,
  presentReport,
} from "./case-presentation";
import { buildHealthSnapshot, buildReadinessSnapshot, type RuntimeState } from "./health";
import { buildDicomSrExport, buildFhirDiagnosticReport } from "./case-exports";
import { createInternalAuthMiddleware } from "./internal-auth";
import { createHmacAuthMiddleware } from "./hmac-auth";
import { MemoryReplayStore } from "./replay-store";
import { getRequestId, requestContextMiddleware, requestLoggingMiddleware } from "./request-context";
import {
  parseClaimJobInput,
  type parseCreateCaseInput as parseCreateCaseInputType,
  parseCreateCaseInput,
  parseDeliveryCallbackInput,
  parseDispatchClaimInput,
  parseDispatchFailInput,
  parseDispatchHeartbeatInput,
  parseFinalizeCaseInput,
  parseInferenceCallbackInput,
  parseReviewCaseInput,
  parseRequeueExpiredInferenceJobsInput,
} from "./validation";
import { createPublicApiRateLimiter, metricsMiddleware, writeMetricsResponse } from "./http-runtime";

export interface CreateAppOptions {
  postgresPoolFactory?: PostgresPoolFactory;
  artifactStore?: ArtifactStore;
}

export function createApp(config: AppConfig, options: CreateAppOptions = {}) {
  const app = express();
  const publicApiRateLimiter = createPublicApiRateLimiter(config);
  const securityHeaders = helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'"],
        "style-src": ["'self'"],
        "img-src": ["'self'", "data:", "blob:"],
        "font-src": ["'self'"],
        "connect-src": ["'self'"],
        "object-src": ["'none'"],
        "base-uri": ["'self'"],
        "form-action": ["'self'"],
        "frame-ancestors": ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: "same-origin" },
    crossOriginResourcePolicy: { policy: "same-origin" },
    originAgentCluster: true,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    strictTransportSecurity:
      config.nodeEnv === "production"
        ? { maxAge: 31536000, includeSubDomains: true, preload: true }
        : false,
    xFrameOptions: { action: "deny" },
    xPermittedCrossDomainPolicies: { permittedPolicies: "none" },
  });
  const archiveLookupClient = createArchiveLookupClient({
    archiveLookupBaseUrl: config.archiveLookupBaseUrl,
    archiveLookupSource: config.archiveLookupSource,
  });
  const artifactStore =
    options.artifactStore ??
    createArtifactStore({
      provider: config.artifactStoreProvider,
      caseStoreFilePath: config.caseStoreFile,
      basePath: config.artifactStoreBasePath,
      bucket: config.artifactStoreBucket,
      endpoint: config.artifactStoreEndpoint,
      region: config.artifactStoreRegion,
      forcePathStyle: config.artifactStoreForcePathStyle,
      presignTtlSeconds: config.artifactStorePresignTtlSeconds,
    });
  const caseService = new MemoryCaseService({
    caseStoreFilePath: config.caseStoreFile,
    storageMode: config.caseStoreMode,
    caseStoreDatabaseUrl: config.caseStoreDatabaseUrl,
    caseStoreSchema: config.caseStoreSchema,
    postgresPoolFactory: options.postgresPoolFactory,
    artifactStore,
  });
  const runtimeState: RuntimeState = { isShuttingDown: false };
  const workbenchRoot = resolve(__dirname, "..", "public", "workbench");
  app.locals.caseService = caseService;
  app.locals.runtimeState = runtimeState;

  app.disable("x-powered-by");

  app.use(securityHeaders);

  app.use(requestContextMiddleware);
  app.use(metricsMiddleware);
  app.use(requestLoggingMiddleware);
  app.use("/api/internal", createInternalAuthMiddleware(config));
  app.use("/api", publicApiRateLimiter);
  app.use(express.json({ limit: config.jsonBodyLimit ?? "1mb" }));
  app.use("/workbench", express.static(workbenchRoot, { index: false }));

  type ParsedCreateCaseInput = ReturnType<typeof parseCreateCaseInput>;

  function hasUsableSeries(input: ParsedCreateCaseInput["studyContext"]) {
    return Array.isArray(input?.series) && input.series.length > 0;
  }

  function mergeStudyContext(
    primary: ParsedCreateCaseInput["studyContext"],
    fallback: ParsedCreateCaseInput["studyContext"],
  ): ParsedCreateCaseInput["studyContext"] {
    if (!primary && !fallback) {
      return undefined;
    }

    const merged = {
      studyInstanceUid: primary?.studyInstanceUid ?? fallback?.studyInstanceUid,
      accessionNumber: primary?.accessionNumber ?? fallback?.accessionNumber,
      studyDate: primary?.studyDate ?? fallback?.studyDate,
      sourceArchive: primary?.sourceArchive ?? fallback?.sourceArchive,
      dicomWebBaseUrl: primary?.dicomWebBaseUrl ?? fallback?.dicomWebBaseUrl,
      metadataSummary:
        primary?.metadataSummary && primary.metadataSummary.length > 0
          ? primary.metadataSummary
          : fallback?.metadataSummary,
      series: hasUsableSeries(primary) ? primary?.series : fallback?.series,
    };

    if (
      !merged.studyInstanceUid &&
      !merged.accessionNumber &&
      !merged.studyDate &&
      !merged.sourceArchive &&
      !merged.dicomWebBaseUrl &&
      (!merged.metadataSummary || merged.metadataSummary.length === 0) &&
      (!merged.series || merged.series.length === 0)
    ) {
      return undefined;
    }

    return merged;
  }

  function needsArchiveLookup(input: ParsedCreateCaseInput) {
    return (
      archiveLookupClient.isConfigured() &&
      (!input.studyContext ||
        !input.studyContext.studyInstanceUid ||
        !hasUsableSeries(input.studyContext) ||
        (!input.studyContext.sourceArchive && !input.studyContext.dicomWebBaseUrl))
    );
  }

  async function enrichCreateCaseInput(input: ParsedCreateCaseInput): Promise<ParsedCreateCaseInput> {
    if (!needsArchiveLookup(input)) {
      return input;
    }

    const result = await archiveLookupClient.lookupStudy(input.studyUid);

    if (result.status === "found") {
      return {
        ...input,
        studyContext: mergeStudyContext(input.studyContext, result.studyContext),
      };
    }

    if (result.status === "error") {
      console.warn(
        JSON.stringify({
          event: "archive_lookup_error",
          studyUid: input.studyUid,
          reason: result.reason,
          ...(result.httpStatus !== undefined ? { httpStatus: result.httpStatus } : {}),
        }),
      );
    }

    return input;
  }

  function handleError(res: express.Response, error: unknown) {
    const requestId = getRequestId(res);

    if (error instanceof WorkflowError) {
      res.status(error.statusCode).json({
        error: error.message,
        code: error.code,
        requestId,
      });
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;

    console.error(
      JSON.stringify({
        level: "error",
        event: "unhandled_error",
        requestId,
        message,
        ...(stack !== undefined ? { stack } : {}),
        timestamp: new Date().toISOString(),
      }),
    );

    res.status(500).json({
      error: "Internal server error",
      code: "INTERNAL_ERROR",
      requestId,
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
          "GET /api/cases/:caseId/exports/dicom-sr",
          "GET /api/cases/:caseId/exports/fhir-diagnostic-report",
          "GET /api/cases/:caseId/artifacts/:artifactId",
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
          "POST /api/internal/dispatch/claim",
          "POST /api/internal/dispatch/heartbeat",
          "POST /api/internal/dispatch/fail",
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
    res.status(200).json(buildHealthSnapshot(config, getRequestId(res)));
  });

  app.get("/readyz", async (_req, res) => {
    const snapshot = await buildReadinessSnapshot(config, caseService, getRequestId(res), runtimeState);
    res.status(snapshot.statusCode).json(snapshot.body);
  });

  app.get("/metrics", async (_req, res) => {
    try {
      await writeMetricsResponse(res);
    } catch {
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to collect metrics", requestId: getRequestId(res) });
      }
    }
  });

  app.post("/api/cases", async (req, res) => {
    try {
      const parsed = parseCreateCaseInput(req.body);
      const created = await caseService.createCase(await enrichCreateCaseInput(parsed));

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
      const updated = await caseService.reviewCase(req.params.caseId, parseReviewCaseInput(req.body));

      res.json({ case: updated });
    } catch (error) {
      handleError(res, error);
    }
  });

  app.post("/api/cases/:caseId/finalize", async (req, res) => {
    try {
      const updated = await caseService.finalizeCase(req.params.caseId, parseFinalizeCaseInput(req.body));

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

  app.get("/api/cases/:caseId/exports/dicom-sr", async (req, res) => {
    try {
      const report = await caseService.getFinalizedReport(req.params.caseId);
      res.json({ dicomSr: buildDicomSrExport(report) });
    } catch (error) {
      handleError(res, error);
    }
  });

  app.get("/api/cases/:caseId/exports/fhir-diagnostic-report", async (req, res) => {
    try {
      const record = await caseService.getCase(req.params.caseId);
      const report = await caseService.getFinalizedReport(req.params.caseId);
      res.json({ diagnosticReport: buildFhirDiagnosticReport(report, record.patientAlias) });
    } catch (error) {
      handleError(res, error);
    }
  });

  app.get("/api/cases/:caseId/artifacts/:artifactId", async (req, res) => {
    try {
      const artifact = await caseService.getArtifact(req.params.caseId, req.params.artifactId);

      if ("redirectUrl" in artifact && typeof artifact.redirectUrl === "string") {
        res.redirect(302, artifact.redirectUrl);
        return;
      }

      res.setHeader("content-type", artifact.artifact.mimeType);
      res.setHeader("content-length", String(artifact.content.byteLength));
      res.send(artifact.content);
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
      const parsed = parseCreateCaseInput(req.body);
      const created = await caseService.ingestCase(await enrichCreateCaseInput(parsed));

      res.status(201).json({ case: created });
    } catch (error) {
      handleError(res, error);
    }
  });

  app.post("/api/internal/inference-callback", async (req, res) => {
    try {
      const parsed = parseInferenceCallbackInput(req.body);

      res.json({
        case: await caseService.completeInference(parsed.caseId, parsed.input),
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
      const input = parseClaimJobInput(req.body);
      const claimed = await caseService.claimNextInferenceJob(input.workerId);
      const claimedCase = claimed ? await caseService.getCase(claimed.caseId) : null;
      res.json({
        job: claimed ? presentInferenceJob(claimed) : null,
        execution:
          claimed && claimedCase
            ? presentInferenceExecutionContract({
                caseRecord: claimedCase,
                inferenceJob: claimed,
              })
            : null,
      });
    } catch (error) {
      handleError(res, error);
    }
  });

  app.post("/api/internal/inference-jobs/requeue-expired", async (req, res) => {
    try {
      const input = parseRequeueExpiredInferenceJobsInput(req.body);
      res.json({
        jobs: (await caseService.requeueExpiredInferenceJobs(input.maxClaimAgeMs)).map((inferenceJob) => presentInferenceJob(inferenceJob)),
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
      const input = parseClaimJobInput(req.body);
      const claimed = await caseService.claimNextDeliveryJob(input.workerId);
      res.json({
        job: claimed ? presentDeliveryJob(claimed) : null,
      });
    } catch (error) {
      handleError(res, error);
    }
  });

  app.post("/api/internal/delivery-callback", async (req, res) => {
    try {
      const parsed = parseDeliveryCallbackInput(req.body);

      res.json({
        case: await caseService.completeDelivery(parsed.caseId, parsed.input),
      });
    } catch (error) {
      handleError(res, error);
    }
  });

  // --- Dispatch routes (HMAC-authenticated for external workers) ---

  const replayStore = new MemoryReplayStore({
    ttlMs: config.replayStoreTtlMs,
    maxEntries: config.replayStoreMaxEntries,
  });

  const hmacAuth = createHmacAuthMiddleware(config, replayStore);

  app.post("/api/internal/dispatch/claim", hmacAuth, async (req, res) => {
    try {
      const input = parseDispatchClaimInput(req.body);
      const claimed = await caseService.claimNextInferenceJob(input.workerId);
      const claimedCase = claimed ? await caseService.getCase(claimed.caseId) : null;
      res.json({
        dispatch: claimed
          ? {
              caseId: claimed.caseId,
              jobId: claimed.jobId,
              leaseId: claimed.leaseId,
              leaseExpiresAt: claimed.leaseExpiresAt,
            }
          : null,
        execution:
          claimed && claimedCase
            ? presentInferenceExecutionContract({
                caseRecord: claimedCase,
                inferenceJob: claimed,
              })
            : null,
      });
    } catch (error) {
      handleError(res, error);
    }
  });

  app.post("/api/internal/dispatch/heartbeat", hmacAuth, async (req, res) => {
    try {
      const input = parseDispatchHeartbeatInput(req.body);
      const renewed = await caseService.renewLease(input.leaseId);
      res.json({
        leaseId: renewed.leaseId,
        leaseExpiresAt: renewed.leaseExpiresAt,
        jobId: renewed.jobId,
      });
    } catch (error) {
      handleError(res, error);
    }
  });

  app.post("/api/internal/dispatch/fail", hmacAuth, async (req, res) => {
    try {
      const input = parseDispatchFailInput(req.body);
      const result = await caseService.failInferenceJob(input);
      res.json(result);
    } catch (error) {
      handleError(res, error);
    }
  });

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (
      typeof error === "object" &&
      error !== null &&
      (("type" in error && error.type === "entity.too.large") ||
        ("status" in error && error.status === 413) ||
        ("statusCode" in error && error.statusCode === 413))
    ) {
      handleError(
        res,
        new WorkflowError(413, `Request body exceeded configured limit of ${config.jsonBodyLimit ?? "1mb"}`, "PAYLOAD_TOO_LARGE"),
      );
      return;
    }

    if (error instanceof SyntaxError) {
      handleError(res, new WorkflowError(400, "Malformed JSON body", "INVALID_INPUT"));
      return;
    }

    handleError(res, error);
  });

  return app;
}

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
  presentEvidenceBundle,
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
import { createOperatorAuthMiddleware } from "./operator-auth";
import { MemoryReplayStore } from "./replay-store";
import { getRequestId, requestContextMiddleware, requestLoggingMiddleware } from "./request-context";
import { resolveAuthorizedReviewerAsync } from "./reviewer-auth";
import {
  buildReaderStudySummary,
  parseBinaryPredictions,
  parseMeasurementPairs,
} from "./reader-study-metrics";
import {
  parseClaimJobInput,
  parseAuthenticatedReviewCaseInput,
  parseCreateCaseInput,
  parseDeliveryCallbackInput,
  parseDispatchClaimInput,
  parseDispatchFailInput,
  parseDispatchHeartbeatInput,
  parseFinalizeCaseInput,
  parseInferenceCallbackInput,
  parsePublicFinalizeCaseInput,
  parseRequeueExpiredInferenceJobsInput,
} from "./validation";
import { createCorsMiddleware, createPublicApiRateLimiter, metricsMiddleware, writeMetricsResponse } from "./http-runtime";
import { normalizeDicomUid, resolveSeriesInstanceUid, resolveStudyInstanceUid } from "./dicom-uids";

type ParsedCreateCaseInput = ReturnType<typeof parseCreateCaseInput>;

export interface CreateAppOptions {
  postgresPoolFactory?: PostgresPoolFactory;
  artifactStore?: ArtifactStore;
}

const TENANT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function normalizeOrigin(value: string) {
  try {
    const parsedUrl = new URL(value);
    if (!["http:", "https:"].includes(parsedUrl.protocol) || !parsedUrl.host) {
      return null;
    }

    return `${parsedUrl.protocol.toLowerCase()}//${parsedUrl.host.toLowerCase()}`;
  } catch {
    return null;
  }
}

function hasAbsoluteUrlScheme(value: string) {
  return /^[A-Za-z][A-Za-z\d+.-]*:/u.test(value);
}

function isLoopbackHostname(hostname: string) {
  const normalized = hostname.trim().toLowerCase();
  return normalized === "localhost" || normalized === "::1" || /^127(?:\.\d{1,3}){3}$/u.test(normalized);
}

function createPublicStudyContextAllowedOriginSet(
  config: Pick<AppConfig, "archiveLookupBaseUrl" | "publicStudyContextAllowedOrigins">,
) {
  const origins = new Set<string>();

  for (const value of config.publicStudyContextAllowedOrigins ?? []) {
    const origin = normalizeOrigin(value.trim());
    if (origin) {
      origins.add(origin);
    }
  }

  if (config.archiveLookupBaseUrl) {
    const archiveLookupOrigin = normalizeOrigin(config.archiveLookupBaseUrl);
    if (archiveLookupOrigin) {
      origins.add(archiveLookupOrigin);
    }
  }

  return origins;
}

function isAllowedPublicAbsoluteOrigin(
  value: string,
  allowedOrigins: Set<string>,
  nodeEnv: string,
) {
  const origin = normalizeOrigin(value);
  if (!origin) {
    return false;
  }

  if (allowedOrigins.has(origin)) {
    return true;
  }

  try {
    const parsedUrl = new URL(value);
    return nodeEnv !== "production" && isLoopbackHostname(parsedUrl.hostname);
  } catch {
    return false;
  }
}

function sanitizePublicStudyContext(
  studyContext: ParsedCreateCaseInput["studyContext"],
  config: Pick<AppConfig, "archiveLookupBaseUrl" | "publicStudyContextAllowedOrigins" | "nodeEnv">,
): ParsedCreateCaseInput["studyContext"] {
  if (!studyContext) {
    return undefined;
  }

  const allowedOrigins = createPublicStudyContextAllowedOriginSet(config);
  const dicomWebBaseUrl =
    typeof studyContext.dicomWebBaseUrl === "string" &&
    isAllowedPublicAbsoluteOrigin(studyContext.dicomWebBaseUrl, allowedOrigins, config.nodeEnv)
      ? studyContext.dicomWebBaseUrl
      : undefined;
  const series = studyContext.series?.map((seriesEntry) => {
    const rawDownloadUrl = typeof seriesEntry.volumeDownloadUrl === "string"
      ? seriesEntry.volumeDownloadUrl.trim()
      : "";

    let volumeDownloadUrl: string | undefined;
    if (rawDownloadUrl.length > 0) {
      if (!hasAbsoluteUrlScheme(rawDownloadUrl)) {
        volumeDownloadUrl = rawDownloadUrl;
      } else if (isAllowedPublicAbsoluteOrigin(rawDownloadUrl, allowedOrigins, config.nodeEnv)) {
        volumeDownloadUrl = rawDownloadUrl;
      }
    }

    return volumeDownloadUrl
      ? { ...seriesEntry, volumeDownloadUrl }
      : { ...seriesEntry, volumeDownloadUrl: undefined };
  });

  return {
    ...studyContext,
    sourceArchive: dicomWebBaseUrl ? studyContext.sourceArchive : undefined,
    dicomWebBaseUrl,
    series,
  };
}

function sanitizePublicCreateCaseInput(
  input: ParsedCreateCaseInput,
  config: Pick<AppConfig, "archiveLookupBaseUrl" | "publicStudyContextAllowedOrigins" | "nodeEnv">,
): ParsedCreateCaseInput {
  return {
    ...input,
    studyContext: sanitizePublicStudyContext(input.studyContext, config),
  };
}

function resolveAccessScope(req: express.Request): { tenantId?: string } {
  const tenantId = req.get("x-tenant-id")?.trim();

  if (!tenantId) {
    return { tenantId: undefined };
  }

  if (!TENANT_ID_PATTERN.test(tenantId)) {
    throw new WorkflowError(
      400,
      "x-tenant-id must contain only letters, numbers, underscores, or hyphens and be at most 64 characters",
      "INVALID_INPUT",
    );
  }

  return { tenantId: tenantId && tenantId.length > 0 ? tenantId : undefined };
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
    archiveLookupMode: config.archiveLookupMode,
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
  const inferenceLeaseRecoveryIntervalMs = config.inferenceLeaseRecoveryIntervalMs ?? 0;
  const inferenceLeaseRecoveryMaxClaimAgeMs = config.inferenceLeaseRecoveryMaxClaimAgeMs ?? 5 * 60 * 1000;
  let inferenceLeaseRecoveryTimer: NodeJS.Timeout | null = null;
  let inferenceLeaseRecoveryInFlight = false;
  const workbenchRoot = resolve(__dirname, "..", "public", "workbench");

  const recoverExpiredInferenceLeases = async () => {
    if (runtimeState.isShuttingDown || inferenceLeaseRecoveryInFlight) {
      return;
    }

    inferenceLeaseRecoveryInFlight = true;

    try {
      const requeuedJobs = await caseService.requeueExpiredInferenceJobs(inferenceLeaseRecoveryMaxClaimAgeMs);

      if (requeuedJobs.length > 0) {
        console.info(
          JSON.stringify({
            level: "info",
            event: "inference_lease_recovery_requeued",
            count: requeuedJobs.length,
            maxClaimAgeMs: inferenceLeaseRecoveryMaxClaimAgeMs,
            timestamp: new Date().toISOString(),
          }),
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      console.error(
        JSON.stringify({
          level: "error",
          event: "inference_lease_recovery_failed",
          message,
          timestamp: new Date().toISOString(),
        }),
      );
    } finally {
      inferenceLeaseRecoveryInFlight = false;
    }
  };

  if (inferenceLeaseRecoveryIntervalMs > 0) {
    inferenceLeaseRecoveryTimer = setInterval(() => {
      void recoverExpiredInferenceLeases();
    }, inferenceLeaseRecoveryIntervalMs);
    inferenceLeaseRecoveryTimer.unref?.();
  }

  const closeCaseService = caseService.close.bind(caseService);
  caseService.close = async () => {
    runtimeState.isShuttingDown = true;

    if (inferenceLeaseRecoveryTimer) {
      clearInterval(inferenceLeaseRecoveryTimer);
      inferenceLeaseRecoveryTimer = null;
    }

    await closeCaseService();
  };

  app.locals.caseService = caseService;
  app.locals.runtimeState = runtimeState;

  app.disable("x-powered-by");

  app.use(securityHeaders);

  app.use(requestContextMiddleware);
  app.use(metricsMiddleware);
  app.use(requestLoggingMiddleware);
  app.use(createCorsMiddleware(config));
  app.use("/api/internal", createInternalAuthMiddleware(config));
  app.use("/api/cases", createOperatorAuthMiddleware(config));
  app.use("/api/operations", createOperatorAuthMiddleware(config));
  app.use("/api/delivery", createOperatorAuthMiddleware(config));
  app.use("/api", publicApiRateLimiter);
  app.use(express.json({ limit: config.jsonBodyLimit ?? "1mb" }));
  app.use("/workbench", express.static(workbenchRoot, { index: false }));

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
      sourceArchive: fallback?.sourceArchive ?? primary?.sourceArchive,
      dicomWebBaseUrl: fallback?.dicomWebBaseUrl ?? primary?.dicomWebBaseUrl,
      metadataSummary:
        primary?.metadataSummary && primary.metadataSummary.length > 0
          ? primary.metadataSummary
          : fallback?.metadataSummary,
      series: hasUsableSeries(fallback) ? fallback?.series : primary?.series,
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

  function materializeStudyContextIdentifiers(input: ParsedCreateCaseInput): ParsedCreateCaseInput {
    const studyInstanceUid = resolveStudyInstanceUid(input.studyUid, input.studyContext?.studyInstanceUid);

    return {
      ...input,
      studyContext: {
        ...(input.studyContext ?? {}),
        studyInstanceUid,
        series: (input.studyContext?.series ?? []).map((seriesEntry, index) => ({
          ...seriesEntry,
          syntheticSeriesInstanceUid:
            seriesEntry.syntheticSeriesInstanceUid === true
            || normalizeDicomUid(seriesEntry.seriesInstanceUid) === undefined,
          seriesInstanceUid: resolveSeriesInstanceUid(
            studyInstanceUid,
            index,
            seriesEntry.seriesInstanceUid,
            [seriesEntry.sequenceLabel, seriesEntry.seriesDescription],
          ),
        })),
      },
    };
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

  function parsePagination(query: express.Request["query"]) {
    const limitRaw = query.limit;
    const offsetRaw = query.offset;
    const limit = typeof limitRaw === "string" && limitRaw.length > 0 ? Number(limitRaw) : 50;
    const offset = typeof offsetRaw === "string" && offsetRaw.length > 0 ? Number(offsetRaw) : 0;

    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      throw new WorkflowError(400, "limit must be an integer between 1 and 200", "INVALID_INPUT");
    }

    if (!Number.isInteger(offset) || offset < 0) {
      throw new WorkflowError(400, "offset must be a non-negative integer", "INVALID_INPUT");
    }

    return { limit, offset };
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
          "GET /api/cases/:caseId/evidence-bundle",
          "GET /api/cases/:caseId/exports/dicom-sr",
          "GET /api/cases/:caseId/exports/fhir-diagnostic-report",
          "GET /api/cases/:caseId/artifacts/:artifactId",
          "GET /api/operations/summary",
          "POST /api/reader-study/concordance",
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
      const parsed = sanitizePublicCreateCaseInput(parseCreateCaseInput(req.body), config);
      const created = await caseService.createCase(materializeStudyContextIdentifiers(await enrichCreateCaseInput(parsed)));

      res.status(201).json({ case: created });
    } catch (error) {
      handleError(res, error);
    }
  });

  app.get("/api/cases", async (req, res) => {
    try {
      const scope = resolveAccessScope(req);
      const page = await caseService.listCasesPage(scope, parsePagination(req.query));
      const cases = page.cases.map((caseRecord) => presentCaseListItem(caseRecord));
      res.json({
        cases,
        meta: {
          totalCases: page.totalCases,
          limit: page.limit,
          offset: page.offset,
        },
      });
    } catch (error) {
      handleError(res, error);
    }
  });

  app.get("/api/cases/:caseId", async (req, res) => {
    try {
      const scope = resolveAccessScope(req);
      res.json({ case: presentCaseDetail(await caseService.getCase(req.params.caseId, scope)) });
    } catch (error) {
      handleError(res, error);
    }
  });

  app.post("/api/cases/:caseId/review", async (req, res) => {
    try {
      const updated = await caseService.reviewCase(req.params.caseId, {
        ...parseAuthenticatedReviewCaseInput(req.body),
        ...await resolveAuthorizedReviewerAsync(req, config, "review"),
      });

      res.json({ case: updated });
    } catch (error) {
      handleError(res, error);
    }
  });

  app.post("/api/cases/:caseId/finalize", async (req, res) => {
    try {
      const reviewer = await resolveAuthorizedReviewerAsync(req, config, "finalize");

      const updated = await caseService.finalizeCase(req.params.caseId, {
        ...parsePublicFinalizeCaseInput(req.body),
        finalizerId: reviewer.reviewerId,
        finalizerRole: reviewer.reviewerRole,
      });

      console.info(JSON.stringify({
        event: "audit_case_finalized",
        requestId: getRequestId(res),
        caseId: updated.caseId,
        reviewerId: reviewer.reviewerId,
      }));

      res.json({ case: updated });
    } catch (error) {
      handleError(res, error);
    }
  });

  app.get("/api/cases/:caseId/report", async (req, res) => {
    try {
      const scope = resolveAccessScope(req);
      res.json({ report: presentReport(await caseService.getReport(req.params.caseId, scope)) });
    } catch (error) {
      handleError(res, error);
    }
  });

  app.get("/api/cases/:caseId/evidence-bundle", async (req, res) => {
    try {
      const scope = resolveAccessScope(req);
      const caseRecord = await caseService.getCase(req.params.caseId, scope);
      res.json({ evidenceBundle: presentEvidenceBundle(caseRecord) });
    } catch (error) {
      handleError(res, error);
    }
  });

  app.get("/api/cases/:caseId/exports/dicom-sr", async (req, res) => {
    try {
      const scope = resolveAccessScope(req);
      const report = await caseService.getFinalizedReport(req.params.caseId, scope);
      console.info(JSON.stringify({
        event: "audit_report_exported",
        requestId: getRequestId(res),
        caseId: req.params.caseId,
        format: "dicom-sr",
      }));
      res.json({ dicomSr: buildDicomSrExport(report) });
    } catch (error) {
      handleError(res, error);
    }
  });

  app.get("/api/cases/:caseId/exports/fhir-diagnostic-report", async (req, res) => {
    try {
      const scope = resolveAccessScope(req);
      const record = await caseService.getCase(req.params.caseId, scope);
      const report = await caseService.getFinalizedReport(req.params.caseId, scope);
      console.info(JSON.stringify({
        event: "audit_report_exported",
        requestId: getRequestId(res),
        caseId: req.params.caseId,
        format: "fhir-diagnostic-report",
      }));
      res.json({ diagnosticReport: buildFhirDiagnosticReport(report, record.patientAlias) });
    } catch (error) {
      handleError(res, error);
    }
  });

  app.get("/api/cases/:caseId/artifacts/:artifactId", async (req, res) => {
    try {
      const scope = resolveAccessScope(req);
      const artifact = await caseService.getArtifact(req.params.caseId, req.params.artifactId, scope);

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
    try {
      res.json({ summary: presentOperationsSummary(await caseService.getOperationsSummary()) });
    } catch (error) {
      handleError(res, error);
    }
  });

  // --- Reader-study concordance metrics (R-03, MRMC validation) ---

  app.post("/api/reader-study/concordance", async (req, res) => {
    try {
      const body = req.body as Record<string, unknown>;
      const binaryPredictions = body.predictions
        ? parseBinaryPredictions(body.predictions)
        : undefined;
      const measurementPairs = body.measurements
        ? parseMeasurementPairs(body.measurements)
        : undefined;

      if (!binaryPredictions && !measurementPairs) {
        throw new WorkflowError(
          400,
          "At least one of predictions or measurements is required",
          "INVALID_INPUT",
        );
      }

      const summary = buildReaderStudySummary({
        binaryPredictions,
        measurementPairs,
      });

      res.json({ concordance: summary });
    } catch (error) {
      handleError(res, error);
    }
  });

  app.post("/api/delivery/:caseId/retry", async (req, res) => {
    try {
      const updated = await caseService.retryDelivery(req.params.caseId);
      console.info(JSON.stringify({
        event: "audit_delivery_retried",
        requestId: getRequestId(res),
        caseId: updated.caseId,
      }));
      res.json({ case: updated });
    } catch (error) {
      handleError(res, error);
    }
  });

  app.post("/api/internal/ingest", async (req, res) => {
    try {
      const parsed = parseCreateCaseInput(req.body);
      const created = await caseService.ingestCase(materializeStudyContextIdentifiers(await enrichCreateCaseInput(parsed)));

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

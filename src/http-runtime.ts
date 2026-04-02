import type express from "express";
import type { Server } from "node:http";
import { collectDefaultMetrics, Counter, Histogram, Registry } from "prom-client";
import { rateLimit } from "express-rate-limit";
import type { AppConfig } from "./config";
import { getRequestId } from "./request-context";

const METRICS_PREFIX = "mri_second_opinion_";
const metricsRegistry = new Registry();

collectDefaultMetrics({
  prefix: METRICS_PREFIX,
  register: metricsRegistry,
});

const httpRequestsTotal = new Counter({
  name: `${METRICS_PREFIX}http_requests_total`,
  help: "Total HTTP requests served by the MRI API.",
  labelNames: ["method", "routeGroup", "statusCode"] as const,
  registers: [metricsRegistry],
});

const httpRequestDurationSeconds = new Histogram({
  name: `${METRICS_PREFIX}http_request_duration_seconds`,
  help: "HTTP request duration in seconds for the MRI API.",
  labelNames: ["method", "routeGroup", "statusCode"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [metricsRegistry],
});

function isInternalApiPath(pathname: string) {
  return pathname === "/internal" || pathname.startsWith("/internal/");
}

function resolveRouteGroup(pathname: string) {
  if (pathname === "/") {
    return "root";
  }

  if (pathname === "/healthz") {
    return "probe_healthz";
  }

  if (pathname === "/readyz") {
    return "probe_readyz";
  }

  if (pathname === "/metrics") {
    return "probe_metrics";
  }

  if (pathname === "/workbench" || pathname.startsWith("/workbench/")) {
    return "workbench";
  }

  if (pathname.startsWith("/api/internal/")) {
    return "api_internal";
  }

  if (pathname.startsWith("/api/cases/")) {
    return "api_cases_detail";
  }

  if (pathname === "/api/cases") {
    return "api_cases";
  }

  if (pathname.startsWith("/api/delivery/")) {
    return "api_delivery";
  }

  if (pathname === "/api/operations/summary") {
    return "api_operations";
  }

  if (pathname.startsWith("/api/")) {
    return "api_other";
  }

  return "other";
}

interface CorsRoutePolicy {
  methods: string[];
  allowedHeaders: string[];
  allowActualRequest: boolean;
}

function addVaryHeader(res: express.Response, value: string) {
  const existing = res.getHeader("Vary");

  if (typeof existing !== "string" || existing.trim().length === 0) {
    res.setHeader("Vary", value);
    return;
  }

  const entries = existing
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (!entries.includes(value)) {
    entries.push(value);
  }

  res.setHeader("Vary", entries.join(", "));
}

function isSameOriginRequest(req: express.Request, origin: string) {
  const host = req.get("host");

  if (!host) {
    return false;
  }

  return origin === `${req.protocol}://${host}`;
}

function parseRequestedHeaders(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value.join(",") : value;

  if (!raw) {
    return [];
  }

  return raw
    .split(",")
    .map((header) => header.trim().toLowerCase())
    .filter((header) => header.length > 0);
}

function resolveCorsRoutePolicy(pathname: string): CorsRoutePolicy | null {
  if (pathname === "/api/cases") {
    return {
      methods: ["GET", "POST"],
      allowedHeaders: ["content-type"],
      allowActualRequest: true,
    };
  }

  if (pathname.startsWith("/api/cases/")) {
    return {
      methods: ["GET", "POST"],
      allowedHeaders: ["content-type"],
      allowActualRequest: true,
    };
  }

  if (pathname === "/api/operations/summary") {
    return {
      methods: ["GET"],
      allowedHeaders: [],
      allowActualRequest: true,
    };
  }

  if (pathname.startsWith("/api/delivery/")) {
    return {
      methods: ["POST"],
      allowedHeaders: ["content-type"],
      allowActualRequest: true,
    };
  }

  if (pathname.startsWith("/api/internal/")) {
    return {
      methods: [],
      allowedHeaders: [],
      allowActualRequest: false,
    };
  }

  return null;
}

export function createCorsMiddleware(config: AppConfig): express.RequestHandler {
  const allowlistedOrigins = new Set(config.corsAllowedOrigins);

  return (req, res, next) => {
    const origin = req.get("origin");

    if (!origin || isSameOriginRequest(req, origin)) {
      next();
      return;
    }

    const policy = resolveCorsRoutePolicy(req.path);

    if (!policy || !allowlistedOrigins.has(origin)) {
      addVaryHeader(res, "Origin");
      res.status(403).json({
        error: "Cross-origin browser access is not allowed for this route",
        code: "CORS_ORIGIN_NOT_ALLOWED",
        requestId: getRequestId(res),
      });
      return;
    }

    addVaryHeader(res, "Origin");

    const requestedMethod = req.get("access-control-request-method")?.trim().toUpperCase();

    if (req.method === "OPTIONS" && requestedMethod) {
      const requestedHeaders = parseRequestedHeaders(req.get("access-control-request-headers"));
      const unsupportedHeaders = requestedHeaders.filter((header) => !policy.allowedHeaders.includes(header));

      if (unsupportedHeaders.length > 0) {
        res.status(403).json({
          error: `Cross-origin browser headers are not allowed for this route: ${unsupportedHeaders.join(", ")}`,
          code: "CORS_HEADERS_NOT_ALLOWED",
          requestId: getRequestId(res),
        });
        return;
      }

      if (!policy.methods.includes(requestedMethod)) {
        res.status(403).json({
          error: `Cross-origin browser method is not allowed for this route: ${requestedMethod}`,
          code: "CORS_METHOD_NOT_ALLOWED",
          requestId: getRequestId(res),
        });
        return;
      }

      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Methods", policy.methods.join(", "));

      if (requestedHeaders.length > 0) {
        res.setHeader("Access-Control-Allow-Headers", requestedHeaders.join(", "));
      }

      res.status(204).end();
      return;
    }

    if (!policy.allowActualRequest) {
      res.status(403).json({
        error: "Cross-origin browser access is not allowed for this route",
        code: "CORS_ORIGIN_NOT_ALLOWED",
        requestId: getRequestId(res),
      });
      return;
    }

    res.setHeader("Access-Control-Allow-Origin", origin);
    next();
  };
}

export function metricsMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  const startedAt = process.hrtime.bigint();

  res.on("finish", () => {
    const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
    const labels = {
      method: req.method,
      routeGroup: resolveRouteGroup(req.path),
      statusCode: String(res.statusCode),
    };

    httpRequestsTotal.inc(labels);
    httpRequestDurationSeconds.observe(labels, durationSeconds);
  });

  next();
}

export function createPublicApiRateLimiter(config: AppConfig) {
  return rateLimit({
    windowMs: config.publicApiRateLimitWindowMs ?? 900_000,
    limit: config.publicApiRateLimitMaxRequests ?? 300,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    ipv6Subnet: 56,
    skip: (req) => isInternalApiPath(req.path),
    handler: (req, res) => {
      res.status(429).json({
        error: "Public API rate limit exceeded",
        code: "RATE_LIMITED",
        requestId: getRequestId(res),
      });
    },
  });
}

export async function writeMetricsResponse(res: express.Response) {
  res.setHeader("Content-Type", metricsRegistry.contentType);
  res.send(await metricsRegistry.metrics());
}

export function applyServerHardening(server: Server, config: AppConfig) {
  server.headersTimeout = config.serverHeadersTimeoutMs ?? 30_000;
  server.requestTimeout = config.serverRequestTimeoutMs ?? 120_000;
  server.setTimeout(config.serverSocketTimeoutMs ?? 120_000);
  server.keepAliveTimeout = config.serverKeepAliveTimeoutMs ?? 5_000;
  server.maxRequestsPerSocket = config.serverMaxRequestsPerSocket ?? 100;
}

export async function shutdownHttpServer(
  server: Server,
  closeResources: () => Promise<void>,
  config: AppConfig,
) {
  let forcedConnectionClose = false;

  const forceCloseTimer = setTimeout(() => {
    forcedConnectionClose = true;
    server.closeAllConnections?.();
  }, config.gracefulShutdownTimeoutMs ?? 10_000);
  forceCloseTimer.unref();

  try {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  } finally {
    clearTimeout(forceCloseTimer);
  }

  await closeResources();

  return {
    forcedConnectionClose,
  };
}
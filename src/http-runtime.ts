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
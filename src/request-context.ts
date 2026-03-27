import { randomUUID } from "node:crypto";
import type express from "express";

const REQUEST_ID_HEADER = "x-request-id";
const MAX_REQUEST_ID_LENGTH = 128;

function normalizeRequestId(value: string | undefined) {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  return trimmed.slice(0, MAX_REQUEST_ID_LENGTH);
}

export function requestContextMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  const requestId = normalizeRequestId(req.get(REQUEST_ID_HEADER)) ?? randomUUID();
  res.locals.requestId = requestId;
  res.locals.requestStartedAt = Date.now();
  res.setHeader(REQUEST_ID_HEADER, requestId);
  next();
}

export function requestLoggingMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  const startedAt = Date.now();

  res.on("finish", () => {
    const requestId = getRequestId(res);
    const durationMs = Date.now() - startedAt;

    console.info(JSON.stringify({
      event: "http_request_completed",
      requestId,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs,
    }));
  });

  next();
}

export function getRequestId(res: express.Response) {
  return typeof res.locals.requestId === "string" ? res.locals.requestId : "unknown-request";
}

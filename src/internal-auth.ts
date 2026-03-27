import { timingSafeEqual } from "node:crypto";
import type express from "express";
import { WorkflowError } from "./cases";
import type { AppConfig } from "./config";

const AUTHORIZATION_SCHEME = "bearer";

export function createInternalAuthMiddleware(
  config: Pick<AppConfig, "internalApiToken">,
): express.RequestHandler {
  const expectedToken = config.internalApiToken;

  return (req, _res, next) => {
    if (!expectedToken) {
      next();
      return;
    }

    const providedToken = extractBearerToken(req.get("authorization"));

    if (!providedToken || !tokensEqual(providedToken, expectedToken)) {
      next(new WorkflowError(401, "Internal API bearer token is missing or invalid", "UNAUTHORIZED"));
      return;
    }

    next();
  };
}

function extractBearerToken(authorizationHeader: string | undefined) {
  if (!authorizationHeader) {
    return undefined;
  }

  const parts = authorizationHeader.trim().split(/\s+/);
  if (parts.length !== 2 || parts[0].toLowerCase() !== AUTHORIZATION_SCHEME) {
    return undefined;
  }

  return parts[1];
}

function tokensEqual(providedToken: string, expectedToken: string) {
  const providedBuffer = Buffer.from(providedToken, "utf-8");
  const expectedBuffer = Buffer.from(expectedToken, "utf-8");

  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(providedBuffer, expectedBuffer);
}
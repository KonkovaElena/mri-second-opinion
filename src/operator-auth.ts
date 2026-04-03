import { timingSafeEqual } from "node:crypto";
import type express from "express";
import { WorkflowError } from "./case-contracts";
import type { AppConfig } from "./config";

const API_KEY_HEADER = "x-api-key";

export function createOperatorAuthMiddleware(
  config: Pick<AppConfig, "operatorApiToken" | "nodeEnv">,
): express.RequestHandler {
  const expectedToken = config.operatorApiToken;

  return (req, _res, next) => {
    if (!expectedToken) {
      if (config.nodeEnv === "development") {
        next();
        return;
      }

      next(new WorkflowError(503, "Operator API authentication is not configured for this environment", "SERVICE_CONFIG_ERROR"));
      return;
    }

    const providedToken = req.get(API_KEY_HEADER)?.trim();

    if (!providedToken || !tokensEqual(providedToken, expectedToken)) {
      next(new WorkflowError(401, "Operator API key is missing or invalid", "UNAUTHORIZED"));
      return;
    }

    next();
  };
}

function tokensEqual(providedToken: string, expectedToken: string) {
  const providedBuffer = Buffer.from(providedToken, "utf-8");
  const expectedBuffer = Buffer.from(expectedToken, "utf-8");

  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(providedBuffer, expectedBuffer);
}

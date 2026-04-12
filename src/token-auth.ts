import { timingSafeEqual } from "node:crypto";
import type express from "express";
import { WorkflowError } from "./case-contracts";

export interface TokenAuthOptions {
  expectedToken: string | undefined;
  nodeEnv: string;
  extractToken: (req: express.Request) => string | undefined;
  unconfiguredLabel: string;
  invalidLabel: string;
}

/**
 * Shared factory for bearer-token / api-key authentication middleware.
 *
 * Both internal-auth (Authorization: Bearer) and operator-auth (x-api-key)
 * share the same flow: check token presence → dev-mode bypass → timing-safe compare.
 */
export function createTokenAuthMiddleware(opts: TokenAuthOptions): express.RequestHandler {
  return (req, _res, next) => {
    if (!opts.expectedToken) {
      if (opts.nodeEnv === "development") {
        next();
        return;
      }

      next(new WorkflowError(503, `${opts.unconfiguredLabel} is not configured for this environment`, "SERVICE_CONFIG_ERROR"));
      return;
    }

    const providedToken = opts.extractToken(req);

    if (!providedToken || !tokensEqual(providedToken, opts.expectedToken)) {
      next(new WorkflowError(401, `${opts.invalidLabel} is missing or invalid`, "UNAUTHORIZED"));
      return;
    }

    next();
  };
}

export function tokensEqual(providedToken: string, expectedToken: string): boolean {
  const providedBuffer = Buffer.from(providedToken, "utf-8");
  const expectedBuffer = Buffer.from(expectedToken, "utf-8");

  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(providedBuffer, expectedBuffer);
}

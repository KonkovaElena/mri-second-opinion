import type express from "express";
import type { AppConfig } from "./config";
import { createTokenAuthMiddleware } from "./token-auth";

const AUTHORIZATION_SCHEME = "bearer";

export function createInternalAuthMiddleware(
  config: Pick<AppConfig, "internalApiToken" | "nodeEnv">,
): express.RequestHandler {
  return createTokenAuthMiddleware({
    expectedToken: config.internalApiToken,
    nodeEnv: config.nodeEnv,
    extractToken: (req) => extractBearerToken(req.get("authorization")),
    unconfiguredLabel: "Internal API authentication",
    invalidLabel: "Internal API bearer token",
  });
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
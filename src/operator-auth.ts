import type express from "express";
import type { AppConfig } from "./config";
import { createTokenAuthMiddleware } from "./token-auth";

const API_KEY_HEADER = "x-api-key";

export function createOperatorAuthMiddleware(
  config: Pick<AppConfig, "operatorApiToken" | "nodeEnv">,
): express.RequestHandler {
  return createTokenAuthMiddleware({
    expectedToken: config.operatorApiToken,
    nodeEnv: config.nodeEnv,
    extractToken: (req) => req.get(API_KEY_HEADER)?.trim(),
    unconfiguredLabel: "Operator API authentication",
    invalidLabel: "Operator API key",
  });
}
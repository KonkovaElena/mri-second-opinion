import { createHmac, timingSafeEqual } from "node:crypto";
import type express from "express";
import { WorkflowError } from "./case-contracts";
import { DEFAULT_REVIEWER_ALLOWED_ROLES, type AppConfig } from "./config";

const AUTHORIZATION_SCHEME = "bearer";
const SUPPORTED_JWT_ALGORITHM = "HS256";

type JwtPayload = {
  sub?: unknown;
  role?: unknown;
  roles?: unknown;
  reviewerRole?: unknown;
  exp?: unknown;
};

export interface AuthenticatedReviewer {
  reviewerId: string;
  reviewerRole?: string;
}

export type ReviewerAction = "review" | "finalize";

export function resolveAuthenticatedReviewer(
  req: express.Request,
  config: Pick<AppConfig, "reviewerJwtSecret">,
): AuthenticatedReviewer {
  const token = extractBearerToken(req.get("authorization"));
  if (!token) {
    throw new WorkflowError(401, "Reviewer bearer token is missing or invalid", "UNAUTHORIZED");
  }

  return verifyReviewerJwt(token, config.reviewerJwtSecret);
}

export function resolveAuthorizedReviewer(
  req: express.Request,
  config: Pick<AppConfig, "reviewerJwtSecret" | "reviewerAllowedRoles">,
  action: ReviewerAction,
): AuthenticatedReviewer {
  const reviewer = resolveAuthenticatedReviewer(req, config);
  assertAuthorizedReviewerRole(reviewer, config.reviewerAllowedRoles, action);
  return reviewer;
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

function verifyReviewerJwt(token: string, secret: string): AuthenticatedReviewer {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new WorkflowError(401, "Reviewer bearer token is missing or invalid", "UNAUTHORIZED");
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = parseJwtJson(encodedHeader, "header") as { alg?: unknown; typ?: unknown };
  const payload = parseJwtJson(encodedPayload, "payload") as JwtPayload;

  if (header.alg !== SUPPORTED_JWT_ALGORITHM) {
    throw new WorkflowError(401, "Reviewer bearer token is missing or invalid", "UNAUTHORIZED");
  }

  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const expectedSignature = createHmac("sha256", secret).update(signingInput).digest();
  const providedSignature = Buffer.from(encodedSignature, "base64url");

  if (
    providedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(providedSignature, expectedSignature)
  ) {
    throw new WorkflowError(401, "Reviewer bearer token is missing or invalid", "UNAUTHORIZED");
  }

  if (typeof payload.exp !== "undefined") {
    if (!Number.isFinite(payload.exp)) {
      throw new WorkflowError(401, "Reviewer bearer token is missing or invalid", "UNAUTHORIZED");
    }

    if (Number(payload.exp) * 1000 <= Date.now()) {
      throw new WorkflowError(401, "Reviewer bearer token has expired", "UNAUTHORIZED");
    }
  }

  const reviewerId = typeof payload.sub === "string" ? payload.sub.trim() : "";
  if (!reviewerId) {
    throw new WorkflowError(401, "Reviewer bearer token is missing or invalid", "UNAUTHORIZED");
  }

  const reviewerRole = resolveReviewerRole(payload);

  return {
    reviewerId,
    ...(reviewerRole ? { reviewerRole } : {}),
  };
}

function parseJwtJson(encodedValue: string, partName: string) {
  try {
    const decoded = Buffer.from(encodedValue, "base64url").toString("utf-8");
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    throw new WorkflowError(401, `Reviewer bearer token ${partName} is invalid`, "UNAUTHORIZED");
  }
}

function resolveReviewerRole(payload: JwtPayload) {
  if (typeof payload.role === "string" && payload.role.trim().length > 0) {
    return payload.role.trim();
  }

  if (typeof payload.reviewerRole === "string" && payload.reviewerRole.trim().length > 0) {
    return payload.reviewerRole.trim();
  }

  if (Array.isArray(payload.roles)) {
    const firstRole = payload.roles.find(
      (role) => typeof role === "string" && role.trim().length > 0,
    );

    if (typeof firstRole === "string") {
      return firstRole.trim();
    }
  }

  return undefined;
}

function assertAuthorizedReviewerRole(
  reviewer: AuthenticatedReviewer,
  allowedRoles: readonly string[] | undefined,
  action: ReviewerAction,
) {
  const reviewerRole = reviewer.reviewerRole?.trim();
  if (!reviewerRole) {
    throw new WorkflowError(403, `Reviewer role is required for case ${action}`, "FORBIDDEN");
  }

  const normalizedAllowedRoles = (allowedRoles ?? DEFAULT_REVIEWER_ALLOWED_ROLES).map((role) => role.toLowerCase());
  if (!normalizedAllowedRoles.includes(reviewerRole.toLowerCase())) {
    throw new WorkflowError(403, `Reviewer role is not authorized for case ${action}`, "FORBIDDEN");
  }
}
import { createHmac, createPublicKey, createVerify, timingSafeEqual } from "node:crypto";
import type express from "express";
import { WorkflowError } from "./case-contracts";
import { DEFAULT_REVIEWER_ALLOWED_ROLES, type AppConfig } from "./config";

const AUTHORIZATION_SCHEME = "bearer";
const SUPPORTED_JWT_ALGORITHM_HS256 = "HS256";
const SUPPORTED_JWT_ALGORITHM_RS256 = "RS256";

type JwtPayload = {
  sub?: unknown;
  role?: unknown;
  roles?: unknown;
  reviewerRole?: unknown;
  exp?: unknown;
  iss?: unknown;
  aud?: unknown;
};

type JwtHeader = {
  alg?: unknown;
  typ?: unknown;
  kid?: unknown;
};

export interface AuthenticatedReviewer {
  reviewerId: string;
  reviewerRole?: string;
}

export type ReviewerAction = "review" | "finalize";

// ---------------------------------------------------------------------------
// JWKS types and cache (R-02: asymmetric crypto for hospital IdP integration)
// ---------------------------------------------------------------------------

interface JwksKey {
  kty: string;
  kid?: string;
  use?: string;
  alg?: string;
  n?: string;
  e?: string;
}

interface JwksDocument {
  keys: JwksKey[];
}

interface JwksCacheEntry {
  jwksUrl: string;
  document: JwksDocument;
  fetchedAt: number;
}

const JWKS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const jwksCache = new Map<string, JwksCacheEntry>();

export type ReviewerAuthConfig = Pick<
  AppConfig,
  | "reviewerJwtSecret"
  | "reviewerJwksUrl"
  | "reviewerJwksIssuer"
  | "reviewerJwksAudience"
  | "clockSkewToleranceMs"
>;

async function fetchJwksDocument(jwksUrl: string): Promise<JwksDocument> {
  const response = await fetch(jwksUrl, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new WorkflowError(
      502,
      "Failed to retrieve JWKS from identity provider",
      "JWKS_FETCH_FAILED",
    );
  }

  const body = (await response.json()) as { keys?: unknown };
  if (!body || !Array.isArray(body.keys)) {
    throw new WorkflowError(
      502,
      "Invalid JWKS document from identity provider",
      "JWKS_INVALID",
    );
  }

  return body as JwksDocument;
}

async function getJwksDocument(jwksUrl: string, forceRefresh = false): Promise<JwksDocument> {
  const now = Date.now();
  const cachedEntry = jwksCache.get(jwksUrl);
  if (!forceRefresh && cachedEntry && now - cachedEntry.fetchedAt < JWKS_CACHE_TTL_MS) {
    return cachedEntry.document;
  }

  const document = await fetchJwksDocument(jwksUrl);
  jwksCache.set(jwksUrl, { jwksUrl, document, fetchedAt: now });
  return document;
}

function getSigningJwksKeys(document: JwksDocument): JwksKey[] {
  return document.keys.filter(
    (key) =>
      key.kty === "RSA" &&
      (key.use === "sig" || !key.use) &&
      (key.alg === "RS256" || !key.alg) &&
      key.n &&
      key.e,
  );
}

function findJwksPublicKey(
  document: JwksDocument,
  kid: string | undefined,
  options: { allowSingleKeyFallback?: boolean } = {},
): JwksKey {
  const signingKeys = getSigningJwksKeys(document);

  if (signingKeys.length === 0) {
    throw new WorkflowError(401, "No suitable signing key found in JWKS", "UNAUTHORIZED");
  }

  if (kid) {
    const matched = signingKeys.find((key) => key.kid === kid);
    if (matched) return matched;

    if (options.allowSingleKeyFallback && signingKeys.length === 1) {
      return signingKeys[0];
    }

    throw new WorkflowError(401, "Signing key not found in JWKS", "UNAUTHORIZED");
  }

  // No kid in token header — use the first available signing key
  return signingKeys[0];
}

async function resolveJwksPublicKey(jwksUrl: string, kid: string | undefined): Promise<JwksKey> {
  const cachedDocument = await getJwksDocument(jwksUrl);

  try {
    return findJwksPublicKey(cachedDocument, kid);
  } catch (error) {
    if (!(error instanceof WorkflowError) || !kid) {
      throw error;
    }
  }

  const refreshedDocument = await getJwksDocument(jwksUrl, true);
  return findJwksPublicKey(refreshedDocument, kid, { allowSingleKeyFallback: true });
}

/** Exported for testing: reset the JWKS in-memory cache */
export function resetJwksCache(): void {
  jwksCache.clear();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function resolveAuthenticatedReviewer(
  req: express.Request,
  config: ReviewerAuthConfig,
): AuthenticatedReviewer {
  const token = extractBearerToken(req.get("authorization"));
  if (!token) {
    throw new WorkflowError(401, "Reviewer bearer token is missing or invalid", "UNAUTHORIZED");
  }

  return verifyReviewerJwt(token, config.reviewerJwtSecret, {
    clockSkewToleranceMs: config.clockSkewToleranceMs,
    requiredAudience: config.reviewerJwksAudience,
  });
}

export async function resolveAuthenticatedReviewerAsync(
  req: express.Request,
  config: ReviewerAuthConfig,
): Promise<AuthenticatedReviewer> {
  const token = extractBearerToken(req.get("authorization"));
  if (!token) {
    throw new WorkflowError(401, "Reviewer bearer token is missing or invalid", "UNAUTHORIZED");
  }

  // Peek at the header to decide HS256 vs RS256
  const header = peekJwtHeader(token);

  if (header.alg === SUPPORTED_JWT_ALGORITHM_RS256 && config.reviewerJwksUrl) {
    return verifyReviewerJwtRs256(token, header, config);
  }

  // Fallback to HS256 (original behavior)
  return verifyReviewerJwt(token, config.reviewerJwtSecret, {
    clockSkewToleranceMs: config.clockSkewToleranceMs,
    requiredAudience: config.reviewerJwksAudience,
  });
}

export function resolveAuthorizedReviewer(
  req: express.Request,
  config: Pick<AppConfig, "reviewerJwtSecret" | "reviewerAllowedRoles" | "reviewerJwksUrl" | "reviewerJwksIssuer" | "reviewerJwksAudience" | "clockSkewToleranceMs">,
  action: ReviewerAction,
): AuthenticatedReviewer {
  const reviewer = resolveAuthenticatedReviewer(req, config);
  assertAuthorizedReviewerRole(reviewer, config.reviewerAllowedRoles, action);
  return reviewer;
}

export async function resolveAuthorizedReviewerAsync(
  req: express.Request,
  config: Pick<AppConfig, "reviewerJwtSecret" | "reviewerAllowedRoles" | "reviewerJwksUrl" | "reviewerJwksIssuer" | "reviewerJwksAudience" | "clockSkewToleranceMs">,
  action: ReviewerAction,
): Promise<AuthenticatedReviewer> {
  const reviewer = await resolveAuthenticatedReviewerAsync(req, config);
  assertAuthorizedReviewerRole(reviewer, config.reviewerAllowedRoles, action);
  return reviewer;
}

// ---------------------------------------------------------------------------
// JWT internals
// ---------------------------------------------------------------------------

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

function audienceMatches(payload: JwtPayload, requiredAudience: string | undefined) {
  if (!requiredAudience) {
    return true;
  }

  const aud = payload.aud;
  return (
    (typeof aud === "string" && aud === requiredAudience) ||
    (Array.isArray(aud) && aud.includes(requiredAudience))
  );
}

function peekJwtHeader(token: string): JwtHeader {
  const dotIndex = token.indexOf(".");
  if (dotIndex < 0) {
    throw new WorkflowError(401, "Reviewer bearer token is missing or invalid", "UNAUTHORIZED");
  }
  return parseJwtJson(token.substring(0, dotIndex), "header") as JwtHeader;
}

function verifyReviewerJwt(
  token: string,
  secret: string,
  options: { clockSkewToleranceMs?: number; requiredAudience?: string } = {},
): AuthenticatedReviewer {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new WorkflowError(401, "Reviewer bearer token is missing or invalid", "UNAUTHORIZED");
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = parseJwtJson(encodedHeader, "header") as JwtHeader;
  const payload = parseJwtJson(encodedPayload, "payload") as JwtPayload;

  if (header.alg !== SUPPORTED_JWT_ALGORITHM_HS256) {
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

  assertPayloadExpiry(payload, options.clockSkewToleranceMs);

  if (!audienceMatches(payload, options.requiredAudience)) {
    throw new WorkflowError(401, "Reviewer bearer token audience mismatch", "UNAUTHORIZED");
  }

  const reviewerId = typeof payload.sub === "string" ? payload.sub.trim() : "";
  if (!reviewerId) {
    throw new WorkflowError(401, "Reviewer bearer token is missing or invalid", "UNAUTHORIZED");
  }

  return {
    reviewerId,
    ...(resolveReviewerRole(payload) ? { reviewerRole: resolveReviewerRole(payload) } : {}),
  };
}

async function verifyReviewerJwtRs256(
  token: string,
  header: JwtHeader,
  config: ReviewerAuthConfig,
): Promise<AuthenticatedReviewer> {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new WorkflowError(401, "Reviewer bearer token is missing or invalid", "UNAUTHORIZED");
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const payload = parseJwtJson(encodedPayload, "payload") as JwtPayload;

  // Fetch JWKS and find the matching key
  const kid = typeof header.kid === "string" ? header.kid : undefined;
  const jwk = await resolveJwksPublicKey(config.reviewerJwksUrl!, kid);

  // Build public key from JWK
  const publicKey = createPublicKey({
    key: {
      kty: jwk.kty,
      n: jwk.n,
      e: jwk.e,
    },
    format: "jwk",
  });

  // Verify RS256 signature
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = Buffer.from(encodedSignature, "base64url");
  const verifier = createVerify("RSA-SHA256");
  verifier.update(signingInput);

  if (!verifier.verify(publicKey, signature)) {
    throw new WorkflowError(401, "Reviewer bearer token is missing or invalid", "UNAUTHORIZED");
  }

  // Validate expiry
  assertPayloadExpiry(payload, config.clockSkewToleranceMs);

  // Validate issuer if configured
  if (config.reviewerJwksIssuer) {
    if (typeof payload.iss !== "string" || payload.iss !== config.reviewerJwksIssuer) {
      throw new WorkflowError(401, "Reviewer bearer token issuer mismatch", "UNAUTHORIZED");
    }
  }

  // Validate audience if configured
  if (config.reviewerJwksAudience) {
    if (!audienceMatches(payload, config.reviewerJwksAudience)) {
      throw new WorkflowError(401, "Reviewer bearer token audience mismatch", "UNAUTHORIZED");
    }
  }

  const reviewerId = typeof payload.sub === "string" ? payload.sub.trim() : "";
  if (!reviewerId) {
    throw new WorkflowError(401, "Reviewer bearer token is missing or invalid", "UNAUTHORIZED");
  }

  return {
    reviewerId,
    ...(resolveReviewerRole(payload) ? { reviewerRole: resolveReviewerRole(payload) } : {}),
  };
}

function assertPayloadExpiry(payload: JwtPayload, clockSkewToleranceMs = 0) {
  if (typeof payload.exp !== "undefined") {
    if (!Number.isFinite(payload.exp)) {
      throw new WorkflowError(401, "Reviewer bearer token is missing or invalid", "UNAUTHORIZED");
    }

    if (Number(payload.exp) * 1000 + clockSkewToleranceMs <= Date.now()) {
      throw new WorkflowError(401, "Reviewer bearer token has expired", "UNAUTHORIZED");
    }
  }
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
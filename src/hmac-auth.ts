import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import type express from "express";
import { WorkflowError } from "./case-contracts";
import type { AppConfig } from "./config";
import type { ReplayStore } from "./replay-store";

/**
 * Canonical header names for HMAC signed requests.
 */
export const HMAC_HEADER_TIMESTAMP = "x-mri-timestamp";
export const HMAC_HEADER_NONCE = "x-mri-nonce";
export const HMAC_HEADER_SIGNATURE = "x-mri-signature";

/**
 * Build the canonical string for HMAC signing.
 *
 * Format: METHOD\nPATH\nTimestamp\nNonce\nSHA256(body)
 */
export function canonicalizeRequest(
  method: string,
  path: string,
  timestamp: string,
  nonce: string,
  bodyBytes: Buffer,
): string {
  const bodyHash = createHash("sha256").update(bodyBytes).digest("hex");
  return `${method.toUpperCase()}\n${path}\n${timestamp}\n${nonce}\n${bodyHash}`;
}

/**
 * Compute HMAC-SHA256 signature of the canonical string.
 */
export function computeSignature(secret: string, canonicalString: string): string {
  return createHmac("sha256", secret).update(canonicalString).digest("hex");
}

/**
 * Signed JSON contract: UTF-8 encoded compact JSON with no extra whitespace.
 * Python workers must mirror this with json.dumps(payload, separators=(",", ":")).
 */
export function serializeSignedJsonPayload(payload: unknown): Buffer {
  const normalizedPayload = typeof payload === "undefined" ? {} : payload;
  return Buffer.from(JSON.stringify(normalizedPayload), "utf-8");
}

/**
 * Timing-safe comparison of two hex signature strings.
 */
export function signaturesEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export interface SignatureVerificationResult {
  ok: boolean;
  code?: "MISSING_SIGNATURE_HEADERS" | "INVALID_TIMESTAMP" | "CLOCK_SKEW_EXCEEDED" | "INVALID_SIGNATURE";
  message?: string;
}

/**
 * Verify an incoming signed request.
 *
 * Returns { ok: true } on success or { ok: false, code, message } on failure.
 */
export function verifySignedRequest(opts: {
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
  rawBody: Buffer;
  hmacSecret: string;
  clockSkewToleranceMs: number;
  nowMs?: number;
}): SignatureVerificationResult {
  const timestamp = opts.headers[HMAC_HEADER_TIMESTAMP];
  const nonce = opts.headers[HMAC_HEADER_NONCE];
  const signature = opts.headers[HMAC_HEADER_SIGNATURE];

  if (!timestamp || !nonce || !signature) {
    return {
      ok: false,
      code: "MISSING_SIGNATURE_HEADERS",
      message: "X-MRI-Timestamp, X-MRI-Nonce, and X-MRI-Signature headers are required",
    };
  }

  const requestTimeMs = new Date(timestamp).getTime();
  if (!Number.isFinite(requestTimeMs)) {
    return {
      ok: false,
      code: "INVALID_TIMESTAMP",
      message: "X-MRI-Timestamp is not a valid ISO 8601 timestamp",
    };
  }

  const now = opts.nowMs ?? Date.now();
  const drift = Math.abs(now - requestTimeMs);
  if (drift > opts.clockSkewToleranceMs) {
    return {
      ok: false,
      code: "CLOCK_SKEW_EXCEEDED",
      message: `Request timestamp skew ${drift}ms exceeds tolerance ${opts.clockSkewToleranceMs}ms`,
    };
  }

  const canonical = canonicalizeRequest(opts.method, opts.path, timestamp, nonce, opts.rawBody);
  const expected = computeSignature(opts.hmacSecret, canonical);

  if (!signaturesEqual(signature, expected)) {
    return {
      ok: false,
      code: "INVALID_SIGNATURE",
      message: "HMAC signature verification failed",
    };
  }

  return { ok: true };
}

/**
 * Express middleware that verifies HMAC-signed requests.
 *
 * Requires the raw body to be available — call express.json() BEFORE this
 * middleware and ensure req.body is parsed, then rebuild the compact signed
 * JSON representation before canonical verification.
 */
export function createHmacAuthMiddleware(
  config: Pick<AppConfig, "hmacSecret" | "clockSkewToleranceMs">,
  replayStore?: ReplayStore,
): express.RequestHandler {
  return async (req, _res, next) => {
    const hmacSecret = config.hmacSecret;

    if (!hmacSecret) {
      next();
      return;
    }

    const rawBody = serializeSignedJsonPayload(req.body);
    const result = verifySignedRequest({
      method: req.method,
      path: req.originalUrl,
      headers: req.headers as Record<string, string | undefined>,
      rawBody,
      hmacSecret,
      clockSkewToleranceMs: config.clockSkewToleranceMs,
    });

    if (!result.ok) {
      const statusCode = result.code === "MISSING_SIGNATURE_HEADERS" ? 401 : 403;
      next(new WorkflowError(statusCode, result.message ?? "HMAC verification failed", "HMAC_VERIFICATION_FAILED"));
      return;
    }

    if (replayStore) {
      const nonce = req.headers[HMAC_HEADER_NONCE] as string;
      const timestamp = req.headers[HMAC_HEADER_TIMESTAMP] as string;
      const requestTimeMs = new Date(timestamp).getTime();

      try {
        const isReplay = await replayStore.checkAndRecord(nonce, requestTimeMs);
        if (isReplay) {
          next(new WorkflowError(401, "Nonce already consumed", "HMAC_VERIFICATION_FAILED"));
          return;
        }
        next();
      } catch (error) {
        next(error);
      }
      return;
    }

    next();
  };
}

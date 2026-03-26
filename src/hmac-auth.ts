import { createHmac, createHash, timingSafeEqual } from "node:crypto";

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

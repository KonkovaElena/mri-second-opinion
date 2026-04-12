import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, createSign, generateKeyPairSync, type KeyObject } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type express from "express";
import { WorkflowError } from "../src/case-contracts";
import { resetJwksCache, resolveAuthenticatedReviewerAsync } from "../src/reviewer-auth";

const DEFAULT_REVIEWER_JWT_SECRET = "reviewer-jwt-secret-0123456789abcdef";
const DEFAULT_CLOCK_SKEW_TOLERANCE_MS = 60_000;

function createRequest(authorization?: string) {
  return {
    get(name: string) {
      return name.toLowerCase() === "authorization" ? authorization : undefined;
    },
  } as unknown as express.Request;
}

function createReviewerJwt(payload: {
  reviewerId: string;
  reviewerRole?: string;
  exp?: number;
  secret?: string;
}) {
  const encodedHeader = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" }), "utf-8").toString("base64url");
  const encodedPayload = Buffer.from(
    JSON.stringify({
      sub: payload.reviewerId,
      ...(payload.reviewerRole ? { role: payload.reviewerRole } : {}),
      exp: payload.exp ?? Math.floor(Date.now() / 1000) + 60,
    }),
    "utf-8",
  ).toString("base64url");
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac("sha256", payload.secret ?? DEFAULT_REVIEWER_JWT_SECRET)
    .update(signingInput)
    .digest("base64url");

  return `${signingInput}.${signature}`;
}

function createRs256KeyMaterial(kid: string) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" }) as JsonWebKey & {
    e: string;
    kty: string;
    n: string;
  };

  return {
    privateKey,
    jwk: {
      kty: jwk.kty,
      n: jwk.n,
      e: jwk.e,
      alg: "RS256",
      use: "sig",
      kid,
    },
  };
}

function createRs256ReviewerJwt(input: {
  reviewerId: string;
  reviewerRole?: string;
  exp?: number;
  kid: string;
  privateKey: KeyObject;
}) {
  const encodedHeader = Buffer.from(
    JSON.stringify({ alg: "RS256", typ: "JWT", kid: input.kid }),
    "utf-8",
  ).toString("base64url");
  const encodedPayload = Buffer.from(
    JSON.stringify({
      sub: input.reviewerId,
      ...(input.reviewerRole ? { role: input.reviewerRole } : {}),
      exp: input.exp ?? Math.floor(Date.now() / 1000) + 60,
    }),
    "utf-8",
  ).toString("base64url");
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  const signature = signer.sign(input.privateKey).toString("base64url");

  return `${signingInput}.${signature}`;
}

async function withJwksServer<T>(
  initialDocument: { keys: Array<Record<string, unknown>> },
  run: (helpers: {
    getBaseUrl: () => string;
    getRequestCount: () => number;
    setDocument: (document: { keys: Array<Record<string, unknown>> }) => void;
  }) => Promise<T>,
) {
  let currentDocument = initialDocument;
  let requestCount = 0;

  const server = createServer((_req, res) => {
    requestCount += 1;
    const body = Buffer.from(JSON.stringify(currentDocument), "utf-8");
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.setHeader("content-length", String(body.length));
    res.end(body);
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;

  try {
    return await run({
      getBaseUrl: () => `http://127.0.0.1:${port}`,
      getRequestCount: () => requestCount,
      setDocument: (document) => {
        currentDocument = document;
      },
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    resetJwksCache();
  }
}

test("reviewer auth accepts HS256 token within clock skew tolerance", async () => {
  const token = createReviewerJwt({
    reviewerId: "reviewer-skew-accept",
    reviewerRole: "radiologist",
    exp: Math.floor((Date.now() - 30_000) / 1000),
  });

  const reviewer = await resolveAuthenticatedReviewerAsync(createRequest(`Bearer ${token}`), {
    reviewerJwtSecret: DEFAULT_REVIEWER_JWT_SECRET,
    reviewerJwksUrl: undefined,
    reviewerJwksIssuer: undefined,
    reviewerJwksAudience: undefined,
    clockSkewToleranceMs: DEFAULT_CLOCK_SKEW_TOLERANCE_MS,
  });

  assert.equal(reviewer.reviewerId, "reviewer-skew-accept");
  assert.equal(reviewer.reviewerRole, "radiologist");
});

test("reviewer auth rejects HS256 token expired beyond clock skew tolerance", async () => {
  const token = createReviewerJwt({
    reviewerId: "reviewer-skew-reject",
    reviewerRole: "radiologist",
    exp: Math.floor((Date.now() - 90_000) / 1000),
  });

  await assert.rejects(
    () =>
      resolveAuthenticatedReviewerAsync(createRequest(`Bearer ${token}`), {
        reviewerJwtSecret: DEFAULT_REVIEWER_JWT_SECRET,
        reviewerJwksUrl: undefined,
        reviewerJwksIssuer: undefined,
        reviewerJwksAudience: undefined,
        clockSkewToleranceMs: DEFAULT_CLOCK_SKEW_TOLERANCE_MS,
      }),
    (error: unknown) =>
      error instanceof WorkflowError &&
      error.code === "UNAUTHORIZED" &&
      /expired/i.test(error.message),
  );
});

test("reviewer auth rejects malformed JWT payload", async () => {
  const encodedHeader = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" }), "utf-8").toString("base64url");
  const malformedToken = `${encodedHeader}.@@@.invalid-signature`;

  await assert.rejects(
    () =>
      resolveAuthenticatedReviewerAsync(createRequest(`Bearer ${malformedToken}`), {
        reviewerJwtSecret: DEFAULT_REVIEWER_JWT_SECRET,
        reviewerJwksUrl: undefined,
        reviewerJwksIssuer: undefined,
        reviewerJwksAudience: undefined,
        clockSkewToleranceMs: DEFAULT_CLOCK_SKEW_TOLERANCE_MS,
      }),
    (error: unknown) =>
      error instanceof WorkflowError &&
      error.code === "UNAUTHORIZED" &&
      /payload is invalid|missing or invalid/i.test(error.message),
  );
});

test("reviewer auth refreshes JWKS when token kid is missing from cache", async () => {
  const keyA = createRs256KeyMaterial("kid-a");
  const keyB = createRs256KeyMaterial("kid-b");

  await withJwksServer({ keys: [keyA.jwk] }, async ({ getBaseUrl, getRequestCount, setDocument }) => {
    const reviewerA = await resolveAuthenticatedReviewerAsync(
      createRequest(
        `Bearer ${createRs256ReviewerJwt({
          reviewerId: "reviewer-a",
          reviewerRole: "radiologist",
          kid: "kid-a",
          privateKey: keyA.privateKey,
        })}`,
      ),
      {
        reviewerJwtSecret: "",
        reviewerJwksUrl: getBaseUrl(),
        reviewerJwksIssuer: undefined,
        reviewerJwksAudience: undefined,
        clockSkewToleranceMs: DEFAULT_CLOCK_SKEW_TOLERANCE_MS,
      },
    );

    assert.equal(reviewerA.reviewerId, "reviewer-a");

    setDocument({ keys: [keyB.jwk] });

    const reviewerB = await resolveAuthenticatedReviewerAsync(
      createRequest(
        `Bearer ${createRs256ReviewerJwt({
          reviewerId: "reviewer-b",
          reviewerRole: "neuroradiologist",
          kid: "kid-b",
          privateKey: keyB.privateKey,
        })}`,
      ),
      {
        reviewerJwtSecret: "",
        reviewerJwksUrl: getBaseUrl(),
        reviewerJwksIssuer: undefined,
        reviewerJwksAudience: undefined,
        clockSkewToleranceMs: DEFAULT_CLOCK_SKEW_TOLERANCE_MS,
      },
    );

    assert.equal(reviewerB.reviewerId, "reviewer-b");
    assert.equal(reviewerB.reviewerRole, "neuroradiologist");
    assert.equal(getRequestCount(), 2);
  });
});

test("reviewer auth falls back to the only JWKS signing key after refresh", async () => {
  const key = createRs256KeyMaterial("stable-kid");

  await withJwksServer({ keys: [key.jwk] }, async ({ getBaseUrl, getRequestCount }) => {
    const reviewer = await resolveAuthenticatedReviewerAsync(
      createRequest(
        `Bearer ${createRs256ReviewerJwt({
          reviewerId: "reviewer-single-key",
          reviewerRole: "radiologist",
          kid: "rotated-kid",
          privateKey: key.privateKey,
        })}`,
      ),
      {
        reviewerJwtSecret: "",
        reviewerJwksUrl: getBaseUrl(),
        reviewerJwksIssuer: undefined,
        reviewerJwksAudience: undefined,
        clockSkewToleranceMs: DEFAULT_CLOCK_SKEW_TOLERANCE_MS,
      },
    );

    assert.equal(reviewer.reviewerId, "reviewer-single-key");
    assert.equal(getRequestCount(), 2);
  });
});

test("reviewer auth caches JWKS per URL so same kid across different issuers does not reuse the wrong key", async () => {
  const issuerA = createRs256KeyMaterial("shared-kid");
  const issuerB = createRs256KeyMaterial("shared-kid");

  await withJwksServer({ keys: [issuerA.jwk] }, async ({ getBaseUrl: getIssuerABaseUrl, getRequestCount: getIssuerARequestCount }) => {
    await withJwksServer({ keys: [issuerB.jwk] }, async ({ getBaseUrl: getIssuerBBaseUrl, getRequestCount: getIssuerBRequestCount }) => {
      const reviewerA = await resolveAuthenticatedReviewerAsync(
        createRequest(
          `Bearer ${createRs256ReviewerJwt({
            reviewerId: "reviewer-issuer-a",
            reviewerRole: "radiologist",
            kid: "shared-kid",
            privateKey: issuerA.privateKey,
          })}`,
        ),
        {
          reviewerJwtSecret: "",
          reviewerJwksUrl: getIssuerABaseUrl(),
          reviewerJwksIssuer: undefined,
          reviewerJwksAudience: undefined,
          clockSkewToleranceMs: DEFAULT_CLOCK_SKEW_TOLERANCE_MS,
        },
      );

      const reviewerB = await resolveAuthenticatedReviewerAsync(
        createRequest(
          `Bearer ${createRs256ReviewerJwt({
            reviewerId: "reviewer-issuer-b",
            reviewerRole: "neuroradiologist",
            kid: "shared-kid",
            privateKey: issuerB.privateKey,
          })}`,
        ),
        {
          reviewerJwtSecret: "",
          reviewerJwksUrl: getIssuerBBaseUrl(),
          reviewerJwksIssuer: undefined,
          reviewerJwksAudience: undefined,
          clockSkewToleranceMs: DEFAULT_CLOCK_SKEW_TOLERANCE_MS,
        },
      );

      assert.equal(reviewerA.reviewerId, "reviewer-issuer-a");
      assert.equal(reviewerB.reviewerId, "reviewer-issuer-b");
      assert.equal(reviewerB.reviewerRole, "neuroradiologist");
      assert.equal(getIssuerARequestCount(), 1);
      assert.equal(getIssuerBRequestCount(), 1);
    });
  });
});
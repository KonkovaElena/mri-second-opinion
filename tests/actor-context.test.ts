import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../src/app";

const DEFAULT_INTERNAL_API_TOKEN = "actor-ctx-internal-token-001";
const DEFAULT_OPERATOR_API_TOKEN = "actor-ctx-operator-token-001";
const DEFAULT_REVIEWER_JWT_SECRET = "actor-ctx-jwt-secret-0123456789abcdef";

function createTestStoreFile() {
  const tempDir = mkdtempSync(join(tmpdir(), "mri-actor-ctx-"));
  return { tempDir, caseStoreFile: join(tempDir, "cases.sqlite") };
}

function createReviewerJwt(opts: {
  reviewerId: string;
  reviewerRole?: string;
  secret?: string;
}) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" }), "utf-8").toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      sub: opts.reviewerId,
      ...(opts.reviewerRole ? { role: opts.reviewerRole } : {}),
      exp: Math.floor(Date.now() / 1000) + 120,
    }),
    "utf-8",
  ).toString("base64url");
  const signingInput = `${header}.${payload}`;
  const signature = createHmac("sha256", opts.secret ?? DEFAULT_REVIEWER_JWT_SECRET)
    .update(signingInput)
    .digest("base64url");
  return `${signingInput}.${signature}`;
}

function reviewerHeaders(reviewerId: string, reviewerRole?: string) {
  return { authorization: `Bearer ${createReviewerJwt({ reviewerId, reviewerRole })}` };
}

function isInternalPath(path: string) {
  return /^\/api\/internal(\/|$)/.test(path);
}

function isOperatorPath(path: string) {
  return /^\/api\/(cases|operations|delivery)(\/|$)/.test(path);
}

function isReviewerPath(path: string) {
  return /\/api\/cases\/[^/]+\/(review|finalize)$/.test(path);
}

function withAuth(path: string, extra: Record<string, string> = {}) {
  const h: Record<string, string> = { "content-type": "application/json", ...extra };
  if (isInternalPath(path) && !h.authorization) {
    h.authorization = `Bearer ${DEFAULT_INTERNAL_API_TOKEN}`;
  }
  if (isOperatorPath(path) && !h["x-api-key"]) {
    h["x-api-key"] = DEFAULT_OPERATOR_API_TOKEN;
  }
  if (isReviewerPath(path) && !h.authorization) {
    Object.assign(h, reviewerHeaders("implicit-reviewer", "neuroradiologist"));
  }
  return h;
}

async function withServer<T>(
  caseStoreFile: string,
  run: (helpers: {
    baseUrl: string;
    json: (path: string, init?: RequestInit) => Promise<{ res: Response; body: any }>;
  }) => Promise<T>,
) {
  const app = createApp({
    nodeEnv: "test",
    port: 0,
    caseStoreFile,
    caseStoreMode: "sqlite",
    internalApiToken: DEFAULT_INTERNAL_API_TOKEN,
    operatorApiToken: DEFAULT_OPERATOR_API_TOKEN,
    reviewerJwtSecret: DEFAULT_REVIEWER_JWT_SECRET,
    reviewerAllowedRoles: ["clinician", "radiologist", "neuroradiologist"],
  });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    return await run({
      baseUrl,
      json: async (path, init) => {
        const res = await fetch(`${baseUrl}${path}`, {
          ...init,
          headers: withAuth(path, (init?.headers as Record<string, string>) ?? {}),
        });
        const text = await res.text();
        return { res, body: text.length > 0 ? JSON.parse(text) : null };
      },
    });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
    await app.locals.caseService.close();
  }
}

async function createCaseAtAwaitingReview(
  json: (path: string, init?: RequestInit) => Promise<{ res: Response; body: any }>,
) {
  const created = await json("/api/cases", {
    method: "POST",
    body: JSON.stringify({
      patientAlias: "actor-ctx-patient-001",
      studyUid: "1.2.840.actor.ctx.001",
      sequenceInventory: ["T1w", "FLAIR"],
      indication: "actor context audit test",
    }),
  });
  assert.equal(created.res.status, 201);
  const caseId = created.body.case.caseId as string;

  await json("/api/internal/inference-callback", {
    method: "POST",
    body: JSON.stringify({
      caseId,
      qcDisposition: "pass",
      findings: ["Actor context test finding."],
      measurements: [{ label: "whole_brain_ml", value: 1100 }],
      artifacts: ["artifact://qc", "artifact://report"],
    }),
  });

  return caseId;
}

test("operation log entries for review and finalize include actorId", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();
  try {
    await withServer(caseStoreFile, async ({ json }) => {
      const caseId = await createCaseAtAwaitingReview(json);

      // Review with a specific reviewer identity
      const reviewed = await json(`/api/cases/${caseId}/review`, {
        method: "POST",
        headers: reviewerHeaders("dr-garcia-001", "neuroradiologist"),
        body: JSON.stringify({ comments: "Actor context verified." }),
      });
      assert.equal(reviewed.res.status, 200);
      assert.equal(reviewed.body.case.status, "REVIEWED");

      // Finalize with a different reviewer identity
      const finalized = await json(`/api/cases/${caseId}/finalize`, {
        method: "POST",
        headers: reviewerHeaders("dr-kim-002", "radiologist"),
        body: JSON.stringify({ finalSummary: "Actor context finalized." }),
      });
      assert.equal(finalized.res.status, 200);
      assert.equal(finalized.body.case.status, "DELIVERY_PENDING");

      // Fetch the full case and inspect the operation log
      const detail = await json(`/api/cases/${caseId}`);
      const opLog = detail.body.case.operationLog as Array<{
        operationType: string;
        actorId: string | null;
        actorType: string;
      }>;

      // Find clinician-reviewed entry
      const reviewOp = opLog.find((e) => e.operationType === "clinician-reviewed");
      assert.ok(reviewOp, "Expected clinician-reviewed operation log entry");
      assert.equal(reviewOp.actorId, "dr-garcia-001", "Review operation must capture the reviewer actorId");

      // Find case-finalized entry
      const finalizeOp = opLog.find((e) => e.operationType === "case-finalized");
      assert.ok(finalizeOp, "Expected case-finalized operation log entry");
      assert.equal(finalizeOp.actorId, "dr-kim-002", "Finalize operation must capture the finalizer actorId");

      // All system/integration operations should have actorId as null (no human actor)
      const systemOps = opLog.filter((e) => e.actorType === "system" || e.actorType === "integration");
      for (const op of systemOps) {
        assert.equal(op.actorId, null, `System/integration op '${op.operationType}' should have null actorId`);
      }
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("finalize captures authenticated reviewer identity even when different from original reviewer", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();
  try {
    await withServer(caseStoreFile, async ({ json }) => {
      const caseId = await createCaseAtAwaitingReview(json);

      // Review by dr-alpha
      await json(`/api/cases/${caseId}/review`, {
        method: "POST",
        headers: reviewerHeaders("dr-alpha", "clinician"),
        body: JSON.stringify({ comments: "Initial review." }),
      });

      // Finalize by dr-beta (different person with authorization)
      const finalized = await json(`/api/cases/${caseId}/finalize`, {
        method: "POST",
        headers: reviewerHeaders("dr-beta", "radiologist"),
        body: JSON.stringify({ finalSummary: "Finalized by different clinician." }),
      });
      assert.equal(finalized.res.status, 200);

      const detail = await json(`/api/cases/${caseId}`);
      const opLog = detail.body.case.operationLog as Array<{
        operationType: string;
        actorId: string | null;
      }>;
      const finalizeOp = opLog.find((e) => e.operationType === "case-finalized");
      assert.ok(finalizeOp);
      assert.equal(finalizeOp.actorId, "dr-beta");

      // The review record on the case should still show dr-alpha
      assert.equal(detail.body.case.review.reviewerId, "dr-alpha");
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

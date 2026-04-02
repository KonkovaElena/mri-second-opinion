import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../src/app";
import { applyServerHardening } from "../src/http-runtime";

function createTestStoreFile() {
  const tempDir = mkdtempSync(join(tmpdir(), "mri-second-opinion-runtime-"));
  return {
    tempDir,
    caseStoreFile: join(tempDir, "cases.sqlite"),
  };
}

async function startServer(
  caseStoreFile: string,
  configOverrides: Partial<Parameters<typeof createApp>[0]> = {},
) {
  const app = createApp({
    nodeEnv: "test",
    port: 0,
    caseStoreFile,
    caseStoreMode: "sqlite",
    ...configOverrides,
  });
  const server = createServer(app);

  await new Promise<void>((resolve) => {
    server.listen(0, resolve);
  });

  const address = server.address() as AddressInfo;
  return {
    app,
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function stopServer(server: Server, shutdown: () => Promise<void>) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

  await shutdown();
}

async function withServer<T>(
  caseStoreFile: string,
  run: (helpers: { baseUrl: string }) => Promise<T>,
  configOverrides: Partial<Parameters<typeof createApp>[0]> = {},
) {
  const { app, server, baseUrl } = await startServer(caseStoreFile, configOverrides);

  try {
    return await run({ baseUrl });
  } finally {
    await stopServer(server, async () => {
      await app.locals.caseService.close();
    });
  }
}

test("metrics endpoint exposes Prometheus-formatted registry output", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(caseStoreFile, async ({ baseUrl }) => {
      const casesResponse = await fetch(`${baseUrl}/api/cases`);
      assert.equal(casesResponse.status, 200);

      const metricsResponse = await fetch(`${baseUrl}/metrics`);
      const metricsBody = await metricsResponse.text();

      assert.equal(metricsResponse.status, 200);
      assert.match(metricsResponse.headers.get("content-type") ?? "", /text\/plain/);
      assert.match(metricsBody, /mri_second_opinion_http_requests_total/);
      assert.match(metricsBody, /mri_second_opinion_http_request_duration_seconds/);
      assert.match(metricsBody, /mri_second_opinion_process_cpu_user_seconds_total/);
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("readyz reports not-ready during shutdown while healthz stays live", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    const { app, server, baseUrl } = await startServer(caseStoreFile);

    try {
      const readyBefore = await fetch(`${baseUrl}/readyz`);
      assert.equal(readyBefore.status, 200);

      app.locals.runtimeState.isShuttingDown = true;

      const readyDuring = await fetch(`${baseUrl}/readyz`);
      const readyDuringBody = await readyDuring.json();
      const healthDuring = await fetch(`${baseUrl}/healthz`);
      const healthDuringBody = await healthDuring.json();

      assert.equal(readyDuring.status, 503);
      assert.equal(readyDuringBody.status, "not-ready");
      assert.equal(readyDuringBody.reason, "shutdown-in-progress");
      assert.equal(healthDuring.status, 200);
      assert.equal(healthDuringBody.status, "ok");
    } finally {
      await stopServer(server, async () => {
        await app.locals.caseService.close();
      });
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("public API rate limiting returns 429 while internal routes stay exempt", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(
      caseStoreFile,
      async ({ baseUrl }) => {
        const firstPublic = await fetch(`${baseUrl}/api/cases`);
        assert.equal(firstPublic.status, 200);

        const limitedPublic = await fetch(`${baseUrl}/api/cases`);
        const limitedBody = await limitedPublic.json();
        assert.equal(limitedPublic.status, 429);
        assert.equal(limitedBody.code, "RATE_LIMITED");
        assert.equal(typeof limitedBody.requestId, "string");

        const internal = await fetch(`${baseUrl}/api/internal/ingest`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            patientAlias: "synthetic-patient-rate-limit-001",
            studyUid: "1.2.840.rate-limit.1",
            sequenceInventory: ["T1w", "FLAIR"],
          }),
        });
        const internalBody = await internal.json();

        assert.equal(internal.status, 201);
        assert.equal(internalBody.case.status, "SUBMITTED");
      },
      {
        publicApiRateLimitMaxRequests: 1,
        publicApiRateLimitWindowMs: 60_000,
      },
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("cross-origin browser requests are rejected unless the origin is explicitly allowlisted", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(caseStoreFile, async ({ baseUrl }) => {
      const response = await fetch(`${baseUrl}/api/cases`, {
        headers: {
          Origin: "https://viewer.example.test",
        },
      });
      const body = await response.json();

      assert.equal(response.status, 403);
      assert.equal(body.code, "CORS_ORIGIN_NOT_ALLOWED");
      assert.equal(typeof body.requestId, "string");
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("allowlisted origins receive explicit CORS preflight approval for public JSON routes", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(
      caseStoreFile,
      async ({ baseUrl }) => {
        const response = await fetch(`${baseUrl}/api/cases`, {
          method: "OPTIONS",
          headers: {
            Origin: "https://viewer.example.test",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
          },
        });

        assert.equal(response.status, 204);
        assert.equal(response.headers.get("access-control-allow-origin"), "https://viewer.example.test");
        assert.equal(response.headers.get("access-control-allow-headers"), "content-type");
        assert.match(response.headers.get("access-control-allow-methods") ?? "", /POST/);
        assert.match(response.headers.get("vary") ?? "", /Origin/);
      },
      {
        corsAllowedOrigins: ["https://viewer.example.test"],
      } as Partial<Parameters<typeof createApp>[0]>,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("allowlisted origins cannot preflight unsupported authorization headers", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(
      caseStoreFile,
      async ({ baseUrl }) => {
        const response = await fetch(`${baseUrl}/api/internal/inference-jobs`, {
          method: "OPTIONS",
          headers: {
            Origin: "https://viewer.example.test",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization, content-type",
          },
        });
        const body = await response.json();

        assert.equal(response.status, 403);
        assert.equal(body.code, "CORS_HEADERS_NOT_ALLOWED");
      },
      {
        corsAllowedOrigins: ["https://viewer.example.test"],
      } as Partial<Parameters<typeof createApp>[0]>,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("workbench document responses include CSP and document security headers", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(caseStoreFile, async ({ baseUrl }) => {
      const response = await fetch(`${baseUrl}/workbench`);
      const contentSecurityPolicy = response.headers.get("content-security-policy") ?? "";

      assert.equal(response.status, 200);
      assert.match(contentSecurityPolicy, /default-src 'self'/);
      assert.match(contentSecurityPolicy, /script-src 'self'/);
      assert.match(contentSecurityPolicy, /style-src 'self'/);
      assert.match(contentSecurityPolicy, /img-src 'self' data: blob:/);
      assert.match(contentSecurityPolicy, /connect-src 'self'/);
      assert.match(contentSecurityPolicy, /font-src 'self'/);
      assert.match(contentSecurityPolicy, /object-src 'none'/);
      assert.match(contentSecurityPolicy, /base-uri 'self'/);
      assert.match(contentSecurityPolicy, /form-action 'self'/);
      assert.match(contentSecurityPolicy, /frame-ancestors 'none'/);
      assert.equal(response.headers.get("cross-origin-embedder-policy"), null);
      assert.equal(response.headers.get("cross-origin-opener-policy"), "same-origin");
      assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      assert.equal(response.headers.get("x-frame-options"), "DENY");
      assert.equal(response.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
      assert.equal(response.headers.get("x-permitted-cross-domain-policies"), "none");
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("production responses include strict transport security", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(
      caseStoreFile,
      async ({ baseUrl }) => {
        const response = await fetch(`${baseUrl}/healthz`);

        assert.equal(response.status, 200);
        assert.match(response.headers.get("strict-transport-security") ?? "", /max-age=/);
      },
      {
        nodeEnv: "production",
      },
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("oversized JSON requests fail with a typed 413 response", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    await withServer(
      caseStoreFile,
      async ({ baseUrl }) => {
        const response = await fetch(`${baseUrl}/api/cases`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            patientAlias: "synthetic-patient-payload-001",
            studyUid: "1.2.840.payload.1",
            sequenceInventory: ["T1w", "FLAIR"],
            indication: "x".repeat(4096),
          }),
        });
        const body = await response.json();

        assert.equal(response.status, 413);
        assert.equal(body.code, "PAYLOAD_TOO_LARGE");
        assert.match(body.error, /configured limit of 1kb/i);
      },
      {
        jsonBodyLimit: "1kb",
      },
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("server hardening applies configured timeout and keep-alive settings", () => {
  const app = createApp({
    nodeEnv: "test",
    port: 0,
    caseStoreFile: join(tmpdir(), "mri-second-opinion-hardening.sqlite"),
    caseStoreMode: "sqlite",
  });
  const server = createServer(app);

  try {
    applyServerHardening(server, {
      nodeEnv: "test",
      port: 0,
      caseStoreFile: join(tmpdir(), "mri-second-opinion-hardening.sqlite"),
      caseStoreMode: "sqlite",
      clockSkewToleranceMs: 60_000,
      replayStoreTtlMs: 120_000,
      replayStoreMaxEntries: 10_000,
      persistenceMode: "snapshot",
      reviewerIdentitySource: "request-body",
      jsonBodyLimit: "1mb",
      publicApiRateLimitWindowMs: 900_000,
      publicApiRateLimitMaxRequests: 300,
      serverHeadersTimeoutMs: 31_000,
      serverRequestTimeoutMs: 121_000,
      serverSocketTimeoutMs: 122_000,
      serverKeepAliveTimeoutMs: 6_000,
      serverMaxRequestsPerSocket: 77,
      gracefulShutdownTimeoutMs: 10_000,
    });

    assert.equal(server.headersTimeout, 31_000);
    assert.equal(server.requestTimeout, 121_000);
    assert.equal(server.timeout, 122_000);
    assert.equal(server.keepAliveTimeout, 6_000);
    assert.equal(server.maxRequestsPerSocket, 77);
  } finally {
    server.close();
    void app.locals.caseService.close();
  }
});

test("unhandled errors produce structured JSON log with event and requestId", async () => {
  const { tempDir, caseStoreFile } = createTestStoreFile();

  try {
    const { app, server, baseUrl } = await startServer(caseStoreFile);

    try {
      const captured: string[] = [];
      const originalStderr = console.error;
      console.error = (...args: unknown[]) => {
        captured.push(String(args[0]));
      };

      try {
        // Monkey-patch getCase to throw a raw Error (not WorkflowError)
        // so the handleError 500 branch fires with structured logging
        app.locals.caseService.getCase = () => {
          throw new Error("simulated unexpected storage failure");
        };

        const response = await fetch(`${baseUrl}/api/cases/any-id`);
        const body = await response.json();

        assert.equal(response.status, 500);
        assert.equal(body.code, "INTERNAL_ERROR");
        assert.equal(typeof body.requestId, "string");

        // Verify structured error log was emitted
        assert.ok(captured.length >= 1, "expected at least one console.error call");
        const logEntry = JSON.parse(captured[captured.length - 1]);
        assert.equal(logEntry.level, "error");
        assert.equal(logEntry.event, "unhandled_error");
        assert.equal(typeof logEntry.requestId, "string");
        assert.equal(logEntry.message, "simulated unexpected storage failure");
        assert.equal(typeof logEntry.timestamp, "string");
      } finally {
        console.error = originalStderr;
      }
    } finally {
      server.close();
      await app.locals.caseService.close();
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
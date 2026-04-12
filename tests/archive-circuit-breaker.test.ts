import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createArchiveLookupClient } from "../src/archive-lookup";

test("archive lookup circuit breaker opens after repeated backend failures", async () => {
  let requestCount = 0;
  const server = createServer((req, res) => {
    requestCount += 1;
    res.statusCode = 500;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: "upstream-unavailable", path: req.url }));
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;

  try {
    const client = createArchiveLookupClient({
      archiveLookupBaseUrl: `http://127.0.0.1:${port}`,
      archiveLookupMode: "custom",
      archiveLookupSource: "mock-archive",
    });

    const first = await client.lookupStudy("study-1");
    const second = await client.lookupStudy("study-1");
    const third = await client.lookupStudy("study-1");
    const fourth = await client.lookupStudy("study-1");

    assert.deepEqual(first, { status: "error", reason: "server-error", httpStatus: 500 });
    assert.deepEqual(second, { status: "error", reason: "server-error", httpStatus: 500 });
    assert.deepEqual(third, { status: "error", reason: "server-error", httpStatus: 500 });
    assert.deepEqual(fourth, { status: "error", reason: "circuit-open", httpStatus: 503 });
    assert.equal(requestCount, 3);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

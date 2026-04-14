import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  API_SURFACE_SUMMARY,
  INTERNAL_INTEGRATION_ROUTE_STRINGS,
  OPERATIONAL_ROUTE_STRINGS,
  PUBLIC_WORKFLOW_ROUTE_STRINGS,
} from "../src/api-surface.generated";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

test("authority route surface stays unique and count-stable", () => {
  const allRoutes = [
    ...PUBLIC_WORKFLOW_ROUTE_STRINGS,
    ...INTERNAL_INTEGRATION_ROUTE_STRINGS,
    ...OPERATIONAL_ROUTE_STRINGS,
  ];

  assert.equal(PUBLIC_WORKFLOW_ROUTE_STRINGS.length, 13);
  assert.equal(INTERNAL_INTEGRATION_ROUTE_STRINGS.length, 11);
  assert.equal(OPERATIONAL_ROUTE_STRINGS.length, 5);
  assert.equal(API_SURFACE_SUMMARY.totalApiCount, 24);
  assert.equal(API_SURFACE_SUMMARY.totalHttpSurfaceCount, 29);
  assert.equal(new Set(allRoutes).size, allRoutes.length, "Route strings must remain unique across the generated API surface");
});

test("authority docs are synchronized with runtime-truth SSOT", () => {
  const result = spawnSync("node", ["scripts/sync-authority-docs.mjs", "--check"], {
    cwd: REPO_ROOT,
    encoding: "utf-8",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout || "authority sync check failed");
});
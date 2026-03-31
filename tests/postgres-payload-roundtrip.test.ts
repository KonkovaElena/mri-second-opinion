import test from "node:test";
import assert from "node:assert/strict";
import { newDb } from "pg-mem";
import { MemoryCaseService } from "../src/cases";

function createPostgresServiceFactory() {
  const database = newDb();
  const adapter = database.adapters.createPg();
  return () =>
    new MemoryCaseService({
      storageMode: "postgres",
      caseStoreDatabaseUrl: "postgresql://unit.test/mri_second_opinion",
      caseStoreSchema: "mri_wave1",
      postgresPoolFactory: () => new adapter.Pool(),
    } as unknown as ConstructorParameters<typeof MemoryCaseService>[0]);
}

// ----- Postgres payload round-trip proof -----

test("postgres round-trip preserves Unicode characters in patientAlias and indication", async () => {
  const createService = createPostgresServiceFactory();
  const service = createService();

  try {
    const created = await service.createCase({
      patientAlias: "Пациент-日本語-αβγ-مريض",
      studyUid: "1.2.3.unicode.alias",
      sequenceInventory: ["T1w", "FLAIR"],
      indication: "Головная боль 🧠 — 偏頭痛 evaluation « with quotes »",
    });

    const retrieved = await service.getCase(created.caseId);
    assert.equal(retrieved.patientAlias, "Пациент-日本語-αβγ-مريض");
    assert.equal(retrieved.indication, "Головная боль 🧠 — 偏頭痛 evaluation « with quotes »");
  } finally {
    await service.close();
  }
});

test("postgres round-trip preserves emoji and special characters in findings and generatedSummary", async () => {
  const createService = createPostgresServiceFactory();
  const service = createService();

  try {
    const created = await service.createCase({
      patientAlias: "emoji-findings-patient",
      studyUid: "1.2.3.emoji.findings",
      sequenceInventory: ["T1w", "FLAIR"],
    });

    await service.completeInference(created.caseId, {
      qcDisposition: "pass",
      findings: [
        "🧠 Brain volume within normal limits",
        "No lesions – «très bien» — все в порядке ✅",
        "Measurement: 1200±50 mL (σ = 3.2)",
      ],
      measurements: [{ label: "brain_volume_ml", value: 1200 }],
      artifacts: ["artifact://overlay"],
      generatedSummary: `Summary with \ud83d\udd2c microscopy symbols, \u2014 em dash, \u201csmart quotes\u201d, and \ttab\nnewline`,
    });

    const retrieved = await service.getCase(created.caseId);
    assert.equal(retrieved.report!.findings[0], "\ud83e\udde0 Brain volume within normal limits");
    assert.equal(retrieved.report!.findings[1], "No lesions \u2013 \u00abtr\u00e8s bien\u00bb \u2014 \u0432\u0441\u0435 \u0432 \u043f\u043e\u0440\u044f\u0434\u043a\u0435 \u2705");
    assert.equal(retrieved.report!.findings[2], "Measurement: 1200\u00b150 mL (\u03c3 = 3.2)");
    assert.ok(retrieved.report!.processingSummary.includes("\ud83d\udd2c"));
    assert.ok(retrieved.report!.processingSummary.includes("“smart quotes”"));
    assert.ok(retrieved.report!.processingSummary.includes("\t"));
    assert.ok(retrieved.report!.processingSummary.includes("\n"));
  } finally {
    await service.close();
  }
});

test("postgres round-trip preserves review comments with embedded newlines and special chars", async () => {
  const createService = createPostgresServiceFactory();
  const service = createService();

  try {
    const created = await service.createCase({
      patientAlias: "review-special-chars",
      studyUid: "1.2.3.review.special",
      sequenceInventory: ["T1w", "FLAIR"],
    });

    await service.completeInference(created.caseId, {
      qcDisposition: "pass",
      findings: ["Normal baseline."],
      measurements: [{ label: "brain_volume_ml", value: 1100 }],
      artifacts: ["artifact://report"],
      generatedSummary: "Draft for review.",
    });

    const comments =
      "Reviewer notes:\n" +
      "- Line 1: «quotation marks» and — em dashes\n" +
      "- Line 2: Кириллица и 漢字\n" +
      '- Line 3: forward slash / and "double quotes"\n' +
      "- Line 4: null byte should not appear here";

    await service.reviewCase(created.caseId, {
      reviewerId: "reviewer-unicode-test",
      comments,
    });

    const retrieved = await service.getCase(created.caseId);
    assert.equal(retrieved.review.comments, comments);
    assert.equal(retrieved.review.reviewerId, "reviewer-unicode-test");
  } finally {
    await service.close();
  }
});

test("postgres round-trip preserves special floating-point measurement values", async () => {
  const createService = createPostgresServiceFactory();
  const service = createService();

  try {
    const created = await service.createCase({
      patientAlias: "float-precision",
      studyUid: "1.2.3.float.precision",
      sequenceInventory: ["T1w", "FLAIR"],
    });

    await service.completeInference(created.caseId, {
      qcDisposition: "pass",
      findings: ["Float precision test."],
      measurements: [
        { label: "tiny_value", value: 0.000001 },
        { label: "large_value", value: 99999.9999 },
        { label: "negative_value", value: -42.5 },
        { label: "zero_value", value: 0 },
      ],
      artifacts: ["artifact://report"],
      generatedSummary: "Float precision draft.",
    });

    const retrieved = await service.getCase(created.caseId);
    const measurements = retrieved.report!.measurements;
    assert.equal(measurements.find((m: any) => m.label === "tiny_value")?.value, 0.000001);
    assert.equal(measurements.find((m: any) => m.label === "large_value")?.value, 99999.9999);
    assert.equal(measurements.find((m: any) => m.label === "negative_value")?.value, -42.5);
    assert.equal(measurements.find((m: any) => m.label === "zero_value")?.value, 0);
  } finally {
    await service.close();
  }
});

test("postgres round-trip preserves large sequenceInventory arrays", async () => {
  const createService = createPostgresServiceFactory();
  const service = createService();

  try {
    const sequences = Array.from({ length: 50 }, (_, i) => `SEQ_${String(i).padStart(3, "0")}`);
    // T1w required:
    sequences[0] = "T1w";

    const created = await service.createCase({
      patientAlias: "large-inventory",
      studyUid: "1.2.3.large.inventory",
      sequenceInventory: sequences,
    });

    const retrieved = await service.getCase(created.caseId);
    assert.deepEqual(retrieved.sequenceInventory, sequences);
    assert.equal(retrieved.sequenceInventory.length, 50);
  } finally {
    await service.close();
  }
});

test("postgres round-trip preserves operation transcript, retry history, and null-or-empty optional shapes", async () => {
  const createService = createPostgresServiceFactory();
  const first = createService();
  let caseId = "";

  try {
    const created = await first.createCase({
      patientAlias: "postgres-ops-roundtrip",
      studyUid: "1.2.3.postgres.ops.roundtrip",
      sequenceInventory: ["T1w", "FLAIR"],
    });
    caseId = created.caseId;

    await first.completeInference(created.caseId, {
      qcDisposition: "warn",
      findings: ["Stable chronic change."],
      measurements: [{ label: "brain_volume_ml", value: 1098 }],
      artifacts: ["artifact://qc", "artifact://report"],
    });
    await first.reviewCase(created.caseId, {
      reviewerId: "postgres-roundtrip-reviewer",
    });
    await first.finalizeCase(created.caseId, {
      deliveryOutcome: "failed",
    });
    await first.retryDelivery(created.caseId);
  } finally {
    await first.close();
  }

  const second = createService();

  try {
    const reloaded = await second.getCase(caseId);
    const summary = await second.getOperationsSummary();

    assert.equal(reloaded.status, "DELIVERY_PENDING");
    assert.equal(reloaded.studyContext.sourceArchive, null);
    assert.deepEqual(reloaded.studyContext.metadataSummary, []);
    assert.deepEqual(reloaded.studyContext.series, []);
    assert.equal(reloaded.review.reviewerRole, null);
    assert.equal(reloaded.review.comments, null);
    assert.notEqual(reloaded.review.reviewedAt, null);
    assert.equal(Object.prototype.hasOwnProperty.call(reloaded.report ?? {}, "finalImpression"), false);
    assert.deepEqual(reloaded.qcSummary.checks, []);
    assert.deepEqual(reloaded.qcSummary.metrics, []);
    assert.deepEqual(reloaded.qcSummary.issues, []);
    assert.equal(reloaded.operationLog.some((entry) => entry.operationType === "case-created"), true);
    assert.equal(
      reloaded.operationLog.some((entry) => entry.operationType === "delivery-retry-requested"),
      true,
    );
    assert.equal(summary.retryHistory.length, 1);
    assert.equal(summary.retryHistory[0].caseId, caseId);
    assert.equal(summary.retryHistory[0].operationType, "delivery-retry-requested");
    assert.equal(
      summary.recentOperations.some(
        (entry) => entry.caseId === caseId && entry.operationType === "delivery-retry-requested",
      ),
      true,
    );
  } finally {
    await second.close();
  }
});

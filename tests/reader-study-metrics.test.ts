import test, { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeAucRoc,
  computeDiceCoefficient,
  computeIcc,
  buildReaderStudySummary,
  parseBinaryPredictions,
  parseMeasurementPairs,
  type BinaryPrediction,
  type VolumetricPair,
  type MeasurementConcordancePair,
} from "../src/reader-study-metrics";

describe("computeAucRoc", () => {
  it("should compute perfect AUC for perfectly separated predictions", () => {
    const predictions: BinaryPrediction[] = [
      { caseId: "c1", groundTruth: true, predictedScore: 0.9 },
      { caseId: "c2", groundTruth: true, predictedScore: 0.8 },
      { caseId: "c3", groundTruth: false, predictedScore: 0.2 },
      { caseId: "c4", groundTruth: false, predictedScore: 0.1 },
    ];

    const result = computeAucRoc(predictions);
    assert.equal(result.auc, 1);
    assert.equal(result.n, 4);
    assert.equal(result.nPositive, 2);
    assert.equal(result.nNegative, 2);
    assert.ok(result.ci95Lower >= 0);
    assert.ok(result.ci95Upper <= 1);
  });

  it("should compute AUC between 0 and 1 for mixed predictions", () => {
    const predictions: BinaryPrediction[] = [
      { caseId: "c1", groundTruth: true, predictedScore: 0.3 },
      { caseId: "c2", groundTruth: false, predictedScore: 0.7 },
      { caseId: "c3", groundTruth: true, predictedScore: 0.6 },
      { caseId: "c4", groundTruth: false, predictedScore: 0.5 },
    ];

    const result = computeAucRoc(predictions);
    assert.ok(result.auc >= 0);
    assert.ok(result.auc <= 1);
  });

  it("should throw for fewer than 2 predictions", () => {
    assert.throws(
      () => computeAucRoc([{ caseId: "c1", groundTruth: true, predictedScore: 0.9 }]),
      /at least 2/,
    );
  });

  it("should throw when all ground truth values are identical", () => {
    assert.throws(
      () => computeAucRoc([
        { caseId: "c1", groundTruth: true, predictedScore: 0.9 },
        { caseId: "c2", groundTruth: true, predictedScore: 0.8 },
      ]),
      /both positive and negative/,
    );
  });

  it("should include CI95 bounds", () => {
    const predictions: BinaryPrediction[] = [];
    for (let i = 0; i < 50; i++) {
      predictions.push({
        caseId: `c${i}`,
        groundTruth: i < 25,
        predictedScore: i < 25 ? 0.6 + Math.random() * 0.3 : Math.random() * 0.4,
      });
    }

    const result = computeAucRoc(predictions);
    assert.ok(result.ci95Lower <= result.auc);
    assert.ok(result.ci95Upper >= result.auc);
  });
});

describe("computeDiceCoefficient", () => {
  it("should return 1.0 for identical regions", () => {
    const pairs: VolumetricPair[] = [
      {
        caseId: "c1",
        groundTruthRegions: new Set([1, 2, 3, 4, 5]),
        predictedRegions: new Set([1, 2, 3, 4, 5]),
      },
    ];

    const result = computeDiceCoefficient(pairs);
    assert.equal(result.dice, 1);
    assert.equal(result.intersection, 5);
  });

  it("should return 0 for non-overlapping regions", () => {
    const pairs: VolumetricPair[] = [
      {
        caseId: "c1",
        groundTruthRegions: new Set([1, 2, 3]),
        predictedRegions: new Set([4, 5, 6]),
      },
    ];

    const result = computeDiceCoefficient(pairs);
    assert.equal(result.dice, 0);
    assert.equal(result.intersection, 0);
  });

  it("should compute partial overlap correctly", () => {
    const pairs: VolumetricPair[] = [
      {
        caseId: "c1",
        groundTruthRegions: new Set([1, 2, 3, 4]),
        predictedRegions: new Set([3, 4, 5, 6]),
      },
    ];

    const result = computeDiceCoefficient(pairs);
    // intersection = 2 (3, 4), total = 4 + 4 = 8, dice = 4/8 = 0.5
    assert.equal(result.dice, 0.5);
    assert.equal(result.intersection, 2);
  });

  it("should throw for empty pair array", () => {
    assert.throws(() => computeDiceCoefficient([]), /at least 1/);
  });

  it("should aggregate across multiple pairs", () => {
    const pairs: VolumetricPair[] = [
      {
        caseId: "c1",
        groundTruthRegions: new Set([1, 2]),
        predictedRegions: new Set([1, 2]),
      },
      {
        caseId: "c2",
        groundTruthRegions: new Set([10, 20]),
        predictedRegions: new Set([30, 40]),
      },
    ];

    const result = computeDiceCoefficient(pairs);
    // total intersection=2, total gt=4, total pred=4, dice = 4/8 = 0.5
    assert.equal(result.dice, 0.5);
    assert.equal(result.n, 2);
  });
});

describe("computeIcc", () => {
  it("should return high ICC for highly concordant measurements", () => {
    const pairs: MeasurementConcordancePair[] = [
      { caseId: "c1", groundTruthValue: 3200, predictedValue: 3210 },
      { caseId: "c2", groundTruthValue: 2800, predictedValue: 2805 },
      { caseId: "c3", groundTruthValue: 4100, predictedValue: 4095 },
      { caseId: "c4", groundTruthValue: 3500, predictedValue: 3502 },
    ];

    const result = computeIcc(pairs);
    assert.ok(result.icc > 0.9, `Expected ICC > 0.9, got ${result.icc}`);
    assert.equal(result.n, 4);
  });

  it("should return low ICC for discordant measurements", () => {
    const pairs: MeasurementConcordancePair[] = [
      { caseId: "c1", groundTruthValue: 3200, predictedValue: 1000 },
      { caseId: "c2", groundTruthValue: 2800, predictedValue: 5000 },
      { caseId: "c3", groundTruthValue: 4100, predictedValue: 2000 },
    ];

    const result = computeIcc(pairs);
    assert.ok(result.icc < 0.5, `Expected ICC < 0.5, got ${result.icc}`);
  });

  it("should include Bland-Altman limits of agreement", () => {
    const pairs: MeasurementConcordancePair[] = [
      { caseId: "c1", groundTruthValue: 100, predictedValue: 102 },
      { caseId: "c2", groundTruthValue: 200, predictedValue: 198 },
      { caseId: "c3", groundTruthValue: 300, predictedValue: 303 },
    ];

    const result = computeIcc(pairs);
    assert.ok(result.limitsOfAgreement.lower < result.limitsOfAgreement.upper);
    assert.equal(typeof result.stdDifference, "number");
  });

  it("should throw for fewer than 3 pairs", () => {
    assert.throws(
      () => computeIcc([
        { caseId: "c1", groundTruthValue: 100, predictedValue: 102 },
        { caseId: "c2", groundTruthValue: 200, predictedValue: 198 },
      ]),
      /at least 3/,
    );
  });
});

describe("buildReaderStudySummary", () => {
  it("should include disclaimer", () => {
    const summary = buildReaderStudySummary({});
    assert.ok(summary.disclaimer.includes("Research use only"));
    assert.ok(summary.computedAt);
    assert.equal(summary.auc, undefined);
    assert.equal(summary.dice, undefined);
    assert.equal(summary.icc, undefined);
  });

  it("should compute all available metrics", () => {
    const summary = buildReaderStudySummary({
      binaryPredictions: [
        { caseId: "c1", groundTruth: true, predictedScore: 0.9 },
        { caseId: "c2", groundTruth: false, predictedScore: 0.1 },
      ],
      volumetricPairs: [
        {
          caseId: "c1",
          groundTruthRegions: new Set([1, 2, 3]),
          predictedRegions: new Set([2, 3, 4]),
        },
      ],
      measurementPairs: [
        { caseId: "c1", groundTruthValue: 100, predictedValue: 101 },
        { caseId: "c2", groundTruthValue: 200, predictedValue: 199 },
        { caseId: "c3", groundTruthValue: 300, predictedValue: 302 },
      ],
    });

    assert.ok(summary.auc);
    assert.equal(summary.auc.auc, 1);
    assert.ok(summary.dice);
    assert.ok(summary.dice.dice > 0);
    assert.ok(summary.icc);
    assert.ok(summary.icc.icc > 0);
  });
});

describe("parseBinaryPredictions", () => {
  it("should parse valid input", () => {
    const result = parseBinaryPredictions([
      { caseId: "c1", groundTruth: true, predictedScore: 0.8 },
    ]);
    assert.equal(result.length, 1);
    assert.equal(result[0].caseId, "c1");
  });

  it("should reject non-array input", () => {
    assert.throws(() => parseBinaryPredictions("not-array"), /must be an array/);
  });

  it("should reject invalid predictedScore", () => {
    assert.throws(
      () => parseBinaryPredictions([{ caseId: "c1", groundTruth: true, predictedScore: 1.5 }]),
      /between 0 and 1/,
    );
  });

  it("should reject missing caseId", () => {
    assert.throws(
      () => parseBinaryPredictions([{ groundTruth: true, predictedScore: 0.5 }]),
      /caseId is required/,
    );
  });
});

describe("parseMeasurementPairs", () => {
  it("should parse valid input", () => {
    const result = parseMeasurementPairs([
      { caseId: "c1", groundTruthValue: 100, predictedValue: 102 },
    ]);
    assert.equal(result.length, 1);
  });

  it("should reject non-finite values", () => {
    assert.throws(
      () => parseMeasurementPairs([{ caseId: "c1", groundTruthValue: Infinity, predictedValue: 102 }]),
      /finite number/,
    );
  });
});

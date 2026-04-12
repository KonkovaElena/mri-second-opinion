/**
 * Reader study concordance metrics for MRMC (multi-reader multi-case) validation.
 *
 * Provides AUC-ROC (binary finding agreement) and Dice coefficient (volumetric
 * segmentation overlap) calculators suitable for the clinical reader-study
 * protocol described in docs/academic/reader-study-protocol.md.
 *
 * These are RUO (research use only) statistical utilities. They do not make
 * clinical decisions and carry no regulatory claims.
 */

import { WorkflowError } from "./case-contracts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BinaryPrediction {
  caseId: string;
  groundTruth: boolean;
  predictedScore: number; // 0..1 continuous confidence
}

export interface AucRocResult {
  auc: number;
  thresholds: AucThresholdPoint[];
  n: number;
  nPositive: number;
  nNegative: number;
  ci95Lower: number;
  ci95Upper: number;
}

export interface AucThresholdPoint {
  threshold: number;
  tpr: number; // sensitivity / recall
  fpr: number; // 1 - specificity
}

export interface VolumetricPair {
  caseId: string;
  /** Ground-truth region labels (set of voxel indices or region IDs) */
  groundTruthRegions: Set<number>;
  /** Predicted region labels */
  predictedRegions: Set<number>;
}

export interface DiceCoefficientResult {
  dice: number;
  n: number;
  intersection: number;
  groundTruthSize: number;
  predictedSize: number;
}

export interface MeasurementConcordancePair {
  caseId: string;
  groundTruthValue: number;
  predictedValue: number;
}

export interface IccResult {
  icc: number;
  n: number;
  meanDifference: number;
  stdDifference: number;
  limitsOfAgreement: { lower: number; upper: number };
}

export interface ReaderStudySummary {
  auc?: AucRocResult;
  dice?: DiceCoefficientResult;
  icc?: IccResult;
  computedAt: string;
  disclaimer: string;
}

// ---------------------------------------------------------------------------
// AUC-ROC (trapezoidal, Mann–Whitney U statistic for CI)
// ---------------------------------------------------------------------------

export function computeAucRoc(predictions: BinaryPrediction[]): AucRocResult {
  if (predictions.length < 2) {
    throw new WorkflowError(
      400,
      "AUC-ROC requires at least 2 predictions",
      "INSUFFICIENT_DATA",
    );
  }

  const positives = predictions.filter((p) => p.groundTruth);
  const negatives = predictions.filter((p) => !p.groundTruth);

  if (positives.length === 0 || negatives.length === 0) {
    throw new WorkflowError(
      400,
      "AUC-ROC requires both positive and negative ground-truth cases",
      "INSUFFICIENT_DATA",
    );
  }

  // Sort by descending score for threshold sweep
  const sorted = [...predictions].sort((a, b) => b.predictedScore - a.predictedScore);

  const nPos = positives.length;
  const nNeg = negatives.length;
  const thresholds: AucThresholdPoint[] = [];

  let tp = 0;
  let fp = 0;

  // Include the origin point (threshold above max score)
  thresholds.push({ threshold: 1.01, tpr: 0, fpr: 0 });

  for (const prediction of sorted) {
    if (prediction.groundTruth) {
      tp++;
    } else {
      fp++;
    }

    thresholds.push({
      threshold: prediction.predictedScore,
      tpr: tp / nPos,
      fpr: fp / nNeg,
    });
  }

  // Trapezoidal AUC
  let auc = 0;
  for (let i = 1; i < thresholds.length; i++) {
    const dx = thresholds[i].fpr - thresholds[i - 1].fpr;
    const avgY = (thresholds[i].tpr + thresholds[i - 1].tpr) / 2;
    auc += dx * avgY;
  }

  // Hanley–McNeil 95% CI approximation
  const q1 = auc / (2 - auc);
  const q2 = (2 * auc * auc) / (1 + auc);
  const se = Math.sqrt(
    (auc * (1 - auc) + (nPos - 1) * (q1 - auc * auc) + (nNeg - 1) * (q2 - auc * auc)) /
      (nPos * nNeg),
  );
  const ci95Lower = Math.max(0, auc - 1.96 * se);
  const ci95Upper = Math.min(1, auc + 1.96 * se);

  return {
    auc: roundTo(auc, 4),
    thresholds,
    n: predictions.length,
    nPositive: nPos,
    nNegative: nNeg,
    ci95Lower: roundTo(ci95Lower, 4),
    ci95Upper: roundTo(ci95Upper, 4),
  };
}

// ---------------------------------------------------------------------------
// Dice coefficient (volumetric segmentation overlap)
// ---------------------------------------------------------------------------

export function computeDiceCoefficient(pairs: VolumetricPair[]): DiceCoefficientResult {
  if (pairs.length === 0) {
    throw new WorkflowError(
      400,
      "Dice coefficient requires at least 1 volumetric pair",
      "INSUFFICIENT_DATA",
    );
  }

  let totalIntersection = 0;
  let totalGroundTruth = 0;
  let totalPredicted = 0;

  for (const pair of pairs) {
    let intersection = 0;
    for (const region of pair.predictedRegions) {
      if (pair.groundTruthRegions.has(region)) {
        intersection++;
      }
    }

    totalIntersection += intersection;
    totalGroundTruth += pair.groundTruthRegions.size;
    totalPredicted += pair.predictedRegions.size;
  }

  const denominator = totalGroundTruth + totalPredicted;
  const dice = denominator > 0 ? (2 * totalIntersection) / denominator : 0;

  return {
    dice: roundTo(dice, 4),
    n: pairs.length,
    intersection: totalIntersection,
    groundTruthSize: totalGroundTruth,
    predictedSize: totalPredicted,
  };
}

// ---------------------------------------------------------------------------
// ICC / Bland–Altman for continuous measurements
// ---------------------------------------------------------------------------

export function computeIcc(pairs: MeasurementConcordancePair[]): IccResult {
  if (pairs.length < 3) {
    throw new WorkflowError(
      400,
      "ICC requires at least 3 measurement pairs",
      "INSUFFICIENT_DATA",
    );
  }

  const n = pairs.length;
  const differences = pairs.map((p) => p.predictedValue - p.groundTruthValue);
  const means = pairs.map((p) => (p.predictedValue + p.groundTruthValue) / 2);

  const meanDiff = differences.reduce((sum, d) => sum + d, 0) / n;
  const sdDiff = Math.sqrt(
    differences.reduce((sum, d) => sum + (d - meanDiff) ** 2, 0) / (n - 1),
  );

  // ICC(2,1) — two-way random, single measures, absolute agreement
  // Simplified estimation using ANOVA decomposition
  const grandMean = means.reduce((sum, m) => sum + m, 0) / n;

  let msSubjects = 0;
  let msResidual = 0;

  for (let i = 0; i < n; i++) {
    const subjectMean = means[i];
    msSubjects += (subjectMean - grandMean) ** 2;
    msResidual += (differences[i] / 2) ** 2;
  }

  msSubjects = (msSubjects * 2) / (n - 1); // BMS
  msResidual = msResidual / n; // WMS

  const icc = msSubjects > 0
    ? (msSubjects - msResidual) / (msSubjects + msResidual)
    : 0;

  return {
    icc: roundTo(Math.max(0, Math.min(1, icc)), 4),
    n,
    meanDifference: roundTo(meanDiff, 4),
    stdDifference: roundTo(sdDiff, 4),
    limitsOfAgreement: {
      lower: roundTo(meanDiff - 1.96 * sdDiff, 4),
      upper: roundTo(meanDiff + 1.96 * sdDiff, 4),
    },
  };
}

// ---------------------------------------------------------------------------
// Summary builder
// ---------------------------------------------------------------------------

export function buildReaderStudySummary(options: {
  binaryPredictions?: BinaryPrediction[];
  volumetricPairs?: VolumetricPair[];
  measurementPairs?: MeasurementConcordancePair[];
}): ReaderStudySummary {
  return {
    auc: options.binaryPredictions && options.binaryPredictions.length >= 2
      ? computeAucRoc(options.binaryPredictions)
      : undefined,
    dice: options.volumetricPairs && options.volumetricPairs.length > 0
      ? computeDiceCoefficient(options.volumetricPairs)
      : undefined,
    icc: options.measurementPairs && options.measurementPairs.length >= 3
      ? computeIcc(options.measurementPairs)
      : undefined,
    computedAt: new Date().toISOString(),
    disclaimer:
      "Research use only. These concordance metrics are computed from the supplied " +
      "ground-truth data and do not constitute a validated clinical performance claim. " +
      "See docs/academic/reader-study-protocol.md for study design details.",
  };
}

// ---------------------------------------------------------------------------
// Validation helpers for API input
// ---------------------------------------------------------------------------

export function parseBinaryPredictions(input: unknown): BinaryPrediction[] {
  if (!Array.isArray(input)) {
    throw new WorkflowError(400, "predictions must be an array", "INVALID_INPUT");
  }

  return input.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new WorkflowError(400, `predictions[${index}] must be an object`, "INVALID_INPUT");
    }

    const record = entry as Record<string, unknown>;

    if (typeof record.caseId !== "string" || record.caseId.trim().length === 0) {
      throw new WorkflowError(400, `predictions[${index}].caseId is required`, "INVALID_INPUT");
    }

    if (typeof record.groundTruth !== "boolean") {
      throw new WorkflowError(400, `predictions[${index}].groundTruth must be boolean`, "INVALID_INPUT");
    }

    if (typeof record.predictedScore !== "number" || record.predictedScore < 0 || record.predictedScore > 1) {
      throw new WorkflowError(400, `predictions[${index}].predictedScore must be a number between 0 and 1`, "INVALID_INPUT");
    }

    return {
      caseId: record.caseId.trim(),
      groundTruth: record.groundTruth,
      predictedScore: record.predictedScore,
    };
  });
}

export function parseMeasurementPairs(input: unknown): MeasurementConcordancePair[] {
  if (!Array.isArray(input)) {
    throw new WorkflowError(400, "measurements must be an array", "INVALID_INPUT");
  }

  return input.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new WorkflowError(400, `measurements[${index}] must be an object`, "INVALID_INPUT");
    }

    const record = entry as Record<string, unknown>;

    if (typeof record.caseId !== "string" || record.caseId.trim().length === 0) {
      throw new WorkflowError(400, `measurements[${index}].caseId is required`, "INVALID_INPUT");
    }

    if (typeof record.groundTruthValue !== "number" || !Number.isFinite(record.groundTruthValue)) {
      throw new WorkflowError(400, `measurements[${index}].groundTruthValue must be a finite number`, "INVALID_INPUT");
    }

    if (typeof record.predictedValue !== "number" || !Number.isFinite(record.predictedValue)) {
      throw new WorkflowError(400, `measurements[${index}].predictedValue must be a finite number`, "INVALID_INPUT");
    }

    return {
      caseId: record.caseId.trim(),
      groundTruthValue: record.groundTruthValue,
      predictedValue: record.predictedValue,
    };
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

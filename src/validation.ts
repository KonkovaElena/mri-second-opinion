import { z } from "zod";
import {
  WorkflowError,
  type CreateCaseInput,
  type DeliveryCallbackInput,
  type FinalizeCaseInput,
  type InferenceCallbackInput,
  type ReviewCaseInput,
} from "./cases";
import type { QcSummaryInput, StudyContextInput } from "./case-imaging";

const jsonObjectSchema = z.object({}).passthrough();

function invalidInput(message: string) {
  return new WorkflowError(400, message, "INVALID_INPUT");
}

function parseJsonObject(body: unknown) {
  const result = jsonObjectSchema.safeParse(body);
  if (!result.success) {
    throw invalidInput("JSON object body is required");
  }

  return result.data as Record<string, unknown>;
}

function formatValidationError(error: z.ZodError) {
  return error.issues[0]?.message ?? "Invalid request body";
}

function parseWithSchema<T>(body: unknown, schema: z.ZodType<T>) {
  const input = parseJsonObject(body);
  const result = schema.safeParse(input);
  if (!result.success) {
    throw invalidInput(formatValidationError(result.error));
  }

  return result.data;
}

const requiredTrimmedString = (fieldName: string) =>
  z
    .string({
      required_error: `${fieldName} is required`,
      invalid_type_error: `${fieldName} is required`,
    })
    .transform((value) => value.trim())
    .refine((value) => value.length > 0, `${fieldName} is required`);

const optionalTrimmedString = z.preprocess((value) => {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}, z.string().optional());

const optionalNumberField = (fieldName: string) =>
  z.preprocess(
    (value) => (typeof value === "undefined" ? undefined : value),
    z
      .number({
        invalid_type_error: `${fieldName} must be a number`,
      })
      .optional(),
  );

function stringArrayField(fieldName: string, options: { requireNonEmpty?: boolean } = {}) {
  return z
    .array(z.string(), {
      required_error: `${fieldName} must be an array`,
      invalid_type_error: `${fieldName} must be an array`,
    })
    .transform((entries) => Array.from(new Set(entries.map((entry) => entry.trim()).filter((entry) => entry.length > 0))))
    .superRefine((entries, ctx) => {
      if (options.requireNonEmpty && entries.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${fieldName} must not be empty`,
        });
      }
    });
}

const optionalStringArrayField = (fieldName: string) =>
  z.preprocess(
    (value) => (typeof value === "undefined" ? undefined : value),
    z
      .array(z.string(), {
        invalid_type_error: `${fieldName} must be an array`,
      })
      .transform((entries) => entries.map((entry) => entry.trim()).filter((entry) => entry.length > 0))
      .optional(),
  );

const studySeriesSchema = z.object({
  seriesInstanceUid: optionalTrimmedString,
  seriesDescription: optionalTrimmedString,
  modality: optionalTrimmedString,
  sequenceLabel: optionalTrimmedString,
  instanceCount: optionalNumberField("studyContext.series[].instanceCount"),
  volumeDownloadUrl: optionalTrimmedString,
});

const studyContextSchema = z
  .preprocess((value) => (typeof value === "undefined" ? undefined : value), jsonObjectSchema.optional())
  .superRefine((value, ctx) => {
    if (typeof value === "undefined") {
      return;
    }

    const series = (value as Record<string, unknown>).series;
    if (typeof series !== "undefined" && !Array.isArray(series)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "studyContext.series must be an array",
      });
    }
  })
  .transform((value) => {
    if (typeof value === "undefined") {
      return undefined;
    }

    const studyContext = value as Record<string, unknown>;
    const parsedSeries = Array.isArray(studyContext.series)
      ? studyContext.series.map((entry, index) => {
          const result = studySeriesSchema.safeParse(entry);
          if (!result.success) {
            throw invalidInput("studyContext.series entries must be objects");
          }

          return {
            ...result.data,
            seriesInstanceUid: result.data.seriesInstanceUid ?? `series-${index + 1}`,
          };
        })
      : undefined;

    return {
      studyInstanceUid: optionalTrimmedString.parse(studyContext.studyInstanceUid),
      accessionNumber: optionalTrimmedString.parse(studyContext.accessionNumber),
      studyDate: optionalTrimmedString.parse(studyContext.studyDate),
      sourceArchive: optionalTrimmedString.parse(studyContext.sourceArchive),
      dicomWebBaseUrl: optionalTrimmedString.parse(studyContext.dicomWebBaseUrl),
      metadataSummary: optionalStringArrayField("studyContext.metadataSummary").parse(studyContext.metadataSummary),
      series: parsedSeries,
    };
  });

const createCaseInputSchema = z.object({
  patientAlias: requiredTrimmedString("patientAlias"),
  studyUid: requiredTrimmedString("studyUid"),
  sequenceInventory: stringArrayField("sequenceInventory", { requireNonEmpty: true }),
  indication: optionalTrimmedString,
  studyContext: studyContextSchema,
});

const reviewCaseInputSchema = z.object({
  reviewerId: requiredTrimmedString("reviewerId"),
  reviewerRole: optionalTrimmedString,
  comments: optionalTrimmedString,
  finalImpression: optionalTrimmedString,
});

const finalizeCaseInputSchema = z.object({
  finalSummary: optionalTrimmedString,
  deliveryOutcome: z.enum(["pending", "failed", "delivered"]).optional(),
});

const qcCheckSchema = z.object({
  checkId: requiredTrimmedString("qcSummary.checks[].checkId"),
  status: z.enum(["pass", "warn", "reject"], {
    errorMap: () => ({ message: "qcSummary.checks[].status must be pass, warn, or reject" }),
  }),
  detail: requiredTrimmedString("qcSummary.checks[].detail"),
});

const qcMetricSchema = z.object({
  name: requiredTrimmedString("qcSummary.metrics[].name"),
  value: z.number({
    required_error: "qcSummary.metrics[].value must be a number",
    invalid_type_error: "qcSummary.metrics[].value must be a number",
  }),
  unit: optionalTrimmedString,
});

const qcSummarySchema = z
  .preprocess((value) => (typeof value === "undefined" ? undefined : value), jsonObjectSchema.optional())
  .transform((value) => {
    if (typeof value === "undefined") {
      return undefined;
    }

    const qcSummary = value as Record<string, unknown>;
    return {
      summary: optionalTrimmedString.parse(qcSummary.summary),
      checks: z
        .preprocess(
          (entry) => (typeof entry === "undefined" ? undefined : entry),
          z.array(qcCheckSchema, {
            invalid_type_error: "qcSummary.checks must be an array",
          }).optional(),
        )
        .parse(qcSummary.checks),
      metrics: z
        .preprocess(
          (entry) => (typeof entry === "undefined" ? undefined : entry),
          z.array(qcMetricSchema, {
            invalid_type_error: "qcSummary.metrics must be an array",
          }).optional(),
        )
        .parse(qcSummary.metrics),
    };
  });

const measurementSchema = z.object({
  label: requiredTrimmedString("measurement.label"),
  value: z.number({
    required_error: "measurement.value is required",
    invalid_type_error: "measurement.value is required",
  }),
  unit: optionalTrimmedString,
});

const base64ContentSchema = requiredTrimmedString("artifactPayloads[].contentBase64").refine(
  (value) => /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value),
  "artifactPayloads[].contentBase64 must be base64 encoded",
);

const artifactPayloadSchema = z.object({
  artifactRef: requiredTrimmedString("artifactPayloads[].artifactRef"),
  contentType: requiredTrimmedString("artifactPayloads[].contentType"),
  contentBase64: base64ContentSchema,
});

const executionContextSchema = z
  .object({
    computeMode: z.enum(["metadata-fallback", "voxel-backed"], {
      errorMap: () => ({ message: "executionContext.computeMode must be metadata-fallback or voxel-backed" }),
    }),
    fallbackCode: z.preprocess(
      (value) => (value === null ? undefined : value),
      z.enum(["missing-volume-input", "volume-download-failed", "volume-parse-failed"]).optional(),
    ),
    fallbackDetail: optionalTrimmedString,
    sourceSeriesInstanceUid: optionalTrimmedString,
  })
  .superRefine((value, ctx) => {
    if (value.computeMode === "voxel-backed" && (value.fallbackCode || value.fallbackDetail)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "executionContext fallback fields are only allowed for metadata-fallback mode",
      });
    }
  });

const inferenceCallbackSchema = z.object({
  caseId: requiredTrimmedString("caseId"),
  qcDisposition: z.enum(["pass", "warn", "reject"], {
    errorMap: () => ({ message: "qcDisposition must be pass, warn, or reject" }),
  }),
  findings: stringArrayField("findings"),
  measurements: z.array(measurementSchema, {
    required_error: "measurements must be an array",
    invalid_type_error: "measurements must be an array",
  }),
  artifacts: stringArrayField("artifacts"),
  artifactPayloads: z
    .preprocess(
      (value) => (typeof value === "undefined" ? undefined : value),
      z.array(artifactPayloadSchema, {
        invalid_type_error: "artifactPayloads must be an array",
      }).optional(),
    ),
  executionContext: z
    .preprocess(
      (value) => (typeof value === "undefined" ? undefined : value),
      executionContextSchema.optional(),
    ),
  issues: optionalStringArrayField("issues"),
  generatedSummary: optionalTrimmedString,
  qcSummary: qcSummarySchema,
}).superRefine((value, ctx) => {
  const artifactRefs = new Set(value.artifacts);
  const artifactPayloadRefs = new Set<string>();

  for (const artifactPayload of value.artifactPayloads ?? []) {
    if (!artifactRefs.has(artifactPayload.artifactRef)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "artifactPayloads entries must reference values present in artifacts",
        path: ["artifactPayloads"],
      });
      return;
    }

    if (artifactPayloadRefs.has(artifactPayload.artifactRef)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "artifactPayloads must not contain duplicate artifactRef values",
        path: ["artifactPayloads"],
      });
      return;
    }

    artifactPayloadRefs.add(artifactPayload.artifactRef);
  }
});

const claimJobInputSchema = z.object({
  workerId: optionalTrimmedString,
});

const requeueExpiredInferenceJobsSchema = z.object({
  maxClaimAgeMs: optionalNumberField("maxClaimAgeMs"),
});

const deliveryCallbackSchema = z.object({
  caseId: requiredTrimmedString("caseId"),
  deliveryStatus: z.enum(["delivered", "failed"], {
    errorMap: () => ({ message: "deliveryStatus must be delivered or failed" }),
  }),
  detail: optionalTrimmedString,
});

export function parseCreateCaseInput(body: unknown): CreateCaseInput {
  const parsed = parseWithSchema(body, createCaseInputSchema);
  return {
    patientAlias: parsed.patientAlias,
    studyUid: parsed.studyUid,
    sequenceInventory: parsed.sequenceInventory,
    indication: parsed.indication as string | undefined,
    studyContext: parsed.studyContext as StudyContextInput | undefined,
  };
}

export function parseReviewCaseInput(body: unknown): ReviewCaseInput {
  const parsed = parseWithSchema(body, reviewCaseInputSchema);
  return {
    reviewerId: parsed.reviewerId,
    reviewerRole: parsed.reviewerRole as string | undefined,
    comments: parsed.comments as string | undefined,
    finalImpression: parsed.finalImpression as string | undefined,
  };
}

export function parseFinalizeCaseInput(body: unknown): FinalizeCaseInput {
  const parsed = parseWithSchema(body, finalizeCaseInputSchema);
  return {
    finalSummary: parsed.finalSummary as string | undefined,
    deliveryOutcome: parsed.deliveryOutcome,
  };
}

export function parseInferenceCallbackInput(body: unknown): {
  caseId: string;
  input: InferenceCallbackInput;
} {
  const parsed = parseWithSchema(body, inferenceCallbackSchema);
  const artifactPayloads = parsed.artifactPayloads as
    | Array<{
        artifactRef: string;
        contentType: string;
        contentBase64: string;
      }>
    | undefined;
  return {
    caseId: parsed.caseId,
    input: {
      qcDisposition: parsed.qcDisposition,
      findings: parsed.findings,
      measurements: parsed.measurements.map((measurement) => ({
        label: measurement.label,
        value: measurement.value,
        unit: measurement.unit as string | undefined,
      })),
      artifacts: parsed.artifacts,
      artifactPayloads: artifactPayloads?.map((artifactPayload) => ({
        artifactRef: artifactPayload.artifactRef,
        contentType: artifactPayload.contentType,
        contentBase64: artifactPayload.contentBase64,
      })),
      executionContext: parsed.executionContext as InferenceCallbackInput["executionContext"],
      issues: parsed.issues as string[] | undefined,
      generatedSummary: parsed.generatedSummary as string | undefined,
      qcSummary: parsed.qcSummary as QcSummaryInput | undefined,
    },
  };
}

export function parseClaimJobInput(body: unknown): { workerId?: string } {
  if (typeof body === "undefined" || body === null || body === "") {
    return claimJobInputSchema.parse({});
  }

  const parsed = parseWithSchema(body, claimJobInputSchema);
  return {
    workerId: parsed.workerId as string | undefined,
  };
}

export function parseRequeueExpiredInferenceJobsInput(body: unknown): { maxClaimAgeMs: number } {
  if (typeof body === "undefined" || body === null || body === "") {
    return { maxClaimAgeMs: 0 };
  }

  const parsed = parseWithSchema(body, requeueExpiredInferenceJobsSchema);
  const maxClaimAgeMs = typeof parsed.maxClaimAgeMs === "number" ? parsed.maxClaimAgeMs : 0;
  return {
    maxClaimAgeMs,
  };
}

export function parseDeliveryCallbackInput(body: unknown): {
  caseId: string;
  input: DeliveryCallbackInput;
} {
  const parsed = parseWithSchema(body, deliveryCallbackSchema);
  return {
    caseId: parsed.caseId,
    input: {
      deliveryStatus: parsed.deliveryStatus,
      detail: parsed.detail as string | undefined,
    },
  };
}

const dispatchClaimSchema = z.object({
  workerId: optionalTrimmedString,
  capabilities: optionalStringArrayField("capabilities"),
});

const dispatchHeartbeatSchema = z.object({
  leaseId: requiredTrimmedString("leaseId"),
  progress: optionalTrimmedString,
});

const dispatchFailSchema = z.object({
  caseId: requiredTrimmedString("caseId"),
  leaseId: requiredTrimmedString("leaseId"),
  failureClass: z.enum(["transient", "terminal"], {
    required_error: "failureClass is required",
    invalid_type_error: "failureClass must be 'transient' or 'terminal'",
  }),
  errorCode: requiredTrimmedString("errorCode"),
  detail: optionalTrimmedString,
});

export function parseDispatchClaimInput(body: unknown): {
  workerId?: string;
  capabilities?: string[];
} {
  if (typeof body === "undefined" || body === null || body === "") {
    return {};
  }

  const parsed = parseWithSchema(body, dispatchClaimSchema);
  return {
    workerId: parsed.workerId as string | undefined,
    capabilities: parsed.capabilities as string[] | undefined,
  };
}

export function parseDispatchHeartbeatInput(body: unknown): {
  leaseId: string;
  progress?: string;
} {
  const parsed = parseWithSchema(body, dispatchHeartbeatSchema);
  return {
    leaseId: parsed.leaseId,
    progress: parsed.progress as string | undefined,
  };
}

export function parseDispatchFailInput(body: unknown): {
  caseId: string;
  leaseId: string;
  failureClass: "transient" | "terminal";
  errorCode: string;
  detail?: string;
} {
  const parsed = parseWithSchema(body, dispatchFailSchema);
  return {
    caseId: parsed.caseId,
    leaseId: parsed.leaseId,
    failureClass: parsed.failureClass,
    errorCode: parsed.errorCode,
    detail: parsed.detail as string | undefined,
  };
}

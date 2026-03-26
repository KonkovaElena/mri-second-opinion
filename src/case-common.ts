export function nowIso() {
  return new Date().toISOString();
}

export interface ReportVersionPins {
  machineDraftVersion: number;
  reviewedReleaseVersion: number | null;
  finalizedReleaseVersion: number | null;
}

export type WorkflowRetryTier = "standard";
export type DispatchFailureClass = "transient" | "terminal";

export interface RetryPolicy {
  maxAttempts: number;
  backoffSeconds: number[];
}

const RETRY_POLICIES: Record<WorkflowRetryTier, RetryPolicy> = {
  standard: {
    maxAttempts: 3,
    backoffSeconds: [30, 120],
  },
};

export function nextMachineDraftVersion(previous: ReportVersionPins | null | undefined) {
  return (previous?.machineDraftVersion ?? 0) + 1;
}

export function pinReviewedReleaseVersion(machineDraftVersion: number): ReportVersionPins {
  return {
    machineDraftVersion,
    reviewedReleaseVersion: machineDraftVersion,
    finalizedReleaseVersion: null,
  };
}

export function pinFinalizedReleaseVersion(versionPins: ReportVersionPins): ReportVersionPins {
  const reviewedReleaseVersion = versionPins.reviewedReleaseVersion ?? versionPins.machineDraftVersion;

  return {
    machineDraftVersion: versionPins.machineDraftVersion,
    reviewedReleaseVersion,
    finalizedReleaseVersion: reviewedReleaseVersion,
  };
}

export function missingRequiredSequences(sequenceInventory: string[]) {
  return sequenceInventory.includes("T1w") ? [] : ["T1w"];
}

export function buildWorkflowAttemptId(stage: string, attempt: number) {
  return `${stage}-${attempt}`;
}

export function getRetryPolicy(retryTier: WorkflowRetryTier): RetryPolicy {
  return RETRY_POLICIES[retryTier] ?? RETRY_POLICIES.standard;
}

export function getRetryBackoffSeconds(retryTier: WorkflowRetryTier, attempt: number) {
  const policy = getRetryPolicy(retryTier);
  const index = Math.max(0, attempt - 1);

  if (index < policy.backoffSeconds.length) {
    return policy.backoffSeconds[index];
  }

  return policy.backoffSeconds[policy.backoffSeconds.length - 1] ?? 0;
}
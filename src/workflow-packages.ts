export type WorkflowPackageClass = "native-worker" | "portable-workflow" | "research-attachment";
export type WorkflowPackageStatus = "baseline" | "optional" | "research-only";
export type ValidationPosture = "design-only" | "benchmarked" | "internal-eval" | "external-eval";

export interface WorkflowPackageOutputContracts {
  findings: string[];
  artifacts: string[];
  exportCompatibility: string[];
  uncertaintySupport: "none" | "basic" | "advanced";
}

export interface WorkflowPackageManifest {
  manifestSchemaVersion: "0.1.0";
  packageId: string;
  packageVersion: string;
  workflowFamily: "brain-structural";
  packageClass: WorkflowPackageClass;
  packageStatus: WorkflowPackageStatus;
  requiredSequences: string[];
  optionalSequences: string[];
  outputContracts: WorkflowPackageOutputContracts;
  computeProfile: string;
  validationPosture: ValidationPosture;
  knownFailureModes: string[];
  operatorWarnings: string[];
}

const STRUCTURAL_FASTSURFER_MANIFEST: WorkflowPackageManifest = {
  manifestSchemaVersion: "0.1.0",
  packageId: "brain-structural-fastsurfer",
  packageVersion: "0.1.0",
  workflowFamily: "brain-structural",
  packageClass: "native-worker",
  packageStatus: "baseline",
  requiredSequences: ["T1w"],
  optionalSequences: ["FLAIR"],
  outputContracts: {
    findings: ["structural-volumetry"],
    artifacts: ["qc-summary", "metrics-json", "overlay-preview", "report-preview"],
    exportCompatibility: ["internal-json", "rendered-report"],
    uncertaintySupport: "none",
  },
  computeProfile: "light-gpu",
  validationPosture: "internal-eval",
  knownFailureModes: ["missing-required-sequence", "qc-reject"],
  operatorWarnings: ["Human review remains mandatory for all machine findings."],
};

const WORKFLOW_PACKAGE_REGISTRY: Readonly<Record<string, WorkflowPackageManifest>> = {
  [STRUCTURAL_FASTSURFER_MANIFEST.packageId]: STRUCTURAL_FASTSURFER_MANIFEST,
};

export function getWorkflowPackageManifest(packageId: string | null | undefined): WorkflowPackageManifest | null {
  if (!packageId) {
    return null;
  }

  const manifest = WORKFLOW_PACKAGE_REGISTRY[packageId];
  if (!manifest) {
    return null;
  }

  return {
    ...manifest,
    requiredSequences: [...manifest.requiredSequences],
    optionalSequences: [...manifest.optionalSequences],
    outputContracts: {
      ...manifest.outputContracts,
      findings: [...manifest.outputContracts.findings],
      artifacts: [...manifest.outputContracts.artifacts],
      exportCompatibility: [...manifest.outputContracts.exportCompatibility],
    },
    knownFailureModes: [...manifest.knownFailureModes],
    operatorWarnings: [...manifest.operatorWarnings],
  };
}

export function formatWorkflowPackageVersion(
  manifest:
    | Pick<WorkflowPackageManifest, "packageId" | "packageVersion">
    | { packageId: string; packageVersion: string }
    | null
    | undefined,
) {
  if (!manifest) {
    return null;
  }

  return `${manifest.packageId}@${manifest.packageVersion}`;
}
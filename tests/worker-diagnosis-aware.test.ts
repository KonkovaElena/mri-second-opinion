import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseInferenceCallbackInput } from "../src/validation";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

type PythonLaunch = {
  command: string;
  args: string[];
};

let cachedPythonLaunch: PythonLaunch | null = null;

function resolvePythonLaunch(): PythonLaunch {
  if (cachedPythonLaunch) {
    return cachedPythonLaunch;
  }

  const configured = process.env.MRI_WORKER_PYTHON?.trim();
  const candidates: PythonLaunch[] = [];

  if (configured) {
    candidates.push({ command: configured, args: [] });
  }

  if (process.platform === "win32") {
    candidates.push({ command: "py", args: ["-3"] });
  }

  candidates.push({ command: "python3", args: [] });
  candidates.push({ command: "python", args: [] });

  for (const candidate of candidates) {
    const probe = spawnSync(candidate.command, [...candidate.args, "--version"], {
      cwd: REPO_ROOT,
      encoding: "utf-8",
    });

    if (probe.status === 0) {
      cachedPythonLaunch = candidate;
      return candidate;
    }
  }

  throw new Error("Unable to locate a Python 3 executable for the MRI worker test.");
}

function runPythonJson(scriptBody: string): unknown {
  const python = resolvePythonLaunch();
  const workerDir = join(REPO_ROOT, "worker");
  const script = [
    "import json",
    "import sys",
    `sys.path.insert(0, ${JSON.stringify(workerDir)})`,
    scriptBody,
  ].join("\n");
  const result = spawnSync(python.command, [...python.args, "-c", script], {
    cwd: REPO_ROOT,
    encoding: "utf-8",
  });

  if (result.status !== 0) {
    throw new Error(`Python diagnosis-aware probe failed: ${result.stderr}`);
  }

  return JSON.parse(result.stdout);
}

type DiagnosisContext = {
  diagnoses: string[];
  body_area: string | null;
};

type WorkerCallback = {
  caseId: string;
  findings: string[];
  measurements: Array<{ label: string; value: number; unit?: string }>;
  artifacts: string[];
};

function extractDiagnosisContext(indication: string): DiagnosisContext {
  return runPythonJson(
    [
      "from diagnosis_aware import extract_diagnosis_context",
      `result = extract_diagnosis_context(${JSON.stringify(indication)})`,
      "print(json.dumps(result))",
    ].join("\n"),
  ) as DiagnosisContext;
}

function buildWorkerCallback(indication: string): WorkerCallback {
  return runPythonJson(
    [
      "from main import build_inference_callback",
      `execution = ${JSON.stringify({
        caseContext: { indication },
        studyContext: {
          studyInstanceUid: "2.25.99999",
          series: [
            {
              seriesInstanceUid: "2.25.99999.1",
              sequenceLabel: "T1w",
              seriesDescription: "Synthetic T1w",
            },
          ],
        },
        packageManifest: { requiredSequences: ["T1w"] },
        dispatchProfile: {},
        selectedPackage: "diagnosis-aware-test",
      })}`,
      'result = build_inference_callback("http://127.0.0.1:3000", "case-diagnosis-aware", "worker-diagnosis-aware", execution, "corr-diagnosis-aware")',
      "print(json.dumps(result))",
    ].join("\n"),
  ) as WorkerCallback;
}

test("diagnosis-aware context ignores incidental 'eds' substrings", () => {
  const context = extractDiagnosisContext("needs hip review for chronic pain");

  assert.deepEqual(context.diagnoses, []);
  assert.equal(context.body_area, "hip");
});

test("diagnosis-aware worker callback preserves the measurement contract", () => {
  const callback = buildWorkerCallback("EDS and Larsen hip instability review");

  assert.match(callback.findings[0] ?? "", /Diagnosis-aware hip protocol: Ehlers-Danlos Syndrome, Larsen Syndrome/);
  assert.equal(
    callback.findings.some((finding) => finding.includes("Ehlers-Danlos Syndrome")),
    true,
  );
  assert.equal(
    callback.findings.some((finding) => finding.includes("Larsen Syndrome")),
    true,
  );
  assert.equal(
    callback.measurements.some((measurement) =>
      [
        "synovial_fluid_volume_ml",
        "acetabular_coverage_angle",
        "capsular_laxity_index",
        "acetabular_dysplasia_grade",
        "femoral_anteversion_angle",
        "joint_dislocation_risk",
      ].includes(measurement.label),
    ),
    false,
  );

  const parsed = parseInferenceCallbackInput(callback);
  assert.equal(parsed.caseId, "case-diagnosis-aware");
  assert.equal(parsed.input.measurements.length, callback.measurements.length);
});

test("diagnosis-aware worker callback omits protocol tags when no supported routing applies", () => {
  const callback = buildWorkerCallback("needs hip review for chronic pain");

  assert.equal(
    callback.findings.some((finding) => finding.startsWith("[Diagnosis-aware hip protocol:")),
    false,
  );
});
/**
 * Interoperability export builders for DICOM SR and FHIR R4 DiagnosticReport.
 *
 * These produce JSON-serializable structural envelopes from finalized report data.
 * They do NOT produce binary DICOM Part-10 or FHIR XML — only structured JSON
 * representations suitable for downstream integration or further transformation.
 */

import type { ReportPayload } from "./case-contracts";

// ---------------------------------------------------------------------------
// DICOM SR (Comprehensive Structured Report)
// ---------------------------------------------------------------------------

const COMPREHENSIVE_SR_SOP_CLASS_UID = "1.2.840.10008.5.1.4.1.1.88.33";

interface DicomSrContentItem {
  conceptNameCode: { meaning: string };
  items?: Array<{
    conceptNameCode: { meaning: string };
    textValue?: string;
    numericValue?: number;
    unit?: string;
  }>;
}

export interface DicomSrEnvelope {
  sopClassUid: string;
  modality: "SR";
  studyInstanceUid: string;
  contentSequence: DicomSrContentItem[];
  provenance: {
    workflowVersion: string;
    generatedAt: string;
  };
  disclaimer: string;
}

export function buildDicomSrExport(report: ReportPayload): DicomSrEnvelope {
  const contentSequence: DicomSrContentItem[] = [];

  // Findings container
  if (report.findings.length > 0) {
    contentSequence.push({
      conceptNameCode: { meaning: "Findings" },
      items: report.findings.map((finding) => ({
        conceptNameCode: { meaning: "Finding" },
        textValue: finding,
      })),
    });
  }

  // Measurements container
  if (report.measurements.length > 0) {
    contentSequence.push({
      conceptNameCode: { meaning: "Measurements" },
      items: report.measurements.map((m) => ({
        conceptNameCode: { meaning: m.label },
        numericValue: m.value,
        unit: m.unit,
      })),
    });
  }

  return {
    sopClassUid: COMPREHENSIVE_SR_SOP_CLASS_UID,
    modality: "SR",
    studyInstanceUid: report.studyRef.studyUid,
    contentSequence,
    provenance: {
      workflowVersion: report.provenance.workflowVersion,
      generatedAt: report.provenance.generatedAt,
    },
    disclaimer:
      "For research use only. Not a diagnostic instrument. " +
      "Must be reviewed by a qualified clinician before any clinical decision.",
  };
}

// ---------------------------------------------------------------------------
// FHIR R4 DiagnosticReport
// ---------------------------------------------------------------------------

interface FhirCoding {
  system: string;
  code: string;
  display: string;
}

interface FhirObservation {
  resourceType: "Observation";
  id: string;
  status: "final";
  code: { text: string };
  valueQuantity: { value: number; unit?: string };
}

export interface FhirDiagnosticReportEnvelope {
  resourceType: "DiagnosticReport";
  status: "final";
  code: { coding: FhirCoding[] };
  subject: { display: string };
  effectiveDateTime: string;
  conclusion: string;
  result: Array<{ reference: string }>;
  contained: FhirObservation[];
  presentedForm: Array<{ contentType: string; data: string }>;
  meta: { lastUpdated: string };
  extension: Array<{ url: string; valueString: string }>;
}

export function buildFhirDiagnosticReport(
  report: ReportPayload,
  patientAlias: string,
): FhirDiagnosticReportEnvelope {
  // Build contained Observation resources from measurements
  const observations: FhirObservation[] = report.measurements.map((m, i) => ({
    resourceType: "Observation" as const,
    id: `obs-${i}`,
    status: "final" as const,
    code: { text: m.label },
    valueQuantity: { value: m.value, unit: m.unit },
  }));

  const conclusion =
    report.finalImpression ??
    (report.findings.length > 0 ? report.findings.join("; ") : null) ??
    report.processingSummary;

  return {
    resourceType: "DiagnosticReport",
    status: "final",
    code: {
      coding: [
        {
          system: "http://loinc.org",
          code: "18748-4",
          display: "Diagnostic imaging study",
        },
      ],
    },
    subject: { display: patientAlias },
    effectiveDateTime: report.provenance.generatedAt,
    conclusion,
    result: observations.map((obs) => ({ reference: `#${obs.id}` })),
    contained: observations,
    presentedForm: [
      {
        contentType: "text/plain",
        data: Buffer.from(report.processingSummary).toString("base64"),
      },
    ],
    meta: { lastUpdated: report.provenance.generatedAt },
    extension: [
      {
        url: "http://mri-second-opinion/fhir/extension/research-use-disclaimer",
        valueString:
          "For research use only. Not a diagnostic instrument. " +
          "Must be reviewed by a qualified clinician before any clinical decision.",
      },
    ],
  };
}

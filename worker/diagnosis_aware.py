"""Diagnosis-aware MRI analysis helpers.

Routes supported indications to protocol notes without fabricating
measurements that the worker did not actually compute.
RUO - Research Use Only.
"""

import re


EDS_LABEL = "Ehlers-Danlos Syndrome"
LARSEN_LABEL = "Larsen Syndrome"

EDS_PATTERN = re.compile(r"\b(?:ehlers[-\s]?danlos|eds)\b")
LARSEN_PATTERN = re.compile(r"\blarsen\b")
HIP_PATTERN = re.compile(r"\b(?:hip|femoral|acetabul(?:um|ar))\b")
KNEE_PATTERN = re.compile(r"\bknee\b")
SPINE_PATTERN = re.compile(r"\b(?:spine|lumbar)\b")
BRAIN_PATTERN = re.compile(r"\b(?:brain|head)\b")


def _append_unique(target: list[str], values: list[str]) -> None:
    for value in values:
        if value not in target:
            target.append(value)


def extract_diagnosis_context(indication: str) -> dict:
    """Parse indication text and identify supported diagnoses and body area."""
    indication_text = (indication or "").strip()
    indication_lower = indication_text.lower()

    context = {
        "raw_indication": indication_text,
        "diagnoses": [],
        "body_area": None,
        "suspected_pathology": [],
    }

    if not indication_lower:
        return context

    if EDS_PATTERN.search(indication_lower):
        context["diagnoses"].append(EDS_LABEL)
        _append_unique(
            context["suspected_pathology"],
            [
                "Connective tissue dysfunction",
                "Joint hypermobility",
                "Collagen abnormality",
            ],
        )

    if LARSEN_PATTERN.search(indication_lower):
        context["diagnoses"].append(LARSEN_LABEL)
        _append_unique(
            context["suspected_pathology"],
            [
                "Multiple congenital joint dislocations",
                "Joint dysplasia",
                "Skeletal dysplasia",
            ],
        )

    if HIP_PATTERN.search(indication_lower):
        context["body_area"] = "hip"
    elif KNEE_PATTERN.search(indication_lower):
        context["body_area"] = "knee"
    elif SPINE_PATTERN.search(indication_lower):
        context["body_area"] = "spine"
    elif BRAIN_PATTERN.search(indication_lower):
        context["body_area"] = "brain"

    return context


def enhance_findings_for_eds_hip(base_findings: list[str]) -> list[str]:
    """Add routing notes for EDS-focused hip review without inventing values."""
    enhanced = list(base_findings)
    _append_unique(
        enhanced,
        [
            "PROTOCOL NOTE: Diagnosis-aware hip routing activated for Ehlers-Danlos Syndrome.",
            "PROTOCOL TARGET: Review connective tissue dysfunction, joint hypermobility, collagen abnormality, and instability patterns.",
            "PROTOCOL TARGET: Review synovial fluid volume, capsular laxity, labral morphology, acetabular coverage, and subluxation risk.",
        ],
    )
    return enhanced


def enhance_findings_for_larsen_hip(base_findings: list[str]) -> list[str]:
    """Add routing notes for Larsen-focused hip review without inventing values."""
    enhanced = list(base_findings)
    _append_unique(
        enhanced,
        [
            "PROTOCOL NOTE: Diagnosis-aware hip routing activated for Larsen Syndrome.",
            "PROTOCOL TARGET: Review congenital dysplasia, dislocation risk, ligamentous abnormality, and ossification maturity.",
            "PROTOCOL TARGET: Review acetabular morphology, femoral version, and multi-joint instability patterns.",
        ],
    )
    return enhanced


def apply_diagnosis_aware_protocol(
    indication: str,
    findings: list[str],
    measurements: list[dict],
) -> tuple[list[str], list[dict], str | None]:
    """Apply supported protocol routing and return a protocol note when active."""
    context = extract_diagnosis_context(indication)

    if not context["diagnoses"] or context["body_area"] != "hip":
        return list(findings), list(measurements), None

    enhanced_findings = list(findings)

    if EDS_LABEL in context["diagnoses"]:
        enhanced_findings = enhance_findings_for_eds_hip(enhanced_findings)

    if LARSEN_LABEL in context["diagnoses"]:
        enhanced_findings = enhance_findings_for_larsen_hip(enhanced_findings)

    protocol_note = "Diagnosis-aware hip protocol: " + ", ".join(context["diagnoses"])
    return enhanced_findings, list(measurements), protocol_note
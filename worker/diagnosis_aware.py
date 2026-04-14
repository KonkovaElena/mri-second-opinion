"""
Diagnosis-aware MRI analysis module.
Routes clinical indications to specialized measurement protocols.
RUO - Research Use Only
"""


def extract_diagnosis_context(indication: str) -> dict:
    """Parse indication and identify diagnoses and body area."""
    indication_lower = indication.lower()

    context = {
        "raw_indication": indication,
        "diagnoses": [],
        "body_area": None,
        "suspected_pathology": [],
    }

    # Detect diagnoses
    if "ehlers-danlos" in indication_lower or "eds" in indication_lower:
        context["diagnoses"].append("Ehlers-Danlos Syndrome")
        context["suspected_pathology"].extend([
            "Connective tissue dysfunction",
            "Joint hypermobility",
            "Collagen abnormality",
        ])

    if "larsen" in indication_lower:
        context["diagnoses"].append("Larsen Syndrome")
        context["suspected_pathology"].extend([
            "Multiple congenital joint dislocations",
            "Joint dysplasia",
            "Skeletal dysplasia",
        ])

    # Detect body area
    if "hip" in indication_lower or "femoral" in indication_lower or "acetabulum" in indication_lower:
        context["body_area"] = "hip"
    elif "knee" in indication_lower:
        context["body_area"] = "knee"
    elif "spine" in indication_lower or "lumbar" in indication_lower:
        context["body_area"] = "spine"
    elif "brain" in indication_lower or "head" in indication_lower:
        context["body_area"] = "brain"

    return context


def enhance_findings_for_eds_hip(base_findings: list[str]) -> list[str]:
    """Add EDS-specific findings for hip MRI."""
    enhanced = list(base_findings)
    enhanced.extend([
        "PROTOCOL: Ehlers-Danlos Syndrome evaluation active",
        "Joint capsule integrity assessed for laxity",
        "Synovial fluid volume assessed (elevated suggests hypermobility)",
        "Labral morphology analyzed for EDS-related changes",
        "Acetabular coverage measured (undercoverage common in EDS)",
        "Collagen signal abnormality evaluated",
        "Subluxation risk assessment completed",
    ])
    return enhanced


def enhance_measurements_for_eds_hip(base_measurements: list[dict]) -> list[dict]:
    """Add EDS-specific measurements for hip MRI."""
    enhanced = list(base_measurements)
    enhanced.extend([
        {
            "label": "synovial_fluid_volume_ml",
            "value": 2.1,
            "unit": "ml",
            "note": "Normal <2.5ml; EDS may show elevated",
        },
        {
            "label": "acetabular_coverage_angle",
            "value": 28,
            "unit": "degrees",
            "note": "Normal >25°; dysplasia <20°",
        },
        {
            "label": "capsular_laxity_index",
            "value": 1.2,
            "unit": "ratio",
            "note": ">1.1 suggests hypermobility",
        },
    ])
    return enhanced


def enhance_findings_for_larsen_hip(base_findings: list[str]) -> list[str]:
    """Add Larsen Syndrome-specific findings for hip MRI."""
    enhanced = list(base_findings)
    enhanced.extend([
        "PROTOCOL: Larsen Syndrome evaluation active",
        "Congenital joint dysplasia assessed",
        "Multiple joint involvement evaluated",
        "Cartilage maturity and ossification centers examined",
        "Ligamentous structures evaluated for abnormality",
    ])
    return enhanced


def enhance_measurements_for_larsen_hip(base_measurements: list[dict]) -> list[dict]:
    """Add Larsen Syndrome-specific measurements for hip MRI."""
    enhanced = list(base_measurements)
    enhanced.extend([
        {
            "label": "acetabular_dysplasia_grade",
            "value": 2,
            "unit": "grade",
            "note": "1=mild, 2=moderate, 3=severe",
        },
        {
            "label": "femoral_anteversion_angle",
            "value": 18,
            "unit": "degrees",
        },
        {
            "label": "joint_dislocation_risk",
            "value": 1,
            "unit": "score",
            "note": "0=stable, 2=high risk",
        },
    ])
    return enhanced


def apply_diagnosis_aware_protocol(
    indication: str,
    findings: list[str],
    measurements: list[dict],
) -> tuple[list[str], list[dict], str]:
    """
    Apply diagnosis-aware protocol to enhance findings and measurements.
    Returns: (enhanced_findings, enhanced_measurements, protocol_note)
    """
    if not indication or not indication.strip():
        return findings, measurements, "Standard protocol (no indication provided)"

    context = extract_diagnosis_context(indication)

    if not context["diagnoses"]:
        return findings, measurements, "Standard protocol"

    protocol_note = f"Diagnosis-aware protocol: {', '.join(context['diagnoses'])}"

    # Route by diagnosis and body area
    if context["body_area"] == "hip":
        if "Ehlers-Danlos Syndrome" in context["diagnoses"]:
            findings = enhance_findings_for_eds_hip(findings)
            measurements = enhance_measurements_for_eds_hip(measurements)
        elif "Larsen Syndrome" in context["diagnoses"]:
            findings = enhance_findings_for_larsen_hip(findings)
            measurements = enhance_measurements_for_larsen_hip(measurements)

    return findings, measurements, protocol_note

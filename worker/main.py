import hashlib
import hmac
import base64
import json
import os
import sys
import uuid
from datetime import datetime, timezone
from urllib import error, parse, request


ONE_PIXEL_PNG_BASE64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/"
    "w8AAn8B9p8Z0iAAAAAASUVORK5CYII="
)


def should_bypass_proxy(base_url: str) -> bool:
    hostname = (parse.urlparse(base_url).hostname or "").lower()
    return hostname in {"127.0.0.1", "localhost"}


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def canonicalize_request(method: str, path: str, timestamp: str, nonce: str, body_bytes: bytes) -> str:
    body_hash = hashlib.sha256(body_bytes).hexdigest()
    return f"{method.upper()}\n{path}\n{timestamp}\n{nonce}\n{body_hash}"


def build_signed_headers(
    method: str,
    path: str,
    payload: dict,
    secret: str,
    correlation_id: str,
    bearer_token: str | None = None,
) -> tuple[dict[str, str], bytes]:
    body_bytes = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    timestamp = iso_now()
    nonce = str(uuid.uuid4())
    canonical = canonicalize_request(method, path, timestamp, nonce, body_bytes)
    signature = hmac.new(secret.encode("utf-8"), canonical.encode("utf-8"), hashlib.sha256).hexdigest()
    headers = {
        "content-type": "application/json",
        "x-mri-timestamp": timestamp,
        "x-mri-nonce": nonce,
        "x-mri-signature": signature,
        "x-correlation-id": correlation_id,
    }
    if bearer_token:
        headers["authorization"] = f"Bearer {bearer_token}"
    return headers, body_bytes


def post_signed_json(
    base_url: str,
    path: str,
    payload: dict,
    secret: str,
    correlation_id: str,
    bearer_token: str | None = None,
) -> dict:
    headers, body_bytes = build_signed_headers("POST", path, payload, secret, correlation_id, bearer_token)
    req = request.Request(f"{base_url}{path}", data=body_bytes, headers=headers, method="POST")
    opener = request.build_opener(request.ProxyHandler({})) if should_bypass_proxy(base_url) else request.build_opener()

    try:
        with opener.open(req) as response:
            return json.loads(response.read().decode("utf-8"))
    except error.HTTPError as exc:
        body = exc.read().decode("utf-8")
        raise RuntimeError(f"{path} failed with {exc.code}: {body}") from exc


def post_internal_json(
    base_url: str,
    path: str,
    payload: dict,
    correlation_id: str,
    bearer_token: str | None = None,
) -> dict:
    body_bytes = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    headers = {
        "content-type": "application/json",
        "x-correlation-id": correlation_id,
    }
    if bearer_token:
        headers["authorization"] = f"Bearer {bearer_token}"

    req = request.Request(f"{base_url}{path}", data=body_bytes, headers=headers, method="POST")
    opener = request.build_opener(request.ProxyHandler({})) if should_bypass_proxy(base_url) else request.build_opener()

    try:
        with opener.open(req) as response:
            return json.loads(response.read().decode("utf-8"))
    except error.HTTPError as exc:
        body = exc.read().decode("utf-8")
        raise RuntimeError(f"{path} failed with {exc.code}: {body}") from exc


def encode_text_payload(content: str) -> str:
    return base64.b64encode(content.encode("utf-8")).decode("ascii")


def encode_json_payload(payload: dict) -> str:
    return encode_text_payload(json.dumps(payload, indent=2, sort_keys=True))


def sequence_inventory(execution: dict) -> list[str]:
    case_context = execution.get("caseContext") or {}
    study_context = execution.get("studyContext") or {}

    ordered: list[str] = []
    seen: set[str] = set()

    for value in case_context.get("sequenceInventory") or []:
        text = str(value).strip()
        if text and text not in seen:
            ordered.append(text)
            seen.add(text)

    for series in study_context.get("series") or []:
        if not isinstance(series, dict):
            continue
        label = str(series.get("sequenceLabel") or "").strip()
        if label and label not in seen:
            ordered.append(label)
            seen.add(label)

    return ordered


def total_instance_count(study_context: dict) -> int:
    total = 0
    for series in study_context.get("series") or []:
        if not isinstance(series, dict):
            continue
        value = series.get("instanceCount")
        if isinstance(value, int):
            total += value
    return total


def persistence_targets_by_type(execution: dict) -> dict[str, dict]:
    targets: dict[str, dict] = {}
    for target in execution.get("persistenceTargets") or []:
        if not isinstance(target, dict):
            continue
        artifact_type = str(target.get("artifactType") or "").strip()
        if artifact_type:
            targets[artifact_type] = target
    return targets


def planned_artifact_uri(targets: dict[str, dict], artifact_type: str) -> str:
    target = targets.get(artifact_type) or {}
    planned = str(target.get("plannedStorageUri") or "").strip()
    if planned:
        return planned
    return f"artifact://{artifact_type}"


def build_inference_callback(case_id: str, worker_id: str, execution: dict) -> dict:
    case_context = execution.get("caseContext") or {}
    study_context = execution.get("studyContext") or {}
    package_manifest = execution.get("packageManifest") or {}
    dispatch_profile = execution.get("dispatchProfile") or {}
    available_sequences = sequence_inventory(execution)
    required_sequences = [str(value) for value in package_manifest.get("requiredSequences") or []]
    missing_required = [sequence for sequence in required_sequences if sequence not in available_sequences]
    series_count = len(study_context.get("series") or [])
    archive_binding = bool(study_context.get("sourceArchive") or study_context.get("dicomWebBaseUrl"))
    study_instance_uid = str(
        study_context.get("studyInstanceUid")
        or case_context.get("studyUid")
        or case_id
    )
    selected_package = str(execution.get("selectedPackage") or "unknown-package")
    sequence_text = ", ".join(available_sequences) if available_sequences else "metadata-only inventory unavailable"
    disposition = "pass" if not missing_required and available_sequences else "warn"
    coverage_ratio = 100.0
    if required_sequences:
        coverage_ratio = round(((len(required_sequences) - len(missing_required)) / len(required_sequences)) * 100.0, 2)

    summary = (
        f"Metadata-derived draft for study {study_instance_uid} using {selected_package} "
        f"with {series_count} described series."
    )
    findings = [
        f"Metadata-derived structural triage prepared for study {study_instance_uid}.",
        f"Sequence coverage available to the worker: {sequence_text}.",
    ]

    indication = str(case_context.get("indication") or "").strip()
    if indication:
        findings.append(f"Clinical indication supplied to the worker: {indication}.")

    if archive_binding:
        findings.append("Archive binding is present, so viewer-facing artifact links can be generated.")
    else:
        findings.append("Archive binding is absent, so viewer-facing artifact links remain bounded placeholders.")

    issues = ["Metadata-derived worker draft only; no voxel-level inference executed."]
    if missing_required:
        issues.append(
            "Missing required sequences for selected package: " + ", ".join(missing_required)
        )
    if not archive_binding:
        issues.append("No archive binding was present in the execution contract.")

    measurements = [
        {"label": "metadata_series_count", "value": series_count, "unit": "count"},
        {
            "label": "metadata_instance_count",
            "value": total_instance_count(study_context),
            "unit": "count",
        },
        {
            "label": "required_sequence_coverage_pct",
            "value": coverage_ratio,
            "unit": "percent",
        },
    ]

    qc_summary = {
        "summary": summary,
        "checks": [
            {
                "checkId": "required-sequences",
                "status": "pass" if not missing_required else "warn",
                "detail": (
                    "All required sequences are present in the execution contract."
                    if not missing_required
                    else "Missing required sequences: " + ", ".join(missing_required)
                ),
            },
            {
                "checkId": "archive-binding",
                "status": "pass" if archive_binding else "warn",
                "detail": (
                    "Study context includes an archive binding for viewer-linked artifacts."
                    if archive_binding
                    else "Study context does not include archive binding metadata."
                ),
            },
            {
                "checkId": "metadata-series",
                "status": "pass" if series_count > 0 else "warn",
                "detail": (
                    f"Worker received {series_count} series descriptors."
                    if series_count > 0
                    else "Worker received no explicit series descriptors."
                ),
            },
        ],
        "metrics": [
            {"name": measurement["label"], "value": measurement["value"], "unit": measurement["unit"]}
            for measurement in measurements
        ],
    }

    targets = persistence_targets_by_type(execution)
    artifact_refs = [
        planned_artifact_uri(targets, "qc-summary"),
        planned_artifact_uri(targets, "metrics-json"),
        planned_artifact_uri(targets, "overlay-preview"),
        planned_artifact_uri(targets, "report-preview"),
    ]

    qc_payload = {
        "caseId": case_id,
        "workerId": worker_id,
        "studyInstanceUid": study_instance_uid,
        "qcDisposition": disposition,
        "summary": summary,
        "checks": qc_summary["checks"],
        "issues": issues,
    }
    metrics_payload = {
        "caseId": case_id,
        "workerId": worker_id,
        "selectedPackage": selected_package,
        "resourceClass": dispatch_profile.get("resourceClass"),
        "metrics": measurements,
    }
    report_preview = "".join(
        [
            "<html><body>",
            f"<h1>MRI Worker Draft for {study_instance_uid}</h1>",
            f"<p>{summary}</p>",
            "<ul>",
            *[f"<li>{finding}</li>" for finding in findings],
            "</ul>",
            "</body></html>",
        ]
    )

    artifact_payloads = [
        {
            "artifactRef": artifact_refs[0],
            "contentType": "application/json",
            "contentBase64": encode_json_payload(qc_payload),
        },
        {
            "artifactRef": artifact_refs[1],
            "contentType": "application/json",
            "contentBase64": encode_json_payload(metrics_payload),
        },
        {
            "artifactRef": artifact_refs[2],
            "contentType": "image/png",
            "contentBase64": ONE_PIXEL_PNG_BASE64,
        },
        {
            "artifactRef": artifact_refs[3],
            "contentType": "text/html",
            "contentBase64": encode_text_payload(report_preview),
        },
    ]

    return {
        "caseId": case_id,
        "workerId": worker_id,
        "qcDisposition": disposition,
        "findings": findings,
        "measurements": measurements,
        "artifacts": artifact_refs,
        "artifactPayloads": artifact_payloads,
        "issues": issues,
        "generatedSummary": summary,
        "qcSummary": qc_summary,
    }


def run_once() -> int:
    base_url = os.environ.get("MRI_API_BASE_URL", "http://127.0.0.1:4010").rstrip("/")
    secret = os.environ.get("MRI_INTERNAL_HMAC_SECRET")
    internal_api_token = os.environ.get("MRI_INTERNAL_API_TOKEN")
    worker_id = os.environ.get("MRI_WORKER_ID", "python-worker-demo")
    stage = os.environ.get("MRI_WORKER_STAGE", "inference")
    lease_seconds = int(os.environ.get("MRI_LEASE_SECONDS", "90"))
    heartbeat_lease_seconds = int(os.environ.get("MRI_HEARTBEAT_LEASE_SECONDS", "180"))
    correlation_id = os.environ.get("MRI_CORRELATION_ID", str(uuid.uuid4()))

    if stage == "inference":
        if not secret:
            raise RuntimeError("MRI_INTERNAL_HMAC_SECRET is required for inference stage")

        claim_result = post_signed_json(
            base_url,
            "/api/internal/dispatch/claim",
            {
                "workerId": worker_id,
                "stage": stage,
                "leaseSeconds": lease_seconds,
            },
            secret,
            correlation_id,
            internal_api_token,
        )
        dispatch = claim_result.get("dispatch")

        if dispatch is None:
            sys.stdout.write("No queued work available.\n")
            return 0

        case_id = dispatch["caseId"]
        lease_id = dispatch["leaseId"]
        execution = claim_result.get("execution") or {}

        heartbeat_result = post_signed_json(
            base_url,
            "/api/internal/dispatch/heartbeat",
            {
                "caseId": case_id,
                "leaseId": lease_id,
                "workerId": worker_id,
                "stage": stage,
                "leaseSeconds": heartbeat_lease_seconds,
            },
            secret,
            correlation_id,
            internal_api_token,
        )
        sys.stdout.write(
            json.dumps(
                {
                    "correlationId": correlation_id,
                    "dispatch": dispatch,
                    "heartbeat": heartbeat_result,
                },
                indent=2,
            )
            + "\n"
        )

        callback_result = post_signed_json(
            base_url,
            "/api/internal/inference-callback",
            build_inference_callback(case_id, worker_id, execution),
            secret,
            correlation_id,
            internal_api_token,
        )
    elif stage == "delivery":
        claim_result = post_internal_json(
            base_url,
            "/api/internal/delivery-jobs/claim-next",
            {
                "workerId": worker_id,
            },
            correlation_id,
            internal_api_token,
        )
        job = claim_result.get("job")

        if job is None:
            sys.stdout.write("No queued work available.\n")
            return 0

        case_id = job["caseId"]
        sys.stdout.write(
            json.dumps(
                {
                    "correlationId": correlation_id,
                    "deliveryJob": job,
                },
                indent=2,
            )
            + "\n"
        )

        callback_result = post_internal_json(
            base_url,
            "/api/internal/delivery-callback",
            {
                "caseId": case_id,
                "workerId": worker_id,
                "deliveryStatus": "delivered",
                "detail": f"Python worker marked delivery complete for case {case_id}.",
            },
            correlation_id,
            internal_api_token,
        )
    else:
        raise RuntimeError(f"Unsupported MRI_WORKER_STAGE: {stage}")

    sys.stdout.write(json.dumps({"correlationId": correlation_id, **callback_result}, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(run_once())
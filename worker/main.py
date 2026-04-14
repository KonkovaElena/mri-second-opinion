import hashlib
import hmac
import base64
import gzip
import json
import os
import struct
import sys
import uuid
from datetime import datetime, timezone
from urllib import error, parse, request

from diagnosis_aware import apply_diagnosis_aware_protocol


ONE_PIXEL_PNG_BASE64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/"
    "w8AAn8B9p8Z0iAAAAAASUVORK5CYII="
)
DEFAULT_WORKER_DOWNLOAD_TIMEOUT_SECONDS = 10
DEFAULT_WORKER_MAX_DOWNLOAD_BYTES = 128 * 1024 * 1024
WORKER_DOWNLOAD_CHUNK_BYTES = 64 * 1024


def should_bypass_proxy(base_url: str) -> bool:
    hostname = (parse.urlparse(base_url).hostname or "").lower()
    return hostname in {"127.0.0.1", "localhost"}


def parse_positive_int_env(name: str, default: int) -> int:
    raw_value = str(os.environ.get(name, str(default))).strip()

    try:
        parsed_value = int(raw_value)
    except ValueError as exc:
        raise RuntimeError(f"{name} must be a positive integer.") from exc

    if parsed_value <= 0:
        raise RuntimeError(f"{name} must be a positive integer.")

    return parsed_value


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


def resolve_download_url(base_url: str, download_url: str) -> str:
    parsed_url = parse.urlparse(download_url)
    if parsed_url.scheme:
        return download_url
    return parse.urljoin(f"{base_url}/", download_url.lstrip("/"))


def normalize_origin(url: str) -> str | None:
    parsed_url = parse.urlparse(url)
    if not parsed_url.scheme or not parsed_url.netloc:
        return None
    return f"{parsed_url.scheme.lower()}://{parsed_url.netloc.lower()}"


def parse_allowed_volume_download_origins() -> set[str]:
    raw_value = os.environ.get("MRI_WORKER_ALLOWED_VOLUME_ORIGINS", "")
    origins: set[str] = set()

    for value in raw_value.split(","):
        origin = normalize_origin(value.strip())
        if origin:
            origins.add(origin)

    return origins


def is_permitted_volume_download_url(base_url: str, download_url: str) -> bool:
    parsed_download_url = parse.urlparse(download_url)

    if not parsed_download_url.scheme:
        return True

    if parsed_download_url.scheme.lower() not in {"http", "https"}:
        return False

    download_origin = normalize_origin(download_url)
    base_origin = normalize_origin(base_url)

    if download_origin and base_origin and download_origin == base_origin:
        return True

    allowed_origins = parse_allowed_volume_download_origins()
    if download_origin and download_origin in allowed_origins:
        return True

    return False


def download_binary_payload(base_url: str, download_url: str, correlation_id: str) -> bytes:
    if not is_permitted_volume_download_url(base_url, download_url):
        raise RuntimeError("Volume download URL origin is not permitted for worker fetch.")

    timeout_seconds = parse_positive_int_env(
        "MRI_WORKER_DOWNLOAD_TIMEOUT_SECONDS",
        DEFAULT_WORKER_DOWNLOAD_TIMEOUT_SECONDS,
    )
    max_download_bytes = parse_positive_int_env(
        "MRI_WORKER_MAX_DOWNLOAD_BYTES",
        DEFAULT_WORKER_MAX_DOWNLOAD_BYTES,
    )
    resolved_url = resolve_download_url(base_url, download_url)
    req = request.Request(
        resolved_url,
        headers={
            "x-correlation-id": correlation_id,
        },
        method="GET",
    )
    opener = request.build_opener(request.ProxyHandler({})) if should_bypass_proxy(resolved_url) else request.build_opener()

    with opener.open(req, timeout=timeout_seconds) as response:
        content_length = response.headers.get("content-length")
        if content_length:
            try:
                if int(content_length) > max_download_bytes:
                    raise RuntimeError("Volume download exceeded the worker byte budget.")
            except ValueError:
                pass

        payload = bytearray()

        while True:
            chunk = response.read(min(WORKER_DOWNLOAD_CHUNK_BYTES, max_download_bytes - len(payload) + 1))
            if not chunk:
                break

            payload.extend(chunk)
            if len(payload) > max_download_bytes:
                raise RuntimeError("Volume download exceeded the worker byte budget.")

        return bytes(payload)


def select_volume_input(study_context: dict) -> dict | None:
    preferred = None
    fallback = None

    for series in study_context.get("series") or []:
        if not isinstance(series, dict):
            continue

        download_url = str(series.get("volumeDownloadUrl") or "").strip()
        if not download_url:
            continue

        if fallback is None:
            fallback = series

        if str(series.get("sequenceLabel") or "").strip() == "T1w":
            preferred = series
            break

    return preferred or fallback


def parse_nifti_volume_bytes(payload_bytes: bytes) -> dict:
    raw_bytes = gzip.decompress(payload_bytes) if payload_bytes[:2] == b"\x1f\x8b" else payload_bytes
    if len(raw_bytes) < 352:
        raise RuntimeError("Downloaded NIfTI payload is too small to contain a valid header.")

    if struct.unpack("<I", raw_bytes[:4])[0] == 348:
        endian = "<"
    elif struct.unpack(">I", raw_bytes[:4])[0] == 348:
        endian = ">"
    else:
        raise RuntimeError("Unsupported NIfTI header; sizeof_hdr is not 348.")

    dimensions = struct.unpack(f"{endian}8h", raw_bytes[40:56])
    rank = max(1, int(dimensions[0]))
    dim_x = max(1, int(dimensions[1]))
    dim_y = max(1, int(dimensions[2])) if rank >= 2 else 1
    dim_z = max(1, int(dimensions[3])) if rank >= 3 else 1
    datatype = int(struct.unpack(f"{endian}h", raw_bytes[70:72])[0])
    bitpix = int(struct.unpack(f"{endian}h", raw_bytes[72:74])[0])
    vox_offset = max(352, int(struct.unpack(f"{endian}f", raw_bytes[108:112])[0]))

    format_map = {
        2: "B",   # uint8
        4: "h",   # int16
        8: "i",   # int32
        16: "f",  # float32
        64: "d",  # float64
        512: "H", # uint16
        768: "I", # uint32
    }
    format_code = format_map.get(datatype)
    if format_code is None:
        raise RuntimeError(f"Unsupported NIfTI datatype: {datatype}")

    bytes_per_value = bitpix // 8
    voxel_count = dim_x * dim_y * dim_z
    data_end = vox_offset + voxel_count * bytes_per_value
    if len(raw_bytes) < data_end:
        raise RuntimeError("Downloaded NIfTI payload ended before the declared voxel data completed.")

    slice_voxel_count = dim_x * dim_y
    center_z = dim_z // 2
    center_slice_start = center_z * slice_voxel_count
    center_slice_end = center_slice_start + slice_voxel_count
    center_slice_values: list[float] = []
    parsed_voxel_count = 0
    min_intensity: float | None = None
    max_intensity: float | None = None
    nonzero_voxel_count = 0
    intensity_sum = 0.0

    for index, (value,) in enumerate(
        struct.iter_unpack(
            f"{endian}{format_code}",
            raw_bytes[vox_offset:data_end],
        )
    ):
        numeric_value = float(value)
        parsed_voxel_count = index + 1
        intensity_sum += numeric_value

        if min_intensity is None or numeric_value < min_intensity:
            min_intensity = numeric_value
        if max_intensity is None or numeric_value > max_intensity:
            max_intensity = numeric_value
        if numeric_value != 0.0:
            nonzero_voxel_count += 1
        if center_slice_start <= index < center_slice_end:
            center_slice_values.append(numeric_value)

    if parsed_voxel_count != voxel_count:
        raise RuntimeError("Parsed voxel count does not match the declared NIfTI dimensions.")
    if len(center_slice_values) != slice_voxel_count:
        raise RuntimeError("Parsed center slice does not match the declared NIfTI dimensions.")

    mean_intensity = round(intensity_sum / voxel_count, 4)

    return {
        "dimensions": [dim_x, dim_y, dim_z],
        "voxelCount": voxel_count,
        "nonzeroVoxelCount": nonzero_voxel_count,
        "meanIntensity": mean_intensity,
        "minIntensity": min_intensity,
        "maxIntensity": max_intensity,
        "centerSliceValues": center_slice_values,
    }


def build_slice_svg(volume_metrics: dict) -> str:
    dim_x, dim_y, dim_z = volume_metrics["dimensions"]
    _ = dim_z
    slice_values = volume_metrics["centerSliceValues"]
    min_intensity = min(slice_values)
    max_intensity = max(slice_values)
    intensity_range = max(max_intensity - min_intensity, 1e-9)
    cell_size = max(4, 64 // max(dim_x, dim_y, 1))
    rects: list[str] = []

    for y in range(dim_y):
        for x in range(dim_x):
            value = slice_values[y * dim_x + x]
            normalized = int(round(((value - min_intensity) / intensity_range) * 255)) if intensity_range > 0 else 0
            rects.append(
                f'<rect x="{x * cell_size}" y="{y * cell_size}" width="{cell_size}" height="{cell_size}" fill="rgb({normalized},{normalized},{normalized})" />'
            )

    width = dim_x * cell_size
    height = dim_y * cell_size
    return "".join(
        [
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{width}" height="{height}" shape-rendering="crispEdges">',
            '<rect width="100%" height="100%" fill="black" />',
            *rects,
            "</svg>",
        ]
    )


def build_execution_context(
    compute_mode: str,
    source_series_instance_uid: str | None = None,
    fallback_code: str | None = None,
    fallback_detail: str | None = None,
) -> dict:
    return {
        "computeMode": compute_mode,
        "fallbackCode": fallback_code,
        "fallbackDetail": fallback_detail,
        "sourceSeriesInstanceUid": source_series_instance_uid,
    }


def build_inference_callback(
    base_url: str,
    case_id: str,
    worker_id: str,
    execution: dict,
    correlation_id: str,
) -> dict:
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

    targets = persistence_targets_by_type(execution)
    artifact_refs = [
        planned_artifact_uri(targets, "qc-summary"),
        planned_artifact_uri(targets, "metrics-json"),
        planned_artifact_uri(targets, "overlay-preview"),
        planned_artifact_uri(targets, "report-preview"),
    ]

    volume_input = select_volume_input(study_context)
    if volume_input is not None:
        volume_series_uid = str(volume_input.get("seriesInstanceUid") or study_instance_uid)
        try:
            download_url = str(volume_input.get("volumeDownloadUrl") or "").strip()
            volume_bytes = download_binary_payload(base_url, download_url, correlation_id)
        except Exception as exc:
            fallback_code = "volume-download-failed"
            fallback_detail = str(exc)
        else:
            try:
                volume_metrics = parse_nifti_volume_bytes(volume_bytes)
            except Exception as exc:
                fallback_code = "volume-parse-failed"
                fallback_detail = str(exc)
            else:
                dim_x, dim_y, dim_z = volume_metrics["dimensions"]
                foreground_ratio = round(
                    (volume_metrics["nonzeroVoxelCount"] / volume_metrics["voxelCount"]) * 100.0,
                    2,
                )
                summary = (
                    f"Voxel-backed draft for study {study_instance_uid} using {selected_package} "
                    f"with volume {dim_x}x{dim_y}x{dim_z}."
                )
                findings = [
                    f"Voxel-backed structural pass executed on series {volume_series_uid}.",
                    f"Parsed volume dimensions: {dim_x}x{dim_y}x{dim_z} voxels.",
                    f"Sequence coverage available to the worker: {sequence_text}.",
                ]

                indication = str(case_context.get("indication") or "").strip()
                if indication:
                    findings.append(f"Clinical indication supplied to the worker: {indication}.")

                issues: list[str] = []
                if missing_required:
                    issues.append(
                        "Missing required sequences for selected package: " + ", ".join(missing_required)
                    )
                if not archive_binding:
                    issues.append("No archive binding was present in the execution contract.")

                measurements = [
                    {"label": "volume_voxel_count", "value": volume_metrics["voxelCount"], "unit": "count"},
                    {"label": "nonzero_voxel_count", "value": volume_metrics["nonzeroVoxelCount"], "unit": "count"},
                    {"label": "foreground_voxel_pct", "value": foreground_ratio, "unit": "percent"},
                    {"label": "mean_intensity", "value": volume_metrics["meanIntensity"], "unit": "signal"},
                ]

                findings, measurements, protocol_note = apply_diagnosis_aware_protocol(
                    indication, findings, measurements
                )
                if protocol_note:
                    findings.insert(0, f"[{protocol_note}]")

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
                            "checkId": "volume-input",
                            "status": "pass",
                            "detail": f"Worker downloaded and parsed a NIfTI volume from {download_url}.",
                        },
                        {
                            "checkId": "foreground-coverage",
                            "status": "pass" if volume_metrics["nonzeroVoxelCount"] > 0 else "warn",
                            "detail": (
                                f"Foreground coverage is {foreground_ratio}% based on non-zero voxels."
                                if volume_metrics["nonzeroVoxelCount"] > 0
                                else "All voxels were zero-valued in the downloaded volume."
                            ),
                        },
                    ],
                    "metrics": [
                        {"name": measurement["label"], "value": measurement["value"], "unit": measurement["unit"]}
                        for measurement in measurements
                    ],
                }

                metrics_payload = {
                    "caseId": case_id,
                    "workerId": worker_id,
                    "selectedPackage": selected_package,
                    "resourceClass": dispatch_profile.get("resourceClass"),
                    "sourceSeriesInstanceUid": volume_series_uid,
                    "metrics": measurements,
                }
                qc_payload = {
                    "caseId": case_id,
                    "workerId": worker_id,
                    "studyInstanceUid": study_instance_uid,
                    "qcDisposition": "pass" if volume_metrics["nonzeroVoxelCount"] > 0 and not missing_required else "warn",
                    "summary": summary,
                    "checks": qc_summary["checks"],
                    "issues": issues,
                }
                svg_preview = build_slice_svg(volume_metrics)
                report_preview = "".join(
                    [
                        "<html><body>",
                        f"<h1>Voxel-backed MRI Worker Draft for {study_instance_uid}</h1>",
                        f"<p>{summary}</p>",
                        "<ul>",
                        *[f"<li>{finding}</li>" for finding in findings],
                        "</ul>",
                        f"<p>Foreground coverage: {foreground_ratio}%</p>",
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
                        "contentType": "image/svg+xml",
                        "contentBase64": encode_text_payload(svg_preview),
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
                    "qcDisposition": qc_payload["qcDisposition"],
                    "findings": findings,
                    "measurements": measurements,
                    "artifacts": artifact_refs,
                    "artifactPayloads": artifact_payloads,
                    "executionContext": build_execution_context(
                        "voxel-backed",
                        source_series_instance_uid=volume_series_uid,
                    ),
                    "issues": issues,
                    "generatedSummary": summary,
                    "qcSummary": qc_summary,
                }
        fallback_volume_issue = "Volume-backed pass unavailable; worker fell back to metadata-only mode: " + fallback_detail
        fallback_code_for_context = fallback_code
        fallback_detail_for_context = fallback_detail
        fallback_series_uid = volume_series_uid
    else:
        fallback_volume_issue = "No volumeDownloadUrl was present in the execution contract."
        fallback_code_for_context = "missing-volume-input"
        fallback_detail_for_context = fallback_volume_issue
        fallback_series_uid = None

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
    if volume_input is not None:
        issues.append(fallback_volume_issue)
    else:
        issues.append(fallback_detail_for_context)
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

    findings, measurements, protocol_note = apply_diagnosis_aware_protocol(
        indication, findings, measurements
    )
    if protocol_note:
        findings.insert(0, f"[{protocol_note}]")

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
        "executionContext": build_execution_context(
            "metadata-fallback",
            source_series_instance_uid=fallback_series_uid,
            fallback_code=fallback_code_for_context,
            fallback_detail=fallback_detail_for_context,
        ),
        "issues": issues,
        "generatedSummary": summary,
        "qcSummary": qc_summary,
    }


def _classify_error(exc: BaseException) -> tuple[str, str]:
    """Classify an exception as (failureClass, errorCode)."""
    current: BaseException | None = exc
    visited: set[int] = set()

    while current is not None and id(current) not in visited:
        visited.add(id(current))

        if isinstance(current, error.HTTPError):
            code = current.code
            if 500 <= code < 600 or code == 429:
                return ("transient", f"WORKER_HTTP_{code}")
            return ("terminal", f"WORKER_HTTP_{code}")

        if isinstance(current, (error.URLError, TimeoutError, OSError)):
            return ("transient", "WORKER_NETWORK_ERROR")

        if isinstance(current, (KeyError, ValueError, TypeError)):
            return ("terminal", "WORKER_DATA_ERROR")

        current = current.__cause__ if current.__cause__ is not None else current.__context__

    return ("terminal", "WORKER_UNKNOWN_ERROR")


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

        try:
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
                build_inference_callback(base_url, case_id, worker_id, execution, correlation_id),
                secret,
                correlation_id,
                internal_api_token,
            )
        except Exception as exc:
            failure_class, error_code = _classify_error(exc)
            detail = str(exc)[:500]
            sys.stderr.write(
                json.dumps(
                    {
                        "event": "inference_failure",
                        "correlationId": correlation_id,
                        "caseId": case_id,
                        "failureClass": failure_class,
                        "errorCode": error_code,
                        "detail": detail,
                    },
                    indent=2,
                )
                + "\n"
            )
            try:
                post_signed_json(
                    base_url,
                    "/api/internal/dispatch/fail",
                    {
                        "caseId": case_id,
                        "leaseId": lease_id,
                        "failureClass": failure_class,
                        "errorCode": error_code,
                        "detail": detail,
                    },
                    secret,
                    correlation_id,
                    internal_api_token,
                )
            except Exception as report_exc:
                sys.stderr.write(f"Failed to report failure: {report_exc}\n")
            return 1
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
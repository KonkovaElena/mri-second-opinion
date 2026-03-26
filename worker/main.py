import hashlib
import hmac
import json
import os
import sys
import uuid
from datetime import datetime, timezone
from urllib import error, request


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
) -> tuple[dict[str, str], bytes]:
    body_bytes = json.dumps(payload).encode("utf-8")
    timestamp = iso_now()
    nonce = str(uuid.uuid4())
    canonical = canonicalize_request(method, path, timestamp, nonce, body_bytes)
    signature = hmac.new(secret.encode("utf-8"), canonical.encode("utf-8"), hashlib.sha256).hexdigest()
    return {
        "content-type": "application/json",
        "x-mri-timestamp": timestamp,
        "x-mri-nonce": nonce,
        "x-mri-signature": signature,
        "x-correlation-id": correlation_id,
    }, body_bytes


def post_json(base_url: str, path: str, payload: dict, secret: str, correlation_id: str) -> dict:
    headers, body_bytes = build_signed_headers("POST", path, payload, secret, correlation_id)
    req = request.Request(f"{base_url}{path}", data=body_bytes, headers=headers, method="POST")

    try:
        with request.urlopen(req) as response:
            return json.loads(response.read().decode("utf-8"))
    except error.HTTPError as exc:
        body = exc.read().decode("utf-8")
        raise RuntimeError(f"{path} failed with {exc.code}: {body}") from exc


def run_once() -> int:
    base_url = os.environ.get("MRI_API_BASE_URL", "http://127.0.0.1:4010").rstrip("/")
    secret = os.environ.get("MRI_INTERNAL_HMAC_SECRET")
    worker_id = os.environ.get("MRI_WORKER_ID", "python-worker-demo")
    stage = os.environ.get("MRI_WORKER_STAGE", "inference")
    lease_seconds = int(os.environ.get("MRI_LEASE_SECONDS", "90"))
    heartbeat_lease_seconds = int(os.environ.get("MRI_HEARTBEAT_LEASE_SECONDS", "180"))
    correlation_id = os.environ.get("MRI_CORRELATION_ID", str(uuid.uuid4()))

    if not secret:
        raise RuntimeError("MRI_INTERNAL_HMAC_SECRET is required")

    claim_result = post_json(
        base_url,
        "/api/internal/dispatch/claim",
        {
            "workerId": worker_id,
            "stage": stage,
            "leaseSeconds": lease_seconds,
        },
        secret,
        correlation_id,
    )
    dispatch = claim_result.get("dispatch")

    if dispatch is None:
        sys.stdout.write("No queued work available.\n")
        return 0

    case_id = dispatch["caseId"]
    lease_id = dispatch["leaseId"]

    heartbeat_result = post_json(
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
    )
    sys.stdout.write(json.dumps({"correlationId": correlation_id, "heartbeat": heartbeat_result["dispatch"]}, indent=2) + "\n")

    if stage == "inference":
        callback_result = post_json(
            base_url,
            "/api/internal/inference-callback",
            {
                "caseId": case_id,
                "leaseId": lease_id,
                "workerId": worker_id,
                "qcDisposition": "pass",
                "findings": ["No acute intracranial abnormality."],
                "measurements": [{"label": "brain_volume_ml", "value": 1128}],
                "artifacts": ["artifact://overlay-preview", "artifact://report-preview"],
                "issues": ["Synthetic scaffold callback only."],
                "generatedSummary": "Python worker scaffold produced a synthetic draft.",
            },
            secret,
            correlation_id,
        )
    elif stage == "delivery":
        callback_result = post_json(
            base_url,
            "/api/internal/delivery-callback",
            {
                "caseId": case_id,
                "leaseId": lease_id,
                "workerId": worker_id,
                "deliveryStatus": "delivered",
                "detail": "Python worker scaffold marked delivery complete.",
            },
            secret,
            correlation_id,
        )
    else:
        raise RuntimeError(f"Unsupported MRI_WORKER_STAGE: {stage}")

    sys.stdout.write(json.dumps({"correlationId": correlation_id, **callback_result}, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(run_once())
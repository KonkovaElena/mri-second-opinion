# MRI Worker Scaffold

This directory contains the bounded Python worker scaffold for PR-14.

It is not a production inference runtime.

It now proves two truthful bounded worker loops against the current standalone API:

1. inference: signed dispatch claim, signed lease heartbeat, and a callback that is metadata-derived by default but can switch to a bounded voxel-backed pass when the execution contract carries a real `volumeDownloadUrl`
2. delivery: internal delivery-job claim and delivery callback on the existing `/api/internal/delivery-*` rail

## Environment

Set these variables before running the scaffold:

1. `MRI_API_BASE_URL` — standalone API base URL, for example `http://127.0.0.1:4010`
2. `MRI_INTERNAL_HMAC_SECRET` — same HMAC secret configured on the API; required for `MRI_WORKER_STAGE=inference`
3. `MRI_WORKER_ID` — worker identity, default `python-worker-demo`
4. `MRI_WORKER_STAGE` — `inference` or `delivery`, default `inference`
5. `MRI_LEASE_SECONDS` — initial claim lease length, default `90`
6. `MRI_HEARTBEAT_LEASE_SECONDS` — renewed lease length, default `180`
7. `MRI_INTERNAL_API_TOKEN` — optional bearer token reused on `/api/internal/*` routes when the standalone API enables internal auth
8. `MRI_CORRELATION_ID` — optional fixed correlation id reused across claim, heartbeat, and callback; defaults to a generated UUID

## Usage

Run once against a seeded standalone case:

```bash
python worker/main.py
```

For the current bounded proof path, the worker does this:

1. if the stage is `inference`, it claims one signed dispatch item, renews the lease once, and then:
	- uses a bounded voxel-backed pass when the execution contract includes a real `studyContext.series[].volumeDownloadUrl` for the selected sequence
	- otherwise falls back to the existing metadata-derived draft path
	In both cases it persists bounded local payloads for `qc-summary`, `metrics-json`, `overlay-preview`, and `report-preview`
2. if the stage is `delivery`, it claims one queued delivery job from `/api/internal/delivery-jobs/claim-next` and posts `/api/internal/delivery-callback` with `delivered`

Both stage paths reuse the same `X-Correlation-Id` value so the standalone operation log and stdout JSON logs can be joined into one bounded workflow transcript. The inference path signs dispatch requests with HMAC headers. The delivery path uses the existing internal bearer-token rail when the standalone API requires it.

The inference callback no longer emits a fixed synthetic draft. When no real volume locator is present it still emits a metadata-derived draft that uses the execution contract and series metadata only. When `studyContext.series[].volumeDownloadUrl` is present, the worker downloads one bounded NIfTI volume, parses it without heavyweight dependencies, emits voxel-level measurements, and generates an SVG slice preview. This remains a narrow Wave 2B seam, not a production imaging runtime or a DICOM-derived pipeline.

The callback uses planned storage-reference strings from the execution contract and attaches local artifact payloads. The API persists those payloads into the bounded local artifact store and turns them into typed artifact references inside the durable case record.

The callback now also emits a structured `executionContext` block. That block records whether the worker completed a `voxel-backed` pass or a `metadata-fallback` pass, carries a stable fallback code when bounded volume download or parsing fails, and preserves the source `seriesInstanceUid` when the worker was able to select a concrete input series.
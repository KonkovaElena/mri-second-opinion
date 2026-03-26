# MRI Worker Scaffold

This directory contains the bounded Python worker scaffold for PR-14.

It is not a production inference runtime.

It proves one truthful external worker loop against the current standalone API:

1. signed dispatch claim
2. signed lease heartbeat
3. signed callback with artifact storage references

## Environment

Set these variables before running the scaffold:

1. `MRI_API_BASE_URL` — standalone API base URL, for example `http://127.0.0.1:4010`
2. `MRI_INTERNAL_HMAC_SECRET` — same HMAC secret configured on the API
3. `MRI_WORKER_ID` — worker identity, default `python-worker-demo`
4. `MRI_WORKER_STAGE` — `inference` or `delivery`, default `inference`
5. `MRI_LEASE_SECONDS` — initial claim lease length, default `90`
6. `MRI_HEARTBEAT_LEASE_SECONDS` — renewed lease length, default `180`
7. `MRI_CORRELATION_ID` — optional fixed correlation id reused across claim, heartbeat, and callback; defaults to a generated UUID

## Usage

Run once against a seeded standalone case:

```bash
python worker/main.py
```

For the current bounded proof path, the worker does this:

1. claims one dispatch item
2. renews the lease once
3. if the stage is `inference`, submits a synthetic signed inference callback
4. if the stage is `delivery`, submits a signed delivery callback with `delivered`

All three signed internal requests reuse the same `X-Correlation-Id` value so the standalone operation log and stdout JSON logs can be joined into one bounded workflow transcript.

The callback payload uses storage-reference strings only.

The API turns those into typed artifact references inside the durable case record.
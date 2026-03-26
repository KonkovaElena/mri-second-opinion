# ADR 2026-03-26 Redis Queue Substrate

## Status

Accepted.

## Context

The standalone MRI subtree already persists workflow queue state inside durable case records.

That state is the authoritative workflow transcript.

What was still missing was a real dispatch substrate that an external worker can poll without reading the full case repository directly.

The immediate PR-11 requirement is narrower than a full worker fleet.

It needs:

1. an external queue substrate for `inference` and `delivery`
2. a local adapter that keeps tests and snapshot mode deterministic
3. a boundary that preserves repository state as the source of truth for lease state, retry attempts, and operator-visible audit history

## Decision

Use Redis as the first external queue substrate.

Use the official `redis` Node client and keep the current `DispatchQueueAdapter` as the runtime seam.

The current slice uses Redis lists with one queue key per stage.

The repository-backed `workflowQueue` remains authoritative for:

1. queue attempt numbering
2. lease metadata
3. expiry-based requeue
4. operator-visible queue transcript

Redis is therefore the transport substrate, not the canonical workflow ledger.

## Why Redis First

1. smallest operational footprint for local and containerized bring-up
2. simple fit for the existing `enqueue` and `claim` contract
3. enough durability for external dispatch polling without prematurely committing to BullMQ or a broader job-orchestration runtime
4. easy to keep optional while snapshot-mode tests continue to use the local adapter

## Consequences

Positive:

1. external workers can claim bounded work through Redis-backed dispatch instead of repository scans
2. snapshot mode and tests keep a deterministic local queue path
3. queue state remains reconstructible from durable case records even if Redis is transiently unavailable

Trade-offs:

1. this slice does not yet deliver distributed lease renewal
2. this slice does not yet provide dead-letter routing or retry taxonomy beyond the persisted case transcript
3. stale Redis jobs can still drift from repository truth and must be treated as transport artifacts, not authority

## Follow-On Work

1. PR-12 adds explicit retry taxonomy and DLQ semantics
2. PR-13 adds lease renewal and abandoned-work recovery beyond simple expiry requeue
3. a later worker-runtime slice may replace raw Redis lists with BullMQ if queue governance grows beyond the current bounded stages
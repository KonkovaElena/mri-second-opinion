# First Public Announcement Draft

Date: 2026-03-25

## Purpose

This draft is the starting point for the first public announcement of MRI Standalone.

It is intentionally conservative.

Use it only after the repository is publicly reachable and the hosted workflows have passed.

## Suggested short announcement

MRI Standalone is now publicly available on GitHub.

This repository is an open-source, clinician-in-the-loop MRI second-opinion workflow baseline with a standalone TypeScript API and restart-safe local persistence.

It is intended as a focused MRI-only workflow foundation, not as a launch-ready clinical system, a complete frontend product, or an autonomous diagnostic platform.

Current public baseline includes:

1. standalone install, build, and local test path
2. workflow API for case intake, review, finalize, report retrieval, and delivery retry
3. restart-safe local snapshot persistence
4. explicit readiness and evidence docs

What is not included yet:

1. database-backed durability
2. queue-backed execution
3. object-store artifact durability
4. real worker execution path
5. clinician review UI
6. launch-ready evidence

If you want to evaluate or contribute, start with:

1. `README.md`
2. `docs/releases/github-publication-playbook.md`
3. `docs/releases/v1-go-no-go.md`
4. `docs/verification/launch-evidence-index.md`

## Suggested longer announcement

MRI Standalone is now public as a focused MRI-only open-source repository.

The project is being published conservatively: it exposes a verified workflow API baseline and local restart-safe persistence, while keeping the formal repository verdict at `NOT_READY` until stronger hosted and product-level evidence exists.

The intent of this public release is to make the current baseline inspectable, testable, and discussable without overstating maturity. The repository should be read as a clinician-in-the-loop workflow foundation, not as a production-ready clinical deployment.

Contributors and reviewers should use the governed publication and evidence docs rather than infer readiness from architecture intent alone.

## Release-channel notes

### For GitHub release notes

Keep the opening paragraph short and use the short announcement.

### For Discussions or community posts

Use the longer announcement and include the "what is not included yet" list.

### For social posts

Do not claim launch readiness, production deployment, or diagnostic capability.

## Do not publish this draft unchanged if any of these are false

1. the repository is not yet public
2. hosted CI has not passed
3. the README no longer matches current repo truth
4. the linked docs are stale

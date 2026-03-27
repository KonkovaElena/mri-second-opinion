# MRI Standalone Repository Audit

Date: 2026-03-25

## Purpose

This note records a full subtree-local audit of the standalone MRI repository after git isolation, local validation, and documentation review.

It is an audit trace.

It is not a higher readiness verdict.

## Scope

The audit covered four surfaces:

1. repository independence and git isolation
2. runtime baseline correctness
3. documentation consistency across README, architecture, academic, and release docs
4. March 2026 external-evidence alignment for version-sensitive claims

## Verified Facts

## 1. Repository independence

Confirmed locally.

The MRI subtree now operates as its own standalone git repository and no longer needs the parent repository to install, build, test, or describe its current runtime baseline.

This does not eliminate the need for hosted CI evidence, but it does eliminate the earlier ambiguity around whether MRI was still only a subtree-shaped fragment of the parent project.

## 2. Runtime baseline

Confirmed locally.

The standalone repository currently proves:

1. dependency installation from lockfile
2. TypeScript build success
3. route-level workflow behavior covered by local tests
4. restart-safe local file-backed durability

The repository still does not prove:

1. PostgreSQL migrations
2. Redis-backed queue execution
3. worker-process inference
4. frontend review closure
5. full hosted product-closure evidence beyond build, test, and docs governance

## 3. Documentation honesty

Confirmed with targeted corrections.

The overall docs package was already conservative and aligned with a `NOT_READY` verdict.

The audit found only narrow drift rather than broad dishonesty.

## Findings And Corrections

## 1. Orthanc image-tag wording needed tightening

The target-architecture document previously referred to Orthanc Team Docker image tags in a `24.x` family.

That wording was too casual relative to the actual Orthanc Team deployment docs, which discuss `orthancteam/orthanc`, renamed image lineage, default versus `-full` variants, and tag examples that should not be conflated with Orthanc server-version statements.

Correction made:

1. architecture wording now requires deployment-pinned Orthanc Team tags without inventing a `24.x` baseline
2. evidence register wording now explicitly calls out the rename and tag-family caution

## 2. MedSAM2 deployment wording needed sharper separation

The repository already handled MedSAM2 carefully, but the audit tightened the language so that readers do not collapse public code openness into deployable-weight rights.

Correction made:

1. academic docs now emphasize that public code availability and public model-weight usability are separate questions
2. the public weight surface remains research-and-education-only in current wording

## 3. Browser review versus workstation review needed clearer role separation

The repository already referenced both OHIF and 3D Slicer, but the audit strengthened the wording that they solve different human-review problems.

Correction made:

1. OHIF remains the eventual browser-native product review surface
2. 3D Slicer remains the workstation-grade validation and rescue seam

## 4. Runtime verification wording needed command-level accuracy

The runtime baseline note previously described dependency installation in a way that did not match the lockfile-first reproducible path as tightly as it should.

Correction made:

1. runtime verification now names `npm ci` rather than a looser install phrasing
2. the placeholder nature of `/metrics` is now explicit

## Audit Verdict

The MRI standalone repository is in good pre-publication shape for a conservative first local workflow baseline.

The codebase does not currently need repair for failing build or failing tests.

The remaining work is mostly closure work rather than bug repair:

1. ~~main-branch hosted CI build and test evidence~~ (recorded: `ci` green on `177094a`)
2. queue and database runtime closure
3. frontend review closure
4. demo reproducibility

## Interaction With Other Docs

Use this note together with:

1. `runtime-baseline-verification.md`
2. `documentation-honesty-review.md`
3. `architecture-and-publication-audit-2026-03-25.md`
4. `../releases/v1-go-no-go.md`
5. `../academic/external-evidence-register-march-2026.md`
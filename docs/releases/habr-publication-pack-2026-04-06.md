# Habr Publication Pack: MRI Second Opinion

## Metadata

- Working title: Не с ИИ, а с workflow: что уже реально есть в open source MRI Second Opinion
- Alternative title: Почему в MRI Second Opinion самая важная часть уже не модель, а workflow
- Format: engineering deep dive / opinionated case study
- Habs: Open source, TypeScript, Python, Health Tech
- Tags: mri, radiology, dicom, fhir, workflow, clinician-in-the-loop, medical imaging, open source
- Complexity: medium
- Target audience: backend engineers, health-tech builders, medical-imaging engineers, open-source maintainers
- Voice constraints: first-person, thesis-led, no hype, strict claim discipline
- Short lead: MRI Second Opinion интересно не как очередная история про ИИ для МРТ, а как редкий open-source пример, где workflow, review gate и claim discipline уже важнее самого model call.
- One-sentence thesis: Самая взрослая часть MRI Second Opinion уже не в модели, а в workflow, который удерживает границу между AI draft и врачебным решением.

## Source Pack

- Primary repo surfaces:
  - README.md
  - src/app.ts
  - src/cases.ts
  - public/workbench/index.html
  - public/workbench/review-workbench.js
  - worker/README.md
- Supporting docs:
  - docs/api-scope.md
  - docs/status-model.md
  - docs/public-vocabulary.md
  - docs/scope-inventory.md
  - docs/academic/evidence-and-claims-policy.md
  - docs/academic/regulatory-positioning.md
  - docs/verification/runtime-baseline-verification.md
  - docs/verification/operator-surface-verification.md
  - docs/verification/workbench-frontend-audit-2026-03-27.md
  - docs/verification/launch-evidence-index.md
  - docs/verification/release-validation-packet.md
  - docs/releases/v1-go-no-go.md
- Existing drafts or public copy:
  - root-level earlier Habr draft outside standalone subtree
  - docs/releases/first-public-announcement-draft.md
  - docs/releases/github-publication-copy-pack.md
- External context if relevant:
  - none required for the main claim; this pack is grounded in repo truth and local validation

## Claim Register

### Implemented

- The standalone repository exposes a real public workflow API for intake, review, finalization, report retrieval, artifact retrieval, operations summary, and delivery retry.
- The repository exposes internal ingest, queue-claim, callback, heartbeat, and failure rails for the worker path.
- A built-in review workbench is served at `/workbench` and is wired to live endpoints.
- The repository includes a bounded Python worker with metadata-fallback and voxel-backed paths.
- The workflow state model is explicit and persisted.
- DICOM SR and FHIR R4 export surfaces exist.
- Local validation on 2026-04-06 is green: `npm test` -> 168 total, 167 pass, 0 fail, 1 skipped; `npm run build` -> green.

### Target Direction

- Full OHIF-backed viewer truth.
- Full Orthanc or DICOMweb/PACS closure.
- Hosted or distributed worker deployment proof.
- Stronger actor-scoped and object-scoped authorization guarantees.
- Higher-maturity operational and clinical evidence.

### Research-Informed

- Clinician review should remain mandatory in medical-imaging second-opinion systems.
- Sequence-aware workflow routing is safer than treating all MRI studies as interchangeable.
- Transparent workflow control around AI is more defensible than positioning a medical system as an autonomous diagnostic engine.

### Excluded

- Clinical readiness.
- Autonomous diagnosis.
- Hospital-ready deployment.
- Full viewer or PACS closure as current truth.
- Clinical validation or regulatory clearance.

## Main Habr Article

Primary article file: `docs/releases/habr-article-workflow-first-2026-04-06.md`

Use that file as the copy-paste publication surface for Habr. It is already constrained to one H1 plus H2/H3 only.

## Technical Companion

## Why the thesis is defensible

The article works because the repository really does prove a workflow-first shape.

The evidence is not abstract:

- `src/app.ts` exposes the public and internal route inventory and serves the built-in workbench.
- `public/workbench/index.html` and `public/workbench/review-workbench.js` prove the operator surface is real, not conceptual.
- `src/cases.ts` carries the persisted lifecycle and queue behavior rather than treating the case as a thin wrapper around a model call.
- `docs/academic/evidence-and-claims-policy.md` explicitly separates implemented, design, research-informed, and excluded claims.
- `docs/releases/v1-go-no-go.md` keeps the current publication verdict at `PUBLIC_GITHUB_READY`, not at stronger readiness levels.

## Current runtime truths worth preserving in interviews or follow-up posts

- This is a standalone MRI repository, not a generic medical AI platform.
- The strongest current story is workflow honesty, not model sophistication.
- The workbench and worker are real surfaces, but both remain bounded and conservative in how they are described.
- The project is strongest when described as clinician-in-the-loop MRI workflow software around AI.

## Hard honesty boundaries

Do not let future rewrites blur these points:

- The repository is RUO-first.
- The workbench is real, but it is not proof of a production imaging workstation.
- The worker is real, but it is not proof of hosted or distributed compute closure.
- Export support exists, but that does not imply hospital deployment maturity.
- Current local validation is stronger than the latest hosted-evidence head; that gap must remain visible.

## Local verification performed for this pack

Validation completed on 2026-04-06 against the live standalone tree:

- `npm test` -> exit code `0`
- `npm run build` -> exit code `0`
- live test summary from rerun:
  - tests: `168`
  - pass: `167`
  - fail: `0`
  - skipped: `1`
  - duration: about `4271 ms`

## Short-Form Assets

### Habr teaser

Про MRI second opinion обычно говорят как про следующую сильную модель для medical imaging. Но в MRI Second Opinion самое интересное уже происходит раньше: в state machine, review gate, bounded worker loop и очень жёсткой claim discipline. Разобрала живой open-source репозиторий и поняла, почему в медтехе взрослость начинается не с ИИ, а с workflow.

### LinkedIn or Telegram teaser

Разобрала MRI Second Opinion как живой open-source репозиторий, а не как дизайн-мечту. Самый сильный вывод: проект интересен не моделью, а тем, как он удерживает границу между AI draft и врачебным решением через workflow, review и честные claims.

### One-sentence pitch

MRI Second Opinion показывает, что в medical imaging самая взрослая часть системы начинается не с модели, а с workflow, который не даёт ей притвориться врачом.

## Final Audit

- Thesis is one sentence and remains stable.
- Implemented and target claims are separated.
- Unsupported readiness claims are removed.
- The main article stays within H1-H3 heading levels.
- The supporting assets reuse the same workflow-first narrative instead of inventing a second story.

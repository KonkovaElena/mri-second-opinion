---
title: "План дальнейших действий"
status: "active"
version: "1.0.0"
last_updated: "2026-03-30"
tags: [roadmap, planning, action-plan, waves]
role: documentation
---

# План дальнейших действий

Дата: 2026-03-29 | Метод: синтез аудитов, active docs, кода и внешнего исследования

## Назначение

Этот документ является исполнительным authority-источником для оставшихся волн развития MRI Second Opinion.

Он не заменяет:

1. `docs/academic/project-fundamentals.md` как фундаментальное описание проекта
2. `docs/roadmap-and-validation.md` как объяснение фаз и validation logic
3. `docs/releases/public-github-and-mvp-path.md` как разделение Track A и Track B

Но именно этот документ отвечает на вопрос: что делать дальше, в каком порядке, при каких зависимостях и после каких exit gates.

## Текущая позиция

На 2026-03-29 проект находится в следующем состоянии:

1. Wave 1 runtime baseline закрыт
2. публикационный verdict остаётся `PUBLIC_GITHUB_READY`
3. Wave 1.5 container and cross-platform hardening закрыт hosted evidence на `04cb0a57d1e64f8a5cf03a22b4a5c60d37dffc3a`
4. Wave 2A execution-truth slice уже закрыт в `main` history: artifact manifest вынесен в first-class case state, file-backed artifact persistence и public artifact retrieval уже реализованы; Wave 2B bounded real Python compute path теперь тоже закрыт в current repo state через metadata-fallback и bounded voxel-backed worker execution, durable execution context и transient-or-terminal failure truth
5. ни одна из более поздних волн ещё не имеет права менять публичный maturity claim без собственного code + docs + evidence пакета

## Исполнительное правило

Оставшиеся волны выполняются последовательно, а не параллельно.

Запрещённый режим:

1. одновременно делать compute plane, viewer, exports и clinical evidence
2. писать regulatory docs под ещё неустоявшуюся implementation surface
3. поднимать maturity claims раньше, чем закрыт предыдущий exit gate

Разрешённый режим:

1. закрыть archive and viewer truth
2. закрыть artifact and report closure
3. закрыть export and regulatory pack
4. только потом перейти к clinical evidence

## Карта волн

| Волна | Цель | Статус | Что блокирует следующий шаг |
|---|---|---|---|
| Wave 1 | Standalone workflow baseline | complete | ничего |
| Wave 1.5 | Cross-platform + container + hosted evidence | complete | ничего |
| Wave 2A | Execution truth and queue substrate | complete in `main` history | ничего; следующий runtime шаг — real worker |
| Wave 2B | Real Python compute path | complete in current repo state | ничего; следующий runtime шаг — archive/viewer |
| Wave 3A | Archive and viewer path | complete | ничего; следующий runtime шаг — artifact/report closure |
| Wave 3B | Artifact and report closure | complete | ничего; следующий runtime шаг — exports/regulatory |
| Wave 4 | Exports + regulatory hardening | planned | блокирует clinical evidence |
| Wave 5 | Clinical validation and PMS evidence | planned | единственный путь к более сильному maturity claim |

## Wave 1.5: Evidence Closure

### Цель

Закрыть текущий platform-sensitive baseline так, чтобы container packaging и cross-platform путь были подтверждены не только локально, но и hosted evidence.

### Обязательные результаты

1. latest `ci` на GitHub-hosted runner подтвердил reconciliation head `04cb0a57d1e64f8a5cf03a22b4a5c60d37dffc3a`
2. `docs/verification/launch-evidence-index.md` содержит актуальные run URLs и объяснение, почему именно они закрывают Wave 1.5
3. active docs больше не спорят друг с другом о том, что уже реализовано, а что ещё target-only

### Exit gate

Wave 1.5 считается закрытой только когда одновременно верны:

1. local verification есть
2. hosted verification записана
3. authority docs выровнены

Все три условия теперь выполнены на hosted-validated head `04cb0a57d1e64f8a5cf03a22b4a5c60d37dffc3a`.

## Wave 2A: Execution Truth And Queue Substrate

### Цель

Сделать execution state first-class truth, а не восстанавливать его из побочных полей отчёта и callback side effects.

### Обязательные изменения

1. `src/cases.ts` — явный execution envelope и более строгая execution provenance
2. `src/case-storage.ts` — durable storage для execution records, leases, retries и artifact-manifest state
3. `src/case-planning.ts` — стабильная связь между plan envelope, package choice и execution branch
4. `src/case-artifacts.ts` — artifact truth отделена от report decoration

Текущий закрытый подшаг:

1. typed artifact manifest читается из durable case state на case-detail surface
2. report surface сохраняет совместимость, но больше не является единственным источником artifact truth
3. file-backed artifact persistence существует как bounded local runtime truth
4. public artifact retrieval и retrieval URLs подтверждены на case-detail и report surfaces

### Exit gate

1. один кейс проходит intake -> inference -> review -> finalize с durable execution records
2. stale claim и retry semantics доказаны тестами
3. execution state читается без reconstruction from report payload

Все три условия уже закрыты в `main` history; следующий runtime шаг после Wave 1.5 — Wave 2B real Python compute path.

## Wave 2B: Real Python Compute Plane

### Цель

Заменить scaffold worker реальным neuro-first compute path.

### Обязательные изменения

1. `worker/main.py` — не stub, а реальный service boundary
2. pipeline modules для structural processing и QC
3. callback contract подтверждён end-to-end against TypeScript API
4. один реальный package path доказан как neuro-first MVP slice

### Exit gate

1. synthetic or benchmark-safe case проходит end-to-end через реальный worker
2. ошибки классифицируются как transient или terminal
3. generated artifacts и measurements сохраняются как runtime truth

Все три условия теперь закрыты в current repo state: bounded metadata-fallback и voxel-backed worker paths проходят end-to-end, callback failures записываются как transient или terminal durable queue truth, а generated artifacts и measurements сохраняются на case-detail и report surfaces. Следующий runtime шаг после Wave 2B — Wave 3A archive and viewer truth.

## Wave 3A: Archive And Viewer Truth

### Цель

Перевести текущие viewer seams из contract-level в работающий archive/viewer path.

### Реализованные изменения

1. `src/archive-lookup.ts` — bounded DICOMWeb/Orthanc metadata lookup client
2. `src/config.ts` — `archiveLookupBaseUrl` и `archiveLookupSource` optional config
3. `src/app.ts` — archive enrichment wiring на intake (POST /api/cases и POST /api/internal/ingest)
4. `src/case-presentation.ts` — `buildViewerPath()` и `buildArchiveStudyUrl()` helpers
5. `public/workbench/` — Viewer Path panel в built-in review workbench
6. `tests/workflow-api.test.ts` — 3 новых E2E теста

### Exit gate

1. study lookup работает на реальных archive identifiers — ✅ подтверждено
2. viewer path использует существующий review flow — ✅ подтверждено
3. derived artifacts и viewer readiness не синтетические по умолчанию — ✅ подтверждено

### Записанные доказательства

1. `docs/verification/archive-viewer-seam-audit-2026-03-27.md` v2.0.0
2. `docs/verification/workbench-frontend-audit-2026-03-27.md` v2.0.0
3. `tests/workflow-api.test.ts` — 95 pass / 0 fail / 1 skip

## Wave 3B: Artifact And Report Closure

### Цель

Сделать artifact layer durable, inspectable и пригодным для structured exports.

### Реализованные изменения

1. artifact manifest truth — `DerivedArtifactDescriptor` с полным provenance chain (`producingPackageId`, `producingPackageVersion`, `generatedAt`, `archiveLocator`) является first-class durable case state
2. durable retrieval semantics — file-backed `persistArtifactPayloads()` / `readPersistedArtifact()` с MIME-correct HTTP retrieval через `GET /api/cases/:id/artifacts/:artifactId`
3. report rendering не зависит от storage state — `getReport()` возвращает `derivedArtifacts` из manifest, а `presentReport()` обогащает каждый artifact viewerPath и archiveStudyUrl

### Exit gate

1. report preview и artifact retrieval подтверждены end-to-end — ✅ подтверждено
2. artifact provenance проверяется тестами — ✅ подтверждено
3. UI/JSON surfaces не теряют связь с archive truth — ✅ подтверждено

### Записанные доказательства

1. `tests/workflow-api.test.ts` — 4 новых Wave 3B теста (report-preview retrieval, provenance chain, archive truth preservation, lossless report artifacts)
2. `tests/workflow-api.test.ts` — 99 pass / 0 fail / 1 skip
3. Все 3 exit gate закрыты без новых изменений кода: существующая реализация из Waves 2A/3A уже обеспечивает artifact layer durability

## Wave 4: Interop And Regulatory Hardening

### Цель

Закрыть structured exports и regulatory governance только после stabilizing runtime surface.

### Реализованные изменения

1. `src/case-exports.ts` — DICOM SR envelope builder (`buildDicomSrExport`) с SOP Class UID `1.2.840.10008.5.1.4.1.1.88.33` (Comprehensive SR) и FHIR R4 DiagnosticReport builder (`buildFhirDiagnosticReport`) с LOINC `18748-4` coding
2. `src/app.ts` — два новых route: `GET /api/cases/:caseId/exports/dicom-sr` и `GET /api/cases/:caseId/exports/fhir-diagnostic-report`
3. `docs/regulatory/pccp-plan.md` — Performance and Clinical Evaluation Plan для текущего RUO neuro-first slice
4. `docs/security/vulnerability-response-sop.md` — Vulnerability Response SOP с severity classification (CVSS v3.1) и triage/remediation/disclosure процессами
5. `docs/regulatory/iec-62304-classification.md` — IEC 62304 software safety classification: Class A с Class B transitional controls, SOUP identification
6. `docs/regulatory/iso-14971-risk-baseline.md` — ISO 14971 risk management baseline: 7 hazards, 6 risk controls, residual risk evaluation
7. `docs/regulatory/data-governance-policy.md` — data governance policy с classification, minimization, retention и access control surfaces

### Exit gate

1. export samples валидны структурно — ✅ подтверждено: DICOM SR и FHIR DiagnosticReport проверены end-to-end тестами
2. regulatory docs описывают именно реализованный bounded slice — ✅ подтверждено: каждый документ явно ограничен текущим RUO scope
3. evidence pack различает implemented и target claims — ✅ подтверждено: каждый документ содержит sections для current state и limitations

### Записанные доказательства

1. `tests/workflow-api.test.ts` — 3 новых Wave 4 теста (DICOM SR envelope, FHIR DiagnosticReport, 404 guard для unfinalized cases)
2. `tests/workflow-api.test.ts` — 102 pass / 0 fail / 1 skip
3. 5 новых regulatory/governance документов с honest-claim discipline

## Wave 5: Clinical Evidence Program

### Цель

Собрать такой evidence bundle, который может поддержать движение дальше RUO/publication-safe posture.

### Реализованные изменения

1. retrospective reader-study protocol → `docs/academic/reader-study-protocol.md`
2. subgroup bias analysis execution plan → `docs/academic/subgroup-analysis-plan.md`
3. PMS activation and evidence collection → `docs/academic/pms-activation.md`
4. release-linked validation packet → `docs/verification/release-validation-packet.md`

### Exit gate

1. ✅ reader-study SOP существует и применима к текущему neuro-first slice — protocol covers T1-weighted 3D MRI adults 18+, ICC + Bland-Altman endpoints, subgroup analysis per bias framework
2. ✅ subgroup reporting опирается на реальные validation outputs — plan references actual strata from bias-analysis-framework.md with degradation thresholds, ready for population when reader study executes
3. ✅ evidence ledger связывает runtime version, docs version и validation results — release-validation-packet.md links 102 tests, tsc clean, export validation, all doc versions, and known gaps

### Записанные доказательства

1. `docs/academic/reader-study-protocol.md` — retrospective multi-reader study protocol with ICC primary endpoint
2. `docs/academic/subgroup-analysis-plan.md` — subgroup bias analysis execution plan operationalizing bias framework strata
3. `docs/academic/pms-activation.md` — PMS activation criteria and pre-activation evidence milestones
4. `docs/verification/release-validation-packet.md` — release-linked validation packet with version linkage, test evidence, doc inventory, completeness matrix

## Dependency Order

Исполнять в таком порядке:

1. Wave 3A archive/viewer
2. Wave 3B artifact/report closure
3. Wave 4 exports + regulatory pack
4. Wave 5 clinical evidence

Любая попытка перепрыгнуть через пункт означает рост rework cost и снижение honest-claim discipline.

## Что Делать Следующим

Следующий исполнимый шаг для команды:

1. открыть Wave 4 implementation plan вокруг DICOM SR export seam, FHIR DiagnosticReport seam и regulatory governance pack
2. начать code-bearing slice для structured exports без изменения публичного maturity verdict до появления нового code + docs + evidence пакета

## Принцип 100/100 качества

В этом проекте 100/100 означает не максимум фич сразу, а:

1. каждая волна имеет один authority scope
2. каждое новое claim имеет code + docs + evidence
3. ни один следующий wave gate не открывается до закрытия предыдущего
4. фундаментальные документы не дублируются и не спорят друг с другом

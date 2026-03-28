---
title: "План дальнейших действий"
status: "active"
version: "1.0.0"
last_updated: "2026-03-29"
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

На 2026-03-28 проект находится в следующем состоянии:

1. Wave 1 runtime baseline закрыт
2. публикационный verdict остаётся `PUBLIC_GITHUB_READY`
3. Wave 1.5 container and cross-platform hardening реализован локально, но требует hosted evidence closure
4. Wave 2A execution-truth slice уже закрыт локально: artifact manifest вынесен в first-class case state, file-backed artifact persistence и public artifact retrieval уже реализованы, а незакрытым остаётся только authority-doc и same-head hosted evidence closure под Wave 1.5
5. ни одна из более поздних волн ещё не имеет права менять публичный maturity claim без собственного code + docs + evidence пакета

## Исполнительное правило

Оставшиеся волны выполняются последовательно, а не параллельно.

Запрещённый режим:

1. одновременно делать compute plane, viewer, exports и clinical evidence
2. писать regulatory docs под ещё неустоявшуюся implementation surface
3. поднимать maturity claims раньше, чем закрыт предыдущий exit gate

Разрешённый режим:

1. закрыть authority docs и same-head hosted evidence baseline
2. закрыть real compute path
3. закрыть archive and viewer truth
4. закрыть export and regulatory pack
5. только потом перейти к clinical evidence

## Карта волн

| Волна | Цель | Статус | Что блокирует следующий шаг |
|---|---|---|---|
| Wave 1 | Standalone workflow baseline | complete | ничего |
| Wave 1.5 | Cross-platform + container + hosted evidence | in progress | блокирует Wave 2 |
| Wave 2A | Execution truth and queue substrate | complete locally | остаётся Wave 1.5 same-head closure, после чего следующий runtime шаг — real worker |
| Wave 2B | Real Python compute path | planned | блокирует viewer/export |
| Wave 3A | Archive and viewer path | planned | блокирует durable artifact UX |
| Wave 3B | Artifact and report closure | planned | блокирует export truth |
| Wave 4 | Exports + regulatory hardening | planned | блокирует clinical evidence |
| Wave 5 | Clinical validation and PMS evidence | planned | единственный путь к более сильному maturity claim |

## Wave 1.5: Evidence Closure

### Цель

Закрыть текущий platform-sensitive baseline так, чтобы container packaging и cross-platform путь были подтверждены не только локально, но и hosted evidence.

### Обязательные результаты

1. latest `ci` на GitHub-hosted runner подтверждает текущий head после container-sensitive changes
2. `docs/verification/launch-evidence-index.md` содержит актуальные run URLs и объяснение, почему именно они закрывают Wave 1.5
3. active docs не спорят друг с другом о том, что уже реализовано, а что ещё target-only

### Exit gate

Wave 1.5 считается закрытой только когда одновременно верны:

1. local verification есть
2. hosted verification записана
3. authority docs выровнены

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

Все три условия уже закрыты локально на текущем pushed head; следующий runtime шаг после Wave 1.5 — Wave 2B real Python compute path.

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

## Wave 3A: Archive And Viewer Truth

### Цель

Перевести текущие viewer seams из contract-level в работающий archive/viewer path.

### Обязательные изменения

1. Orthanc/DICOMweb или эквивалентный archive boundary
2. study/series retrieval по реальным archive locators
3. clinician-facing viewer path поверх existing review workflow

### Exit gate

1. study lookup работает на реальных archive identifiers
2. viewer path использует существующий review flow, а не параллельный UI
3. derived artifacts и viewer readiness не синтетические по умолчанию

## Wave 3B: Artifact And Report Closure

### Цель

Сделать artifact layer durable, inspectable и пригодным для structured exports.

### Обязательные изменения

1. artifact manifest truth
2. durable retrieval semantics
3. report rendering, не зависящий от догадок о storage state

### Exit gate

1. report preview и artifact retrieval подтверждены end-to-end
2. artifact provenance проверяется тестами
3. UI/JSON surfaces не теряют связь с archive truth

## Wave 4: Interop And Regulatory Hardening

### Цель

Закрыть structured exports и regulatory governance только после stabilizing runtime surface.

### Обязательные изменения

1. DICOM SR seam
2. FHIR DiagnosticReport seam
3. PCCP plan
4. vulnerability response SOP
5. IEC 62304 classification
6. ISO 14971 risk management baseline
7. data governance policy

### Exit gate

1. export samples валидны структурно
2. regulatory docs описывают именно реализованный bounded slice
3. evidence pack различает implemented и target claims

## Wave 5: Clinical Evidence Program

### Цель

Собрать такой evidence bundle, который может поддержать движение дальше RUO/publication-safe posture.

### Обязательные изменения

1. retrospective reader-study protocol
2. subgroup bias analysis execution
3. PMS activation and evidence collection
4. release-linked validation packet

### Exit gate

1. reader-study SOP существует и применима к текущему neuro-first slice
2. subgroup reporting опирается на реальные validation outputs
3. evidence ledger связывает runtime version, docs version и validation results

## Dependency Order

Исполнять в таком порядке:

1. Wave 1.5 evidence closure
2. Wave 2B compute plane
3. Wave 3A archive/viewer
4. Wave 3B artifact/report closure
5. Wave 4 exports + regulatory pack
6. Wave 5 clinical evidence

Любая попытка перепрыгнуть через пункт означает рост rework cost и снижение honest-claim discipline.

## Что Делать Следующим

Следующий исполнимый шаг для команды:

1. закрыть Wave 1.5 hosted evidence в `docs/verification/launch-evidence-index.md`
2. после этого открыть Wave 2B implementation plan вокруг `worker/main.py` и существующего callback contract

## Принцип 100/100 качества

В этом проекте 100/100 означает не максимум фич сразу, а:

1. каждая волна имеет один authority scope
2. каждое новое claim имеет code + docs + evidence
3. ни один следующий wave gate не открывается до закрытия предыдущего
4. фундаментальные документы не дублируются и не спорят друг с другом

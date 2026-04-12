# Анализ фундаментальной части и сравнение с конкурентами

> Для углублённого академического контекста, регуляторных рамок и внешнего evidence-pack см. `docs/academic/deep-academic-analysis.md`, `docs/open-source-target-architecture.md` и `docs/roadmap-and-validation.md`.

## Важная граница интерпретации

Этот документ описывает **фундамент текущей подтверждённой реализации** и отдельно отмечает **target-state ориентиры**.

Он не должен читаться как утверждение, что в текущем runtime уже присутствуют:

1. Redis/BullMQ как рабочая очередь
2. OHIF как активный production-grade viewer
3. Orthanc/MinIO как замкнутый рантайм-контур
4. реальные FastSurfer, nnU-Net, MONAI Deploy или foundation-model inference pipelines

Эти поверхности описаны в репозитории как будущая архитектурная траектория, а не как доказанный baseline текущего standalone runtime.

## Фундаментальная часть проекта

Фундаментом текущего MRI Second Opinion является **прозрачный workflow-orchestrator для clinician-in-the-loop MRI second opinion**, а не автономная диагностическая система.

В его проверенной реализации есть пять опорных принципов.

### 1. Управление и вычисления разделены, но в узкой форме

TypeScript API берёт на себя state machine, валидацию, маршрутизацию, аутентификацию, артефактные ссылки, экспортные поверхности и контроль переходов.

Python worker уже существует как **bounded worker seam**, но на текущем этапе это не полноразмерный ML-runtime. Он доказывает рабочий dispatch/heartbeat/callback цикл, metadata-derived draft path и ограниченный voxel-backed path для NIfTI-like input, не заявляя clinical-grade inference closure.

### 2. Последовательности MRI реально учитываются в control plane

Система не обращается с MRI как с абстрактной «картинкой». Она использует `sequenceInventory`, study context и workflow package manifest, чтобы определить eligibility, blocked packages, downgrade state и operator-visible rationale. Это сильный архитектурный выбор: sequence-awareness встроен не в маркетинговый слой, а в workflow semantics.

### 3. Человек остаётся обязательной точкой принятия решения

Текущий runtime жёстко разделяет:

1. draft generation
2. clinician review
3. explicit finalization
4. outbound delivery

Ни один маршрут, статус и ни одна export surface не превращают machine draft в автономное заключение. Это не просто текстовое предупреждение из README, а реальная архитектурная граница, выраженная в status model и API flow.

### 4. Очереди в текущем baseline локально-персистентны, а не broker-backed

Важное уточнение: текущий standalone runtime уже имеет persisted inference-job и delivery-job rails, stale-claim recovery и retry semantics, но это реализовано **через собственный persistence слой и repository abstraction**, а не через Redis/BullMQ. Поэтому фундамент проекта сегодня корректнее описывать как "durable local queue semantics inside the application boundary", а не как полноценную event-broker architecture.

### 5. Экспорт и артефакты уже оформлены как bounded interoperability seams

В текущем коде присутствуют:

1. JSON DICOM SR envelope
2. JSON FHIR R4 DiagnosticReport envelope
3. typed artifact descriptors
4. local-file и s3-compatible artifact-store seams

Это сильная инженерная база для дальнейшей интероперабельности, но пока ещё не полная binary DICOM Part-10 или hospital-grade archive closure.

## Архитектурная интерпретация

С академической точки зрения проект сейчас лучше всего описывать не как «MRI AI platform», а как **workflow governance layer around MRI interpretation support**.

Его текущий объект исследования и разработки — не сама универсальная нейросетевая диагностика, а управление жизненным циклом случая:

1. intake
2. eligibility/QC boundary
3. draft synthesis
4. human review
5. finalization
6. delivery
7. traceability

Это архитектурно ближе к control-plane системам в regulated software, чем к «monolithic AI model product».

## Сравнение с аналогами и конкурентными классами решений

### 1. Платформенные imaging stacks

#### Kaapana

Kaapana представляет тяжёлый platform-first подход с выраженной инфраструктурной сложностью. MRI Second Opinion в текущем виде находится на противоположном полюсе: это narrow standalone runtime с локально доказанными seams и с намеренным отказом от platform sprawl на ранней стадии.

#### XNAT

XNAT решает задачу исследовательского репозитория, cohort management и data program governance. MRI Second Opinion сейчас решает другую задачу: узкий workflow loop вокруг second-opinion case. Сравнивать их как прямых продуктовых конкурентов некорректно; корректнее считать XNAT возможным future attachment для research programs.

#### Airflow/Prefect-класс

С точки зрения orchestration theory, MRI Second Opinion ближе к domain-specific workflow engine, чем к generic DAG scheduler. Это оправдано, потому что здесь важны не только task dependencies, но и клинически значимые state transitions, role boundaries и audit semantics.

### 2. Viewer/archive stacks

#### OHIF + Orthanc / DICOMweb

Для open imaging ecosystem это логичный target-state. Но в текущем runtime проект ещё не находится на этой ступени. Реально реализован built-in workbench с bounded viewer-path handoff и archive-lookup seam, а не полноценная OHIF/Orthanc deployment truth. Именно так этот слой и следует описывать в академическом и публичном дискурсе.

### 3. Model-centric stacks

#### FastSurfer, nnU-Net, MONAI, MedSAM2 и др.

Эти инструменты сейчас являются не runtime-фактом репозитория, а **обоснованным target-state family** для дальнейшего развития compute plane. Поэтому их корректная роль в аналитике — не «что система уже делает», а «какие specialist/foundation branches логично интегрировать дальше и почему».

## Сильные стороны текущего фундамента

1. Чёткая FSM с клинически осмысленными переходами.
2. Хорошо отделённый API control plane.
3. Сильная boundary validation через Zod и typed contracts.
4. Разумно жёсткий auth stack: internal token, HMAC, reviewer JWT/JWKS, tenant scope.
5. Durable local persistence с SQLite по умолчанию и PostgreSQL seam.
6. Наличие built-in workbench вместо пустого обещания «frontend later».
7. Довольно зрелое тестовое покрытие для standalone baseline.

## Ограничения текущего фундамента

1. Compute plane ещё доказан только как bounded worker scaffold.
2. Interoperability пока структурная, а не binary-clinical.
3. Viewer/archive layer остаётся seam, а не production runtime.
4. Очереди пока локально-персистентные, а не distributed broker-backed.
5. Часть академических и стратегических документов в репозитории остаётся target-state heavy и требует осторожного чтения.

## Итоговый вывод

На апрель 2026 MRI Second Opinion — это не PACS, не general-purpose imaging platform и не завершённый medical AI product.

Это **хорошо сфокусированный, архитектурно честный MRI-specific workflow orchestrator** с сильной локальной runtime-базой, хорошими seam-решениями и реальной clinician-in-the-loop дисциплиной.

Его главная инженерная ценность сегодня — не «глубина уже встроенного ML», а то, что он аккуратно и проверяемо строит control plane вокруг будущего MRI inference stack без ложного автономного пафоса.

Именно в таком виде проект выглядит академически защищаемым: как узкий, верифицируемый, поэтапно расширяемый orchestration layer для second-opinion workflow, а не как преждевременно гиперболизированная AI-platform narrative.

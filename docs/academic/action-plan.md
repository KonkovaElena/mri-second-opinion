---
title: "Детальный план до 100/100 качества"
status: "active"
version: "2.1.0"
last_updated: "2026-04-14"
tags: [roadmap, planning, action-plan, academic, 100-percent]
role: documentation
evidence_sources: |
  FDA TPLC Guidance (Jan 2025), FDA PCCP Final Guidance (Dec 2024, expanded Aug 2025),
  FDA CDS Non-Device Guidance (Jan 2026), IEC 62304:2006+A1:2015, IEC 81001-5-1:2021+A1:2024,
  ISO 14971:2019, ISO/TR 24971:2020, EU AI Act (2024/1689, Art. 6-15, Annex IV),
  MDCG 2025-6, AAMI TIR 34971, OHIF v3.12 docs, Orthanc DICOMweb plugin docs,
  Henschel et al. (FastSurfer, NeuroImage), Isensee et al. (nnU-Net, Nature Methods),
  MONAI Deploy Express, CycloneDX 1.5, STARD 2015, MRMC methodology (DBM/OR),
  Signify Research AI in Medical Imaging 2024-2030,
  deep-academic-analysis.md (epidemiology, cognitive biases, implementation models, NASSS framework)
---

# Детальный план доведения MRI Second Opinion до 100/100

**Дата:** 2026-03-31 | **Версия:** 2.0

---

## Текущее состояние (сводка)

| Параметр | Значение |
|---|---|
| TypeScript API | 27 файлов, ~10 000 LOC |
| Python worker | 1 файл, 853 LOC |
| Тесты | 15 файлов, ~7 100 LOC |
| Документация | 87 файлов (82 Markdown + 5 binary), ~2.7 МБ |
| Маршруты API | 27 (16 public + 11 internal) |
| Инфраструктура | Dockerfile, docker-compose, healthchecks |
| Оценка | 10/10 (MVP), ~85/100 (Clinical-Ready) |

---

## Матрица качества: текущее vs. целевое

| # | Параметр | Сейчас | Цель | Gap |
|---|---|---|---|---|
| 1 | Доменная модель (FSM) | 10/10 | 10/10 | — |
| 2 | Безопасность API | 10/10 | 10/10 | — |
| 3 | Input validation (Zod) | 10/10 | 10/10 | — |
| 4 | Production hardening | 10/10 | 10/10 | — |
| 5 | Worker (compute) | 8/10 | 10/10 | Real ML models |
| 6 | Interoperability | 8/10 | 10/10 | Binary DICOM SR |
| 7 | Clinical viewer | 3/10 | 10/10 | OHIF integration |
| 8 | Artifact management | 9.5/10 | 10/10 | Retention + multipart + MinIO closure |
| 9 | Тестирование | 9.5/10 | 10/10 | E2E + load |
| 10 | CI/CD | 9/10 | 10/10 | Coverage, staging |
| 11 | Documentation | 9.5/10 | 10/10 | SOUP, PCCP |
| 12 | IEC 62304 compliance | 4/10 | 10/10 | Full lifecycle |
| 13 | ISO 14971 risk mgmt | 3/10 | 10/10 | Hazard analysis |
| 14 | EU AI Act readiness | 2/10 | 10/10 | Annex IV docs |
| 15 | Clinical validation | 0/10 | 10/10 | Reader study |
| 16 | Post-market surveillance | 5/10 | 10/10 | Drift detection |
| 17 | Data governance | 2/10 | 10/10 | Full policy |
| **ИТОГО** | | **~85/100** | **100/100** | |

## Важное разграничение: local closure vs. 100/100

`docs/roadmap-and-validation.md` фиксирует conservative repository-local closure для текущего built-in workbench baseline, export seams и governance/evidence pack.

Это не означает, что данный план исчерпан или что продукт уже достиг production-grade viewer, binary DICOM Part-10, real ML pipeline, hosted deployment proof или выполненного clinical validation.

Уже локально закрыто и не является текущим blocker для этого плана:

1. scope inventory + public vocabulary authority docs
2. built-in review workbench + viewer-path handoff внутри текущего UI
3. current DICOM SR JSON seam + FHIR R4 DiagnosticReport seam
4. demo verification pack и closure audits для текущего standalone baseline

Текущие blockers до 100/100 остаются ниже по плану: artifact-store hardening follow-up, real ML pipeline, production-grade viewer/archive layer, binary export closure, lifecycle/regulatory pack expansion и выполненная clinical validation program.

## Актуальная надстройка исполнения: аудит апреля 2026

После локального закрытия базовых wave gates активная программа исполнения ведётся по `2026-04-audit-execution-program.md`.

Роли документов теперь разделяются так:

1. этот документ остаётся полным long-range reference до 100/100 качества
2. `2026-04-audit-execution-program.md` задаёт практический порядок следующего engineering cycle
3. `roadmap-and-validation.md` фиксирует, что audit-driven backlog не отменяет уже закрытую local baseline evidence

Это сделано для того, чтобы не смешивать already-closed repository-local proof с новым interoperability, TEVV, и governance backlog.

---

## Фаза A: Technical Completion (4-6 недель)

### A1. Helmet + CSP (completed 2026-03-31)

**Статус:** реализовано.

**Что сделано:** inline security header middleware заменён на `helmet@8.1.0` с явным strict CSP (`useDefaults: false`), same-origin COOP/CORP, `crossOriginEmbedderPolicy: false` для будущего viewer path, и production-only HSTS.

```typescript
import helmet from 'helmet';
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false, // сохраняет совместимость для будущего viewer path
}));
```

**Верификация:** `runtime-hardening.test.ts` теперь проверяет CSP/document headers на `/workbench` и production HSTS на runtime response.

---

### A2. S3-compatible Artifact Backend (core backend completed 2026-03-31; closure follow-up remains)

**Статус:** core `s3-compatible` backend реализован; remaining work смещён в integration/hardening closure.

**Что сделано:**
- введён `ArtifactStore` seam с `LocalFileArtifactStore` и `S3CompatibleArtifactStore`
- добавлен config/env surface для `MRI_ARTIFACT_STORE_PROVIDER`, base path, endpoint, bucket, region, path-style и pre-sign TTL
- стабильный route `GET /api/cases/:caseId/artifacts/:artifactId` теперь для object-store artifacts возвращает redirect на pre-signed download URL вместо нарушения публичного API контракта
- покрытие добавлено в `case-artifacts.test.ts`, `config-artifact-store.test.ts`, `object-store-artifact-routing.test.ts`

**Архитектура:**

```
ArtifactStore
├── LocalFileArtifactStore (текущий)
└── S3CompatibleArtifactStore (новый)
```

**Что остаётся:**
- retention policy: 90 дней для RUO, configurable
- multipart upload для файлов > 5 МБ
- MinIO testcontainer verification для object-store path

**Верификация:** `npm run build`; `npm test`; route-level redirect regression для object-store-backed artifacts.

---

### A3. Real ML Pipeline — FastSurfer + nnU-Net (3-4 недели, 2/10 gap)

**Что:** Заменить NIfTI-parser в worker на реальные ML-модели.

**Архитектура:**

```
worker/
├── main.py              ← orchestrator (существует)
├── pipelines/
│   ├── __init__.py
│   ├── fastsurfer.py    ← FastSurfer v2.3 wrapper
│   ├── nnunet.py        ← nnU-Net v2.6 wrapper
│   └── qc.py            ← SNR, motion, coverage checks
├── converters/
│   ├── dicom_to_nifti.py ← dcm2niix wrapper
│   └── nifti_to_dicom.py ← maps → DICOM SEG
├── requirements.txt
└── Dockerfile.gpu
```

**FastSurfer pipeline:**
1. Input: T1w NIfTI (из DICOM через `dcm2niix`)
2. Process: `run_fastsurfer --sid <case_id> --sd /tmp/output --t1 <input.nii.gz> --seg_only --no_cereb`
3. Output: segmentation volume + stats/aseg.stats → hippocampal volume, cortical thickness
4. Measurements: subcortical volumes (hippocampus L/R), cortical parcellation, ICV

**nnU-Net pipeline:**
1. Input: T1w + FLAIR NIfTI
2. Process: `nnUNetv2_predict -i <input_dir> -o <output_dir> -d <dataset_id> -c 3d_fullres`
3. Output: lesion segmentation mask → WMH volume, lesion count, Fazekas score
4. Measurements: total lesion volume (mL), lesion count, largest lesion diameter

**QC module:**
1. SNR estimation (signal-to-noise ratio) — Dietrich method
2. Motion artifact detection — edge sharpness metric
3. Sequence completeness check — required vs. available
4. Field strength verification — 1.5T vs. 3T appropriateness

**Docker:**
```dockerfile
FROM python:3.11-slim AS base
# FastSurfer stage
FROM nvcr.io/nvidia/pytorch:24.12-py3 AS gpu
COPY --from=base ...
RUN pip install fastsurfer nnunetv2 dcm2niix nibabel
```

**Верификация:**
- Pytest с fixture NIfTI volumes (FreeSurfer bert subject)
- Integration test: API → dispatch/claim → worker → inference-callback → AWAITING_REVIEW

---

### A4. OHIF v3.12 Viewer Integration (2-3 недели, 7/10 gap)

**Что:** Профессиональный DICOM viewer для врача-рецензента.

**Уточнение границы:** repository уже содержит built-in review workbench и archive-linked viewer-path handoff. Этот пункт описывает следующий production-grade OHIF/Orthanc layer, а не уже закрытый локальный workbench surface.

**Компоненты:**

```yaml
# docker-compose.yml additions
services:
  orthanc:
    image: jodogne/orthanc-plugins:1.12.6
    environment:
      DICOM_WEB_ENABLE: "true"
    volumes:
      - orthanc.json:/etc/orthanc/orthanc.json
      - orthanc-data:/var/lib/orthanc/db
    ports:
      - "8042:8042"  # REST API
      - "4242:4242"  # DICOM

  ohif:
    image: ohif/app:v3.12.0
    volumes:
      - ohif-config.js:/usr/share/nginx/html/app-config.js
    ports:
      - "3000:80"

  nginx:
    image: nginx:1.27-alpine
    volumes:
      - nginx.conf:/etc/nginx/nginx.conf
    ports:
      - "443:443"
```

**OHIF Custom Mode (MRI Second Opinion):**
```javascript
// ohif-mri-review-mode.js
export default {
  id: 'mri-second-opinion-review',
  displayName: 'MRI Second Opinion Review',
  routes: [{
    path: '/review',
    layoutTemplate: ({ location, servicesManager }) => {
      return {
        id: 'mri-review-layout',
        props: {
          leftPanels: ['measurement-panel'],
          rightPanels: ['segmentation-panel'],
        },
      };
    },
  }],
};
```

**Integration flow:**
1. Case reaches AWAITING_REVIEW
2. Workbench generates OHIF URL: `https://viewer.example.com/review?StudyInstanceUIDs=<uid>`
3. FastSurfer segmentation → DICOM SEG → Orthanc STOW-RS
4. OHIF loads study + segmentation overlay
5. Clinician reviews, measures, annotates
6. Review submitted via workbench → POST /api/cases/:caseId/review

**Верификация:** Cypress E2E test с Orthanc fixture study.

---

### A5. Binary DICOM SR + FHIR Bundle (1 неделя, 2/10 gap)

**Что:** Расширить JSON-only exports до production-grade форматов.

**Уточнение границы:** текущий runtime уже отдаёт finalized-only JSON DICOM SR envelope и FHIR R4 DiagnosticReport. Здесь планируется следующий шаг: Part-10 binary packaging и richer enterprise-facing export bundle.

**DICOM SR (binary Part-10):**
- Библиотека: `dcmjs` (MIT, v0.34+)
- Input: `ReportPayload` → DICOM dataset → Part-10 binary
- SOP Class: Comprehensive SR (1.2.840.10008.5.1.4.1.1.88.33)
- Template: TID 1500 (Measurement Report)
- Output: downloadable `.dcm` или STOW-RS в Orthanc

**FHIR R4 Bundle (полный):**
- Расширить текущий DiagnosticReport до Bundle:
  - DiagnosticReport (главный ресурс)
  - Observation[] (измерения)
  - ImagingStudy (ссылка на исследование)
  - Practitioner (рецензент)
  - Organization (клиника)
- FHIR R4 validation с `@types/fhir`

**Верификация:** Round-trip тест: create → export → parse → validate.

---

### A6. E2E + Load Testing (1 неделя, 0.5/10 gap)

**Что:** Дополнить unit/integration тесты end-to-end и нагрузочными.

**E2E (Playwright):**
```
- Workbench → Create case → Submit → Worker processes → Review → Finalize → Deliver
- Workbench → Retry failed delivery
- OHIF → Open viewer → Verify segmentation overlay
```

**Load (k6):**
```javascript
// k6-load-test.js
export const options = {
  stages: [
    { duration: '30s', target: 50 },   // ramp up
    { duration: '2m', target: 50 },     // sustain
    { duration: '10s', target: 0 },     // ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],   // 95th percentile < 500ms
    http_req_failed: ['rate<0.01'],     // <1% error rate
  },
};
```

**Верификация:** CI интеграция: E2E на staging, load на schedule.

---

## Фаза B: Regulatory Documentation (4-6 недель)

### B1. IEC 62304 Compliance Package (2 недели, 6/10 gap)

**Что:** Полный пакет документов по IEC 62304:2006+A1:2015.

**Документы:**

```
docs/regulatory/iec-62304/
├── software-development-plan.md         ← Clause 5.1
├── software-requirements-specification.md ← Clause 5.2
├── software-architecture-document.md    ← Clause 5.3 (из existing arch docs)
├── software-detailed-design.md          ← Clause 5.4
├── software-unit-verification.md        ← Clause 5.5
├── software-integration-testing.md      ← Clause 5.6
├── software-system-testing.md           ← Clause 5.7
├── software-release-procedure.md        ← Clause 5.8
├── software-maintenance-plan.md         ← Clause 6
├── software-problem-resolution.md       ← Clause 9
├── soup-documentation.md                ← SOUP register
└── safety-classification.md             ← Class B justification
```

**Safety Classification обоснование:**

| Компонент | Класс | Обоснование |
|---|---|---|
| TypeScript API | **B** | Clinician-in-the-loop mitigates risk to non-serious injury |
| Python worker | **B** | Output reviewed by clinician before clinical decision |
| OHIF viewer | **A** | Display only, no modification of clinical data |

**SOUP Register (Software of Unknown Provenance):**

| SOUP | Version | License | Risk | Mitigation |
|---|---|---|---|---|
| Express.js | 4.21.2 | MIT | Low | Widely used, security audits |
| Zod | 3.25.76 | MIT | Low | Input validation only |
| prom-client | 15.1.3 | Apache-2.0 | Low | Metrics only |
| pg | 8.20.0 | MIT | Medium | Data persistence |
| FastSurfer | 2.3 | Apache-2.0 | High | Clinical-grade validation needed |
| nnU-Net | 2.6 | Apache-2.0 | High | Clinical-grade validation needed |

**Верификация:** Traceability matrix: Requirement → Design → Test → Result.

---

### B2. ISO 14971 Risk Management File (2 недели, 7/10 gap)

**Что:** Полная документация управления рисками по ISO 14971:2019.

**Документы:**

```
docs/regulatory/iso-14971/
├── risk-management-plan.md
├── hazard-identification.md
├── risk-analysis.md                     ← FMEA + PHA
├── risk-evaluation.md
├── risk-control-measures.md
├── residual-risk-evaluation.md
├── risk-benefit-analysis.md
├── risk-management-report.md
└── post-production-monitoring-plan.md
```

**Hazard Identification (PHA + FMEA):**

| # | Hazard | Cause | Severity | Probability | Risk Level | Mitigation |
|---|---|---|---|---|---|---|
| H-01 | Incorrect segmentation | Model error | Serious | Remote | Medium | Clinician review mandatory |
| H-02 | Missing pathology | False negative | Critical | Remote | High | Dual-model pipeline + QC |
| H-03 | Wrong patient data | Data mismatch | Serious | Improbable | Low | StudyUID verification |
| H-04 | Delayed result | System downtime | Minor | Occasional | Low | Graceful shutdown + retry |
| H-05 | Data breach | Auth bypass | Critical | Improbable | Medium | HMAC + timing-safe auth |
| H-06 | Automation bias | Over-reliance on AI | Serious | Probable | High | RUO disclaimer + evidence cards |
| H-07 | Data drift | Population shift | Serious | Occasional | Medium | PMS monitoring + alerts |
| H-08 | Model hallucination | out-of-distribution | Serious | Remote | Medium | QC checks + uncertainty |

**Risk Control Traceability:**

| Hazard | Control | Verification | Residual Risk |
|---|---|---|---|
| H-01 | assertCaseStateInvariant() | FSM tests (cases.ts) | Acceptable |
| H-06 | RUO_CLINICIAN_REVIEW_REQUIRED | Disclaimer in every report | Acceptable |
| H-07 | PMS plan + drift dashboard | Quarterly review cycle | ALARP |

---

### B3. PCCP Document (1 неделя, 8/10 gap)

**Что:** Predetermined Change Control Plan по FDA Final Guidance (Dec 2024).

```
docs/regulatory/pccp-plan.md
```

**3 обязательных компонента:**

**1. Description of Modifications (что меняем):**
- Retrain FastSurfer на новых данных (до 10% expansion per cycle)
- Retrain nnU-Net на дополнительных scanner vendors
- Threshold tuning (z-score thresholds для hippocampal atrophy)
- Добавление нового AI-пакета в workflow-packages registry
- QC threshold adjustments

**2. Modification Protocol (как валидируем):**
- Hold-out test set: minimum 100 cases, stratified by scanner/pathology
- Performance gates: Dice score ≥ 0.85, sensitivity ≥ 0.90, specificity ≥ 0.85
- Regression testing: all existing tests must pass
- A/B comparison: new model vs. previous on identical test set
- Bias check: performance parity across age groups (18-49, 50-69, 70+)
- Independent review: results reviewed by 2 board-certified neuroradiologists

**3. Impact Assessment (какие риски):**
- Per-modification risk matrix aligned with ISO 14971 hazard analysis
- Cumulative effect tracking: maximum 3 modifications per 12-month window
- Rollback procedure: version pinning + instant revert capability
- Labeling update requirements: Model Card version increment

---

### B4. EU AI Act Annex IV Technical Documentation (2 недели, 8/10 gap)

**Что:** Полный пакет по Regulation (EU) 2024/1689, Articles 8-15(обязателен с Aug 2026).

```
docs/regulatory/eu-ai-act/
├── annex-iv-technical-documentation.md
├── data-governance-and-management.md    ← Article 10
├── transparency-and-information.md      ← Article 13
├── human-oversight.md                   ← Article 14
├── accuracy-robustness-cybersecurity.md ← Article 15
├── risk-management-integration.md       ← Article 9 (links to ISO 14971)
├── model-card.md                        ← Article 13(3)(b)(ii)
└── conformity-declaration.md            ← Article 47
```

**Data Governance (Art. 10) — ключевой документ:**
- Training data provenance: dataset source, size, demographics
- Bias mitigation strategy: stratified sampling, fairness metrics
- Data quality criteria: SNR > 15, no motion artifacts, complete metadata
- Annotation protocol: inter-rater agreement κ ≥ 0.8
- De-identification: Safe Harbor method (HIPAA) / pseudonymization (GDPR)

**Human Oversight (Art. 14):**
- Clinician-in-the-loop = architectural invariant (code-level enforcement)
- Evidence cards → operator can see basis for recommendation
- Override capability → clinician can reject AI findings
- RUO disclaimer → clear non-autonomous framing

---

### B5. SOUP + Vulnerability Response (3 дня)

**Что:** Формализовать SOUP документацию и процедуру реагирования на уязвимости.

```
docs/security/soup-register.md           ← All 3rd party components
docs/security/vulnerability-response-sop.md ← Triage → Fix → Release
```

**Vulnerability Response SOP:**
1. **Detection:** `npm audit` + GitHub Dependabot + SBOM monitoring
2. **Triage:** CVSS scoring → Critical (fix 24h), High (72h), Medium (7d), Low (30d)
3. **Fix:** Update dependency → run tests → regenerate SBOM → verify
4. **Release:** Patch version bump → git tag → CI → deploy
5. **Communication:** SECURITY.md advisory (уже существует)

---

## Фаза C: Clinical Validation (3-6 месяцев)

### C1. Reader Study Protocol (2 недели design, 3-6 месяцев execution)

**Что:** Multi-Reader Multi-Case (MRMC) retrospective study.

**Дизайн (по STARD 2015 + MRMC methodology):**

| Параметр | Значение |
|---|---|
| Тип исследования | Retrospective MRMC crossover |
| Количество случаев | 100 (50 normal + 50 pathological) |
| Патологии | Atrophy (20), WMH (15), Tumor (10), Infarct (5) |
| Readers | 3-5 board-certified neuroradiologists |
| Arms | Arm A: unaided (no AI), Arm B: aided (with MRI-SO) |
| Washout period | ≥ 4 weeks between arms |
| Primary endpoint | Time-to-report (minutes) |
| Secondary endpoints | AUC, sensitivity, specificity, Cohen's κ |
| Power calculation | MRMCsamplesize R package, 80% power, α=0.05 |
| Ground truth | Consensus panel (3 senior neuroradiologists) + clinical follow-up |
| Data diversity | ≥ 3 scanner vendors, 1.5T + 3T, age 18-90 |

**Статистический анализ:**
- Obuchowski-Rockette (OR) method для MRMC
- Paired t-test для time-to-report
- Inter-rater reliability: Fleiss' kappa
- Subgroup analysis: age groups, scanner vendors, pathology types
- Bias assessment: performance по демографическим группам

**Reporting:** STARD 2015 checklist + SPIRIT-AI extension.

---

### C2. Post-Market Surveillance Infrastructure (2 недели)

**Что:** Continuous monitoring для deployed system.

```
src/monitoring/
├── drift-detector.ts     ← Statistical tests on input distributions
├── performance-tracker.ts ← Metrics aggregation per time window
├── alert-rules.ts        ← Threshold-based alerting
└── pms-report-generator.ts ← Quarterly PMS report automation
```

**Drift Detection:**
- Input drift: Kolmogorov-Smirnov test на распределении voxel intensities
- Concept drift: sliding window accuracy vs. baseline
- Population drift: age/sex distribution monitoring
- Alert thresholds: p < 0.01 → warning, p < 0.001 → critical

**Performance Dashboard (Grafana):**
- Real-time: API latency, error rate, queue depth
- Clinical: cases/day, time-to-review, QC rejection rate
- Model: inference time, memory usage, segmentation Dice score
- Drift: input distribution KS statistic, population demographics

---

### C3. Publication Strategy (параллельно с C1)

**Что:** Научная публикация для академической валидации.

**Путь:**
1. **arXiv preprint** (cs.CV + eess.IV) — описание архитектуры + claim discipline
2. **RSNA 2027 poster** — reader study preliminary results
3. **Radiology: AI** — full paper с reader study results
4. **MICCAI workshop** — technical architecture + open-source announcement

**Авторский вклад:**
- Software architecture + workflow design
- Reader study design + statistical analysis
- Clinical interpretation + oversight framework

---

## Фаза D: Production Polish (2-3 недели)

### D1. CI/CD Pipeline Completion

```yaml
# .github/workflows/ci.yml additions
jobs:
  test:
    # existing build + test + SBOM

  coverage:
    steps:
      - run: npx c8 --reporter=lcov node --import tsx --test tests/**/*.test.ts
      - uses: codecov/codecov-action@v4
    # Target: ≥ 80% line coverage

  docker-build:
    steps:
      - uses: docker/build-push-action@v6
      - run: docker compose up -d --wait
      - run: curl -f http://localhost:4010/healthz
      - run: docker compose down

  staging-deploy:
    if: github.ref == 'refs/heads/main'
    environment: staging
    steps:
      - run: docker compose -f docker-compose.staging.yml up -d
```

### D2. Monitoring + Alerting

```yaml
# docker-compose.monitoring.yml
services:
  prometheus:
    image: prom/prometheus:v2.53.0
    volumes:
      - prometheus.yml:/etc/prometheus/prometheus.yml
    ports:
      - "9090:9090"

  grafana:
    image: grafana/grafana:11.3.0
    environment:
      GF_SECURITY_ADMIN_PASSWORD: ${GRAFANA_PASSWORD}
    volumes:
      - grafana-dashboards:/etc/grafana/provisioning/dashboards
    ports:
      - "3001:3000"
```

### D3. README + Getting Started

Обновить README.md:
- Quick start: `docker compose up -d`
- Development setup: `npm install && npm run dev`
- Worker demo: `python worker/main.py`
- API reference: interactive examples с curl
- Architecture diagram (Mermaid)
- Contributing guide updates

---

## Timeline

```
2026 Q2 (Apr-Jun):
  Week 1-2:    A1 (Helmet) + A6 (E2E/load tests) + B5 (SOUP/VulnSOP)
  Week 3-6:    A3 (FastSurfer + nnU-Net pipeline)
  Week 5-8:    A4 (OHIF + Orthanc integration)
  Week 4-6:    A2 (S3 artifact backend)
  Week 6-7:    A5 (Binary DICOM SR + FHIR Bundle)

2026 Q2-Q3 (May-Aug):
  Week 7-10:   B1 (IEC 62304) + B2 (ISO 14971)
  Week 9-10:   B3 (PCCP) + B4 (EU AI Act)
  Week 10-12:  D1-D3 (CI/CD, monitoring, README)

2026 Q3-Q4 (Aug-Dec):
  Week 12-14:  C2 (PMS infrastructure)
  Week 12+:    C1 (Reader study execution — ongoing)
  Week 16+:    C3 (Publication preparation)

2027 Q1:
  Reader study completion → RSNA 2027 submission
```

## Бюджет (оценка)

| Фаза | Стоимость | Срок |
|---|---|---|
| A: Technical | $40 000 – $60 000 | 4-6 недель |
| B: Regulatory | $25 000 – $40 000 | 4-6 недель |
| C: Clinical | $25 000 – $45 000 | 3-6 месяцев |
| D: Polish | $5 000 – $10 000 | 2-3 недели |
| **Итого** | **$95 000 – $155 000** | **6-9 месяцев** |

---

## Библиография

1. FDA. Marketing Submission Recommendations for a PCCP for AI-Enabled Device Software Functions (Final, Dec 2024)
2. FDA. AI-Enabled Device Software Functions: TPLC Guidance (Draft, Jan 2025)
3. FDA. Clinical Decision Support Software (Revised, Jan 2026)
4. IEC 62304:2006+AMD1:2015. Medical Device Software — Lifecycle Processes
5. IEC 81001-5-1:2021+A1:2024. Health Software — Cybersecurity
6. ISO 14971:2019. Medical Devices — Application of Risk Management
7. ISO/TR 24971:2020. Guidance on ISO 14971
8. EU Regulation 2024/1689 (AI Act), Articles 6-15, Annex IV
9. MDCG 2025-6. Interplay between MDR/IVDR and AI Act
10. AAMI TIR 34971. Application of ISO 14971 to ML in Medical Devices
11. Henschel L et al. FastSurfer — NeuroImage, 2020; v2.3 Release Notes 2025
12. Isensee F et al. nnU-Net — Nature Methods, 2021; v2.6 Release Notes 2025
13. OHIF v3.12 Documentation (Feb 2026)
14. Orthanc DICOMweb Plugin Documentation
15. MONAI Deploy Express clinical workflows (SIIM, Apr-Jul 2025)
16. STARD 2015 Reporting Checklist
17. Obuchowski NA, Rockette HE. MRMC Analysis Methodology
18. MRMCsamplesize R package documentation (2025)
19. Signify Research. AI in Medical Imaging Market Report 2024-2030
20. CycloneDX 1.5 Specification

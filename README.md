# MRI Second Opinion

**Clinician-in-the-loop MRI second-opinion workflow system.**

A standalone TypeScript API that orchestrates the full lifecycle of an MRI second-opinion case — from intake and quality checks through AI-assisted draft generation to mandatory clinician review, finalization, and delivery.

> **⚠️ Research Use Only.** This system is not a medical device. It must not be used for clinical decision-making without proper regulatory clearance. Every output requires review by a qualified clinician.
>
> This repository is not an autonomous diagnostic system. It is a clinician-in-the-loop workflow layer that enforces human review before finalization or delivery.

---

## Table of Contents

- [What This Project Does](#what-this-project-does)
- [How It Works](#how-it-works)
- [Architecture](#architecture)
- [Technology Stack](#technology-stack)
- [API Surface](#api-surface)
- [Security](#security)
- [Getting Started](#getting-started)
- [Testing](#testing)
- [Project Structure](#project-structure)
- [Regulatory Positioning](#regulatory-positioning)
- [Roadmap](#roadmap)
- [Documentation](#documentation)
- [Community](#community)
- [License](#license)
- [Русская версия](#русская-версия)

---

## What This Project Does

MRI Second Opinion is not an "AI that reads MRI scans." It is the **workflow system around** the AI — the control plane that ensures every MRI case follows a strict, auditable path from submission to delivery.

Think of it as a **transparent orchestrator**:

1. A clinician or integration system submits an MRI case with patient alias and study metadata
2. The system checks which MRI sequences are available (T1-weighted, FLAIR, etc.) and selects the appropriate analysis workflow
3. An AI worker (Python) processes the study — runs structural segmentation, measures brain volumes, detects lesions
4. The system captures the AI output as a structured **draft report** — never as a final diagnosis
5. A human clinician **must** review the draft, add their impression, and explicitly approve it
6. Only after clinician approval does the case move to finalization and delivery
7. Every step is logged, timestamped, and traceable

**The key idea:** The AI generates a draft. A human makes the decision. The system enforces this boundary in code.

---

## How It Works

### The 9-State Machine

Every case follows a strict state machine with 9 possible states:

```
INGESTING → QC_REJECTED (if quality check fails)
INGESTING → SUBMITTED (if quality check passes)
SUBMITTED → AWAITING_REVIEW (after AI generates draft)
AWAITING_REVIEW → REVIEWED (after clinician reviews)
REVIEWED → FINALIZED (after explicit finalization)
FINALIZED → DELIVERY_PENDING (delivery job created)
DELIVERY_PENDING → DELIVERED (delivery confirmed)
DELIVERY_PENDING → DELIVERY_FAILED (delivery error)
DELIVERY_FAILED → DELIVERY_PENDING (retry)
```

**Two invariants are enforced in code:**
- No case can reach `REVIEWED` without a human clinician reviewing it
- No workflow state implies autonomous diagnosis

### The Worker Loop

The Python worker (`worker/main.py`) operates as a pull-based agent:

1. **Claim** — Worker calls `POST /api/internal/dispatch/claim` with HMAC-signed request
2. **Heartbeat** — Worker renews its lease via `POST /api/internal/dispatch/heartbeat`
3. **Process** — Worker downloads the study data, runs analysis, generates artifacts
4. **Callback** — Worker reports results via `POST /api/internal/inference-callback`
5. **Fail** — If something goes wrong, worker reports failure via `POST /api/internal/dispatch/fail`

The worker supports two compute modes:
- **Voxel-backed:** Downloads actual NIfTI volume data, parses it, computes measurements (SNR, foreground coverage, volume dimensions), and generates an SVG slice preview
- **Metadata-fallback:** When no volume data is available, produces a metadata-derived draft from series descriptors and sequence inventory

### Interoperability Exports

Finalized reports can be exported as:
- **DICOM SR** — Comprehensive Structured Report (SOP Class 1.2.840.10008.5.1.4.1.1.88.33)
- **FHIR R4 DiagnosticReport** — with LOINC coding, contained Observations, and RUO disclaimer extension

---

## Architecture

```
┌──────────────────────────────────────────────┐
│                  Clinician                    │
│         (Review Workbench / OHIF)             │
└──────────────┬───────────────────────────────┘
               │ review / finalize
┌──────────────▼───────────────────────────────┐
│           TypeScript API (Express)            │
│                                               │
│  ┌─────────┐ ┌──────────┐ ┌───────────────┐  │
│  │ Routing │ │ State    │ │ Validation    │  │
│  │ & Auth  │ │ Machine  │ │ (Zod)         │  │
│  └─────────┘ └──────────┘ └───────────────┘  │
│  ┌─────────┐ ┌──────────┐ ┌───────────────┐  │
│  │ Planning│ │ Artifact │ │ Health &      │  │
│  │ Engine  │ │ Storage  │ │ Metrics       │  │
│  └─────────┘ └──────────┘ └───────────────┘  │
│  ┌─────────┐ ┌──────────┐ ┌───────────────┐  │
│  │ HMAC    │ │ DICOM SR │ │ FHIR R4       │  │
│  │ Auth    │ │ Export   │ │ Export        │  │
│  └─────────┘ └──────────┘ └───────────────┘  │
└──────────────┬───────────────────────────────┘
               │ dispatch / callback
┌──────────────▼───────────────────────────────┐
│          Python Worker (main.py)              │
│                                               │
│  ┌─────────────┐ ┌────────────────────────┐  │
│  │ NIfTI Parse │ │ SVG Slice Renderer     │  │
│  │ (stdlib)    │ │ (voxel visualization)  │  │
│  └─────────────┘ └────────────────────────┘  │
│  ┌─────────────┐ ┌────────────────────────┐  │
│  │ HMAC Signer │ │ QC Checks             │  │
│  │ (crypto)    │ │ (coverage, SNR)       │  │
│  └─────────────┘ └────────────────────────┘  │
└──────────────────────────────────────────────┘
               │
┌──────────────▼───────────────────────────────┐
│           Persistence Layer                   │
│  SQLite (default) │ PostgreSQL (production)   │
└──────────────────────────────────────────────┘
```

**Key design decisions:**
- **Separation of control and compute:** The TypeScript API handles workflow logic only. Heavy imaging computation lives in a separate Python process.
- **Sequence-aware routing:** The system inspects MRI metadata (which sequences are available) and selects the right analysis workflow package. It does not treat all MRI scans as identical.
- **Claim discipline:** The project distinguishes between what is implemented (backed by running code and tests), what is target architecture (planned), and what is research-informed (supported by literature but not built).

---

## Technology Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Runtime** | Node.js ≥ 22, TypeScript 5.8 | API server and workflow engine |
| **Framework** | Express 4.21 | HTTP routing and middleware |
| **Validation** | Zod 3.25 | Schema validation for all API inputs |
| **Auth** | HMAC-SHA256 + Bearer tokens | Worker authentication (timing-safe) |
| **Metrics** | prom-client 15.1 | Prometheus-compatible metrics |
| **Rate Limiting** | express-rate-limit 8.3 | Public API protection |
| **Default DB** | SQLite (WAL mode) | Local persistence, restart-safe |
| **Production DB** | PostgreSQL 17 | Transactional persistence |
| **Worker** | Python 3.11+ (stdlib only) | Inference and delivery processing |
| **Container** | Docker (multi-stage, non-root) | Production packaging |
| **Orchestration** | Docker Compose | Local development and deployment |
| **SBOM** | CycloneDX | Software bill of materials |

---

## API Surface

### Public Endpoints (11 routes)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/cases` | Create a new MRI case |
| `GET` | `/api/cases` | List all cases |
| `GET` | `/api/cases/:caseId` | Get detailed case information |
| `POST` | `/api/cases/:caseId/review` | Submit clinician review |
| `POST` | `/api/cases/:caseId/finalize` | Finalize a reviewed case |
| `GET` | `/api/cases/:caseId/report` | Get the structured report |
| `GET` | `/api/cases/:caseId/exports/dicom-sr` | Export as DICOM Structured Report |
| `GET` | `/api/cases/:caseId/exports/fhir-diagnostic-report` | Export as FHIR R4 DiagnosticReport |
| `GET` | `/api/cases/:caseId/artifacts/:artifactId` | Download a derived artifact |
| `GET` | `/api/operations/summary` | Operational dashboard data |
| `POST` | `/api/delivery/:caseId/retry` | Retry failed delivery |

### Internal Endpoints (12 routes)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/internal/ingest` | Ingest case from internal system |
| `POST` | `/api/internal/inference-callback` | Worker reports inference results |
| `GET` | `/api/internal/inference-jobs` | List inference jobs |
| `POST` | `/api/internal/inference-jobs/claim-next` | Claim next inference job |
| `POST` | `/api/internal/inference-jobs/requeue-expired` | Requeue expired jobs |
| `GET` | `/api/internal/delivery-jobs` | List delivery jobs |
| `POST` | `/api/internal/delivery-jobs/claim-next` | Claim next delivery job |
| `POST` | `/api/internal/delivery-callback` | Worker reports delivery result |
| `POST` | `/api/internal/dispatch/claim` | HMAC-signed dispatch claim |
| `POST` | `/api/internal/dispatch/heartbeat` | Renew dispatch lease |
| `POST` | `/api/internal/dispatch/fail` | Report dispatch failure |

### Operational Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | API identity, route map, documentation links |
| `GET` | `/healthz` | Liveness probe |
| `GET` | `/readyz` | Readiness probe (includes DB check) |
| `GET` | `/metrics` | Prometheus metrics |
| `GET` | `/workbench` | Built-in review workbench UI |

---

## Security

| Feature | Implementation |
|---|---|
| **Internal Auth** | Bearer token (`MRI_INTERNAL_API_TOKEN`) for all `/api/internal/*` |
| **HMAC Auth** | SHA-256 signed requests for `/api/internal/dispatch/*` |
| **Replay Protection** | Nonce-based replay store with configurable TTL |
| **Clock Skew** | Configurable timestamp tolerance (default 60s) |
| **Timing Safety** | `crypto.timingSafeEqual()` for all secret comparisons |
| **Rate Limiting** | Configurable window and quota for public API |
| **Payload Limits** | Configurable JSON body size limit (default 1MB) |
| **Slowloris Protection** | Server-level timeout hardening (headers, request, socket) |
| **Security Headers** | Helmet-managed CSP and response headers, including X-Content-Type-Options, X-Frame-Options, Referrer-Policy, and production HSTS |
| **Input Validation** | Zod schema validation on every API input |
| **Error Envelopes** | Structured JSON errors with request ID, never raw stack traces |

---

## Getting Started

### Prerequisites

- Node.js ≥ 22
- npm (included with Node.js)
- Python 3.11+ (for the worker, optional)

### Local Development

```bash
# Install dependencies
npm ci

# Build TypeScript
npm run build

# Run tests (136 tests)
npm test

# Start the server (default port: 4010)
npm start

# Or use development mode with auto-reload
npm run dev
```

After startup, verify:
- `http://localhost:4010/` — API info and route map
- `http://localhost:4010/healthz` — should return `ok`
- `http://localhost:4010/workbench` — built-in review UI

### Docker

```bash
# Start the API only
docker compose up --build app

# Start everything (API + PostgreSQL + Redis)
docker compose up --build
```

### Running the Worker

```bash
# Set environment variables
export MRI_API_BASE_URL=http://127.0.0.1:4010
export MRI_INTERNAL_HMAC_SECRET=your-secret-key-at-least-32-bytes
export MRI_WORKER_STAGE=inference  # or "delivery"

# Run one iteration
python worker/main.py
```

### Environment Variables

See `.env.example` for all 22 configurable parameters covering:
- Server and database configuration
- Internal and HMAC authentication
- Rate limiting and payload limits
- Artifact storage
- Archive lookup integration

---

## Testing

The project has **142 tests** across 13 test files (~5,200 lines of test code):

```bash
npm test
```

| Test File | What It Covers |
|---|---|
| `workflow-api.test.ts` | Full API lifecycle, all 23 routes, state transitions |
| `validation-limits.test.ts` | Input validation edge cases, payload limits |
| `archive-error-types.test.ts` | Archive lookup graceful degradation |
| `execution-contract.test.ts` | Worker execution contract structure |
| `postgres-payload-roundtrip.test.ts` | PostgreSQL data preservation (Unicode, floats) |
| `runtime-hardening.test.ts` | Metrics, rate limiting, timeout hardening |
| `memory-case-service.test.ts` | State machine invariants, domain logic |
| `case-artifacts.test.ts` | URI canonicalization (Windows, POSIX, UNC) |
| `config.test.ts` | Configuration parsing and defaults |
| `db-migrations.test.ts` | Database migration safety |
| `postgres-bootstrap.test.ts` | PostgreSQL initialization |
| `postgres-case-service.test.ts` | PostgreSQL persistence |

---

## Project Structure

```
mri-second-opinion/
├── src/                          # TypeScript source (27 files, ~10,000 LOC)
│   ├── index.ts                  # Entry point, graceful shutdown
│   ├── app.ts                    # Express app factory (23 routes)
│   ├── cases.ts                  # Domain model, 9-state machine (~1,400 LOC)
│   ├── case-contracts.ts         # All TypeScript interfaces and types
│   ├── case-planning.ts          # Workflow planning engine
│   ├── case-artifacts.ts         # Artifact URI canonicalization
│   ├── case-artifact-storage.ts  # Artifact file persistence
│   ├── case-exports.ts           # DICOM SR + FHIR R4 export builders
│   ├── case-presentation.ts      # API response formatters
│   ├── case-repository.ts        # Storage abstraction layer
│   ├── case-postgres-repository.ts # PostgreSQL implementation
│   ├── case-sqlite-storage.ts    # SQLite implementation
│   ├── archive-lookup.ts         # Orthanc/DICOMweb archive client
│   ├── validation.ts             # Zod schemas for all inputs
│   ├── hmac-auth.ts              # HMAC-SHA256 request signing
│   ├── internal-auth.ts          # Bearer token middleware
│   ├── health.ts                 # Health and readiness probes
│   ├── http-runtime.ts           # Metrics, rate limit, hardening
│   ├── config.ts                 # Configuration from environment
│   ├── workflow-packages.ts      # AI workflow package registry
│   └── ...                       # Supporting modules
├── worker/                       # Python worker (853 LOC)
│   ├── main.py                   # Inference + delivery worker
│   ├── requirements.txt          # stdlib only — no external deps
│   └── README.md                 # Worker documentation
├── tests/                        # Test suite (13 files, ~5,200 LOC)
├── public/workbench/             # Built-in review UI
├── docs/                         # Documentation (90+ files)
│   ├── academic/                 # Research and analysis
│   ├── regulatory/               # Regulatory positioning
│   ├── security/                 # Security documentation
│   ├── verification/             # Audit and verification reports
│   └── releases/                 # Publication and release docs
├── scripts/                      # Utilities and migrations
├── artifacts/                    # SBOM output
├── Dockerfile                    # Multi-stage, non-root
├── docker-compose.yml            # API + PostgreSQL + Redis
└── package.json                  # Dependencies and scripts
```

---

## Regulatory Positioning

This project is positioned under the **FDA Clinical Decision Support (CDS) Non-Device pathway** (January 2026 guidance):

1. **Not intended to replace clinician judgment** — The system generates drafts, not diagnoses
2. **Transparent basis for recommendations** — Evidence cards show what the AI found and why
3. **Clinician can independently review** — The underlying data (MRI study) remains accessible
4. **Clinician-in-the-loop is enforced** — The state machine makes human review mandatory

For EU markets, the project will require conformity assessment under both the **Medical Device Regulation (MDR)** and the **EU AI Act** (obligations apply from August 2, 2026).

Key regulatory documents in the repository:
- `docs/regulatory/pms-plan.md` — Post-market surveillance plan
- `docs/academic/regulatory-positioning.md` — Regulatory strategy
- `docs/academic/evidence-and-claims-policy.md` — Claim discipline framework
- `docs/security/threat-model.md` — Current threat model

---

## Roadmap

| Wave | Status | What |
|---|---|---|
| **Wave 1: Reliability** | ✅ Complete | Rate limiting, Prometheus metrics, graceful shutdown, slowloris protection, payload limits |
| **Wave 2: Compute** | ✅ Complete | Python worker, dispatch API, HMAC auth, lease renewal, NIfTI parsing, artifact persistence |
| **Wave 3: Viewer** | 🔜 Next | OHIF v3.12 integration, Orthanc DICOMweb, segmentation overlays |
| **Wave 4: Interoperability** | 🟡 Partial | DICOM SR JSON export (done), FHIR R4 export (done), binary DICOM Part-10 (planned) |
| **Wave 5: Clinical Validation** | ⬜ Planned | MRMC reader study, 100 cases, 3-5 neuroradiologists |

See `docs/academic/action-plan.md` for the detailed technical roadmap.

---

## Documentation

### Start Here

| Document | Purpose |
|---|---|
| `docs/scope-lock.md` | What is in scope and what is not |
| `docs/scope-inventory.md` | Exact inventory of the active runtime, demo, and verification surfaces |
| `docs/status-model.md` | The 9-state workflow machine |
| `docs/public-vocabulary.md` | Frozen public terminology for states, errors, and workflow nouns |
| `docs/api-scope.md` | API boundary rules |
| `docs/launch-readiness-checklist.md` | Release gate criteria |
| `docs/releases/v1-go-no-go.md` | Current readiness verdict |

### Academic Analysis

| Document | Purpose |
|---|---|
| `docs/academic/project-fundamentals.md` | Complete project overview |
| `docs/academic/formal-system-analysis.md` | EFSM and protocol analysis |
| `docs/academic/competitive-analysis.md` | Comparison with MONAI, Kaapana, XNAT |
| `docs/academic/action-plan.md` | Technical roadmap to 100/100 |
| `docs/academic/ecosystem-landscape-march-2026.md` | Market and ecosystem context |

### Verification

| Document | Purpose |
|---|---|
| `docs/verification/launch-evidence-index.md` | All evidence artifacts |
| `docs/verification/runtime-baseline-verification.md` | What is verified today |
| `docs/verification/release-validation-packet.md` | Release validation |
| `docs/verification/hosted-evidence-capture-template.md` | Template for hosted verification evidence capture |

### Demo and Launch Operations

| Document | Purpose |
|---|---|
| `docs/demo/demo-script.md` | Operator-facing demo flow from intake through delivery |
| `docs/demo/social-preview-brief.md` | Screenshot and social preview brief for public publication |
| `docs/releases/v1-go-no-go.md` | Current launch verdict and blocking conditions |
| `docs/releases/github-publication-playbook.md` | End-to-end GitHub publication sequence |
| `docs/releases/github-go-live-checklist.md` | Go-live gate checklist for the public repository |
| `docs/releases/github-metadata-copy.md` | Repository description, topics, and profile copy |
| `docs/releases/github-settings-worksheet.md` | Required repository settings and permissions worksheet |
| `docs/releases/github-live-publication-sequence.md` | Ordered publication runbook for launch day |
| `docs/releases/first-public-announcement-draft.md` | First public announcement draft |
| `docs/releases/github-operator-packet.md` | Operator packet for public launch rehearsal |

---

## Community

- [Contributing Guide](CONTRIBUTING.md) — How to contribute
- [Security Policy](SECURITY.md) — How to report vulnerabilities
- [Code of Conduct](CODE_OF_CONDUCT.md) — Community standards
- [Support](SUPPORT.md) — How to get help
- [Governance](GOVERNANCE.md) — Project governance model

---

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.

---
---
---

# Русская версия

# MRI Second Opinion — Система Второго Мнения по МРТ

**Система рабочего процесса для получения второго мнения по МРТ с обязательным участием врача.**

Автономный TypeScript API, который управляет полным жизненным циклом кейса МРТ — от приёма и проверки качества через генерацию ИИ-черновика до обязательного врачебного рецензирования, финализации и доставки результата.

> **⚠️ Только для исследовательского использования.** Эта система не является медицинским изделием. Она не может использоваться для принятия клинических решений без соответствующей регуляторной сертификации. Каждый результат требует рецензии квалифицированного врача.

---

## Содержание

- [Что делает проект](#что-делает-проект)
- [Как это работает](#как-это-работает)
- [Архитектура](#архитектура)
- [Технологический стек](#технологический-стек)
- [API проекта](#api-проекта)
- [Безопасность](#безопасность)
- [Быстрый старт](#быстрый-старт)
- [Тестирование](#тестирование)
- [Структура проекта](#структура-проекта)
- [Регуляторное позиционирование](#регуляторное-позиционирование)
- [Дорожная карта](#дорожная-карта)

---

## Что делает проект

MRI Second Opinion — это **не «ИИ, который читает МРТ-снимки»**. Это **система управления рабочим процессом вокруг ИИ** — диспетчерская, которая гарантирует, что каждый МРТ-кейс проходит строгий, проверяемый путь от подачи до доставки результата.

Представьте это как **прозрачный оркестратор**:

1. **Подача кейса.** Врач или интеграционная система отправляет МРТ-кейс с псевдонимом пациента и метаданными исследования
2. **Проверка качества.** Система проверяет, какие МРТ-последовательности доступны (T1-взвешенная, FLAIR и др.) и выбирает подходящий алгоритм анализа
3. **ИИ-обработка.** Python-воркер обрабатывает исследование — сегментирует структуры мозга, измеряет объёмы, обнаруживает поражения
4. **Черновик отчёта.** Система фиксирует результат ИИ как структурированный **черновик** — никогда как окончательный диагноз
5. **Обязательная рецензия врача.** Врач-клиницист **обязан** рассмотреть черновик, добавить своё заключение и явно одобрить его
6. **Финализация.** Только после одобрения врачом кейс переходит к финализации и доставке
7. **Аудит.** Каждый шаг записывается, снабжается временной меткой и прослеживается

**Ключевая идея:** ИИ создаёт черновик. Человек принимает решение. Система обеспечивает эту границу на уровне кода.

---

## Как это работает

### Машина состояний из 9 состояний

Каждый кейс проходит строгую машину состояний:

```
INGESTING (Приём) → QC_REJECTED (Отклонён по качеству)
INGESTING → SUBMITTED (Подан на обработку)
SUBMITTED → AWAITING_REVIEW (Ожидает рецензии)
AWAITING_REVIEW → REVIEWED (Рецензирован)
REVIEWED → FINALIZED (Финализирован)
FINALIZED → DELIVERY_PENDING (Ожидает доставки)
DELIVERY_PENDING → DELIVERED (Доставлен)
DELIVERY_PENDING → DELIVERY_FAILED (Ошибка доставки)
DELIVERY_FAILED → DELIVERY_PENDING (Повтор)
```

**Два инварианта, зафиксированных в коде:**
- Ни один кейс не может достичь состояния `REVIEWED` без рецензии врача
- Ни одно состояние не подразумевает автономный диагноз

### Цикл работы воркера

Python-воркер (`worker/main.py`) работает по принципу pull-запросов:

1. **Заявка (Claim)** — Воркер вызывает `POST /api/internal/dispatch/claim` с HMAC-подписанным запросом
2. **Сердцебиение (Heartbeat)** — Воркер продлевает аренду через `POST /api/internal/dispatch/heartbeat`
3. **Обработка** — Воркер скачивает данные, запускает анализ, генерирует артефакты
4. **Обратный вызов (Callback)** — Воркер отправляет результаты через `POST /api/internal/inference-callback`
5. **Ошибка (Fail)** — При проблемах воркер сообщает о сбое через `POST /api/internal/dispatch/fail`

Воркер поддерживает два режима:
- **Воксельный режим:** Скачивает реальные данные объёма NIfTI, разбирает их, вычисляет метрики (SNR, покрытие переднего плана, размеры объёма) и генерирует SVG-превью среза
- **Метаданные-фоллбэк:** Когда объёмные данные недоступны, формирует черновик из описаний серий и инвентаря последовательностей

### Экспорт в стандартные форматы

Финализированные отчёты можно экспортировать как:
- **DICOM SR** — Структурированный отчёт (SOP Class 1.2.840.10008.5.1.4.1.1.88.33)
- **FHIR R4 DiagnosticReport** — с кодированием LOINC, встроенными Observation и расширением-дисклеймером RUO

---

## Архитектура

```
┌──────────────────────────────────────────────┐
│                    Врач                       │
│        (Рецензионный интерфейс / OHIF)        │
└──────────────┬───────────────────────────────┘
               │ рецензия / финализация
┌──────────────▼───────────────────────────────┐
│          TypeScript API (Express)             │
│                                               │
│  ┌─────────┐ ┌──────────┐ ┌───────────────┐  │
│  │Маршрути-│ │ Машина   │ │ Валидация     │  │
│  │зация    │ │ состояний│ │ (Zod)         │  │
│  └─────────┘ └──────────┘ └───────────────┘  │
│  ┌─────────┐ ┌──────────┐ ┌───────────────┐  │
│  │Планиров-│ │Хранилище │ │ Здоровье и    │  │
│  │щик      │ │артефактов│ │ метрики       │  │
│  └─────────┘ └──────────┘ └───────────────┘  │
│  ┌─────────┐ ┌──────────┐ ┌───────────────┐  │
│  │HMAC-    │ │ DICOM SR │ │ FHIR R4       │  │
│  │авториз. │ │ экспорт  │ │ экспорт       │  │
│  └─────────┘ └──────────┘ └───────────────┘  │
└──────────────┬───────────────────────────────┘
               │ диспетчеризация / обратный вызов
┌──────────────▼───────────────────────────────┐
│          Python-воркер (main.py)              │
│                                               │
│  ┌─────────────┐ ┌────────────────────────┐  │
│  │ NIfTI парсер│ │ SVG-рендерер срезов    │  │
│  │ (stdlib)    │ │ (визуализация вокселей) │  │
│  └─────────────┘ └────────────────────────┘  │
│  ┌─────────────┐ ┌────────────────────────┐  │
│  │ HMAC подпись│ │ Проверки качества (QC) │  │
│  │ (crypto)    │ │ (покрытие, SNR)        │  │
│  └─────────────┘ └────────────────────────┘  │
└──────────────────────────────────────────────┘
               │
┌──────────────▼───────────────────────────────┐
│          Слой персистенции                    │
│  SQLite (по умолчанию) │ PostgreSQL (прод.)   │
└──────────────────────────────────────────────┘
```

**Ключевые архитектурные решения:**
- **Разделение управления и вычислений:** TypeScript API обрабатывает только логику рабочего процесса. Тяжёлые вычисления по обработке изображений живут в отдельном Python-процессе.
- **Маршрутизация с учётом последовательностей:** Система проверяет метаданные МРТ (какие последовательности доступны) и выбирает правильный пакет анализа. Не все МРТ-снимки обрабатываются одинаково.
- **Дисциплина утверждений:** Проект различает то, что реализовано (подтверждено кодом и тестами), целевую архитектуру (запланировано) и научно обоснованное (подтверждено литературой, но не построено).

---

## Технологический стек

| Уровень | Технология | Назначение |
|---|---|---|
| **Среда** | Node.js ≥ 22, TypeScript 5.8 | API-сервер и движок рабочего процесса |
| **Фреймворк** | Express 4.21 | HTTP-маршрутизация и middleware |
| **Валидация** | Zod 3.25 | Валидация схем для всех входных данных |
| **Авторизация** | HMAC-SHA256 + Bearer-токены | Аутентификация воркеров (timing-safe) |
| **Метрики** | prom-client 15.1 | Prometheus-совместимые метрики |
| **Ограничение** | express-rate-limit 8.3 | Защита публичного API |
| **БД (умолч.)** | SQLite (WAL-режим) | Локальная персистенция, переживает перезапуск |
| **БД (прод.)** | PostgreSQL 17 | Транзакционная персистенция |
| **Воркер** | Python 3.11+ (только stdlib) | Инференс и доставка |
| **Контейнер** | Docker (multi-stage, non-root) | Продакшен-упаковка |
| **Оркестрация** | Docker Compose | Локальная разработка и деплой |
| **SBOM** | CycloneDX | Перечень компонентов ПО |

---

## API проекта

### Публичные маршруты (11)

| Метод | Путь | Описание |
|---|---|---|
| `POST` | `/api/cases` | Создать новый МРТ-кейс |
| `GET` | `/api/cases` | Список всех кейсов |
| `GET` | `/api/cases/:caseId` | Детальная информация о кейсе |
| `POST` | `/api/cases/:caseId/review` | Отправить рецензию врача |
| `POST` | `/api/cases/:caseId/finalize` | Финализировать рецензированный кейс |
| `GET` | `/api/cases/:caseId/report` | Получить структурированный отчёт |
| `GET` | `/api/cases/:caseId/exports/dicom-sr` | Экспорт как DICOM SR |
| `GET` | `/api/cases/:caseId/exports/fhir-diagnostic-report` | Экспорт как FHIR R4 |
| `GET` | `/api/cases/:caseId/artifacts/:artifactId` | Скачать артефакт |
| `GET` | `/api/operations/summary` | Данные для операционной панели |
| `POST` | `/api/delivery/:caseId/retry` | Повторить неудачную доставку |

### Внутренние маршруты (12)

| Метод | Путь | Описание |
|---|---|---|
| `POST` | `/api/internal/ingest` | Приём кейса из внутренней системы |
| `POST` | `/api/internal/inference-callback` | Воркер сообщает результаты |
| `GET` | `/api/internal/inference-jobs` | Список задач инференса |
| `POST` | `/api/internal/inference-jobs/claim-next` | Забрать следующую задачу |
| `POST` | `/api/internal/inference-jobs/requeue-expired` | Вернуть просроченные задачи |
| `GET` | `/api/internal/delivery-jobs` | Список задач доставки |
| `POST` | `/api/internal/delivery-jobs/claim-next` | Забрать задачу доставки |
| `POST` | `/api/internal/delivery-callback` | Воркер сообщает о доставке |
| `POST` | `/api/internal/dispatch/claim` | HMAC-подписанная заявка |
| `POST` | `/api/internal/dispatch/heartbeat` | Продление аренды |
| `POST` | `/api/internal/dispatch/fail` | Отчёт об ошибке |

---

## Безопасность

| Функция | Реализация |
|---|---|
| **Внутренняя авторизация** | Bearer-токен для всех `/api/internal/*` |
| **HMAC-авторизация** | SHA-256 подпись для `/api/internal/dispatch/*` |
| **Защита от повтора** | Хранилище nonce с настраиваемым TTL |
| **Временной сдвиг** | Настраиваемая толерантность (по умолчанию 60 сек.) |
| **Timing-безопасность** | `crypto.timingSafeEqual()` для всех сравнений секретов |
| **Ограничение запросов** | Настраиваемое окно и квота для публичного API |
| **Лимит размера** | Настраиваемый лимит JSON-тела (по умолчанию 1 МБ) |
| **Защита от Slowloris** | Таймауты на уровне сервера |
| **Заголовки безопасности** | CSP и security headers под управлением Helmet, включая X-Content-Type-Options, X-Frame-Options, Referrer-Policy и production HSTS |
| **Валидация входа** | Zod-валидация каждого входного параметра |
| **Оболочки ошибок** | Структурированные JSON-ошибки с ID запроса |

---

## Быстрый старт

### Требования

- Node.js ≥ 22
- npm (входит в комплект Node.js)
- Python 3.11+ (для воркера, опционально)

### Локальная разработка

```bash
# Установить зависимости
npm ci

# Собрать TypeScript
npm run build

# Запустить тесты (136 тестов)
npm test

# Запустить сервер (порт 4010 по умолчанию)
npm start

# Или в режиме разработки с авто-перезагрузкой
npm run dev
```

После запуска проверьте:
- `http://localhost:4010/` — информация об API и карта маршрутов
- `http://localhost:4010/healthz` — должен вернуть `ok`
- `http://localhost:4010/workbench` — встроенный интерфейс рецензирования

### Docker

```bash
# Запустить только API
docker compose up --build app

# Запустить всё (API + PostgreSQL + Redis)
docker compose up --build
```

### Запуск воркера

```bash
# Установить переменные окружения
export MRI_API_BASE_URL=http://127.0.0.1:4010
export MRI_INTERNAL_HMAC_SECRET=ваш-секретный-ключ-минимум-32-байта
export MRI_WORKER_STAGE=inference  # или "delivery"

# Выполнить одну итерацию
python worker/main.py
```

---

## Тестирование

Проект содержит **136 тестов** в 13 файлах (~5 200 строк тестового кода):

```bash
npm test
```

| Файл теста | Что проверяет |
|---|---|
| `workflow-api.test.ts` | Полный жизненный цикл API, все 23 маршрута |
| `validation-limits.test.ts` | Граничные случаи валидации |
| `archive-error-types.test.ts` | Устойчивость archive lookup |
| `execution-contract.test.ts` | Структура контракта воркера |
| `postgres-payload-roundtrip.test.ts` | Сохранность данных в PostgreSQL |
| `runtime-hardening.test.ts` | Метрики, rate limiting, таймауты |
| `memory-case-service.test.ts` | Инварианты машины состояний |
| `case-artifacts.test.ts` | Каноникализация URI (Windows, POSIX) |

---

## Структура проекта

```
mri-second-opinion/
├── src/                          # TypeScript-код (27 файлов, ~10 000 строк)
│   ├── index.ts                  # Точка входа, graceful shutdown
│   ├── app.ts                    # Express-приложение (23 маршрута)
│   ├── cases.ts                  # Доменная модель, 9 состояний (~1 400 строк)
│   ├── case-contracts.ts         # Все TypeScript-интерфейсы и типы
│   ├── case-exports.ts           # Экспорт DICOM SR + FHIR R4
│   ├── archive-lookup.ts         # Клиент Orthanc/DICOMweb
│   ├── validation.ts             # Zod-схемы для всех входных данных
│   ├── hmac-auth.ts              # HMAC-SHA256 подпись запросов
│   └── ...                       # Вспомогательные модули
├── worker/                       # Python-воркер (853 строки)
│   ├── main.py                   # Инференс + доставка
│   └── requirements.txt          # Только stdlib — без зависимостей
├── tests/                        # Тесты (13 файлов, ~5 200 строк)
├── public/workbench/             # Встроенный интерфейс рецензирования
├── docs/                         # Документация (90+ файлов)
│   ├── academic/                 # Исследования и анализ
│   ├── regulatory/               # Регуляторная документация
│   ├── security/                 # Документация безопасности
│   └── verification/             # Аудиты и верификация
├── Dockerfile                    # Multi-stage, non-root
├── docker-compose.yml            # API + PostgreSQL + Redis
└── package.json                  # Зависимости и скрипты
```

---

## Регуляторное позиционирование

Проект позиционируется по пути **FDA Clinical Decision Support (CDS) Non-Device** (руководство от января 2026):

1. **Не предназначен для замены суждения врача** — Система генерирует черновики, а не диагнозы
2. **Прозрачная основа рекомендаций** — Карточки доказательств показывают, что нашёл ИИ и почему
3. **Врач может независимо проверить** — Исходные данные (МРТ-исследование) остаются доступными
4. **Участие врача обязательно** — Машина состояний делает рецензию обязательной

Для рынков ЕС проект потребует оценки соответствия по **MDR (Регламент медицинских изделий)** и **EU AI Act** (обязательства с 2 августа 2026).

---

## Дорожная карта

| Волна | Статус | Что |
|---|---|---|
| **Волна 1: Надёжность** | ✅ Выполнена | Rate limiting, Prometheus, graceful shutdown, защита от Slowloris |
| **Волна 2: Вычисления** | ✅ Выполнена | Python-воркер, dispatch API, HMAC, аренда, NIfTI-парсер |
| **Волна 3: Просмотрщик** | 🔜 Следующая | Интеграция OHIF v3.12, Orthanc DICOMweb |
| **Волна 4: Совместимость** | 🟡 Частично | DICOM SR (готово), FHIR R4 (готово), бинарный DICOM (план) |
| **Волна 5: Клин. валидация** | ⬜ Запланировано | MRMC-исследование, 100 кейсов, 3-5 нейрорадиологов |

Подробности: `docs/academic/action-plan.md`

---

## Сообщество

- [Руководство для контрибьюторов](CONTRIBUTING.md)
- [Политика безопасности](SECURITY.md)
- [Кодекс поведения](CODE_OF_CONDUCT.md)
- [Поддержка](SUPPORT.md)
- [Управление проектом](GOVERNANCE.md)

---

## Лицензия

Проект распространяется под лицензией MIT. Подробности в файле [LICENSE](LICENSE).

---
title: "Сравнительный анализ с аналогами и конкурентами"
status: "active"
version: "1.0.0"
last_updated: "2026-03-28"
tags: [competitive, analysis, market, comparison]
role: documentation
---

# Сравнительный анализ с аналогами и конкурентами

Дата: 2026-03-28 | Источники: Signify Research, RSNA, ECR 2026, FDA, публичные данные вендоров

## Рынок ИИ в медицинской визуализации

| Метрика | Значение |
|---|---|
| Рынок 2024 | $1.75 млрд |
| Прогноз 2030 | $8.56 млрд |
| CAGR | 30% |
| Главный тренд 2025-2026 | От standalone AI → к orchestration platforms |

## Коммерческие конкуренты

### NeuroQuant (Cortechs.ai)

Специализация: автоматическая волюметрия мозга (объёмы структур).

| Параметр | NeuroQuant | MRI Second Opinion |
|---|---|---|
| FDA | ✅ 510(k) cleared | RUO |
| Модели | Собственные, закрытые | Открытые (FastSurfer, nnU-Net) |
| Стоимость | $50-100K/год | $0 (MIT) |
| Модификация | ❌ | ✅ |
| Clinician-in-loop | Dashboard (опционально) | Архитектурный инвариант |

### icobrain (icometrix)

Специализация: MS, TBI, деменция, инсульт.

| Параметр | icobrain | MRI Second Opinion |
|---|---|---|
| FDA | ✅ CE + FDA | RUO |
| Развёртывание | Облако | Локально |
| Исходный код | ❌ Закрытый | ✅ MIT |
| Orchestration | Линейный pipeline | 9-state FSM |

### e-Stroke (Brainomix)

Специализация: инсульт (ASPECTS scoring, перфузия).

| Параметр | e-Stroke | MRI Second Opinion |
|---|---|---|
| Фокус | Stroke (CT) | Brain MRI (general) |
| Скорость | Минуты (urgency) | Часы (second opinion) |
| Claim discipline | Нет формальной | 4-level hierarchy |

### aiOS (Aidoc)

Специализация: enterprise triage, мультиалгоритмическая платформа.

| Параметр | aiOS (Aidoc) | MRI Second Opinion |
|---|---|---|
| Тип | Агрегатор алгоритмов | Transparent orchestrator |
| Clinician-in-loop | Alert-based | Mandatory review |
| Стоимость | Enterprise pricing | $0 |
| Открытость | ❌ | ✅ |

## Open-source аналоги

### Kaapana (DKFZ, Heidelberg)

Открытая платформа для исследований в медицинской визуализации.

| Параметр | Kaapana | MRI Second Opinion |
|---|---|---|
| Назначение | Research platform | Clinical workflow |
| Инфраструктура | Kubernetes (сложная) | Node.js (простая) |
| Стейт-машина | ❌ DAG | ✅ 9-state FSM |
| Clinician review | Опционально | Обязательно |
| Federated learning | ✅ | ❌ |
| Порог входа | Высокий (K8s) | Низкий (npm) |

### MONAI Deploy (NVIDIA)

Фреймворк для упаковки и развёртывания ИИ-моделей.

| Параметр | MONAI Deploy | MRI Second Opinion |
|---|---|---|
| Назначение | AI packaging + deploy | Workflow orchestration |
| Стейт-машина | ❌ Linear pipeline | ✅ 9-state FSM |
| Clinician review | Нет | Обязательно |
| Сообщество | NVIDIA + 200+ contributors | Начальная стадия |
| Совместимость | Можно использовать вместе | MAP как формат для воркеров |

### XNAT (Washington University)

Платформа для управления данными нейровизуализации.

| Параметр | XNAT | MRI Second Opinion |
|---|---|---|
| Назначение | Data management | Clinical workflow |
| Технология | Java/Tomcat | TypeScript/Node.js |
| Стейт-машина | ❌ Архивная модель | ✅ 9-state FSM |
| Clinical workflow | Минимальный | Полный lifecycle |

## Уникальная ниша MRI Second Opinion

На март 2026 года MRI Second Opinion занимает **незанятую нишу**: open-source система, сочетающая:

1. Строгую стейт-машину (9 состояний, формально верифицирована)
2. Принудительную проверку врачом (не настройка, а инвариант)
3. Прозрачную оркестрацию (все шаги видны)
4. 4-уровневую дисциплину заявлений
5. Низкий порог входа (npm install вместо Kubernetes)

Ни один из перечисленных коммерческих или открытых аналогов не реализует все пять характеристик одновременно.

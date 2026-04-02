---
title: "Investor And Due-Diligence Packet"
status: "active"
version: "1.0.0"
last_updated: "2026-04-02"
tags: [investor, diligence, github, publication]
role: documentation
---

# Investor And Due-Diligence Packet

This page is the shortest safe route through MRI Second Opinion for investors, advisors, and technical due-diligence reviewers.

## Current posture

| Item | Status |
|---|---|
| Repository verdict | `PUBLIC_GITHUB_READY` |
| Product posture | MRI-only, clinician-in-the-loop, research use only |
| Current maturity | public GitHub-reviewable, not clinically validated, not production deployment-ready |
| Runtime baseline | TypeScript API plus Python worker, Node.js 24 LTS target |
| Release discipline | build, test, SBOM, release-packaging workflow, and evidence-led documentation |

## 1. Business and product framing

| Document | Why it matters |
|---|---|
| `docs/executive-summary-ru.md` | Short Russian-language executive summary for the product and market thesis |
| `docs/fundamental_analysis_report.md` | Product moat, architecture, and competitor framing in Russian |
| `docs/academic/project-fundamentals.md` | Current architecture, domain model, and implementation baseline |
| `docs/academic/competitive-analysis.md` | Market and open-source comparison pack |

## 2. Technical diligence and runtime truth

| Document | Why it matters |
|---|---|
| `docs/verification/launch-evidence-index.md` | Primary evidence ledger for publication-readiness claims |
| `docs/verification/release-validation-packet.md` | Current local validation snapshot and known gaps |
| `docs/verification/github-investor-readiness-audit-2026-04-02.md` | April 2026 repo-structure, freshness, and donor-cleanliness audit |
| `README.md` | Public landing page and claim boundary for outside readers |

## 3. Regulatory, risk, and security framing

| Document | Why it matters |
|---|---|
| `docs/academic/regulatory-positioning.md` | RUO-first posture and non-claim discipline |
| `docs/regulatory/data-governance-policy.md` | Data-governance boundary and retention posture |
| `docs/security/threat-model.md` | Current threat baseline and hardening surface |
| `SECURITY.md` | Private vulnerability reporting route |

## 4. Open-source trust signals

| Surface | Why it matters |
|---|---|
| `.github/CODEOWNERS` | Minimal ownership and review-routing signal |
| `.github/workflows/ci.yml` | Build, test, Docker, and PostgreSQL smoke validation |
| `.github/workflows/docs-governance.yml` | Documentation honesty and publication-surface checks |
| `.github/workflows/release.yml` | Reproducible release packaging with SBOM generation |
| `LICENSE` / `CONTRIBUTING.md` / `GOVERNANCE.md` / `SUPPORT.md` | Community-health and contribution expectations |

## 5. Freshness and upgrade policy

Current baseline decisions after the April 2026 audit:

1. The standalone repo targets Node.js 24 LTS because the official Node.js release schedule marks 24 as Active LTS and recommends only Active or Maintenance LTS for production applications.
2. Safe patch-level dependency refreshes are preferred inside the current working tree.
3. Major migrations to `express@5`, `zod@4`, and `typescript@6` remain separate compatibility waves until they are proven against the local regression net.

## 6. What this packet does not claim

This packet does not claim:

1. clinical validation
2. production deployment readiness
3. regulatory clearance or CE marking
4. autonomous diagnostic behavior
5. hosted production proof for the current local working tree

For the current claim boundary, use `docs/releases/v1-go-no-go.md` together with `docs/verification/launch-evidence-index.md`.

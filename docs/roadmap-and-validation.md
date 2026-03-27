# Roadmap And Validation

## Purpose

This document turns the standalone MRI second-opinion target stack into a phased engineering plan with explicit validation expectations.

It describes the intended path.

It does not claim that the current repository already satisfies later phases.

## Delivery Principle

The project should grow from a narrow, verifiable MRI workflow baseline rather than from an over-broad imaging platform promise.

Each phase should add one clinically meaningful capability family and the validation surface needed to keep claims honest.

## Delivery Window

The March 2026 planning baseline assumes a roughly two-year maturation path from initial repository foundation to a stronger clinical-integration-ready engineering state.

That timeline should be treated as a sequencing aid, not a launch promise.

## Current Wave Transition: Wave 1 To Wave 1.5

The repository has already closed the wave-1 API and durability baseline.

The immediate next wave should harden that baseline before broader clinical-scope expansion.

### Target outcomes

1. remove host-specific absolute-path assumptions from runtime, tests, and release evidence
2. keep snapshot, migration, and artifact-reference paths canonicalized through runtime helpers rather than host literals
3. preserve a Windows-friendly contributor workflow while keeping GitHub-hosted Linux CI green
4. record hosted evidence whenever a platform-sensitive change lands on `main`
5. advance deeper into Phase 1 only after this cross-platform and evidence-hardening pass is closed

### Proof expectations

1. GitHub-hosted `ci` succeeds on the current `main` commit after platform-sensitive changes
2. local Windows authoring and Linux container or hosted CI agree on persisted artifact URI semantics
3. no regression test compares machine-specific absolute paths literally
4. `docs/verification/launch-evidence-index.md` records the current hosted run URLs and why they matter

### Post-Publication Sequencing

Use the current repository state in this order.

1. keep `PUBLIC_GITHUB_READY` scoped to conservative repository publication, not MVP closure
2. close remaining GitHub UI or operator follow-up documented in `docs/releases/pending-manual-github-actions.md`
3. finish wave 1.5 proof capture before expanding the scope of runtime claims
4. resume Track B work in the established order: `WP-1`, `WP-2`, `WP-3`, `WP-4`, `WP-6`
5. revisit deeper phase-1 expansion only after the bounded MVP slice and evidence ledger are current

### Phase 1 Governance Hardening Pack

Before broader clinical-scope expansion, keep one small but explicit governance pack current.

1. `security/sbom-policy.md` defines the software supply-chain transparency seam and the `npm run sbom` operating rule
2. `security/threat-model.md` turns the existing threat snapshot into a maintained design-control surface
3. `academic/bias-analysis-framework.md` defines how subgroup and protocol-stratum evaluation must be planned before any stronger performance claims
4. `regulatory/pms-plan.md` defines the future post-market surveillance transition plan while preserving the current RUO boundary

This pack is documentation hardening, not proof of regulated release.

## Phase 0: Foundation

Target outcomes:

1. compose-based local deployment for Orthanc, PostgreSQL, queue, object storage, and workflow core
2. DICOM ingest plus study-router skeleton
3. basic anonymization and MRI-safe demo path
4. queue-backed worker execution baseline
5. CI and repository-governance closure
6. append-only audit trail skeleton
7. empty but explicit bias-testing framework contract
8. initial orchestrator registry contract for workflow packages, sequence gates, and evidence cards

Proof expectations:

1. one-command local bring-up
2. runtime health evidence
3. synthetic intake-to-case-record path
4. documented intended-use and RUO labeling
5. initial report-envelope schema and artifact taxonomy
6. workflow-plan envelope that shows why a case was routed, blocked, downgraded, or dispatched
7. deterministic fallback DAGs and planner-validation rules for any adaptive planning seam that is enabled

### Phase 0 MVP note

The narrowest credible first release path should stay neuro-first on a single GPU workstation or equivalent departmental node.

The initial sequence should be:

1. Orthanc intake
2. DICOM to NIfTI conversion
3. QC gate
4. extraction and structural branch such as HD-BET plus FastSurfer or SynthSeg-family tooling
5. evidence-card and report-preview generation

Public datasets such as OASIS-3 and IXI are reasonable validation candidates for research-mode MVP work, but their access terms, intended use, and cohort properties should be respected explicitly in any validation write-up.

The concrete handoff for this first slice is defined in `architecture/neuro-first-mvp-slice.md`.

## Phase 1: Brain Structural

Target outcomes:

1. QC gate
2. skull stripping
3. anatomical segmentation and volumetry
4. normative comparison and z-score flagging
5. draft report preview
6. foundation screening seam for whole-brain anomaly attention
7. cross-validation summary between screening and structural specialist outputs
8. review-assist evidence cards that summarize branch selection, disagreements, and missing-sequence constraints without changing the underlying structured findings contract

Proof expectations:

1. held-out synthetic and public-data validation cases
2. quantitative comparison against accepted reference tools where defensible
3. timing baseline for one end-to-end structural workflow

## Phase 2: Lesion Workflows

Target outcomes:

1. FLAIR lesion support
2. lesion count and volume outputs
3. uncertainty summary for lesion predictions
4. operator-visible missing-sequence and low-confidence states
5. cross-scanner and cross-protocol validation matrix start
6. DICOM SEG and DICOM SR structural seams
7. explicit rule that any language-model or VLM-style summary layer remains review-assist only and must not become the source of truth for lesion findings

Proof expectations:

1. lesion sensitivity and false-positive evaluation on reference sets
2. regression fixtures for lesion count and volume computation
3. fallback behavior evidence when required sequences are missing

## Phase 3: Tumor And Structured Exports

Target outcomes:

1. multimodal brain-tumor workflow support where sequence eligibility is met
2. structured finding model for tumor components and derived measurements
3. export-oriented artifacts such as DICOM SEG or DICOM SR seams
4. adaptive pipeline behavior for incomplete but still partially useful protocols
5. portable packaging seam for selected workflow modules where package boundaries improve reuse or deployment isolation

Proof expectations:

1. modality-completeness gating works as designed
2. issue taxonomy captures partial-failure states
3. export artifacts are structurally valid on synthetic or benchmark-safe inputs
4. report payload can distinguish machine finding state from reviewed release state

## Phase 4: Spine, MSK, And Longitudinal

Target outcomes:

1. spine workflow family
2. focused MSK workflow family such as knee
3. prior-study matching and longitudinal comparison seam
4. changed-volume and new-lesion summary structures where supported
5. federated-improvement seam for later multi-site learning without raw-study transfer
6. explicit research-mode seam for scanner harmonization or synthesis experiments, disabled by default in the clinical-facing baseline path

Proof expectations:

1. registration and change-analysis regression fixtures
2. cross-workflow routing tests
3. explicit validation notes for anatomies with weaker evidence maturity
4. explicit documentation that federated improvement is an advanced later seam with site-standardization, preprocessing, and governance complexity beyond ordinary single-site nnU-Net retraining
5. explicit documentation that harmonization or synthesis branches remain optional research workflows until they have workflow-specific evidence and failure-mode reporting

## Phase 5: Clinical Integration Readiness

Target outcomes:

1. OHIF-integrated clinician review flow
2. enterprise export seams such as DICOM SR, SEG, and future FHIR alignment
3. stronger multi-site evidence plan
4. operational benchmarking under realistic queue and worker conditions
5. comprehensive bias-audit reporting and release documentation bundle
6. orchestrator observability that shows package usage, downgrade rates, disagreement rates, and branch-specific validation coverage

Proof expectations:

1. full synthetic end-to-end demo from DICOM ingress to reviewed report
2. repeatable deployment guide
3. release packet that distinguishes implemented truth from research roadmap

## Validation Pyramid

The validation stack should stay multi-layered:

1. unit tests for transforms, routing helpers, metrics, schemas, and report formatting
2. integration tests for DICOM to NIfTI conversion, queue dispatch, worker callbacks, and artifact persistence
3. end-to-end tests for full synthetic case execution from intake to reviewed report
4. model-validation suites for workflow-specific metrics on held-out datasets
5. operational tests for retry, failure, and degraded-resource paths
6. canonical planner-scenario tests if a reasoning agent is enabled

No single benchmark table is enough for this product.

Routing, QC, reporting, and fallback behavior require their own validation artifacts.

Latency claims also require their own profiling artifacts. No architecture-only time estimate should be treated as product evidence.

## Bias, Provenance, And Audit Expectations

Validation is not only about Dice or latency.

The release path should also preserve:

1. subgroup or scanner-stratum performance review where metadata permits it
2. model-version and workflow-version provenance per processed case
3. append-only execution logging for routing, fallbacks, overrides, and export generation

Even in RUO mode, those controls improve scientific honesty and reduce future re-architecture cost.

The current governance pack that supports this section is:

1. `academic/bias-analysis-framework.md`
2. `security/threat-model.md`
3. `security/sbom-policy.md`
4. `regulatory/pms-plan.md`

## Synthetic And Controlled Test Fixtures

The project should maintain synthetic or benchmark-safe fixtures for:

1. routing edge cases across vendor naming patterns
2. QC pass, warn, and reject states
3. known-volume or known-lesion phantom checks
4. report rendering regressions
5. failure and fallback scenarios

Synthetic fixtures are especially important for public CI because they allow regression testing without overstating clinical validation.

## Cross-Scanner And Cross-Protocol Matrix

Validation should explicitly track uncertainty across scanner and acquisition regimes rather than reporting one blended metric.

At minimum, the matrix should distinguish:

1. major vendors
2. field strengths where metadata allows it
3. protocol completeness
4. lower-quality clinical acquisitions

This helps the product state where confidence is stronger and where it degrades.

## Report And Export Validation

The reporting surface should be validated as its own product layer.

That includes:

1. stable machine-readable JSON result schema
2. PDF or HTML report rendering checks
3. artifact reference integrity for overlays and masks
4. future structural validation for DICOM SR and SEG export objects
5. future FHIR DiagnosticReport mapping checks once that export seam becomes active

The canonical target contract for this layer lives in `architecture/reporting-and-export-contract.md`.

## Public Benchmark Targets

The product should track benchmark targets as engineering goals rather than as marketing claims.

Initial targets may include:

| Capability family | Example metric | Target posture |
|---|---|---|
| Brain structural segmentation | cortical or subcortical Dice | approach accepted open-tool baselines rather than claim universal superiority |
| Brain tumor workflow | whole-tumor and component Dice | stay within defensible public-benchmark distance of strong nnU-Net baselines |
| Brain extraction | extraction Dice on mixed pathology | match established open baselines with explicit fallback logging |
| Brain age or normative branch | MAE or calibration quality | report only if reference cohort and uncertainty framing are explicit |
| End-to-end workflow | wall-clock case completion time | keep queue-to-review latency operationally acceptable for a second-opinion workflow |

The project should not publish benchmark numbers without naming:

1. dataset
2. split or evaluation protocol
3. model version
4. failure exclusions or degraded cases
5. known subgroup weaknesses

## Key Operational KPIs

The roadmap should track a small KPI set per phase:

1. successful routing rate on reference studies
2. QC-to-review throughput time
3. workflow completion time per case family
4. fallback invocation rate
5. operator-visible reject reasons coverage
6. synthetic and benchmark regression pass rate

## Release Rule

No phase should be described as complete from architecture intent alone.

A phase is complete only when:

1. scope is implemented
2. validation evidence exists
3. known limitations are written down
4. public docs still distinguish engineering progress from clinical validation
5. research-informed statements still align with `academic/external-evidence-register-march-2026.md`
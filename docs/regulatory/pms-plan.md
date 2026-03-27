# Post-Market Surveillance Transition Plan

Date: 2026-03-27

## Purpose

This document defines the surveillance and feedback discipline the repository should grow into if it ever moves beyond its current RUO posture.

Today it functions as a transition plan, not as proof that a live regulated PMS system already exists.

## Current Status

The repository is currently:

1. research use only
2. clinician-in-the-loop
3. not a cleared or CE-marked medical device

Because of that, this document should not be read as evidence of active regulated-market surveillance.

Its role is to prevent the team from treating surveillance as an afterthought later.

## Scope Of The Future PMS Surface

If the product claim surface expands toward real clinical use, the surveillance program should track at minimum:

1. safety-relevant workflow failures
2. clinically meaningful false-positive or false-negative patterns surfaced by validation or field review
3. operator complaints and usability hazards
4. dependency vulnerabilities and supply-chain advisories relevant to released builds
5. bias or subgroup degradation signals
6. post-release configuration or model-change impact

## Minimum Intake Channels

The future surveillance operating model should preserve at least these intake channels.

1. issue tracker intake for non-sensitive engineering defects
2. security-report intake for vulnerability or abuse reports
3. controlled operator or evaluator feedback channel for workflow anomalies
4. release-linked evidence log for resolved high-severity incidents and corrective actions

## Triage Logic

When a later regulated or pre-regulated release path exists, each incoming signal should be classified by:

1. severity
2. recurrence
3. patient-safety relevance or clinical-decision relevance
4. affected workflow family and version
5. whether the issue is product logic, data quality, workflow misuse, or environment-specific failure

## Output Expectations

The future PMS surface should produce:

1. a dated incident register
2. corrective and preventive action tracking
3. release-linked summaries of material issues and dispositions
4. escalation rules for retraining, threshold changes, or workflow rollback

## What Should Already Happen Now

Even in RUO mode, the repository can prepare by keeping these habits explicit.

1. preserve versioned release evidence
2. preserve threat and bias documentation as active control surfaces
3. keep dependency-inventory evidence through the SBOM seam
4. avoid language that implies live-market surveillance already exists

## Activation Preconditions

This plan should be upgraded from transition document to active operational program only when all of the following are true.

1. intended use is formally narrowed
2. target jurisdiction pathway work has started
3. release packaging and deployment ownership are defined
4. incident-handling responsibilities are assigned
5. quality-management and risk-management surfaces exist beyond repository documentation alone

## Interaction With Other Docs

Use this document together with:

1. `../academic/regulatory-positioning.md` for current RUO posture
2. `../security/threat-model.md` for current security-risk framing
3. `../security/sbom-policy.md` for supply-chain evidence discipline
4. `../academic/bias-analysis-framework.md` for subgroup-risk and fairness signals that may later feed surveillance review
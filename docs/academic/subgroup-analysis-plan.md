# Subgroup Bias Analysis Execution Plan

Date: 2026-03-30

## Purpose

This document turns the bias analysis framework into an executable plan for the current neuro-first brain volumetry workflow.

It defines what subgroup analyses will be run, how results will be reported, and what thresholds trigger corrective action.

## Relationship To Bias Analysis Framework

The bias analysis framework (`docs/academic/bias-analysis-framework.md`) defines the general contract.

This document operationalizes that contract for the specific workflow family and endpoints currently implemented.

## Scope

This execution plan applies to the brain volumetry workflow only.

It covers the subgroup dimensions that are assessable given the metadata available in the evaluation dataset and the outputs produced by the current workflow version.

## Subgroup Dimensions

### Primary Strata (mandatory for every evaluation run)

1. **Scanner vendor**: stratify by manufacturer extracted from DICOM metadata
2. **Field strength**: stratify by 1.5T versus 3T (and 7T if present in dataset)
3. **Acquisition quality class**: stratify by QC disposition (pass, warn, reject)
4. **Age band**: stratify by decade (18-29, 30-39, 40-49, 50-59, 60-69, 70-79, 80+)

### Secondary Strata (when metadata and sample size permit)

1. **Sex**: stratify by sex when ethically appropriate and metadata is available
2. **Protocol completeness**: stratify by presence or absence of expected complementary sequences
3. **Site or cohort**: stratify by acquisition site when multi-site datasets are used

## Metrics Per Stratum

For each primary stratum, report:

1. sample size per stratum
2. mean and standard deviation of hippocampal volume measurement
3. mean and standard deviation of total brain volume measurement
4. ICC with expert consensus (if reader study data is available)
5. Bland-Altman bias and limits of agreement per stratum
6. QC rejection rate per stratum
7. workflow failure rate per stratum

## Degradation Thresholds

A subgroup is flagged for corrective investigation if any of the following apply:

1. ICC drops more than 0.10 below the pooled result
2. Bland-Altman bias exceeds 2x the pooled bias for any stratum
3. QC rejection rate exceeds 3x the pooled rejection rate
4. workflow failure rate exceeds 2x the pooled failure rate
5. sample size in a stratum is below the minimum reporting threshold (n=10)

## Reporting Format

Each subgroup analysis report must include:

1. dataset and version identifier
2. workflow version used for processing
3. stratum definitions and sample sizes
4. per-stratum metric table
5. flagged strata with explanation
6. non-claims section documenting strata where data is insufficient

## Current Status

No subgroup analysis has been executed yet.

The workflow and export seams are now stable enough to support evaluation runs.

The next step is to obtain and process an evaluation dataset, then run the subgroup analysis per this plan.

## Integration With Other Documents

1. the reader-study protocol provides the expert consensus data needed for ICC computation
2. the bias analysis framework provides the general contract this plan operationalizes
3. the ISO 14971 risk baseline identifies measurement inaccuracy and subgroup bias as tracked hazards
4. the PCCP plan identifies subgroup analysis as a required evidence endpoint

## Limitations

This execution plan covers the current single workflow family.

Expansion to lesion, tumor, or other workflow families requires a separate execution plan per family.

The subgroup dimensions are limited to metadata available in the evaluation dataset. Unmeasured confounders may exist.

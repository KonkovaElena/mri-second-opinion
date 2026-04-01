# Scope Lock

## Included In Standalone v1

1. MRI-only intake and case creation
2. AI-assisted draft generation
3. clinician review and amendment
4. explicit finalization
5. report retrieval
6. delivery retry and operations visibility

## Explicitly Excluded From Standalone v1

1. broader diagnosis-support APIs or runtime surfaces outside this standalone repository
2. custom PACS implementation
3. custom medical image viewer engine
4. autonomous diagnosis claims
5. multimodality expansion beyond MRI
6. direct EMR or hospital-wide integration claims unless actually implemented

## Product Positioning

The product is a standalone clinician-in-the-loop MRI second-opinion workflow system.

It is not a replacement for enterprise radiology infrastructure.

It should be described as MRI-specific product software, not as a broader non-MRI or cross-project platform.

For the exact active repository surface, see `docs/scope-inventory.md`.

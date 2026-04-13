# Pending Manual GitHub Actions

Date: 2026-03-27
Status: **open** — these items require GitHub UI access and cannot be automated via git push

## 1. Set Repository Topics

**Where**: GitHub > Settings (or repo main page, click gear icon next to About)

Add these 12 topics (from `docs/releases/github-metadata-copy.md`):

```
mri, medical-imaging, radiology, second-opinion, clinical-review,
dicom, fhir, typescript, nodejs, python,
workflow-orchestration, research-use-only
```

**Do not add** topics implying shipped frontend, production deployment, or autonomous AI.

## 2. Enable Private Vulnerability Reporting

**Where**: GitHub > Settings > Code security and analysis > Private vulnerability reporting

Enable the toggle. `SECURITY.md` already references this as the primary reporting path.

## 3. Upload Social Preview Image

**Where**: GitHub > Settings > Social preview > Edit > Upload an image

Requirements (from `docs/demo/social-preview-brief.md`):
- Title: "MRI Second Opinion"
- Subtitle: "Clinician-in-the-loop MRI workflow"
- Footer: "Human review | RUO | Not launch-ready"
- PNG, JPG, or GIF; under 1 MB; at least 640×320, with 1280×640 preferred
- No fake dashboard, no diagnostic wording, no patient imagery

Prepared asset in the repository:

- `docs/demo/social-preview.png`

**Manual action still required**: upload that file through the GitHub UI.

Use a solid background unless transparency has been checked against multiple platform backgrounds.

## 4. Add Branch Protection Rules

**Where**: GitHub > Settings > Branches > Add branch protection rule

For branch `main`:
- [x] Require pull request reviews before merging (1 reviewer minimum)
- [x] Require status checks to pass: `test` (from `ci.yml`), `docs-governance` (from `docs-governance.yml`)
- [x] Require branches to be up to date before merging

**Prerequisite**: Both `ci` and `docs-governance` workflows are confirmed stable (passing on `177094a` and later commits).

## 5. Triage Dependabot PRs

Five Dependabot PRs were opened automatically:

Current local note (2026-04-13): the equivalent CI-only workflow bumps for `actions/checkout` and `actions/setup-node` are already applied directly in `.github/workflows/ci.yml` and `.github/workflows/release.yml` in the local working tree. If those Dependabot PRs are still open after this workflow patch is pushed, they are redundant and can be closed instead of merged.

| PR | Package | Type | Risk | Recommendation |
|----|---------|------|------|----------------|
| express 5.2.1 | `express` | npm (major 4→5) | **HIGH** — breaking API changes | **Do not merge** without full migration review. Express 5 removes/changes middleware APIs. |
| @types/node 25.5.0 | `@types/node` | npm (dev) | LOW | Safe to merge — dev-only type definitions. |
| typescript 6.0.2 | `typescript` | npm (major 5→6) | **HIGH** — potential breaking compiler changes | **Do not merge** without build verification on TS 6.x. |
| actions/checkout-6 | `actions/checkout` | GitHub Actions | LOW | Safe to merge, or close as redundant if the direct workflow bump has already landed on the branch. |
| actions/setup-node-6 | `actions/setup-node` | GitHub Actions | LOW | Safe to merge, or close as redundant if the direct workflow bump has already landed on the branch. |

**Recommended merge order**:
1. If the direct workflow bump is not already pushed, merge `actions/checkout-6` + `actions/setup-node-6`; otherwise close both PRs as redundant
2. `@types/node-25.5.0` (safe, dev-only)
3. Hold `express-5.2.1` and `typescript-6.0.2` until dedicated migration sessions

## Completion

When all 5 items are done, update `docs/releases/github-go-live-checklist.md`:
- Phase 2: mark Security tab, social preview, and topics as `[x]`
- Phase 5: mark branch protection as `[x]`
- Mark checklist as complete per the completion rule

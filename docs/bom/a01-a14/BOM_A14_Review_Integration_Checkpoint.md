# A-14 continuation — variantOf Review integration

Status: PARTIAL — proposal-branch code committed; CI execution in progress at this checkpoint.

Repository: `spencerskelly/MDSE_Workbench`
Branch: `proposal/bom-a14-readonly-quantity-uom`
Latest integration-test commit: `a07043c016bdd08c59b7029141df4ca880878886`

## Changes
- `src/core/review.ts`: Add `variantOf` Review category with stable finding keys, sorting and counts; formatter accepts variant-specific findings.
- `src/obsidian/assurance.ts`: Include read-only `validateVariantOf(index)` in the cached shared assurance snapshot; avoids per-render whole-index graph passes.
- `src/obsidian/review.ts`: Show variant-specific review guidance.
- `test/bom-variantof.test.ts`: Verify invalid links appear in the Review list and valid family links do not.

## Governance
No merger to main. These model relationships require the separately governed `relationships.yaml` one-way variantOf declaration. The Workbench changes do not establish new authoring permissions.

## CI
Focused branch CI run: https://github.com/spencerskelly/MDSE_Workbench/actions/runs/37873398568
Typecheck and test results must be recorded from the completed run; do not report pass while queued/running.

## Remaining risk
- Verify YAML frontmatter's unresolved and repeated targets are fully represented by `NoteRecord.fields`; unresolved links are separately held in `broken`.
- Verify scope of candidate versus confirmed variantOf and source provenance.
- Historical suite baseline has 89 existing failures on 0.5 baseline; keep separate.
- Additional model-index unit assertions and runtime Obsidian UI smoke test remain desirable.

## Verified CI result
Run 37873398568 completed: TypeScript typecheck PASS; focused BOM tests PASS; full historical suite FAIL (known baseline drift; failure-by-failure comparison for this commit not yet performed). Workflow overall FAILURE. No production merge.

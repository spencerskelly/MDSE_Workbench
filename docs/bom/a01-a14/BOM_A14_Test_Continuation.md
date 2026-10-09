# A-14 continuation — reader validation regression checkpoint

Status: PARTIAL. Committed two further regression tests on the existing proposal branch; full TypeScript execution remains unverified.

Repository: `spencerskelly/MDSE_Workbench`  
Branch: `proposal/bom-a14-readonly-quantity-uom`  
New commit: `24c282288ad2bfec08ba4860b0ce1091eff1881a`  
File: `test/bom-localmodel-06.test.ts`

## Progress
- Added explicit-empty-value regressions (`quantity` and `unitOfMeasure`).
- Added preservation tests for Part records in Local Model 0.1 through 0.5.
- Previously authored tests cover successful 0.6 decimal string reads, invalid quantity/unit combinations, and 0.5 unsupported-field reporting.
- Verified GitHub contains the commit; GitHub Actions returned zero workflow runs for this proposal branch.

## Verification boundary
- Remote git clone fails in this container: `Could not resolve host: github.com`.
- `npm test` and `npm run typecheck` **NOT RUN**. No claim of runtime test pass or typecheck pass.
- No merge or change to controlled `main`, schemas, or 0.6 writer.

## Next step (A-14 continuation)
Run `npm ci && npm run typecheck && npm test -- --test-name-pattern='0.6|legacy'` in a GitHub CI workflow or a checked-out repository with dependencies. Fix failures; then add `variantOf` Object reader validation. After full compatibility tests pass, prepare governance review rather than merging unapproved schemas.

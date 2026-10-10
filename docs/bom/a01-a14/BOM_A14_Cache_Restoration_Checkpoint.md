# A-14 — Cache restoration and re-resolution checkpoint

**Status:** PARTIAL — scoped tests pass; historical full suite has existing baseline failures.

- Repository: `spencerskelly/MDSE_Workbench`
- Branch: `proposal/bom-a14-readonly-quantity-uom`
- Latest commit: `f4db39a3fefea2c8e347e22991ea3a74b94f9471`
- CI run: https://github.com/spencerskelly/MDSE_Workbench/actions/runs/37875707627

## Completed work

1. Added a cache round-trip regression to `test/cache.test.ts`: `variantOfFormatError` survives JSON serialization and `restoreSemanticState`; repeated and unresolved link evidence remains present.
2. Included cache regression testing in the focused A-14 GitHub CI command.
3. Added `test/bom-variantof.test.ts` coverage for relationship re-resolution, verifying raw YAML format findings survive a refreshed set of resolved links.
4. Inspected `Indexer` re-resolution code: updated note records spread the previous record before replacing resolved `fields`, `broken`, and `repeat`; this retains `variantOfFormatError`. No production change to this routine was needed.

## CI evidence

- TypeScript typecheck: PASS (run 37875707627).
- Focused test command (BOM reader, variantOf, cache): PASS (run 37875707627).
- Historic full suite: was still in progress at checkpoint; the untouched 0.5 baseline independently had 89 failures.

## Remaining

- Confirm and categorize whole-suite outcome for this exact commit.
- An Obsidian runtime smoke test for malformed raw YAML / updated metadata cache remains outstanding.
- Governing variantOf relationship and Local Model 0.6 changes still await approval; 0.6 writer remains disabled.
- Nothing was merged into main.

## Final CI update
Run 37875707627 completed: **typecheck PASS; focused tests PASS; full suite FAIL: 456 total, 367 pass, 89 fail**. The 89 matches the prior baseline failure *count*; failing names were not re-compared for this commit.

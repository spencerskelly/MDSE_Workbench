# A-14 — variantOf validation checkpoint

## Result
Implemented a pure, read-only `variantOf` graph validator and regression tests in `spencerskelly/MDSE_Workbench`, proposal branch `proposal/bom-a14-readonly-quantity-uom`.

- `src/core/variantof.ts` committed at `26ec1606395c08c507573ae9caff97d09c07b7fd`: validates Object owner/target, missing target, self link, multiple targets, and directed cycles. Reverse lookup remains derived; there is no inverse authoring.
- `test/bom-variantof.test.ts` committed at `4be0cc8f52e534871a33381cb29ff4e7ad328ad1`: tests valid siblings, missing/invalid endpoints, self/multiple links and cycles.
- CI workflow extended at `fe7d185d36644738126a2ac3e7262cd8adeeb47f` to run focused variantOf and quantity/UOM tests.
- CI run: https://github.com/spencerskelly/MDSE_Workbench/actions/runs/37873248866
- **TypeScript typecheck PASS; focused BOM tests PASS**, per CI job 113635857855. Full legacy suite was in progress at initial checkpoint; do not imply it passed.

## Remaining integration work
- Integrate this separate read-only validator into the existing ModelIndex/Review findings UI; current implementation is a callable validator, not yet wired to all vault scans.
- Define how multiple raw YAML entries and unresolved links are retained by the Obsidian indexing layer; resolved `NoteRecord.fields` alone may miss syntactic duplicates or unresolved values.
- Govern addition of `variantOf` to relationships.yaml before production use. Neither schema nor main was modified.
- Keep old 89 baseline failures separate from new A-14 coverage.

## Next unit
A-14 continuation: integrate validator into the Review pipeline and verify YAML source/reference handling. Preserve branch isolation and use CI.

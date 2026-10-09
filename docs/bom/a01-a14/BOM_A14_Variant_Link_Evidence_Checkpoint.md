# A-14 continuation — authored variantOf evidence

Status: PARTIAL. Proposal code committed; CI verification pending at document creation.

Repository: spencerskelly/MDSE_Workbench
Branch: proposal/bom-a14-readonly-quantity-uom
Last change commit: 90bf7dea6dba52e242f4d6055cc83b970f9f3ebd

## Finding
The Obsidian Indexer reads `cache.frontmatterLinks` and resolves authored relationships through `resolveAuthoredRelationshipLinks`. That resolver deduplicates resolved targets in `NoteRecord.fields`, while retaining duplicate counts in `NoteRecord.repeat` (keys `field|path`) and unresolvable links in `NoteRecord.broken`. The old variantOf validator inspected only `fields`, so it could miss those source conditions.

## Implemented
- `src/core/variantof.ts`: detect `variant.duplicate` from `repeat`, `variant.unresolved` from `broken`, and count unresolved authored references when enforcing the single-target limit.
- `test/bom-variantof.test.ts`: regression case asserting duplicate, unresolved, multiple-target, and Review broken-reference reports.

## Limits
- No governing MDSE schema was modified; `variantOf` approval is still pending.
- This step does not implement YAML scalar-vs-list cardinality validation at metadata extraction or detect values that are not recognized as frontmatter wikilinks.
- Do not claim passing CI until workflow completion is checked.

## CI
https://github.com/spencerskelly/MDSE_Workbench/actions/runs/37875341309

## Next
Check CI typecheck and focused results. Investigate non-link/malformed YAML `variantOf` values and count duplicated unresolved entries before declaring authoring validation complete.

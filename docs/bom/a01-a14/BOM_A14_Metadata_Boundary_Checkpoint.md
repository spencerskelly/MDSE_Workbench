# A-14 — Obsidian metadata boundary checkpoint

Status: PARTIAL — simulated metadata-cache test, NOT real Obsidian smoke validation.

- Repo: `spencerskelly/MDSE_Workbench`
- Branch: `proposal/bom-a14-readonly-quantity-uom`
- Commit: `eeda0618d3a566d552f6801eb2e74ea4650b3a47`
- CI: https://github.com/spencerskelly/MDSE_Workbench/actions/runs/37875949229

## Changes
- Extracted `variantOfMetadataFinding(frontmatter)` in `src/core/variantof-format.ts`. It reads raw `frontmatter.variantOf`, without depending on Obsidian to emit a `frontmatterLinks` entry.
- Wired `src/obsidian/indexer.ts` to use this boundary helper.
- Added a focused test using metadata-cache-shaped objects for malformed scalar, YAML array, number, valid link, absent property, and absent frontmatter.

## Interpretation
The test is representative of the metadata cache shape and can run in Node CI; it is **not** evidence from an actual Obsidian GUI/plugin session. Existing `record()` refresh logic is exercised by normal Obsidian metadata changes, but requires runtime smoke verification with the app.

## Suggested manual runtime smoke
On a disposable vault and proposal build, edit an Object note to `variantOf: Family` (plain text). Check Review shows `variant.format`; replace with `variantOf: "[[Family]]"` and check it clears after indexing. Then try a YAML sequence and an unresolved `[[Missing Family]]` target. Restart Obsidian and repeat; do not use a production vault before governance approval.

## Next
Confirm CI status. If focus tests pass, prepare runtime Obsidian validation matrix and handle any cache re-index issues; do not merge to main.

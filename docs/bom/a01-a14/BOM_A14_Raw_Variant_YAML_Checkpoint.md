# A-14 — Raw YAML variantOf validation checkpoint

Status: PARTIAL — focused CI passing, broad historic suite tracked separately.

Repository: spencerskelly/MDSE_Workbench
Branch: proposal/bom-a14-readonly-quantity-uom
Latest commit: 716a994e803a55ede87f3d5cb9dbc01e84a3e853
CI: https://github.com/spencerskelly/MDSE_Workbench/actions/runs/37875547793

## Changes
- New `src/core/variantof-format.ts`: restrict present `variantOf` to a single note-level `[[Target]]` YAML string; reject sequences, primitives, bare names, multi-link text, and local block targets.
- `src/obsidian/indexer.ts`: assess raw frontmatter before links are resolved.
- `src/core/model.ts` and `src/core/cache.ts`: preserve an optional diagnostic through note indexing and serialized cache restores.
- `src/core/variantof.ts`: emit `variant.format` for malformed raw values, appearing in existing variantOf Review category.
- `test/bom-variantof.test.ts`: valid/invalid value and Review output regression coverage.

## Observed CI
- TypeScript typecheck: PASS.
- Focused BOM reader/variantOf tests: PASS.
- Full historical suite: in progress at the verification point; a known 0.5 baseline carries 89 historical failures.

## Open concerns
- Need actual Obsidian metadata-cache smoke checks with invalid YAML values.
- Need broader cache round-trip and reresolution regression for new field.
- No merge to main, schema approval outstanding.

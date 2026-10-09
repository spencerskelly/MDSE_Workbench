# A-14 — Read-only validation continuation

**Status: PARTIAL; live Workbench tests not executed.**

Repository: `spencerskelly/MDSE_Workbench`
Branch: [`proposal/bom-a14-readonly-quantity-uom`](https://github.com/spencerskelly/MDSE_Workbench/tree/proposal/bom-a14-readonly-quantity-uom)

## Committed outputs

- `src/core/localmodel.ts`: `3b874de187954a88b068fcfca3779505ff7869e4` — 0.6-only validations for positive ordinary decimal quantities, quantity/UOM presence coupling, provisional UOM set (`ea`, `in`, `m`, `kg`), and ambiguous `ea` alongside multiplicity.
- `test/bom-localmodel-06.test.ts`: `3a71c13c40b09a81c33af0315fbb4fcddfd64039` — regression tests for decimal preservation, missing pair, invalid decimal strings, unrecognized units, `ea` multiplicity collision, legacy 0.5 rejection of 0.6 fields, and writer remaining at 0.5.

## Evidence and limitations

7/7 remote source assertions passed (source and test files fetched back from GitHub). **This does not prove tests compile or pass.** `npm test` and `npm run typecheck` need execution in a checkout or CI. The machine executing this pass could not resolve github.com through `git`, so local TypeScript tooling could not be exercised. The provisional UOM whitelist and format require formal governance. The decimal rule currently forbids signs and scientific notation. No changes were made to `main` or approved core schemas.

## Next bounded action

Run `npm run typecheck` and `node --import tsx --test test/bom-localmodel-06.test.ts` on the proposal branch. Fix any failures before starting `variantOf` indexing/relationship validation. Do not enable 0.6 writing.

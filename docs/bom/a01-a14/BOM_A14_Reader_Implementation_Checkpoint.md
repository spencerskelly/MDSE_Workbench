# A-14 — Read-only reader implementation checkpoint

**Status: PARTIAL — code committed to proposal branch; runtime testing remains.**

- Repository: `spencerskelly/MDSE_Workbench`
- Base ref: `workbench/local-model-0.5`
- Proposal branch: `proposal/bom-a14-readonly-quantity-uom`
- Commit: `1d98d9129b6453b1e69325f32162fd89c03531ef`
- Changed path: `src/core/localmodel.ts`

## Changes
1. Add 0.6 to reader-compatible versions while keeping the writer on 0.5.
2. Parse and retain `quantity` and `unitOfMeasure` as strings to avoid binary floating-point loss.
3. Admit both fields on Part records only for 0.6.
4. Retain older-version field lists and section handling.
5. Treat the `Parts`/`Interfaces` section names as applicable to 0.6.

## Verification
Eight remote source assertions: **PASS**. Remote fetched blob SHA: `a8c55e099a7cf33c6af7636152236bab82d382b2`.

**Not tested**: TypeScript compilation, Workbench unit tests, integration with the current parser, exact-decimal validation, UOM registry validation, and `variantOf`. The local execution environment cannot resolve github.com through git, so an end-to-end build did not run here. The code must not be promoted as an approved 0.6 implementation.

## Next continuation of A-14
Implement read-only numeric/UOM validation and integration fixtures on the proposal branch, then run project TypeScript tests and preserve compatibility results. Resolve the governing schema-version/relationship approval before merging. Do not enable 0.6 writing.

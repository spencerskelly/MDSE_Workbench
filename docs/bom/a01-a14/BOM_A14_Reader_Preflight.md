# A-14 — Workbench reader: bounded preflight and implementation handoff

**Status: PARTIAL — targeted reader implementation not yet merged.** This is a reproducible diagnosis and targeted test plan, not a passing Workbench 0.6 integration test.

## Source snapshots

- `spencerskelly/MDSE_Workbench` `main`: `59fc6219b1d0586900aa7d38685e7087a9d47fec`; `src/core/localmodel.ts` blob `972f4c0b404e08fd10328eaf8a102f5b659c735b`. Main advertises reader/writer version 0.4.
- `spencerskelly/MDSE_Workbench` `workbench/local-model-0.5`: branch tip `7052c07b4c95212522ba4b5d274c95be0860bda3`; `src/core/localmodel.ts` blob `862f3f7dda3e42420de79b9f6825699ede1bbeb0`. This has 0.5 read/write support and is the **correct forward compatibility reference** for the proposed 0.6 reader.
- `spencerskelly/Test_Vault_` `importer/baseline-contract-2026-10-05`: `local-model.yaml` 0.5, blob `361dee8269f9fbdfd16bcee33a1b808015f7ba5a`; `relationships.yaml` 1.36, blob `413fd5d32d12331413fda30653c7a3a38ac2d2ab`.

## Verified gaps in 0.5 reader

1. `READABLE_VERSIONS` has only 0.1–0.5; proposed 0.6 records are structured-disabled.
2. `LocalRecord` has `multiplicity` but not separate `quantity` or `unitOfMeasure` values.
3. Both legacy and 0.4/0.5 `ALLOWED_FIELDS` maps omit these proposed part fields. `validateRegion` emits `record.unknown-field` warnings (not errors) for unrecognized fields.
4. No proposed exact positive-decimal or UOM-pairing checks exist. A known `unitOfMeasure` registry has not been approved; do not hardcode the seed unit examples as governance.
5. A separate note metadata/relationship parser must handle `variantOf`. Adding it to `localmodel.ts` is inappropriate; `relationships.yaml` oneWay and Object-only endpoint validation must be updated together.

## Required next atomic patch

On a new feature branch from **the 0.5-capable implementation baseline**, add read-only 0.6 support to `src/core/localmodel.ts` and targeted tests. Accept 0.1–0.6, leave older version interpretation and rendering unchanged, preserve quantity as exact decimal source text (no `Number` rounding), and normalize only for calculation. Add per-version allowed fields, part-only field checks, and UOM pairing, with explicit error status for nonpositive/nonfinite/unsupported value forms. Do **not** set writer to 0.6 until A-15 is ready, and do not auto-upgrade legacy documents. Verify 0.6 `Parts` heading behavior.

Then add an independent test for forward `variantOf` on Object notes that accepts a single link, rejects non-Object endpoints, self-links, multi-links and cycles, and verifies no inverse or `subtypeOf` is synthesized. Keep source confidence outside YAML until a governed field exists.

## Proposed regression cases

- 0.5 `Parts` without new fields: unchanged parse + validation.
- 0.6 part `multiplicity: 2`, `quantity: 0.35`, `unitOfMeasure: m`: exact 0.70 m aggregate.
- 0.6 material `quantity: 1.25`, `unitOfMeasure: kg`, omitted multiplicity: valid.
- 0.6 count `multiplicity: 4` only: valid.
- 0.6 `quantity: 0`, `-1`, `NaN`, or `1e3`: error, raw source retained in ledger.
- 0.6 quantity without UOM, UOM without quantity, and unknown UOM: error/review per approved registry.
- 0.5 note containing new fields: warn as unknown, never silently reinterpret or rewrite.
- 0.1–0.5 previous fixtures: no regression.
- `variantOf` forward link: One Object→Object only, reverse query derived, no inheritance or reverse YAML.

**Test result:** static source inspection only. **Production reader acceptance: NOT RUN.** No repository mutation was performed. Before implementation, resolve the existing 0.5 branch-versus-main integration and the pending A-05/A-08 governance approvals.

**Next:** A-14 continuation, test-first reader slice; A-15 writer is blocked pending A-14 acceptance.

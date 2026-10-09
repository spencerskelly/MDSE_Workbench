# BOM A-01–A-14 Git persistence audit — 2026-10-08

## Status: NOT YET COMPLETE — do not proceed to A-15 or promote this branch

The **Workbench source changes** for A-14 were committed to this proposal branch and have executed focused CI checks. The previous handoff **documents and fixture archives** were produced as local sandbox artifacts, but an audit confirmed they were **not all committed to GitHub**. This audit note does not replace the original files.

## Tracked in this proposal branch
- Read-only Local Model 0.6 support, quantity and unitOfMeasure fields, validation and cache serialization.
- Object variantOf graph validator, raw YAML-format finding, relationship evidence handling, shared assurance and Review category.
- BOM-focused tests, CI workflow and regression coverage.
- Most recent pre-audit code commit: `eeda0618d3a566d552f6801eb2e74ea4650b3a47`.

## Remaining to persist as exact original files
The following items exist as local artifacts and need Git-committed copies, with content/hash verification:
- A-01 `BOM_SOURCE_MANIFEST.json`
- A-02 `BOM_SEMANTIC_DECISION_RECORD_A-02.md`
- A-03 `BOM_DECISION_AUTHORITY_A-03.md`
- A-04 `BOM_LOCAL_MODEL_UNITS_CONTRACT_A-04.md`
- A-05 `BOM_LOCAL_MODEL_SCHEMA_PROPOSAL_A-05.md`
- A-06 `BOM_A06_Fixtures.zip`
- A-07 `BOM_VARIANTOF_CONTRACT_A-07.md`
- A-08 `BOM_VARIANTOF_SCHEMA_PROPOSAL_A-08.md`, `BOM_A08_variantof_fixture_check.py`, `BOM_A08_VariantOf_Test_Results.txt`
- A-09 `BOM_OBJECT_SUBTYPE_A-09.md`
- A-10 `BOM_VARIANT_COMPARISON_CONTRACT_A-10.md`
- A-11 `BOM_A11_Canonical_Examples.zip`
- A-12 `BOM_RULESET_AMENDMENT_A-12.md`
- A-13 `BOM_AI_TEMPLATE_AMENDMENT_A-13.md`
- A-14 `BOM_A14_Reader_Preflight.md`, all A-14 checkpoint Markdown files, `BOM_A14_Obsidian_Runtime_Acceptance.md`, and `BOM_A14_Disposable_Obsidian_Vault.zip`
- Master `BOM_MDSE_Vault_Implementation_Plan.md` and `BOM_RUN_LOG.md`

## Guardrails
These are **unapproved proposals**, not approved governing MDSE schemas. Keep them on a proposal branch. Do not overwrite Test_Vault_ governed schema, merge to main, or claim implementation acceptance. The Obsidian runtime checks remain unexecuted. Historical Workbench test baseline has 89 failures.

## Remaining Git gate
1. Commit exact original artifact bytes to a dedicated `docs/bom/a01-a14/` handoff area, including binary ZIPs.
2. Compare every uploaded SHA-256 digest with the local originals.
3. Confirm all A-01–A-14 deliverables are present on the remote branch.
4. Then proceed with the next A-14 runtime work unit.

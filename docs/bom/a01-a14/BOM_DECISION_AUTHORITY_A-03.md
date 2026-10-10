# A-03 — MDSE W-decision authority and numbering reconciliation

**Checked:** 2026-10-08 (America/Los_Angeles)  
**Status:** PASS — conflict identified, numbering guarded; no W-number allocated or core governance altered.

## Verified repository evidence

| Reference | HEAD / blob | Findings |
|---|---|---|
| `spencerskelly/Test_Vault_`, `main` | commit `19f565859e4b9fb7ae63004f1b6f0a7de1b9144e` | `00_Workspace/Workspace Decision Log.md` ends at **W-370**; no W-385 entry; log blob `c2470d416589e3a1f68fefb17d0eeca1d65f3464`. |
| `spencerskelly/Test_Vault_`, `importer/baseline-contract-2026-10-05` | commit `b382ec79f722b9991dabaec27ed6cfea17070d02` | The same log contains **W-371 through W-398**; log blob `49ab9bc513b27ce7e1c2beed6e039aad5c0bebbb`. |
| `spencerskelly/Test_Vault_`, `wb106-release-integration` | commit `c1093cf5f7b5727beef6a0fe6b7cdfbfd39d5105` | Decision log on this older branch ends at W-338. |
| `spencerskelly/MDSE_Workbench`, `main` | commit `59fc6219b1d0586900aa7d38685e7087a9d47fec` | Commit message explicitly references **W-385** (WB-128, Local Model 0.4 fixture). |

GitHub comparison `Test_Vault_ main...importer/baseline-contract-2026-10-05` reports **ahead 471, behind 0**, with `main` at the merge base. The importer working branch is an unmerged extension of `main`, not a divergent independent history.

## Interpretation and numbering guard

- W-385 is **not missing in general**: it exists on the active importer branch. The previous apparent gap was caused by consulting `main` alone.
- The branch W-371–W-398 decisions are **proposed/staged until merged or otherwise accepted through the repository's approval process**. They must not be represented as approved `main` policy.
- **Do not use W-371 through W-398 for BOM decisions.** They are occupied on the unmerged branch. **W-399 is a candidate next integer, not an approved or reserved number**; check the latest governing branch and open proposals again at the write stage. A-03 allocates **no ID**.
- W-384 changes the taxonomy/Local Model 0.4; W-385 describes the `exposes` relation; W-386 pins Workbench 0.1.18; W-398 proposes Local Model 0.5 `equals` binding semantics. These directly affect the prospective BOM reader/schema baseline. The BOM plan's October 5 `Local Model 0.2` baseline must therefore be treated as historical until the governing branch and release state are reconciled.
- This step does not merge, cherry-pick, modify, or approve the importer branch. Do not change schemas/templates/Workbench on `main` merely because the working branch includes later decisions.

## Resolution for the next steps

1. Use `Test_Vault_/main` as **merged authority**, and the importer branch as **known staged authority and occupied numbering space**.
2. Draft the A-04 quantity/unit contract independently of W numbering, with a compatibility matrix for Local Model **0.2, 0.3, 0.4, and proposed 0.5** before any schema write.
3. At the future governing write checkpoint, validate current SHA, W-log maximum across relevant live branches, decision supersession, and actual runtime schema compatibility, then submit a proposal branch/PR. Never silently write main.

## Checks

- [x] Retrieved `main` decision log and verified final W-370.
- [x] Retrieved working branch decision log and verified W-371–W-398 including W-385.
- [x] Verified importer branch relationship to main (471 ahead / 0 behind).
- [x] Correlated Workbench WB-128 commit to W-385.
- [x] Proposed no conflicting W-number, made no repository writes.

**Next work unit:** **A-04 — Specify Local Model units**.  
**Remaining open matters:** release authority/merge status for the later branch decisions; precise adopted Local Model schema version; S1 original workbook is unavailable for fresh rehash in this session.

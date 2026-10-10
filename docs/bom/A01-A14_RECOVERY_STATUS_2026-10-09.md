# BOM A-01–A-14 exact-original recovery status — 2026-10-09

**Status: RECOVERED — all 31 frozen original artifacts are persisted in GitHub with verified SHA-256 integrity.**

**Scope:** Original BOM A-01–A-14 handoff files only. **This does not approve the BOM implementation, Local Model 0.6, `variantOf`, runtime acceptance, or a release.** This evidence document is not a new governing schema or model contract.

## Completed GitHub source-integrity verification

The user uploaded the four remaining original files to the isolated branch `recovery/bom-a01-a14-artifacts-2026-10-09`, under `docs/bom/a01-a14/`. The branch now contains **all 31** frozen-inventory files, including the exact historical `BOM_RUN_LOG.md` and all three original binary ZIPs.

- Original authority: [A-01–A-14 SHA-256 inventory](A01-A14_ARTIFACT_SHA256.md), written on the original BOM proposal before source artifact recovery.
- [GitHub audit 38008742547](https://github.com/spencerskelly/MDSE_Workbench/actions/runs/38008742547): **31/31 exact hash matches, 0 missing, 0 hash errors**, against commit `160f1066b7fac47d7879c252b5e69f2e0d66249e`.
- [Hardened fail-closed GitHub audit 38008828655](https://github.com/spencerskelly/MDSE_Workbench/actions/runs/38008828655): **PASS, 31/31, 0 missing, 0 mismatches**. The workflow now fails if the original inventory changes count, a required file disappears, or its bytes differ from the frozen SHA-256. No blanket approval is based on this integrity check.
- [Draft source-recovery PR #15](https://github.com/spencerskelly/MDSE_Workbench/pull/15) targets the **existing BOM proposal branch**, never `main`. Its artifact-recovery blocker is resolved; it remains draft for review and controlled integration.

## Original handoff provenance and exact source bytes

The uploaded original `BOM_A01_A14_Git_Handoff.tar.gz` was **76,602 bytes**, SHA-256 `afec22098e7a6aa8c84a392c51d8ab4e04485708cdc04fe4642f507cd022f5af`. Independent sandbox inspection found 31 frozen inventory artifacts plus 17 disposable-vault member files. All 31 source hashes matched. The three source ZIP archives passed internal CRC checks. See [original archive verification](A01-A14_ORIGINAL_HANDOFF_ARCHIVE_VERIFICATION_2026-10-09.md).

The four final recovered originals were:

| Filename | Original bytes | SHA-256 |
|---|---:|---|
| `BOM_A06_Fixtures.zip` | 3,319 | `a2fd27132588ad5c343efed0bccfb653f72bb715eb4345165d0fa3fb2e2d040f` |
| `BOM_A11_Canonical_Examples.zip` | 3,876 | `7219f43f29a409ba321f076d5e23a5e388ba3deb334f30359359b7918e457afa` |
| `BOM_A14_Disposable_Obsidian_Vault.zip` | 6,061 | `28cabfaebed97629732ad39f94f2f786251c002388ef1cd4456549254d81932c` |
| `BOM_RUN_LOG.md` | 18,936 | `0142c0c616cf17f745d3d499629b70a998bebfc75334c9d980c00bcbce331514` |

The archived `BOM_RUN_LOG.md` is the *frozen original*; its checksum differs from the later version also visible in the user's Library (`63ee9d799c78403a4b2c131fa75257ad8ed17b21fd1b76578de3d9b03094ae2f`). The later file was **not** substituted into the recovered source archive.

## Recovery timeline (historical, superseded states)

1. Original handoff documents, ZIPs and TAR.GZ were located in the user's ChatGPT Library at `/BOM Work`, resolving concern that source files were permanently lost.
2. Twenty-seven text originals were recovered and independently matched against frozen hashes after restoration of their original final newline, then committed to this isolated branch. [Partial 27/31 audit 37980805384](https://github.com/spencerskelly/MDSE_Workbench/actions/runs/37980805384) showed no hash errors and four pending files.
3. The user attached the original TAR.GZ; independent SHA-256 validation confirmed all 31 frozen files. A four-file transfer packet was prepared from exact original bytes, not recreated approximations.
4. The user uploaded the final four binaries/text to GitHub; both the first complete audit and the stricter 31/31-required audit passed. The historic *27/31* status is superseded by **31/31 complete in GitHub**.

## Remaining engineering gates (unrelated to recovery)

- Review draft PR #15's complete source provenance and integrate it into the **BOM proposal branch only** when appropriate. Original BOM feature and `main` histories remain preserved.
- Reconcile read-only Local Model 0.6 + `quantity`, `unitOfMeasure`, and `variantOf` model semantics with governing `Test_Vault_/99_System/03_Schemas`, retaining the importer's 0.5 writer constraint.
- On *committed integrated source*, amend the old future-unsupported-schema negative test from 0.6 to 0.7; rerun the previously rehearsed **462-test** Workbench suite, typecheck, build, and paired importer model checks.
- Perform real Obsidian UI startup, note editing/restart persistence, Bootstrap pin/lock and controlled Base Vault release acceptance. No release or `main` merge was approved through source integrity verification.

**Verdict: original BOM file preservation is complete and verifiable; BOM functionality/release approval remains separate.**

# BOM A-01–A-14 original handoff archive — independently verified

**Date:** 2026-10-09
**Result:** **PASS: 31/31 frozen artifact SHA-256 hashes match the original archive, zero hash mismatches.**
**Source:** `BOM_A01_A14_Git_Handoff.tar.gz` uploaded intact by the user in the BOM recovery conversation.
**Original archive size:** 76,602 bytes
**Original archive SHA-256:** `afec22098e7a6aa8c84a392c51d8ab4e04485708cdc04fe4642f507cd022f5af`

## Exact-byte audit

A sandbox-local Python `tarfile` reader inspected **48 regular-file TAR members**: all **31 top-level artifacts** named in the pre-existing frozen `docs/bom/A01-A14_ARTIFACT_SHA256.md` inventory, plus **17 disposable Obsidian vault members** under `A14_Disposable_Obsidian_Vault/`.

For each of the 31 frozen inventory names, the audit required exactly one matching TAR entry, read that entry's **original raw bytes**, computed SHA-256, and compared with the frozen hash. **31 verified, 0 missing in the original archive, 0 mismatches.** The script rejected duplicates, path traversal and nonregular-file entries. ZIP members were checked using Python `zipfile.testzip()`.

### Previously missing originals — original bytes now verified

| Original filename | Bytes | Frozen SHA-256 | ZIP CRC |
|---|---:|---|---|
| `BOM_A06_Fixtures.zip` | 3,319 | `a2fd27132588ad5c343efed0bccfb653f72bb715eb4345165d0fa3fb2e2d040f` | PASS (4 entries) |
| `BOM_A11_Canonical_Examples.zip` | 3,876 | `7219f43f29a409ba321f076d5e23a5e388ba3deb334f30359359b7918e457afa` | PASS (8 entries) |
| `BOM_A14_Disposable_Obsidian_Vault.zip` | 6,061 | `28cabfaebed97629732ad39f94f2f786251c002388ef1cd4456549254d81932c` | PASS (17 entries) |
| `BOM_RUN_LOG.md` | 18,936 | `0142c0c616cf17f745d3d499629b70a998bebfc75334c9d980c00bcbce331514` | not applicable |

**Important:** this historic `BOM_RUN_LOG.md` is the exact source-inventory version, distinct from the later Library text whose hash did not match the original. The later revision was not substituted.

## GitHub persistence and independent final checksum audit — COMPLETE

- [Recovery branch](https://github.com/spencerskelly/MDSE_Workbench/tree/recovery/bom-a01-a14-artifacts-2026-10-09/docs/bom/a01-a14) and [draft PR #15](https://github.com/spencerskelly/MDSE_Workbench/pull/15) now contain **all 31 exact original artifacts**, including the three ZIPs and the historically frozen run log.
- The first complete [GitHub audit 38008742547](https://github.com/spencerskelly/MDSE_Workbench/actions/runs/38008742547) proved **31/31 exact hashes, 0 missing, 0 mismatches** against original inventory.
- The [hardened fail-closed CI audit 38008828655](https://github.com/spencerskelly/MDSE_Workbench/actions/runs/38008828655) independently repeated **31/31 exact hashes, 0 missing, 0 mismatches**. This workflow now **fails** on any missing original, altered bytes, or changed number of frozen inventory entries.
- The prior [27/31 audit 37980805384](https://github.com/spencerskelly/MDSE_Workbench/actions/runs/37980805384) is historical recovery progress only; it no longer describes current GitHub state.
- The conversation transfer packet was used to carry exact original bytes; it is no longer required for the handoff.

## Final source-integrity verdict and separate acceptance

**The 31/31 original artifact Git-persistence gate is SATISFIED.** The BOM source recovery can proceed to normal review on draft PR #15 targeting the BOM proposal branch, not `main`. Do not confuse original-artifact integrity with approving proposed Local Model 0.6 read-only semantics, `variantOf` governance, old negative-test updates, Obsidian UI acceptance, Bootstrap or a controlled release.

**No release was promoted, no BOM source implementation merged into `Test_Vault_`, and no default branch was changed by archive recovery.**

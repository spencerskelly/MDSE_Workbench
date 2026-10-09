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

## Persisted GitHub state — separate from archive verification

- [GitHub recovery branch](https://github.com/spencerskelly/MDSE_Workbench/tree/recovery/bom-a01-a14-artifacts-2026-10-09/docs/bom/a01-a14) and [draft PR #15](https://github.com/spencerskelly/MDSE_Workbench/pull/15) already contain the **27** original text artifacts recovered in the previous step.
- [Latest GitHub SHA audit before this uploaded archive](https://github.com/spencerskelly/MDSE_Workbench/actions/runs/37980805384) proved **27 Git files/31 inventory entries, 0 Git hash mismatches, 4 missing in Git**.
- **The four originals listed above are now verified from user-provided original archive bytes, but have NOT yet been copied into the GitHub recovery branch.** The GitHub connector exposes text and encoded blob operations, but cannot directly consume the mounted binary file path. Do not conflate 31/31 **archive verified** with 31/31 **Git persisted**.
- A user-facing transfer package `BOM_Final_Four_Verified_for_GitHub.zip` has been created from **unaltered original member bytes**. Extract it and upload the four contained files **without opening/re-saving them** to the *isolated recovery branch*, folder `docs/bom/a01-a14/`. GitHub Actions must then independently pass at **31/31**. The package's own ZIP hash is not evidence for the individual original hashes; the table above is authoritative.

## Precise remaining gate

**Transfer all four original files into the GitHub recovery branch and rerun the existing frozen SHA inventory audit; require `31 exact Git byte matches, 0 missing, 0 mismatches`.**

Only after that gate may the BOM source-artifact recovery PR be considered for merge into the BOM proposal (not into `main`); BOM 0.6 read-only/variantOf schema governance, future-negative-test adjustment, actual Obsidian UI acceptance, Bootstrap and controlled release approval remain independent work.

**No release was promoted and no main branch or source BOM proposal branch was modified by this archive verification.**

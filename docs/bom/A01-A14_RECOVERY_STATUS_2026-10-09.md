# BOM A-01–A-14 exact-original recovery status — 2026-10-09

**Status: PARTIAL RECOVERY — NOT COMPLETE AND NOT APPROVED FOR MERGE OR A-15.**

This is an evidence record, not a new source contract. All existing MDSE/BOM proposal decisions retain their original provenance.

## Verified location of original project files

The original files are visible in the user's ChatGPT file Library at `/BOM Work`, including:

- `BOM_A01_A14_Git_Handoff.tar.gz` (76,602 bytes; present, raw export is not authorized by the current Files connector)
- 28 individual original text documents (including `BOM_RUN_LOG.md`)
- `BOM_A06_Fixtures.zip`, `BOM_A11_Canonical_Examples.zip`, and `BOM_A14_Disposable_Obsidian_Vault.zip`

The three binary ZIPs and handoff TAR.GZ are **located**, but no raw-byte SHA check was possible; do not claim archive verification from a filename or size.

## Independent checksum verification of text files

The Library's text representation omits one final newline for these documents. Restoring one newline in each extracted text document and computing SHA-256 against the **already frozen** `docs/bom/A01-A14_ARTIFACT_SHA256.md` results in:

- **27 text documents with exact original SHA-256**.
- **One text mismatch:** `BOM_RUN_LOG.md`.
  - Frozen archive inventory SHA: `0142c0c616cf17f745d3d499629b70a998bebfc75334c9d980c00bcbce331514`.
  - SHA of the currently readable Library version (one terminal newline restored): `63ee9d799c78403a4b2c131fa75257ad8ed17b21fd1b76578de3d9b03094ae2f`.
  - **Do not overwrite/replace the frozen log** with this different revision. Extract the archived log from the original handoff TAR.GZ once raw bytes can be obtained.

## GitHub persistence: 15 source originals verified

A separate recovery branch, `recovery/bom-a01-a14-artifacts-2026-10-09`, forks from BOM proposal head `87cb615876c342a34ce794beee8b5fad80b80520`; original proposal and default branch remain unchanged.

**15 of the 27 verified text originals were committed** under `docs/bom/a01-a14/`. GitHub Actions [run 37980074904](https://github.com/spencerskelly/MDSE_Workbench/actions/runs/37980074904) checked every present file against the frozen SHA inventory and reported:

- Frozen inventory entries: **31**
- Git-committed byte-for-byte matches: **15**
- Missing from GitHub recovery branch: **16**
- Git-committed hash failures: **0**

The 16 missing Git files consist of **12 locally verified text originals**, the **three binary ZIPs**, and the **one version-divergent frozen BOM run log**. GitHub CI is a **partial-integrity audit**, not a complete recovery or release acceptance.

## Verified recovery transfer packet

A user-accessible conversation artifact `BOM_A01_A14_Verified_Text_Recovery_27_Files.zip` was generated containing the 27 SHA-confirmed original text documents, the structured local checksum record and explicit missing-file list. Its own transfer-packet SHA-256 is:

`e757a96df4b4d62c4d152f0c01c5bcb5bc62c39ad2581f1fe2b7d0f34d0194a1`.

**This transfer packet is not the historical 76,602-byte Git handoff archive and does not include any of the three ZIPs or the original BOM run log.** It can be used to finish committing the 12 remaining text files through a trusted workstation or another file-capable upload path. Do not substitute it for the historical archive.

## Remaining verified recovery gates

1. Copy the 12 remaining verified text originals from the transfer packet to this **recovery branch** at `docs/bom/a01-a14/`. Recompute SHA-256 **on GitHub**, using `.github/workflows/bom-artifact-recovery-audit.yml` to verify all newly committed bytes.
2. Transfer the three original binary ZIPs **without reserialization or modification** from the Library/workstation or original handoff archive. Validate each against the frozen SHA inventory before committing.
3. Extract/check the historical `BOM_RUN_LOG.md` from the true source handoff archive; preserve the differently hashed current Library revision as a separate labeled revision if needed, never as a replacement for the frozen log.
4. Only then require **31/31 exact source hashes and 0 missing** before BOM A-14 source migration or promotion; separately resolve read-only Local Model 0.6 schema and variantOf governance, the updated 0.7 future-negative test, Obsidian UI acceptance, and controlled release pins.

**No source Workbench/BOM proposal merges or releases occurred in this recovery task.**

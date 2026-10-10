# A-14 — Obsidian runtime acceptance protocol

**Status: READY TO EXECUTE; NOT EXECUTED.** This is an acceptance plan, not evidence of a working Obsidian session.

## Build under test
- Repository: `spencerskelly/MDSE_Workbench`
- Proposal branch: `proposal/bom-a14-readonly-quantity-uom`
- Target commit: `eeda0618d3a566d552f6801eb2e74ea4650b3a47`
- CI run: https://github.com/spencerskelly/MDSE_Workbench/actions/runs/37875949229
- CI: TypeScript typecheck PASS; focused BOM tests PASS; full historical suite FAIL (baseline failures). **Do not merge to `main`.**

## Setup
Use a *disposable* Obsidian vault, with the proposal Workbench build installed deliberately for testing. Never deploy this draft directly to a production Ampure vault. Ensure the vault's **test-only** relationships schema recognizes `variantOf` as a one-way Object→Object field. Preserve a copy of the pretest vault and Workbench logs.

Create three notes with valid model metadata and unique identifiers under the applicable current standard:
- `Family` — `type: Object`
- `Product A` — `type: Object`
- `Non-object` — a supported non-Object type

Use the appropriate frontmatter link quoting syntax, for example:

```yaml
variantOf: "[[Family]]"
```

## Execution matrix
Record **Observed**, **Pass/Fail**, and a timestamp for every case. Expected findings are assertions to check, not observations.

| ID | Action | Expected outcome |
|---|---|---|
| R1 | Add `variantOf: "[[Family]]"` to Product A | Relationship resolves; no Variant Family Finding |
| R2 | Change to `variantOf: Family` | `variant.format` appears even without an Obsidian frontmatter link |
| R3 | Replace with a YAML list containing `[[Family]]` and `[[Non-object]]` | `variant.format` appears |
| R4 | Replace with `variantOf: "[[Missing Family]]"` | `variant.unresolved` (and broken-link diagnostic, if schema tracks this link) |
| R5 | Replace with valid `[[Non-object]]` | `variant.endpoint-invalid` |
| R6 | Make Family point back to Product A while Product A points to Family | `variant.cycle` findings |
| R7 | Enter duplicate links to the same Family in the YAML representation | Duplicate-target finding, or format finding if expressed as prohibited array; never silently accept as valid single target |
| R8 | Fix Product A to `variantOf: "[[Family]]"` | Prior malformed/missing/cycle findings clear after index refresh |
| R9 | Restart Obsidian with malformed `variantOf: Family`; check Review | `variant.format` persists after warm-cache restore or rebuild |
| R10 | Rename Family, update link, and rescan | Resolved target follows approved link handling; no stale diagnostic |
| R11 | Edit another unrelated Object note | Variant findings do not leak between notes; Review counts remain consistent |
| R12 | With an A-14 test assembly, read Local Model 0.6 Part quantity/UOM | Reader accepts valid values without changing the content or enabling 0.6 writing |

## Evidence / acceptance
Capture Workbench version/commit, schema revisions, Obsidian version/platform, exact YAML before/after, Review screenshot or exported findings, and applicable error logs. A-14 runtime acceptance requires R1–R12 observed without unexplained failures; no claim of completion before this happens.

## Open dependencies
1. Governed `relationships.yaml` variantOf relationship and Local Model 0.6 rules are still proposals until approved.
2. Actual Obsidian UI startup, event propagation, cache restoration and restart behavior are not accessible in this execution environment.
3. CI historical suite remains red; the earlier Workbench 0.5 baseline comparison attributed 89 failing test names to the baseline.

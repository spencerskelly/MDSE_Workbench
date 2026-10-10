# A-12 — Proposed MDSE Modeling Ruleset Amendment: BOM, Occurrences and Variants

**Date:** 2026-10-08  
**Disposition:** PROPOSED ONLY — no governance approval or live schema changes  
**Base examined:** `Test_Vault_` branch `importer/baseline-contract-2026-10-05`, `99_System/10_Docs/MDSE Modeling Ruleset 1.23.md` blob `51eeb4f4c9c98937d31f55f942252cb4d1e218ef`; Local Model schema 0.5; element types 1.18; relationships 1.36.  
**Placement:** Proposed new **§17 — BOM import, measured occurrences and configuration families** after §16.5. Do not overwrite/renumber established W-governed text. The 1.23 introduction and §15.7 still describe 0.2 and older Port semantics; the working-branch machine schemas are newer, so reconcile those references before publishing a new authoritative Ruleset version.

## Proposed normative text

### 17.1 Identity and BOM revision scope

Every distinct, normalized manufacturing part number maps to **exactly one first-class Object note**, independent of the number of parents that consume it and the number of historical revisions in the source. Its immutable `uid`/`id` is allocated once and preserved by a source-to-model identity map. Do not create separate Object notes per revision or duplicate notes per product family. BOM-effective configuration is determined per **owning assembly**, not by mixing rows across competing revisions. Preserve the complete source ledger; summarize older revisions and their ledger/query keys in the affected note body. These are BOM adapter rules, not a new revision class or a change to EA translator ownership.

### 17.2 Structural use and Where Used

A BOM child use belongs **only to its parent assembly's governed Local Model `Parts` records**, whose `definition` is a reusable Object reference. Importing assembly usage must **not** generate `partOf`, `hasPart`, `usedBy`, or a parent list on a child note merely because that child occurs in a BOM. `Where Used` is a **derived reverse query** across effective parent-owned records. A disposable index may accelerate the query; provenance joins may enrich results with source configuration/revision and row references. Updating a parent changes its query results without modifying the child. Ordinary, separately asserted semantic `hasPart/partOf` relations are not globally deprecated; BOM usage is not evidence sufficient to author them.

### 17.3 Multiplicity, quantity and units on Part records

In a compatible future Local Model writer version (proposed **0.6**, contingent on governance), a `Parts` record may carry optional `multiplicity`, `quantity`, and `unitOfMeasure`:

- `multiplicity`: positive integral number of **interchangeable individual occurrences**, retaining pre-existing 0.5 compatibility semantics; individually addressable instances require separate records.
- `quantity`: positive, finite, exact-decimal physical **amount per occurrence**; fractional values are permitted and represented without binary-float rounding in the ledger/validator.
- `unitOfMeasure`: governed canonical physical unit for `quantity`; required when `quantity` exists and not meaningful by itself absent a defined quantity (unless a later approved schema explicitly permits it).

When both `multiplicity` and `quantity` exist, aggregate consumption is their product, subject to unit dimensional checks. Do not treat a measured length, mass or volume as a number of instances. Do not double-count `ea` by treating two competing count fields as independent without proven source meaning; uncertain combinations are review findings. Preserve raw source amount/unit exactly. A zero, negative, non-finite, malformed or unknown-unit source amount must be retained in source evidence and flagged rather than coerced into a valid live consumed quantity. Only conversions governed by a dimensionally compatible approved UOM registry may be performed. The canonical approved UOM registry and `ea` precedence remain outstanding decisions.

### 17.4 Family Object and `variantOf`

An engineering-relevant product, assembly or component **family/type** may be a standalone Object definition **without a manufacturing part number**, provided it has independent semantic/navigation value. No new top-level semantic class is created. An Object's `subtype` may be omitted **only if a future approved `element-types.yaml` explicitly permits it**; until then, missing-subtype family fixtures are proposed-format examples, not valid existing-schema notes.

Proposed optional single-target YAML **`variantOf`** is a **one-way Object → Object** relationship identifying defensible family/similar-build grouping. It has no persisted inverse: find members by querying forward links. Targets must exist, be Objects, and not form self-links or cycles. Evidence and confidence should be recorded in the BOM source/assessment ledger or review report, without introducing unsupported note-level keys. Prefer real existing family/type definitions; leave uncertain targets blank and report candidates. Do not synthesize meaningless family Objects to maximize coverage.

### 17.5 Separation of `variantOf`, `subtypeOf` and Local Model `usage`

`variantOf` is **not inheritance**, composition, replacement or a proof of substitutability. Never automatically emit `subtypeOf` because two builds share a family or BOM similarity. `subtypeOf` remains reserved for true invariant reusable specialization under §2. Existing Local Model `usage: variant | option` candidates remain derived from governed `subtypeOf` families, **not** from unreviewed `variantOf` group membership. A variant-comparison report may compare explicit BOM configurations (unchanged, added, removed, count/quantity/UOM/revision changes, nested substitutions, uncertain matches), with a separate human-reviewed outcome: true subtype candidate, parallel configuration, unclear, or inconsistent grouping. Differences must not be silently converted into generalization edges.

### 17.6 Manufacturing lifecycle and stable physical categorization

Source manufacturing lifecycle and MDSE `status` are distinct. Mark a newly imported Object `Retired` **only after** explicit effective production roots, supported-service exceptions, fallback definitions and full reachability have been reconciled, with ambiguous roots, collisions or missing definitions blocking irreversible classification. Never delete unreachable Objects or discard source history; existing human-authored statuses need an approved overwrite rule. A source archive flag is not automatic `supersedes` evidence. Folder placement is navigation only and never creates a relationship. Physical categories are evidence-driven, with conductors nested under Electrical Part and one location per part number; keep the governed directory limits and packaging policy.

### 17.7 Ownership, compatibility and acceptance gates

The **core MDSE standard** governs `quantity`/`unitOfMeasure`, `variantOf`, approved Object subtype omission, validations, editors, templates and variant comparisons. The **BOM adapter** governs part-number normalization, source/revision ledgers, effective BOM selection, reachability retirement rules, categorization and ZIP release partitioning. The BOM adapter remains distinct from the EA translator. A new writer must not emit unsupported 0.6 fields into records marked 0.5; older Local Model formats remain readable and are not silently upgraded. Update machine schemas, Ruleset, AI instructions, templates, Workbench and derived configurations coherently in governed PRs, with W-decision authority resolved first.

## Cross-reference/implementation map

| Proposed section | Existing authority touched | Required follow-up |
|---|---|---|
| 17.1–17.2 | §15.7, §16 identity/rerun, Local Model schema | A-13 / A-14 / A-16; BOM adapter definition |
| 17.3 | Local Model schema 0.5 `records.part` | A-13–A-15; 0.6 candidate schema review; unit fixtures |
| 17.4 | §1.1, element-types schema 1.18, relationships 1.36 | A-13; approve optional subtype omission and one-way `variantOf` |
| 17.5 | §2, Local Model `usage` | A-14–A-16; comparison tests |
| 17.6 | §1 folder navigation, retirement guidance | Phase C / D + source evidence |
| 17.7 | §15.8 / §15.9, §16.4 | A-17 / A-18 governance and release gates |

## A-12 checks and outstanding decisions

- Confirmed proposed §17 does not declare `partOf`, `subtypeOf`, `supersedes`, or an inverse `variantOf` based on BOM usage.
- Confirmed core versus BOM adapter authority is separated.
- Confirmed historical Local Model compatibility and 0.5-to-0.6 writer guard are stated.
- **Not performed:** live Ruleset commit, W-decision allocation, Workbench runtime parsing, MDSE release validation.
- **Open:** approval of version numbers, subtype omission, governed UOM dictionary/`ea` precedence, source-effective BOM conflict resolution, and reconciliation of outdated §15.7 language against working-branch schema 0.5.

**Handoff:** A-12 complete as a reviewable amendment proposal. **Next: A-13 — Update AI/template rules (proposal).**

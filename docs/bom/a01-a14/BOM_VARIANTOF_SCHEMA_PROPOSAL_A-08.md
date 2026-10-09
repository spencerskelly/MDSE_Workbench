# A-08 — Proposed `variantOf` relationship-schema change

**Date:** 2026-10-08  
**Status:** Draft only; no change to governing GitHub repository and no approved W-decision.  
**Source of authority:** `spencerskelly/Test_Vault_`, branch `importer/baseline-contract-2026-10-05`, `99_System/03_Schemas/relationships.yaml` schema 1.36, Git blob `413fd5d32d12331413fda30653c7a3a38ac2d2ab`.  
**Semantic prerequisite:** `BOM_VARIANTOF_CONTRACT_A-07.md`.

## 1. Minimal proposed YAML diff

A future approved change must version `relationships.yaml` (candidate **1.37**, not assigned). Retain all existing paired/symmetric/oneWay definitions and add exactly this single entry **within the existing `oneWay` list**:

```diff
 oneWay:
 - {field: participants, from: [Use Case], to: [Object, Actor, Behavior, Document]}
 - {field: initialState, from: [Condition], to: [Condition]}
 - {field: finalState, from: [Condition], to: [Condition]}
+- {field: variantOf, from: [Object], to: [Object]}
 guidance:
+  variantOf: 'variantOf is an optional, single-target, one-way Object-to-Object family/similar-build grouping. It does not assert inheritance, physical containment, substitutability, or replacement. Never generate subtypeOf or an inverse YAML property from variantOf. Reject self-reference, directed cycles, multiple targets, unresolved links and invalid endpoint classes. Reverse membership is a derived query. Source-derived candidate links require provenance and review per the BOM variant evidence policy.'
```

The existing schema's global `storage` statement about paired inverse synchronization stays intact because `variantOf` is **not paired**. Do **not** add `variants`, `variantOfInverse`, or `supertypeOf` side effects. No change to `hasPart/partOf` or the Local Model is proposed by A-08.

## 2. Checks required by implementations

| Check | Valid | Reason |
|---|---|---|
| `Object A -> Object Family` | Yes | Proper source and target |
| `Object A -> Requirement R` | No | Target not Object |
| `Requirement R -> Object Family` | No | Source not Object |
| `Object A -> Object A` | No | Self reference |
| `A -> B -> C -> A` | No | Cycle |
| `Object A -> [B,C]` | No | More than one forward target |
| `A -> F`, `B -> F` | Yes | Two distinct variants may share one target |
| No `variantOf` on A | Yes | Optional field |
| `A -> F`, no stored inverse on F | Yes | Derived index produces membership |

**Implementation constraint:** The `from`/`to` declaration alone cannot guarantee cardinality or directed acyclicity; those are semantic validator/editor requirements. A link's actual note identity must be resolved before graph validation; comparing Markdown text alone is insufficient. A-08's fixture checker is intentionally a bounded proposed-contract validator, **not** the authoritative Workbench validator.

## 3. Interactions and governance dependencies

- **A-09:** A family/type `Object` with absent `subtype` must be legal before writing unnumbered family Objects.
- **A-12/A-13:** Align Ruleset, Object property order, AI authoring, Fileclasses generation. `relationships.yaml` alone cannot authorize a frontmatter field in all consumers.
- **A-14/A-15:** Workbench reader/index/writer must support this field while preserving existing forward-only records and human edits.
- **A-17/A-18:** Regenerate derived configurations, run acceptance and obtain W decision/branch review before treating `variantOf` as governed.
- **Source authority collision:** On `Test_Vault_/main`, the decision log ends at W-370; the working branch already contains W-371..W-398. Do not pick a new W-number without checking both heads (A-03).

## 4. Test evidence and limits

A standalone fixture checker validates the proposed relationship shape and the semantic graph invariants. See `BOM_A08_VariantOf_Test_Results.txt` and `BOM_A08_variantof_fixture_check.py`. It does **not** prove any change has been integrated into the production MDSE schema, renderer, editor, or release toolchain.

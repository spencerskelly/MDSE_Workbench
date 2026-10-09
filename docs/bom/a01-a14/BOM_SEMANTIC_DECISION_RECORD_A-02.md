# BOM → MDSE: Semantic Decision Record (A-02)

**Date:** 2026-10-08  
**Status:** Proposed contract captured; **not** an approved W-decision or schema change  
**Basis:** `BOM_MDSE_Vault_Implementation_Plan.md` §0.3, §0.6; `BOM_SOURCE_MANIFEST.json` (A-01).  
**Authority:** Core methodology remains `Test_Vault_`; Workbench implementation remains `MDSE_Workbench`. No repository files changed in A-02.

## Decision contract

| Topic | Agreed meaning / constraint | Owning authority |
|---|---|---|
| Part identity | Exactly one MDSE `Object` note per normalized **part number**, stable UID/ID across imports. Distinct revisions and usages do not create new Object notes. | **BOM adapter**, conforming to core identity rules |
| Assembly composition | A parent assembly `Object` owns BOM usage records under `## Local Model` → `### Part Occurrences`. Each occurrence references the child `Object`. Never write BOM-derived reverse `partOf`, `usedBy`, or parent inventories to child notes. | **Core Local Model semantics**; **BOM adapter** for source mapping |
| Where Used | Derive reverse usage from indexed **parent-owned** part occurrences, joined to the source ledger for revisions/configuration; the index is disposable, not independent model authority. | **Core Workbench query behavior**; **BOM adapter** for provenance |
| Count versus amount | Optional `multiplicity` counts interchangeable discrete instances. Optional numeric `quantity` states material/item amount **per occurrence**. Optional `unitOfMeasure` gives a canonical unit (e.g. `m`, `in`, `kg`, `ea`). Preserve raw source quantity/unit; flag zero, invalid, unknown and ambiguous coexistence, rather than coercing. | **Core MDSE standard** (`local-model.yaml`, Ruleset, reader/writer, validation/tests) |
| Variation | Optional, single-target, forward YAML `variantOf` is an `Object → Object` family/similar-build association. The inverse is queried, never stored. Evidence-backed targets preferred; unresolved mappings remain blank with review evidence. It is **not** containment and **not** inheritance. | **Core MDSE standard** (`relationships.yaml`/Object schema, Ruleset, Workbench) |
| Generalization | `subtypeOf` requires separately reviewed genuine reusable invariant specialization. Do **not** promote `variantOf` into `subtypeOf`; current Local Model `usage: variant` retains its existing `subtypeOf` semantics. Compare variants by their actual BOM configurations. | **Core MDSE standard** (variant comparison and review gate) |
| Family/type definitions | Useful product/assembly/part **family Objects** may exist without a part number, without duplicating numbered Objects or creating a new top-level model class. Blank `Object.subtype` is allowed only after explicit schema governance. | **Core MDSE standard** |
| BOM effectivity / history | One effective, deterministically selected current BOM per assembly note. Older and alternative configuration/revision records remain in the immutable ledger and concise assembly/part-body history; no revision notes. Incompatible simultaneously active BOM definitions are **blocking** until resolved, never unioned silently. | **BOM adapter policy** |
| Retirement and replacement | Manufacturing lifecycle is **not** MDSE `status`. After approved production-root/service-exception closure, confirmed unreachable imported parts become `status: Retired` without deletion; preserve category and provenance, and do not override human-written status without governance. Archive alone does not prove `supersedes`; require positive evidence between **different** part numbers. | **BOM adapter policy** under existing core retire-not-delete semantics |
| Physical taxonomy and packaging | Categories/subcategories are navigation, not `partOf`. Primary types include System, Mechanical Assembly, Electrical Assembly, PCBA, Mechanical Part and Electrical Part (with Conductors below Electrical Part). ≤75 generated model notes per folder; targeted navigation pages, stable paths, no duplicate notes. ZIP segments reconstruct **one standalone vault**. | **BOM vault release policy**, respecting core path/runtime constraints |

## Scope and implementation boundary

- **Core changes requested, not yet approved:** Local Model `quantity`/`unitOfMeasure` and count coexistence; optional `variantOf`; family/type `Object` subtype-omission rules; variant comparison and `subtypeOf` review; Workbench parser/indexer/editor/validation and regenerated downstream configs. Maintain legacy Local Model reader compatibility and version changes under governance.
- **BOM-only rules:** Source normalization and immutable provenance; stable part-number-to-note map; revision summaries; root/effective-BOM selection; lifecycle/reachability; deterministic category placement; standalone segmented vault packaging. **Do not** add these requirements to EA translation semantics unless separately governed.
- **Prohibited shortcuts:** Child-maintained reverse assembly links, one note per revision, accidental `subtypeOf`, silent active-BOM union, retirement based only on archive flag, guessed units/quantities, duplicated family notes, edits to generated Fileclasses, or direct unapproved changes to `main`.

## Gate and unresolved questions

1. **A-03:** Reconcile current W-number/branch authority before assigning or implementing any core decision. A-01 found `MDSE_Workbench/main` WB-128 referring to W-385 while `Test_Vault_/main` decision log observed through W-370.
2. **A-04–A-09:** Finalize number/unit precision, counted `ea` precedence, allowed UOM and family subtype omission; validate existing Local Model/schema compatibility before selecting version numbers.
3. **B/C phases:** Profile actual CL1/CL2/effectivity fields and S1/S2 discrepancies; explicitly approve the active root allowlist and service exceptions before retirement.
4. **D/F phases:** Review variant target confidence and generalization separately; unresolved associations remain findings, not forced links.

**Disposition:** A-02 **COMPLETE as a proposed semantic decision record**. No rules or schemas are claimed to be approved or deployed. **Next step: A-03 — Check current W-decision numbering.**

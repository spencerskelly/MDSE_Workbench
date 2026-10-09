# A-10 — Variant and assembly configuration comparison contract

**Date:** 2026-10-08  
**Status:** Proposed core MDSE capability; no schema or repository mutation.  
**Basis:** `BOM_MDSE_Vault_Implementation_Plan.md` §0.3 (especially items 5–8), §0.6, A-10, F-04–F-08; A-04/A-05 quantity contract; A-07/A-08 `variantOf` contract; A-09 Object family proposal. 

## 1. Purpose and boundaries

Compare two **explicitly selected assembly configurations** (part-number Objects, or one assembly's historical/effective configurations) based on their actual BOM occurrence records. This is useful for assessing design differences, candidate family groupings, and whether a generalization review is warranted. `variantOf` is a navigational grouping hint, **not** evidence that one structure inherits from another, is interchangeable, or is substitutable. Neither comparison nor grouping automatically writes `subtypeOf`, `variantOf`, `supersedes`, or child-side assembly relationships.

The preferred live source is the **parent-owned** Local Model Parts section of each chosen effective assembly. Revision-specific or historical comparisons use immutable source ledger/configuration keys. Never mix simultaneously active incompatible BOMs or silently treat the union of revisions as one configuration. Input sources retain provenance, lifecycle states, source row keys, revision identifiers and exact amounts/units.

## 2. Comparison request / result contract

**Required input:** `leftOwnerUid`, `rightOwnerUid`, each with selected `configurationKey` (or a deterministically resolved effective selection), `comparisonMode` (`direct` | `recursive`), ledger snapshot/version, identity registry, and an explicit UOM/conversion registry version when conversions are enabled. This comparison is valid even when neither Object has `variantOf`.

**Optional inputs:** maximum traversal depth, display grouping by function/subassembly, and reviewed equivalence/substitution mappings. Do not infer equivalent parts solely from names or shared family links.

**Output:** a stable comparison ID from normalized input identities/configuration keys and algorithm version; source snapshots/hashes; direct and recursive result sets; uncertainty/blocker list; proposed (not asserted) generalization disposition; totals only where quantity semantics permit. Every difference should carry both owner paths, occurrence/block IDs or historical row keys, part identity, quantities/units/revision where known, and the exact reason for its classification.

## 3. Matching and normalization rules

1. **Same component identity:** resolve part number to the canonical Object UID. Compare repeated occurrences by stable source line/occurrence IDs and supported instance identifiers; aggregate interchangeable identical parts in one owner only when the Local Model contract allows it. Do not merge separately addressable occurrences.
2. **Comparable fields:** part UID, local `identifier`, `multiplicity`, `quantity`, `unitOfMeasure`, selected child revision/configuration, and occurrence path. Missing is not zero. Exact source decimals are compared using decimal arithmetic rather than floating-point rounding.
3. **Quantities:** `multiplicity` represents interchangeable instance count; `quantity` is measured amount **per occurrence**; when both are present aggregate consumption = quantity × multiplicity. `unitOfMeasure` is required whenever `quantity` is provided in the candidate contract; convert units only through a versioned approved dimension-compatible table. `ea` alongside multiplicity requires an explicit no-double-count rule and is not automatically multiplied as two independent counts.
4. **No implicit match by family:** different part UIDs are an add/remove pair unless an approved substitution/equivalence map allows them to be reported additionally as a **substitution** (with evidence and confidence). An ambiguous pairing remains unresolved.
5. **Revision context:** retain part revision vs. parent BOM configuration separately; a part-number Object remains one note, not one per revision.
6. **Determinism:** sort output by path, category, canonical part UID, then occurrence/source key; identical inputs must yield identical results.

## 4. Difference classification

| Category | Exact condition | Required output |
|---|---|---|
| Unchanged/common | Same resolved part identity and equivalent occurrence semantics in matched context | Common count and canonical identity; do not suppress provenance |
| Added / removed | Occurrence present only on right / only on left | Side and owner path; raw plus normalized amounts |
| Multiplicity changed | Same part/context with different interchangeable instance count | Left/right counts, delta |
| Quantity changed | Same part/context with different exact measured quantity (after explicit comparable-unit conversion, if used) | Left/right value/unit, per-occurrence and derived consumption delta where valid |
| UOM changed | Same part/context with different unit labels | Dimension and conversion result; flag nonconvertible/unknown units, not a numeric delta |
| Revision/configuration changed | Same part UID with different selected effective revision or child BOM configuration | Both revision/configuration keys, corresponding ledger references |
| Assembly substitution | Different child assembly identities in homologous role/position, **with evidence-backed mapping** | Pair plus evidence and independent nested differences |
| Uncertain pairing | Multiple matching candidates, missing identifiers, unresolved active configuration, unknown UOM, invalid source amount, or unsupported semantics | Review reason; no forced identical/substitution verdict |
| Changed internal decomposition | Same high-level function/role but different descendant subgraph | Report direct assembly identity change and recursive leaf differences separately |

A single occurrence may yield multiple field-level differences. Report both direct and recursive outcomes; do not double count a substitution as independent physical consumption if the recursive comparison already accounts for its leaves.

## 5. Recursive comparison

Traverse each selected child assembly's **selected configuration**, preserving an ordered owner/occurrence path. Compare shared subassembly identities at the same contextual role; for unlike subassemblies, use only reviewed substitution mapping. Output both direct substitution and leaf-level change sets, labeled by level. Detect cycles; block the affected traversal and provide the complete cycle path, rather than looping or inventing totals. Missing definitions and ambiguous effective configurations block affected paths; show unaffected comparison portions and mark overall completeness `PARTIAL` or `BLOCKED`.

Shared parts used in two paths are counted separately **for consumption**, but their Object note identity remains unique. Where Used remains a separate derived reverse query over parent-owned records; child notes are never rewritten by comparison.

## 6. Generalization review (not a mutation)

Review pair/group outcomes using **function, invariant interface/behavior, allowed specializations, and substitution contract**, in addition to BOM similarity. Dispositions:

- **Potential true subtype:** an explicit reusable parent abstraction/invariant and clear specialization evidence exists; flag for human/schema-governed approval of `subtypeOf`.
- **Parallel configuration / similar build:** related products or assemblies, different BOM realizations, with no proven inheritance; `variantOf` may be suitable if evidence meets A-07 threshold.
- **Unclear:** missing definitions, contradictory function or interface evidence, ambiguous substitutions/configuration, insufficient evidence; no relationship automatically added.
- **Inconsistent grouping:** contradictory family link, dissimilar fundamental purpose, cyclic grouping or evidence against the proposed type association; flag correction/review.

A high percentage of common part numbers is **never by itself** proof of a generalization. `Local Model usage: variant` continues to depend on approved `subtypeOf` per existing semantics, not `variantOf`.

## 7. Minimum acceptance fixtures (for F-phase execution)

| ID | Fixture | Expected |
|---|---|---|
| VC-01 | Same 3 effective BOM lines, same UIDs/counts/units | Unchanged only |
| VC-02 | Right adds C; left-only B | Added C and removed B |
| VC-03 | Same fastener: multiplicity 4 vs 6 | Count delta +2, not a measured-quantity delta |
| VC-04 | Same wire: 2 × 0.35 m vs 2 × 0.40 m | Per-run delta +0.05 m; total delta +0.10 m |
| VC-05 | 35 cm vs 0.35 m, registered compatible conversion | No physical quantity change; raw UOM change preserved |
| VC-06 | 0.35 m vs 0.35 kg | UOM incompatibility; blocked numeric comparison |
| VC-07 | Same part UID, revision R1 vs R2 | Revision change; no duplicate part note |
| VC-08 | Assembly X replaced by Y with reviewed pairing | Substitution and recursive differences both visible, no double count |
| VC-09 | Similar name, no verified pairing | Added/removed and uncertain pairing candidate, no asserted substitution |
| VC-10 | Two conflicting active configurations on one side | Configuration blocker; no silently selected/merged BOM |
| VC-11 | Different children but similar top-level function, no interface invariant | Similar-build review, not auto-subtype |
| VC-12 | Repeated leaf UID in two subassemblies | Each occurrence counted on its path; one Object note |
| VC-13 | Cyclic assembly graph | Affected path blocked with cycle explanation |
| VC-14 | Both variants point to same family Object | Reverse family query works; still no automatic inheritance |
| VC-15 | Unknown source quantity or zero quantity | Raw evidence retained, consumed total unavailable, flagged |
| VC-16 | No `variantOf` on either Object | Direct comparison still supported |

## 8. Dependencies, decisions and handoff

**Core standard / Workbench:** agree comparison input/output model, deterministic identity and status vocabulary, indexed query/display, allowable UOM conversions, variant family query and generalization review gate (A-10, F-01–F-10). **BOM adapter:** effective-BOM selection, revision/configuration evidence, source line provenance, matching candidate reports and complete immutable ledger (B/C/E phases).

**Open:** approval of A-04 quantity/UOM semantics; current working-branch schema 0.5 vs proposed 0.6; one-way `variantOf` and optional family subtype are proposals; approved equivalence/substitution evidence policy is outstanding; CL1/CL2 and UOM source meanings must be profiled during Phase B. W-399 is only a potential allocation, not an approved decision.

**Disposition:** A-10 contract documented. It is not a claim that any full BOM comparisons, Workbench queries, or production validation have been executed. **Next: A-11 — Write canonical example notes.**

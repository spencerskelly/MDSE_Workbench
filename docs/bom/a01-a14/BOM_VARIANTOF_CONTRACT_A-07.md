# A-07 — Proposed `variantOf` semantic contract

**Date:** 2026-10-08  
**Status:** Proposed core MDSE extension; not a W-decision and not an approved schema change.  
**Evidence baseline:** `Test_Vault_` branch `importer/baseline-contract-2026-10-05`, `99_System/03_Schemas/relationships.yaml` v1.36, Git blob `413fd5d32d12331413fda30653c7a3a38ac2d2ab`; A-02 decision record and implementation plan §0.3 (7–8), §0.6. 

## 1. Meaning and direction

`variantOf` means **this Object is a member of / similar build to an identified Object family or type**, suitable for side-by-side configuration comparison. It does **not** imply substitutability, shared structure, interface compatibility, subtype inheritance, ownership, physical placement, or replacement. It does not assert that the target is a supertype.

- **Domain and range:** `Object → Object` only, including numbered parts and meaningful non-numbered family/type Objects (where supported by separate Object schema approval).
- **Storage:** Optional, **single forward YAML link on the variant Object**, never a stored `variants` inverse on the family Object. Multiple candidate families are maintained in a review ledger rather than multiple `variantOf` values.
- **Target:** An existing, stable, resolvable Object note UID; prefer suitable existing family/type Objects, then create a real family/type Object only when justified by reusable meaning. Never point to self.
- **Query:** `variants(target)` is a reverse index/query of forward edges. The index is disposable and rebuilt when links change; the target note remains unchanged.
- **Grouping hierarchy:** A family Object may itself be a variant of a broader family, but this is only a grouping chain. Direct membership and transitive descendants must be separately identifiable in queries, with path/cycle safeguards.
- **No forced coverage:** It is valid to omit `variantOf` when evidence is insufficient. Family inference is not performed from folder path, part number prefix, or BOM parentage alone.

## 2. Evidence and confidence rules

| Disposition | Rule | YAML emitted? |
|---|---|---|
| Confirmed | Authoritative product/type declaration or manually reviewed equivalent family grouping; no conflicting evidence | Yes |
| Supported / defensible | Two independent consistent signals, such as standardized type description + comparable function/configuration/BOM topology, with no material contradiction | Yes, with evidence/confidence retained in source-derived review ledger |
| Candidate | One signal, uncertain family identity, overlapping plausible targets or a contradiction requiring review | No; candidate ledger only |
| Rejected | Different fundamental function/type, misleading name similarity, cycle, self-reference, or known inconsistent grouping | No; rejection reason recorded |

The BOM adapter must retain source rows/description keys, confidence, reviewer/algorithm version, reason, target UID, and disposition in a separate evidence ledger. Confidence is **not** silently embedded as ungoverned YAML properties. The core field stores only an accepted target. Manual edits must not be overwritten by a lower-confidence importer inference.

## 3. Validation and mutation semantics

1. `variantOf` is valid only on an `Object`, with one valid Object target and a resolved unambiguous link.
2. Reject self-links, duplicate/multiple YAML target values, dangling/non-Object targets, and directed cycles (including multi-hop cycles).
3. Mutation updates the source Object only; no YAML inverse is added or repaired on the target. Reverse query results must update from the forward-edge index.
4. If target deletion/retirement/move makes resolution uncertain, flag validation; do not silently relink using only a similar display name. A retired target may remain referenced if identity and meaningful family semantics persist; warn if the definition is not viable.
5. Never interpret `variantOf` as `hasPart/partOf`, an assembly BOM occurrence, `copyOf`, `supersedes`, or `subtypeOf`.
6. Never generate, delete, or alter `subtypeOf` because `variantOf` was created/removed. Existing Local Model `usage: variant` selection still uses approved `subtypeOf` specialization, not this grouping.
7. Workbench comparison uses each Object's actual selected effective BOM; if active configurations are ambiguous, report blocked/uncertain rather than an invented comparison.

## 4. Example (illustrative; not yet schema-valid)

```yaml
class: Object
partNumber: PC-100-A
variantOf: "[[PC-100 Charger Family]]"
```

The above illustrates the *single forward link* only. Exact current Object YAML property order, link representation and target UID resolution must be taken from the approved `element-types.yaml` and templates during A-08/A-13. No `subtypeOf` or target-side `variants` list is implied.

## 5. Interaction with existing relationship architecture

The working-branch `relationships.yaml` v1.36 distinguishes `paired`, `symmetric`, and `oneWay` relationships. Its declared `storage` defaults to materialized inverse values for **paired** relationships. Therefore `variantOf` belongs in **`oneWay`**, not `paired`. Proposed entry (illustrative):

```yaml
oneWay:
  - {field: variantOf, from: [Object], to: [Object]}
```

A-08 must add the authoritative schema definition and guidance, then align the Object property schema, Fileclass generation, Workbench reader/writer/query, validation and template order. Do not materialize an inverse simply because most other relationship pairs do so.

## 6. Small acceptance fixtures for subsequent steps

| Fixture | Expected |
|---|---|
| A, B both point to family F | F reverse query returns A and B; F YAML unchanged |
| A points to B, B to F | Direct F members = B; transitive includes A and B, with path distinctions |
| A points to A | Invalid self-link |
| A → B → C → A | Invalid cycle, reject proposed edge |
| A points to Requirement R | Invalid endpoint class |
| A has two targets in field | Invalid cardinality; review target ambiguity |
| A and B share 95% parts but different function | Candidate/rejected; no automatic YAML |
| A has `variantOf: F` and no `subtypeOf` | Valid grouping; `usage: variant` **not** enabled from grouping alone |
| A variant target moves folder but UID stable | Resolve by governed stable identity, no new family note |

## 7. Governance decisions outstanding

- Adopt `variantOf` as `oneWay` and choose next `relationships.yaml` version from actual authority (currently 1.36 on working branch).
- Confirm allowable Object family/type definition with unset `subtype` separately in A-09.
- Confirm exact YAML link/cardinality representation and fileclass/property order in A-08/A-13.
- Approve evidence threshold and human override precedence before bulk inferred links.
- Coordinate relationship-schema changes with Local Model 0.6 proposal but **do not** conflate their version numbers.

**A-07 disposition:** Draft specification complete. No core repositories, schemas, or generated files modified. **Next A-08:** Draft relationship schema change.

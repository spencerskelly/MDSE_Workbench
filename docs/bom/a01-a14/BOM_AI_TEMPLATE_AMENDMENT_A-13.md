# A-13 — Proposed AI Instructions and Object Template Amendment

**Status:** PROPOSAL ONLY; unmerged, not authoring authority. **Date:** 2026-10-08. **Scope:** BOM units and `variantOf` additions to core MDSE.

## Source baseline (frozen for review)

`spencerskelly/Test_Vault_` branch `importer/baseline-contract-2026-10-05`:

| File | Blob SHA | Existing behavior |
|---|---|---|
| `99_System/02_AI/AI_INSTRUCTIONS.md` | `5e3eeb2b88a93714a6095464d7e711ec254b03e1` | Templates and governed property order; instructions still say Local Model 0.2 and reusable Port |
| `99_System/05_Templates/Object.md` | `24e4ddf3c1b34dc3e2536b9cfe117cd863e6f6eb` | `subtype: electrical` default, `status: Draft`, stable headings |
| `99_System/03_Schemas/element-types.yaml` | `3f694feadb2eafd41498aff5ebc24946b9715f6d` | 1.18; Object subtype enumerated; fixed common property order |
| `99_System/03_Schemas/relationships.yaml` | `413fd5d32d12331413fda30653c7a3a38ac2d2ab` | 1.36; forward/paired/one-way relationship classes |
| `99_System/03_Schemas/local-model.yaml` | `361dee8269f9fbdfd16bcee33a1b808015f7ba5a` | 0.5 writer, reads 0.1–0.5; `Parts`, `Interfaces`, `Connections`; `multiplicity` only |

Do not activate this amendment before the A-05/A-08/A-09 schemas, W-decisions, writer/reader and release checks agree. Candidate schema versions (Local Model 0.6, relationships 1.37) are not approved releases.

## 1. Minimal proposed amendments to `AI_INSTRUCTIONS.md`

### Creating a note — insert after numbered step 1

> **Object families and variants (only when approved schemas are installed):** Reuse an existing meaningful Object family/type definition before adding a new one. A family/type definition does not need a part number; a numbered physical part has exactly one note across uses/revisions. For an Object family/type note, `subtype` may be omitted only under the approved Object subtype-omission rule; otherwise select a valid subtype and do not treat an empty value as automatically valid. An optional `variantOf` on an Object is **one** forward Obsidian note link to another Object representing a defensible family/similar-build grouping. Confirm the target exists, is not the note itself, and that the chain has no cycle. Leave uncertain candidate links out of YAML and log their evidence for review. `variantOf` is not `subtypeOf`, `partOf`, or `hasPart` and does not assert inheritance.

### Relationships — append

> `variantOf` is a one-way relationship, so write only the originating Object's field. Never persist `variants`, `variantBy`, or another inverse field on the target. A query may derive family members by searching `variantOf`. Do not generate `subtypeOf` or Local Model `usage: variant` from a `variantOf` link. Keep normal paired/inverse behavior for other relationships exactly as governed by `relationships.yaml`.

### Local occurrences — replace stale canonical-writer sentence and append

> Follow the writable version in `local-model.yaml`; do not hardcode 0.2 or automatically upgrade older 0.1–0.5 regions. Under the **future approved** quantity-capable schema, an assembly Object owns its `### Parts` records, each with an Object `definition` and optional `multiplicity`, `quantity`, `unitOfMeasure` in schema-defined order. `multiplicity` counts contextually interchangeable discrete occurrences. `quantity` is an exact positive decimal consumption **per occurrence** and `unitOfMeasure` is its approved physical unit. When both are present, the derived aggregate is multiplicity × quantity, only if aggregation is appropriate. `unitOfMeasure` requires quantity and vice versa under the A-05 candidate policy. Do not infer a multiplicity from a measured length/mass; do not record zero, unknown, NaN, or unrecognized UOM as accepted consumption. Retain raw source evidence in the BOM ledger and flag for review. Do not silently convert units. The BOM importer writes parent-owned Parts only; do not generate child-side `partOf`, `usedBy`, `hasPart` or Where Used inventories from BOM usage. Where Used is a derived query.

### Local occurrences — terminology correction (separate validation before merge)

> Replace the stale statement that every contextual endpoint must have a reusable Port with the 0.5 rule: an Interface endpoint occurrence may omit its reusable Object/interface `definition` when no deterministic definition exists; connectivity and exposure follow `local-model.yaml`. Preserve existing same-version editor semantics for old records. This correction is necessary to avoid regression but is not itself part of the quantity fields.

### Sparse optional properties — append

> `variantOf` is a governed **relationship**, not a generic sparse optional scalar. Place it in the relationships portion of YAML after `tags` and any governed sparse options such as `abstract`, in relationship-schema order. Only Objects may use it; treat its value as exactly one note link, not a list.

## 2. Object template policy

**Keep** `99_System/05_Templates/Object.md`'s existing seven YAML keys, property order, status and headings unchanged for normal Object creation:

```yaml
---
type: Object
subtype: electrical
id: <% tp.file.include("[[Snippet - id]]") %>
uid: <% tp.file.include("[[Snippet - uid]]") %>
status: Draft
tags: []
---
```

Do **not** insert `variantOf:` with an empty value into every Object or put a default family link in the template. It is optional, evidence-dependent; add only when validated, after `tags` (and any approved sparse optional properties) as governed by relationship ordering. No change to existing body headings `Definition`, `Notes`, `Aliases`, `Former ids` is required. Do **not** change the default to `subtype:` blank. A family-definition authoring path may **omit the entire `subtype` line**, but only once `element-types.yaml`, note validator, Fileclass generation and Workbench explicitly support that omission. Until approval, the template's existing subtype is required.

### Future approved Object example (not schema-valid today)

```yaml
---
type: Object
subtype: electrical
id: OBJ-XXXXX
uid: 20261008120000000sampleauthor-
status: Draft
tags: []
variantOf: "[[Example Charger Family]]"
---
```

The values above are illustrative placeholders and must not be copied as a valid allocated identity. A subtype-free family note can be created only once the subtype policy is approved; omission is distinct from an empty string.

### Future approved parent-owned part occurrence example (not schema-valid today)

```markdown
<!-- MDSE:LOCAL-MODEL START schema=0.6 -->
## Local Model
### Parts
#### Wire run
- definition: [[Example Wire]]
- multiplicity: 2
- quantity: 0.35
- unitOfMeasure: m
^part-20261008120000000sampleauthor-
<!-- MDSE:LOCAL-MODEL END -->
```

This illustrates placement and semantics only; actual marker/heading order, identity allocation, supported units and full record syntax must be tested against the approved writer before production. The child Wire Object must not contain a reverse BOM parent list.

## 3. Implementation ownership and rollout order

1. Approve A-05, A-07/A-08, A-09 semantics; reconcile branch W-decision authority. No W ID is allocated by A-13.
2. Update the core schemas and Ruleset *together*; update `AI_INSTRUCTIONS.md` using the scoped additions above. Preserve `type, subtype (when present), id, uid, status, tags`, then sparse options, then relationship fields.
3. Leave the ordinary Object template's required keys/defaults intact; add a separate conditional family-authoring path only after schema support, not a new top-level class.
4. Update the Local Model reader/writer and template-related code; retain read-only/compatibility behavior for older schema regions.
5. Regenerate downstream Fileclass/plugin config from schema authority, do not hand-edit generated files. Run release checker and fixture tests; do not claim an approved/golden release until gates pass.

## 4. Validation matrix (future integration gates)

| Case | Required outcome |
|---|---|
| Existing Object template | Unchanged default `subtype: electrical`; retains Draft, key order and headings |
| Object `variantOf` | One valid linked Object; no inverse writing |
| Family subtype omitted | Accepted only after explicit schema approval; do not serialize `subtype: null` opportunistically |
| Non-Object `variantOf` / cycle / self-link / list | Rejected |
| Family membership query | Derived from forward Object links, no duplicate inverse field |
| Assembly part measured material | Optional exact positive `quantity` with approved UOM |
| Counted fastener | `multiplicity` without a fabricated measurement |
| Dual fields | Deterministic aggregate with no double-counting of `ea` |
| Unknown/zero raw source amount | Ledger preserved, finding emitted, no accepted live consumption |
| Earlier Local Model 0.1–0.5 | Read compatibility and no silent rewrite |
| Parent-only Where Used | Child note unchanged when parent adds/removes a use |
| Fileclass/Workbench/schema release | All synchronized before authoring is enabled |

## 5. Checkpoint

**A-13 status:** Proposal drafted; no repo mutation. **Next:** A-14 — Workbench reader validation, bounded fixture/test-first implementation.

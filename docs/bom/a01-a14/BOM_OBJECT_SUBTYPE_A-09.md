# A-09 — Object subtype omission for family/type definitions

**Date:** 2026-10-08 (planning baseline; executed next day UTC)  
**Status:** PROPOSED — not merged or approved  
**Authority inspected:** `spencerskelly/Test_Vault_`, branch `importer/baseline-contract-2026-10-05`, `99_System/03_Schemas/element-types.yaml` schema **1.18**, blob `3f694feadb2eafd41498aff5ebc24946b9715f6d`; `local-model.yaml` schema 0.5, blob `361dee8269f9fbdfd16bcee33a1b808015f7ba5a`.

## Finding

The current element-types schema declares `commonProperties: [type, subtype, id, uid, status, tags]` and the Object subtype enumeration `[electrical, circuit, mechanical, software, firmware, part, interface]`. It does **not** explicitly authorize omission, null, or blank `subtype` for Object. Other classes have empty subtype arrays, but that does **not** establish a rule for Object. Consequently, do not generate blank-subtype family Objects under today's schema without a governed exception/change.

## Decision proposed

Allow a family/type **Object** to omit the YAML `subtype` field where no listed subtype truthfully applies. Such a note still has `type: Object`, ordinary Object identity and governed properties, and no invented physical decomposition. This does not create a `Product Family` top-level class. A numbered part may only appear once; non-numbered semantic family/type Objects are distinct from part-number Objects and require useful definition/evidence.

- **Canonical form:** absent `subtype` for qualifying Object family/type notes; never emit `subtype: ''`, `subtype: null`, or placeholder labels.
- **Applicability:** restrict omission to Object; all other classes retain their existing rules.
- **Semantics:** an omitted subtype means *no governed Object subtype asserted*, not `abstract: true`, not a default classification, and not an error in identity.
- **Default:** if credible subtype evidence exists, retain it. An arbitrary imported part with missing classification is **not** automatically entitled to omit subtype; classify it or record a review finding.
- **Relations:** `variantOf` may target such an Object once approved, but does not imply `subtypeOf`; abstract types are separate decisions. Ordinary `subtypeOf` validation and Local Model `usage` semantics stay unchanged.
- **Compatibility:** existing Object notes, schema-valid subtypes, readers, and writers retain behavior. The optional omission is an additive, versioned policy, not a rewrite of old files.

## Minimal schema amendment (illustrative, pending grammar review)

Use an **explicit per-class omission rule**, rather than appending a fake `none` subtype:

```yaml
# Proposed changes relative to element-types.yaml 1.18
schemaVersion: '1.19' # candidate only; confirm version at governance
classes:
- name: Object
  prefix: OBJ
  subtype: ["electrical", "circuit", "mechanical", "software", "firmware", "part", "interface"]
  allowSubtypeOmission: true  # NEW schema key; implement in readers/validators/templates before release
```

The fragment illustrates the intended delta, not a standalone replacement for `element-types.yaml`; `allowSubtypeOmission` is **not** presently a supported machine-schema key and must not be added without consumer implementation. Keep `subtype` in governed property ordering when present; skip it canonically when absent. The actual next schema version must be checked against any newer branches before commit.

## Acceptance scenarios (to implement with approved validators)

| ID | Input | Expected |
|---|---|---|
| O-01 | `type: Object`, omitted `subtype`, explicit documented family/type purpose, no part number | Valid after amendment |
| O-02 | `type: Object`, `subtype: electrical` | Valid, unchanged |
| O-03 | `type: Object`, `subtype: ''` | Invalid; omit field instead |
| O-04 | `type: Object`, `subtype: null` | Invalid; omit field instead |
| O-05 | `type: Object`, `subtype: unknown` | Invalid |
| O-06 | `type: Behavior`, omitted `subtype` where Behavior requires allowed subtype | Unchanged current validation; no new exemption |
| O-07 | family Object `variantOf` target (after A-08 approval) | Link can resolve without forcing a subtype |
| O-08 | imported numbered component with missing subtype and no family/type evidence | Import review required; omission not used as silent escape |

## Downstream impact and release gate

1. Amend element-types schema and Ruleset in one governed change once approved.
2. Adjust Object note templates and property serializers (including Fileclass regeneration) so omitted subtype is treated as intentional and not regenerated as an empty property.
3. Verify Workbench, importer, release checker, and AI instructions tolerate subtype absence *only under this rule*.
4. Test variant target resolution and note uniqueness; ensure no duplicate numbered-part note is created merely to establish a family.
5. Do not claim this as accepted until relevant changes are merged under a non-conflicting W-decision and release checks pass.

**Disposition:** A-09 proposal complete. No governing repository changes. **Next: A-10** — specify variant-comparison outputs and generalization review.

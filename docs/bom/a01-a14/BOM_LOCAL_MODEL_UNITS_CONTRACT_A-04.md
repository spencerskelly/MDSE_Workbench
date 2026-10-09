# A-04 — Local Model Parts: Units and Occurrence Contract

**Date:** 2026-10-08  | **Status:** PROPOSED, not authoritative  | **Next:** A-05 schema amendment

## Authority and compatibility

This proposal extends the *Parts* record of the current **Local Model 0.5 working-branch schema** (`Test_Vault_`, `importer/baseline-contract-2026-10-05`, `99_System/03_Schemas/local-model.yaml`, blob `361dee8269f9fbdfd16bcee33a1b808015f7ba5a`). Its Parts record currently requires `definition` and permits `usage`, `identifier`, and `multiplicity`. Neither `quantity` nor `unitOfMeasure` is currently allowed. The 0.5 working branch is ahead of `main` and is not an issued MDSE release. **Do not write these new fields under marker `schema=0.5` before governance approves a versioned extension, reader, writer, and tests.** Historic 0.1–0.5 Local Models remain readable under their original rules.

## Field semantics (all optional per `part` record)

| Field | Meaning | Valid value | When omitted |
|---|---|---|---|
| `multiplicity` | Number of interchangeable *individual instances* represented by one local Part occurrence | Positive base-10 integer (`1, 2, ...`); governed existing `positiveIntegerOrSourceMultiplicity` compatibility requires explicit review in A-05 | One individually identified occurrence, or unknown count; not an inferred physical measurement |
| `quantity` | Consumed amount of the specified item/material **per interchangeable occurrence** | Finite, strictly positive, exact decimal; may be fractional (e.g., `0.35`) | No measured amount specified; do not assume zero or one |
| `unitOfMeasure` | Canonical, unambiguous unit of `quantity` | Controlled UOM code; candidate symbols `ea`, `in`, `m`, `kg` pending governed vocabulary | Allowed only if `quantity` is absent; `quantity` with no UOM is invalid until mapped/reviewed |

### Computation and non-double counting

- **Counted items:** use `multiplicity` (e.g., four interchangeable screws: `multiplicity: 4`), generally without `quantity` or `unitOfMeasure`. A source quantity of `4 ea` is mapped to multiplicity **only when source meaning is a discrete interchangeable count**, otherwise flagged for review. Never emit `multiplicity: 4` plus `quantity: 4`/`unitOfMeasure: ea` from a single source `4 ea` row.
- **Bulk items:** use `quantity` and `unitOfMeasure` (e.g., wire `quantity: 0.35`, `unitOfMeasure: m`); no count is implied. A quantity is attached to the owning parent Part record, not to the child Object note.
- **Both present:** total consumed amount = `multiplicity × quantity`, in `unitOfMeasure`. Example: two identical cable runs each consuming `0.35 m` means `multiplicity: 2`, `quantity: 0.35`, `unitOfMeasure: m`, derived total `0.70 m`. Use both only with distinct source or reviewed engineering evidence for the two factors.
- **Individually addressable components** stay as separate Part records under the existing Local Model rule, not one multiplied record.
- **No implicit aggregation of different units** (`in` vs `m`) or incompatible dimensions; conversions, if approved, must be exact/reproducible with a versioned unit table and preserve source precision/provenance. Query totals must show the basis and only sum compatible units.

### Numeric and unit integrity

1. Parse decimal text without binary floating-point rounding; recommended implementation uses arbitrary-precision decimal and preserves the source lexeme, locale, unit string and raw amount in an immutable source ledger. Preserve meaningful input digits (for display/audit), while numeric equivalence may normalize trailing zeros for arithmetic.
2. Reject values that are zero, negative, nonnumeric, NaN, infinity, ranges, or qualifiers as consumed `quantity`. Keep all raw cells; flag zero/invalid/unknown rather than dropping, coercing to `1`, or creating a silent live Part amount.
3. `multiplicity` must be an integer count in canonical written records; fractional source counts are **not** rounded or automatically moved to `quantity` without a unit mapping. Existing legacy `positiveIntegerOrSourceMultiplicity` requires review before tightening historical parsing.
4. Unit strings must resolve through a controlled, case-sensitive dimension-aware vocabulary; distinguish `m` (length) from other spellings, avoid silent alias conversion, and reject unknown/ambiguous source UOM for writing. Source aliases can be mapped only via documented normalization rules.
5. Material quantities are never treated as component instance counts. An unmeasured source amount cannot be interpreted as `ea` by default.

## Illustrative future record (not schema-valid yet)

```markdown
### Parts
#### R1 — Wire
- definition: [[01798-006-M - Wire]]
- multiplicity: 2
- quantity: 0.35
- unitOfMeasure: m
^part-<governed-unique-30-character-token>
```

The heading, marker version, and block token must come from the approved writer. The token above is deliberately schematic, not a valid identity. `Parts` is the heading in the current working-branch 0.5 schema; the earlier implementation plan's `Part Occurrences` sample targets an older schema.

## Checks for A-05/A-06

1. Count only; measured amount only; distinct count and per-instance measurement together.
2. Fractional decimal and exact arithmetic; source `0`, negatives, `NaN`, unknown UOM, missing UOM, fractional count rejected/held with traceable findings.
3. Source `4 ea` has no double-counted total; source `2 × 0.35 m` yields exactly `0.70 m`.
4. Conversions do not alter the original ledger; incompatible dimensions cannot aggregate.
5. Legacy 0.1–0.5 notes parse unchanged, and a new-field writer cannot silently downgrade or mutate old markers.
6. No child-side `partOf` or `usedBy` generated; Where Used computes from owning parent Part occurrences.

## Open decisions / scope boundary

- **Source evidence not yet verified:** A-04 does not establish the exact S1/S2 column meaning for quantity, units, CL1/CL2 or per-occurrence semantics; source profiling is scheduled in Phase B. The numeric examples are illustrative, not claims about source rows.
- Decide the version number **after** reconciling the Local Model 0.5 working branch with released `main` and Workbench compatibility (A-05/A-17/A-18).
- Decide the canonical UOM vocabulary, treatment of explicit `ea` alongside `multiplicity`, whether a bare UOM with no quantity is ever permitted, and how historic source multiplicity tokens should be interpreted in a migration.
- This document is a **core MDSE schema proposal**, not a BOM-import-only definition and not a merged governance change.

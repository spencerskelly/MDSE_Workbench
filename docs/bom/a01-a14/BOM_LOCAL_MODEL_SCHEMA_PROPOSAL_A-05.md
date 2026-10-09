# A-05 — Proposed Local Model Parts schema extension

**Status:** PROPOSAL ONLY — not merged or authoritative  
**Basis:** A-04 units contract; `spencerskelly/Test_Vault_` branch `importer/baseline-contract-2026-10-05`, file `99_System/03_Schemas/local-model.yaml`, Git blob `361dee8269f9fbdfd16bcee33a1b808015f7ba5a` (observed schema `0.5`).  
**Owner:** Core MDSE methodology, not the BOM adapter.

## Decision

Propose **Local Model 0.6** as the *candidate* next writer/record format, solely to introduce `quantity` and `unitOfMeasure` on local **Parts** records. The actual version number is contingent on reconciling concurrent branch work under A-17/A-18; do not amend or write `schema=0.5` data with these fields.

The 0.5 `part` record requires `definition` and optionally permits `usage`, `identifier`, `multiplicity`. Preserve these unchanged and append `quantity`, `unitOfMeasure` in that order. The change affects **only** `records.part`; endpoint `multiplicity`, Interfaces and Connections remain untouched. In particular, do **not** modify the existing `positiveIntegerOrSourceMultiplicity` contract as a side effect: canonical writes should be a strictly positive integer, and compatibility for historic source-shaped values requires separately specified validation.

## Exact candidate schema delta (illustrative patch)

```diff
-schemaVersion: "0.5"
+schemaVersion: "0.6"
 compatibility:
-  readableVersions: ["0.1", "0.2", "0.3", "0.4", "0.5"]
-  writableVersion: "0.5"
+  readableVersions: ["0.1", "0.2", "0.3", "0.4", "0.5", "0.6"]
+  writableVersion: "0.6"
+  version05Compatibility: "0.5 records remain readable and unchanged; quantity/unitOfMeasure fields are not legal under 0.5 markers and no implicit upgrade is permitted."
 region:
-  startMarker: "<!-- MDSE:LOCAL-MODEL START schema=0.5 -->"
+  startMarker: "<!-- MDSE:LOCAL-MODEL START schema=0.6 -->"
 records:
   part:
     headingLevel: 4
     required: [definition]
-    optional: [usage, identifier, multiplicity]
+    optional: [usage, identifier, multiplicity, quantity, unitOfMeasure]
     fields:
       definition: {value: "noteLink", targetSemanticKind: "Object"}
       usage: {value: "enum", allowed: [standard, variant, option]}
       identifier: {value: "text"}
       multiplicity: {value: "positiveIntegerOrSourceMultiplicity"}
+      quantity: {value: "positiveExactDecimal"}
+      unitOfMeasure: {value: "controlledUOM", requires: "quantity"}
     rules:
+      - "quantity and unitOfMeasure must appear together; neither field is mandatory."
+      - "quantity is positive, finite, exact decimal material/item amount PER interchangeable occurrence; zero, negative, NaN, Infinity, and ranges are invalid."
+      - "unitOfMeasure resolves to a governed canonical, case-sensitive unit in a controlled vocabulary."
+      - "multiplicity counts interchangeable instances; when both multiplicity and quantity exist, aggregate consumption = multiplicity * quantity."
+      - "A counted item represented by multiplicity alone has no inferred quantity or UOM."
+      - "Do not produce multiplicity and quantity: <same count> ea from one source amount; require independent evidence for dual fields."
```

**Important:** The proposed `positiveExactDecimal`, `controlledUOM` and `requires` descriptors require matching parser/validator implementation. They are *proposed notation*, not established keys known to be accepted by existing tools. The diff is **not** a drop-in deployable schema patch until the descriptor vocabulary and UOM registry are governed and implemented. No other 0.5 schema fields are removed.

## Contractual validation details

- Accepted authored `quantity` lexemes: `0.35`, `1`, `2.000`, `1e-3` **only if** a future lexical grammar explicitly permits scientific notation. **For the initial writer, use plain ASCII base-10 decimal only** (`[0-9]+(\.[0-9]+)?`) and require a numerical value greater than zero. Preserve original lexical precision and raw source amount separately in the BOM ledger. No binary float round trips.
- `unitOfMeasure` is case-sensitive and canonical. Draft seed registry: `ea` (dimension `count`), `in` and `m` (dimension `length`), `kg` (dimension `mass`). These are examples, **not** a complete approved UOM enumeration. Alias and conversion handling belong to a separately governed normalization table; do not silently map `EA`, `inch`, or unknown unit strings.
- A bare `unitOfMeasure` without `quantity` is invalid, as is `quantity` without `unitOfMeasure`. Both omitted is valid. `multiplicity` can occur alone, or alongside the valid pair.
- `quantity: 0` must not be written as a positive consumed quantity: retain it in the raw ledger and issue a finding. Do not coerce it to one, even when quantity is optional.
- Existing `multiplicity` values must continue to parse under their original schema marker, even if a future 0.6 writer restricts canonical new values to positive base-10 integers. Do not silently normalize legacy notes.
- Decimal aggregation must use exact decimal arithmetic; group by compatible unit/dimension and convert only with an approved explicit rule. Prevent `4 ea` source rows becoming `multiplicity: 4` plus `quantity: 4` `unitOfMeasure: ea`.
- Parent-owned Parts are the only authoritative storage location for assembly consumption. No generated child-side `partOf`, `usedBy`, or reverse assembly list.

## Compatibility / deployment gate

1. Reader continues to recognize 0.1–0.5 markers and their respective semantics. New fields under old markers must be reported as unsupported, not silently accepted or lost.
2. Writer emitting 0.6 markers must round-trip `quantity` and `unitOfMeasure` without touching other Local Model regions or free text.
3. Structured editor and source adapter reject unknown UOM, nonpositive/ambiguous values and invalid dual-field combinations **before** writing; where source data is invalid retain it in the ledger with a review finding.
4. Workbench parser/index/Where Used totals must read exact-decimal source representations, retain display precision, and compute aggregate amounts consistently.
5. Regression fixtures (A-06) must include count-only, measured-only, dual-factor, `ea` double-count trap, missing/bare UOM, zeros, negatives, scientific notation policy, invalid unit, historical version and no-child-side-usage tests.
6. Core governance must approve version, descriptor vocabulary, controlled UOM source, and changes to Ruleset, writer, validator, reader, template and release definition before generation uses the new fields.

## Open questions deliberately not resolved in A-05

- Whether concurrent newer schema work changes the next permissible version after 0.5.
- Full UOM dictionary, exact conversion ratios, aliasing and dimensional registry owner.
- Whether schema descriptors such as `requires` are native to the existing validation engine or need rule implementations.
- Evidence for S1/S2 quantities and unit columns; deferred to Phase B source profiling.

**Disposition:** A-05 specification artifact prepared; no GitHub mutations and no runtime changes. **Next:** A-06, deterministic valid/invalid fixture set and executable validation expectations.

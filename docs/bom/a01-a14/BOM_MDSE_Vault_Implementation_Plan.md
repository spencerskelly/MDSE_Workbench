# BOM → MDSE Parts Vault: Governed Implementation Plan

**Planning baseline:** 2026-10-08  
**Status:** Proposed implementation plan; decisions in this document express the user's directions, but **no governing MDSE repositories have been modified**.  
**Intended final outcome:** One complete, validated, installable Obsidian/MDSE vault delivered as one or more downloadable ZIP files, plus source ledgers, manifests, validation evidence, and reproducible generation tools.

> **Starting instruction for a new chat:** Read this entire plan and its checkpoint section before acting. Complete **only the first incomplete numbered work unit**. Keep one work unit to approximately five minutes of bounded effort. Produce a concrete artifact or verification result, record its disposition, and stop at a clean handoff. The user may reply `y` to continue. For ZIP-generating steps, deliver an actual downloadable ZIP; do not just describe it.

## 0. Scope, authority, and source provenance

### 0.1 Source spreadsheets

| ID | File | Role | SHA-256 (of currently supplied copy) |
|---|---|---|---|
| S1 | `AllBOMsProduction.xlsx` | Initial production baseline and preferred active relationship evidence | `dccf329de530ba6d7dd1b5d1e29c8bb4e78337006138bcc317b40375d79acf5d` |
| S2 | `Ampure_all_BoMs.xlsx` | Complete available BOM history; recover missing dependency definitions and revisions | `d9b37d50d59908cc8a908f68301f2d98b0cc8f474e590416a71593996b1fc1e1` |

These two hashes identify the uploads used for planning. Any different source file in a later chat must be explicitly reconciled; it must not silently replace S1 or S2. Earlier exploratory counts are **not release acceptance criteria**. Stage B recomputes all counts, field mappings, state distributions, and inclusion relationships from the files.

### 0.2 MDSE authoritative references — reviewed 2026-10-08

- Methodology repository: `https://github.com/spencerskelly/Test_Vault_`.
- Current-state registry: `00_Workspace/00 - Current State.md` (its latest verified date at review was 2026-10-05).
- Modeling: `99_System/10_Docs/MDSE Modeling Ruleset 1.23.md`.
- Machine schemas: `99_System/03_Schemas/element-types.yaml` **1.17**, `relationships.yaml` **1.35**, `local-model.yaml` **0.2**.
- AI rules: `99_System/02_AI/AI_INSTRUCTIONS.md`.
- Runtime release control: `Base Vault/Definition/mdse-release.yaml` (**0.8.0 pre-release** at review).
- Tool authority: `00_Workspace/MDSE Tool Definitions and Boundaries.md`; Workbench implementation in `spencerskelly/MDSE_Workbench`.
- Decision log: `00_Workspace/Workspace Decision Log.md`. It includes later W-decisions than the 2026-10-05 registry, including W-370; **reconcile the current branch and decision authority before changing files**. Do not assume the October 5 status table contains every later implementation change.

**Governance protocol:** No unapproved edits to core rules, schemas, plugins, or generated Fileclasses. When core changes are implemented, allocate W-decisions according to the actual current decision log, update authoritative schema/rules/reference documents together, regenerate downstream artifacts, and run release validation. Never edit the generated Fileclasses directly. Do not declare a golden release while the official release gates remain open.

### 0.3 Nonnegotiable modeling contract

1. **Exactly one first-class `Object` note per distinct normalized part number.** A revision is never a separate Object note. No duplicate part notes across product families, folders, ZIP batches, or assembly usages. A source-provenance map joins source part IDs to stable note UIDs; IDs/UIDs never change on rerun.
2. A part may be used by many parents. **Assembly occurrences belong only to their owning parent assembly note** in the governed Local Model `Part Occurrences` section. Do not write the reverse list of assemblies into each child note's YAML or body. In particular, do not generate child `partOf` solely from BOM usage. `Where Used` is a derived reverse query over parent-owned records, not maintained child-side content.
3. A unique part number is distinct from a *part family/type* Object. Product-family or part-family definitions may be standalone `Object` notes **without a part number** when they provide real navigational/semantic value. They are not duplicate part notes and do not introduce a new top-level class. An Object may have a blank/unset `subtype` only if the governing schema explicitly permits it (govern this change).
4. **BOM revisions are BOM-specific history**: summarize older revisions in the affected part/assembly note body and provide a ledger/query reference to **where each revision was used**; do not copy changing parent-assembly inventories into child notes. Retain the complete normalized, immutable source ledger. Do not add one note per revision.
5. **One effective Local Model for each assembly note.** The default parent-owned Local Model represents its deterministically selected production/effective BOM. Historical revision-specific BOMs stay in the ledger and concise body history, rather than merging incompatible revisions into one live parts list. If multiple active BOMs are incompatible and no authoritative effective version can be determined, emit a blocking configuration-review finding for that assembly instead of merging/silently choosing lines.
6. For Local Model part records, `multiplicity` = individual, interchangeable instance count; `quantity` = numeric amount **per occurrence** of the source material/item (fraction allowed); `unitOfMeasure` = canonical physical unit, such as `in`, `m`, `kg`, or `ea`. All three are optional per part record. Define and test coexistence, aggregation, zero/invalid source amounts, and conversion; preserve the exact source value/unit in the ledger. Never reinterpret measured material quantity as number of discrete occurrences. A zero source amount is **not** a valid positive consumed quantity; preserve and flag for evaluation, not silently drop or coerce.
7. **Optional YAML `variantOf`** is a one-way `Object → Object` link (or governed single-target field) denoting a proposed family/similar-build grouping, not proof of inheritance and not a synonym for `partOf` or `hasPart`. A normal forward query finds its variants; no materialized inverse is required. Infer candidates using evidence from the BOM and part definitions, record confidence/provenance, add the link when defensible, and leave unresolved cases blank with review entries. Prefer existing suitable family/type Objects; when necessary create a meaningful family/type Object, never invent an assembly decomposition just to fill `variantOf`.
8. **Do not automatically generate `subtypeOf` from `variantOf`.** Review true reusable invariant specialization against the MDSE generalization rules. Existing Local Model `usage: variant` semantics still derive valid candidates from `subtypeOf`, *not* from unreviewed `variantOf`. A future variant-comparison capability may compare actual configurations without declaring generalization.
9. **One part note's MDSE `status` remains distinct from manufacturing source lifecycle.** After full reachability analysis and safeguards below, **automatically set `status: Retired` for confirmed unreachable imported parts**. Do not delete them or discard evidence. Retired notes remain in original physical category folders and are filtered in views. Human-authored existing status must not be overwritten without a governed import rule/change log.
10. An archive/obsolete source row is **not** automatic evidence of a `supersedes` pair. If the same part number has archived and production revisions, preserve both under the same note; prefer production evidence for the effective version. Create `supersedes` between *different* part notes only with strong replacement evidence, otherwise log a candidate.
11. **Physical folder placement is navigation only**, not a semantic `partOf` link. Use existing MDSE limits and names: ≤75 generated model notes per folder, semantic categories before notes, path preflight, targeted top-level README/Base/Canvas, and no exhaustive per-folder Canvas.
12. Generated notes must follow MDSE class templates, property order, identity formats, governed Local Model markers, link syntax, author-code rules, evidence requirements, and review gates. Imported IDs must be allocated deterministically and preserved via a source map; do not use uncontrolled wall-clock UID generation on each rebuild.
13. **Do not turn the BOM importer into the EA translator.** It is a separate source adapter / generation pipeline that conforms to the same MDSE schemas and controlled base. BOM source ledger is owned by BOM importer, EA mappings and evidence remain governed separately.
14. **No cross-vault dependency is required to open the delivered artifact.** If multiple ZIP archives are necessary, they are *segments of one logical vault root*, never separate vaults with duplicate or cross-vault-only notes.

### 0.4 Expected note-level experience

An assembly note has an ordinary MDSE `Object` header and the existing governed Local Model 0.2 region. Inside `## Local Model` → `### Part Occurrences`, each part block has `definition` pointing to another Object note and optionally lines such as:

```markdown
#### R1 — Wire
- definition: [[01798-006-M - Wire]]
- multiplicity: 2
- quantity: 0.35
- unitOfMeasure: m
^part-<unique-30-character-token>
```

This is an **illustration**, not a schema-valid finished record until the approved Local Model writer syntax is implemented and tested. For a bulk material line with no instance count, omit `multiplicity`; for a counted fastener, `multiplicity: 4` may be sufficient. If both count and quantity appear, the stated quantity is **per interchangeable occurrence**, so aggregate physical consumption is derived consistently. Keep source BOM row IDs and revision context in the ledger, not stuffed into the governed record unless a future approved schema warrants them.

A part note does **not** hold `usedBy`, `partOf`, a generated `Where Used` list, or duplicated parent identifiers. Workbench's Where Used query resolves indexed Local Model references to the part's UID; it can show owning parent part number, parent configuration/revision, quantity, unit, and reference designator by joining the live part record with provenance/ledger. The index is disposable and rebuildable.

### 0.5 Physical folder taxonomy

Use these primary physical/model categories, with **subcategories under each primary category before part notes**. Labels below are a proposed navigational hierarchy, not new semantic model types:

```text
<single vault root>/
  README.md
  .vault.yaml
  .obsidian/                    (controlled runtime, one copy only)
  10_System/
      Charger Systems/
      Product Families/
      Other Systems/
  20_Mechanical Assembly/
      Enclosures/
      Mounting Assemblies/
      Other Mechanical Assemblies/
  30_Electrical Assembly/
      Power Assemblies/
      Control Assemblies/
      Wiring Assemblies/
      Other Electrical Assemblies/
  40_PCBA/
      Control Boards/
      Power Boards/
      Other PCBAs/
  50_Mechanical Part/
      Sheet Metal/
      Fasteners/
      Other Mechanical Parts/
  60_Electrical Part/
      Power Components/
      Electronic Components/
      Connectors/
      Conductors/
          Wire/
          Cable/
          Cable Assemblies/
          Busbars/
          Other Conductors/
      Other Electrical Parts/
  99_System/                    (existing controlled MDSE runtime/system area)
      11_Import/                (BOM evidence and ledgers, sized appropriately)
```

Categories are **provisional** until classified from real part descriptions and relationships; add or rename subcategories only with documented evidence. An uncertain part is placed deterministically in a reviewed `Unclassified` subcategory under the best-supported primary category; if even the primary category is unresolved, hold its placement in preflight rather than making up a type. Split busy leaf categories deterministically into smaller subfolders to respect the 75-file rule. `Conductors` remains under `Electrical Part`, not a separate root. `Cable Assemblies` is a subcategory of `Conductors` even when its Object has assembly behavior. If the actual build warrants treating a cable assembly as an Electrical Assembly, document an explicit classification exception and keep only one note.

**Top-level navigation:** Each primary model category gets the standard README/BASE_local/BASE_all/CANVAS set. Lower subcategories get extra navigation files only where needed. Do not scaffold every leaf folder.

### 0.6 Standard vs BOM-specific contract ownership

| Concern | Proposed authority to change | What must be changed |
|---|---|---|
| `quantity` / `unitOfMeasure` | **Core MDSE standard** | `local-model.yaml`, Ruleset, Local Model editor/reader, validators, tests; advance version according to governance (writer may no longer be exactly 0.2, though the change is based on 0.2) |
| `variantOf` | **Core MDSE standard** | `relationships.yaml` if treated as one-way relationship (preferred) and matching Object frontmatter/fileclass/editor/query rules; semantics in Ruleset; schema versions and tests |
| Variant comparison / variant vs true subtype evaluation | **Core MDSE standard** | Formal comparison inputs and outputs, `variantOf` evidence, `subtypeOf` review gate, Workbench querying/reporting, test fixtures |
| Object family/type notes with blank `subtype` | **Core MDSE standard** | Define if/how unset `subtype` is valid for `Object`; template and schema tests; no separate Product Family semantic class |
| One note per part number, revision summary, source ledger | **BOM adapter policy** | BOM importer definition and note-body template extension; no core revision model changes |
| Product-root classification and automatic unreachable-part retirement | **BOM adapter policy** | Root whitelist, reachability rules, exception list, source ledger, retirement evidence; current MDSE retire-not-delete remains intact |
| Folders/categories and ZIP batch format | **BOM vault release policy** | BOM import definition, release manifest, packaging/test scripts; current folder limits and controlled runtime still govern |

**Version note:** Treat `Extend Local Model 0.2` as “extend the present 0.2 contract,” not an instruction to mutate an already released schema *without versioning*. Determine the proper next schemaVersion and reader/writer compatibility in the specific schema-change step. Preserve read access to 0.1/0.2 records. Workbench must not silently write records it cannot validate.

---

## 1. Execution protocol — designed for short, reliable passes

- One numbered work unit is one independently recordable pass; aim for **≤5 minutes of bounded active effort**. Do not start multiple multi-repository writes, multi-GB exports, full-model parsing, or an entire ZIP generation loop in one interactive pass.
- Any broadly worded implementation unit (such as “classify parts” or “update Workbench”) means **one bounded rule, one named test fixture, or one deterministic ≤250-item batch per invocation**; repeat the same ID with an incrementing checkpoint until its stated definition of done is met. Never interpret a heading as permission to run the full corpus in one pass.
- Each step has one concrete output: a decision record, checked-in definition, small fixture/test result, manifest, CSV, generator module, QA report, or downloadable ZIP. A step may be recorded **BLOCKED** with clear failure evidence and a minimal next action; do not misreport a partial step as complete.
- All expensive operations must support **resume** and **deterministic incremental partitions** by stable part number / path / source row key. One batch per pass; never regenerate a whole data set unnecessarily.
- Every step's handoff must include: step ID, source file/repo revisions, files changed/created, test executed and result, next uncompleted step, known blockers. Add `RUN_LOG.md` entries or a project handoff line. The human may upload completed ZIPs and manifests back into project files as work proceeds.
- Each run uses a uniquely named output staging folder. Never overwrite a previous accepted ZIP, source ledger, or manually enriched note. Do not change existing UIDs or IDs, and do not move files without recording a path map.
- If implementation changes need GitHub edits, create a proposal/branch/PR according to repository policy; never silently modify `main` or treat an unmerged change as the official rule.
- Each ZIP must be built, then reopened/extracted into a scratch root to verify file paths, hashes, duplicates, YAML, and compatibility with previous ZIPs. Record SHA-256 and included part-number range/manifest indexes.
- Next-chat handoff must not depend on access to a prior chat's temporary container filesystem. Persist scripts, build inputs, manifests and required generated files via an attached project artifact, GitHub, or a downloadable checkpoint ZIP.

### Handoff line template

```text
STEP: B-04 | STATUS: PASS / BLOCKED / PARTIAL
SOURCE: S1 dccf329d...; S2 d9b37d50...; Test_Vault_ <commit SHA>
OUTPUT: <artifact/path/link/hash>
CHECK: <test> — <counts, expected vs actual, PASS/FAIL>
NEXT: B-05
OPEN ISSUES: <none or one-line blocker>
```

### Global completion gates

- **G0 — Rules approved:** core and BOM policy decisions recorded; schema/implementation versions identified; runtime-base candidate build aligned.
- **G1 — Data reconciled:** source files hashed; schema read and normalized; all rows accounted for; selected effective BOMs reconciled; root/retirement policy verifiable.
- **G2 — Generator proven:** 10–50-part pilot produces MDSE-valid notes; a parent-to-child Where Used query works without child-side assembly metadata; variant comparisons and history tests pass.
- **G3 — Full data generation:** every eligible unique part number has exactly one note, no duplicate UID/ID/path, correct lifecycle and classification, no unresolved *blocking* configuration collision.
- **G4 — Packaging:** complete vault content covers all accepted batches; ZIP reconstruction succeeds; all manifests and checksums match; first-open Obsidian/Workbench performance and controlled plugins tested where supported.
- **G5 — Final release:** complete ZIP(s), source ledgers, restart/rebuild tools, reports, and limitations delivered; still labeled **candidate** if MDSE 0.8.0 golden release gate is not passed.

---

## 2. Atomic work plan

Each numbered step below is a separate suggested chat pass. Change work-unit size rather than risking a single overlarge run. **Do not skip source and governance gates.**

### Phase A — Freeze decisions and extend core MDSE methodology (A-01 through A-18)

- [ ] **A-01 — Freeze source/repo manifest.** Capture S1/S2 hashes and current MDSE/Workbench branch commit SHAs in `BOM_SOURCE_MANIFEST.json`; record version drift from the October 5 current-state registry.
- [ ] **A-02 — Write one-page semantic decision record.** Document parent-owned BOM, Where Used as derived query, one part note, variantOf, retirement, history, and categories; mark core vs BOM policy.
- [ ] **A-03 — Check current W-decision numbering.** Read latest `Workspace Decision Log`, confirm no superseding decision, reserve/propose IDs; do not guess IDs from the last reviewed decision.
- [ ] **A-04 — Specify Local Model units.** Write a 1-page contract for `multiplicity`, `quantity`, `unitOfMeasure`, numeric precision, units, per-occurrence meaning and dual-field behavior.
- [ ] **A-05 — Draft Local Model schema changes.** Propose precise optional fields on local `part` records, with backward compatibility; separately review any field name conflict with existing records/tools.
- [ ] **A-06 — Add unit test fixtures.** Create small valid/invalid examples for counted parts, measured materials, fractional quantities, zeros, unknown UOM, invalid units and dual count/quantity.
- [ ] **A-07 — Specify `variantOf`.** Define a single-value optional YAML Object → Object relation, one-way with no stored inverse; define candidate vs confirmed grouping and no automatic `subtypeOf`.
- [ ] **A-08 — Draft relationship schema change.** Add approved `variantOf` to `relationships.yaml` (one-way preferred); test allowed endpoints and absence from non-Object classes.
- [ ] **A-09 — Clarify Object subtype omission.** Confirm whether `Object` may have empty `subtype` for product-family/type definitions; propose minimal `element-types.yaml` change if needed.
- [ ] **A-10 — Specify variant comparison.** Define common, added, removed, quantity/UOM changed, revision changed, assembly substitution, uncertain pairing, and generalization-review outcomes.
- [ ] **A-11 — Write canonical example notes.** Create 3–5 small non-production fixtures (family Object, two part Objects, one assembly containing parts) with accurate YAML and Local Model block IDs.
- [ ] **A-12 — Amend Ruleset.** Prepare a small numbered amendment covering assembly-owned usage, Where Used query semantics, variantOf/subtypeOf separation, measured quantity, and family Objects.
- [ ] **A-13 — Update AI/template rules.** Amend only the templates and authoring instructions that need optional Object `variantOf` and Local Model quantity/UOM; preserve governed property order.
- [ ] **A-14 — Update Workbench reader validation.** Introduce test-first parsing/indexing of quantity/UOM and `variantOf`; retain compatibility with prior Local Model versions.
- [ ] **A-15 — Update Workbench writer transaction.** Permit editing optional part quantity/UOM and Object variantOf in the governed structured editor with validation; avoid touching unrelated body sections.
- [ ] **A-16 — Test parent-only Where Used.** Show Workbench or a headless query returning a child's parents by scanning Local Model definitions, with **zero written child-side `partOf`**.
- [ ] **A-17 — Rebuild derived configs and release checks.** Regenerate Fileclasses/config from authority, run targeted schema/Workbench tests and base release checker; register failures, not artificial passes.
- [ ] **A-18 — Governance checkpoint.** Record approved W decisions and actual merged commit/release revisions. Do not start bulk note generation until schemas and readers agree. **Checkpoint ZIP C0:** `BOM_Contract_and_Tests.zip` (contract, fixtures, test evidence, source manifest—not a vault).

### Phase B — Source normalization and reconciliation (B-01 through B-14)

- [ ] **B-01 — Read S1 layout.** Record sheet names, real header row(s), field names and data starting row in `BOM_SOURCE_PROFILE.json`.
- [ ] **B-02 — Read S2 layout.** Record the same for S2, including any extra product flag/configuration columns or repeated header rows.
- [ ] **B-03 — Define raw BOM line identity.** Set stable line key from file hash + sheet + physical row, without discarding duplicates; preserve raw cells.
- [ ] **B-04 — Normalize part numbers.** Define trim/case/leading-zero/punctuation behavior; create collision report for distinct raw values mapping to one canonical key.
- [ ] **B-05 — Normalize parent CL1/CL2.** Preserve configuration/revision fields and define an unambiguous parent effective-BOM key.
- [ ] **B-06 — Normalize lifecycle states.** Build exact original-state mapping, unknown-state list, and precedence rules that do **not** assume archived means obsolete replacement.
- [ ] **B-07 — Normalize quantities and units.** Preserve source precision and strings, map known unit codes to controlled UOM, quarantine unknown and invalid values.
- [ ] **B-08 — Normalize descriptive fields.** Preserve part names, source/make-buy, effective dates, notes and reference designators without truncation.
- [ ] **B-09 — Create S1 normalized partition.** Export the first bounded subset of S1 and a manifest, prove the extractor can resume by stable row index.
- [ ] **B-10 — Finish S1 partitions incrementally.** Run one bounded partition per pass; append counts/checksums until every source data row is explicitly reconciled; repeat B-10 as needed.
- [ ] **B-11 — Create S2 normalized partition.** Produce first bounded S2 partition using identical schema and resumable checkpoints.
- [ ] **B-12 — Finish S2 partitions incrementally.** Run one bounded partition per pass; repeat B-12 as needed until all raw rows reconcile.
- [ ] **B-13 — Compare S1 to S2 precisely.** Join by full source-specific composite signature including configuration and line identity semantics; report unmatched, duplicate, additional, and conflicting rows.
- [ ] **B-14 — Source integrity gate.** Produce `BOM_Source_Reconciliation.csv` and `BOM_Normalization_Report.md` showing every row as accepted, excluded by explicit rule, or flagged. **Checkpoint ZIP C1:** `BOM_Normalized_Source.zip` (partitioned ledgers/manifests/reports).

### Phase C — Product roots, effective configurations and usage graph (C-01 through C-13)

- [ ] **C-01 — Build distinct part registry.** One row per canonical part number with all observed names/revisions/states/source provenance; flag conflicting identity candidates.
- [ ] **C-02 — Build revision-aware BOM edge table.** Keep parent, parent configuration, child, child revision when present, amount, unit, row key and source priority.
- [ ] **C-03 — Identify candidate product roots.** Find production parents not used as children of other production assemblies; report candidate roots and obvious non-product roots separately.
- [ ] **C-04 — Classify product roots.** Use name/product flags/evidence to classify finished products, service assemblies, accessories and uncertain candidates; produce root review file.
- [ ] **C-05 — Define the active root set.** Record an explicit production-root allowlist and needed supported-service exceptions. An unresolved root prevents irreversible retirement decisions.
- [ ] **C-06 — Select effective assembly BOMs.** Prefer matching S1 production configurations; avoid mixing CL1/CL2; report multiple competing effective definitions.
- [ ] **C-07 — Detect assembly cycles.** Validate graph is expandable and list cycles/loop paths by assembly key and source row.
- [ ] **C-08 — Detect missing child definitions.** For every active child assembly, check whether its BOM can expand from S1; locate candidates in S2 and preserve source/revision evidence.
- [ ] **C-09 — Resolve one dependency class.** For a small sample of active assemblies, test fallback to S2 when S1 lacks required definitions without importing inappropriate archived alternatives.
- [ ] **C-10 — Compute full active reachability.** Walk from the approved root set through each chosen effective BOM, with bounded resumable graph traversal and a manifest of reached parts/assemblies.
- [ ] **C-11 — Compute retirement candidates.** Mark imported part numbers unreachable from all active roots plus exceptions. Generate `Retirement_Candidates.csv` with explanation and source states, not just a Boolean.
- [ ] **C-12 — Apply retirement safeguards.** Block or quarantine ambiguous/conflicting BOMs, unresolved product roots, missing active definitions, and known service-only dependencies before automatic `Retired` assignment.
- [ ] **C-13 — Graph/retirement gate.** Verify all chosen roots close over their known dependencies; archive determination is reproducible. **Checkpoint ZIP C2:** `BOM_Graph_and_Retirement.zip` (edges, root list, configuration decisions, reports and code).

### Phase D — Classify parts, families and variations (D-01 through D-12)

- [ ] **D-01 — Write category rules.** Map evidence to System, Mechanical Assembly, Electrical Assembly, PCBA, Mechanical Part, Electrical Part, and Electrical Part → Conductors.
- [ ] **D-02 — Classify systems and PCBAs.** Apply only strong description and hierarchy evidence; produce exception rows for ambiguity.
- [ ] **D-03 — Classify mechanical vs electrical assemblies.** Decide repeatable inference rules, including mixed assemblies; never classify solely by quantity of children.
- [ ] **D-04 — Classify leaf components.** Assign mechanical/electrical primary group and meaningful subcategory, with unclassified queue.
- [ ] **D-05 — Classify conductors.** Place wires, cable, cable assemblies and busbars under `Electrical Part/Conductors/...`; document assembly exceptions without duplication.
- [ ] **D-06 — Define family candidate extraction.** Use recognizable product/assembly/part type groupings from actual descriptions, product flags and similar BOM topology.
- [ ] **D-07 — Create family/type Object registry.** Identify which families already correspond to part-number Objects and which require genuine non-numbered family/type Objects.
- [ ] **D-08 — Infer `variantOf` for systems.** Assign evidence-backed product variants to meaningful family Objects; record candidates and reasons.
- [ ] **D-09 — Infer `variantOf` for assemblies.** Assign likely assembly type grouping; do not substitute assembly-parent containment for variant grouping.
- [ ] **D-10 — Infer `variantOf` for leaf parts.** Use engineering descriptions/type equivalence, not appearance alone; do not force every part to have a link.
- [ ] **D-11 — Produce true-generalization review.** For variantOf groups, identify where a reusable invariant `subtypeOf` relationship might legitimately exist and which are merely similar configurations.
- [ ] **D-12 — Category/variant gate.** Report classified/uncertain counts, candidate variant links and their evidence; ensure no cycles in `variantOf` and no unapproved `subtypeOf`. **Checkpoint ZIP C3:** `BOM_Classification_and_Variants.zip`.

### Phase E — Generator, note identity and revision-history behavior (E-01 through E-14)

- [ ] **E-01 — Pin the base template.** Establish exact compatible controlled runtime-base build revision and show release status; never copy methodology-workspace-only files into a generated vault.
- [ ] **E-02 — Define deterministic object identity map.** One canonical part number → one persistent UID/ID/path using governed author code and source identity; reserve a separate namespace for family/type Objects and local occurrences.
- [ ] **E-03 — Build part note renderer.** Generate a valid Object template with description, part number, and governed optional fields without source-specific hacks in property order.
- [ ] **E-04 — Build revision-history renderer.** Add compact older-revision table in the note body: revision/CL1/CL2, source lifecycle, effective period when known, and a link/key to the historical Where Used ledger/query; **no enumerated parent lists or generated reverse relationship fields**.
- [ ] **E-05 — Build historical ledger cross-reference.** Ensure revision summaries trace to exact source ledger row/config keys and do not conflate a part's revision with its parent's revision.
- [ ] **E-06 — Build Local Model part renderer.** In the owning assembly note, emit one stable occurrence per distinguishable BOM line or grouped interchangeable quantity, using valid block IDs and definition links.
- [ ] **E-07 — Render quantity and UOM.** Implement optional `multiplicity`, `quantity`, and `unitOfMeasure` on local part blocks; preserve zero/unknown source values only in ledger with findings.
- [ ] **E-08 — Implement effectivity selection.** Render only selected effective assembly configuration as live Local Model; keep conflicting/historical versions as summaries/ledger, not merged parts.
- [ ] **E-09 — Implement `variantOf`.** Add the optional forward field to evidence-backed Object notes; no generated inverse list or subtypeOf promotion.
- [ ] **E-10 — Implement retirement state.** Set `status: Retired` on confirmed unreachable generated parts; preserve all files and evidence; leave ambiguous objects at default with findings.
- [ ] **E-11 — Implement category-path planner.** Subcategory-first placement, ≤75 model files per folder, existing name/path rules, deterministic fallback subdivision and collision preflight.
- [ ] **E-12 — Generate a 10–50-part pilot.** Include assembly, PCBA, conductor, measured material, historical revisions, variant family, and retired/unreferenced case.
- [ ] **E-13 — Validate pilot semantics.** Check UID/ID, Markdown/YAML, note/Local Model link resolution, ownership, units, variantOf and source ledger reconciliation; compare rendered assemblies with raw BOM rows.
- [ ] **E-14 — Deliver pilot.** **Checkpoint ZIP C4:** `BOM_MDSE_Pilot_Vault.zip` (complete standalone small vault + generator definition, manifests, validation report); explicitly mark candidate.

### Phase F — Derived queries and variant comparison (F-01 through F-10)

- [ ] **F-01 — Define Where Used query.** Join child Object UID to every parent-owned part occurrence, with source ledger lookups for revision/configuration; no child-side assembly relationships.
- [ ] **F-02 — Implement indexed Where Used.** Build/rebuild a disposable reverse index of Local Model part definition links; validate it matches an independent ledger-derived query.
- [ ] **F-03 — Add multiple-parent fixture.** A component used by three assemblies reports all three; confirm child note is unchanged when a parent uses it.
- [ ] **F-04 — Implement direct assembly comparison.** Compare two selected effective parents for add/remove/quantity/unit/revision differences and identity-stable component matches.
- [ ] **F-05 — Implement recursive comparison.** Expand differences down all unambiguous assembly paths, preserve both direct assembly substitution and leaf differences.
- [ ] **F-06 — Preserve historical configuration comparisons.** Allow old vs current revisions to be selected from ledger without creating revision notes or overriding current Local Model.
- [ ] **F-07 — Add variant family query.** Query `variantOf` members in real time; do not require reverse YAML. Present evidence/uncertainty separately from confirmed subtypeOf.
- [ ] **F-08 — Add generalized review report.** For candidate variantOf links, report potential true subtype, parallel configuration, unclear, and inconsistent grouping; no automatic promotion.
- [ ] **F-09 — Measure query performance.** Run Where Used and variant comparisons against a bounded growing fixture or partition; record time and index memory, use pagination.
- [ ] **F-10 — Deliver query tests.** **Checkpoint ZIP C5:** `BOM_Queries_and_Variants.zip` (code, fixtures, reports, optionally updated pilot; no duplicate production notes).

### Phase G — Full generation in bounded, downloadable batches (G-01 through G-10; repeat G-05/G-06)

- [ ] **G-01 — Freeze accepted input manifest.** Pin normalized sources, graph closure, classifications, schemas, tool versions and Object identity map with exact hashes.
- [ ] **G-02 — Build one complete vault index.** Plan *all* output paths, UIDs, IDs, local block IDs and file ownership before writing content; detect collisions globally.
- [ ] **G-03 — Build ZIP segment strategy.** Choose a tested upper bound (initial target 250–500 Object notes per notes segment, less if needed); partition by stable sorted canonical part-number or path range, not arbitrary row order. Each segment gets an inclusion manifest; no duplicate relative paths.
- [ ] **G-04 — Build controlled vault shell.** Generate a single `BOM_Vault_00_Runtime_and_Index.zip` containing runtime/config, root navigation, registry and install instructions; no duplicated shell in data segments.
- [ ] **G-05 — Generate next notes partition.** Produce exactly one deterministic partition of notes, local occurrences and any associated small required assets; save intermediate manifest and validator result. **Repeat G-05** until all Object notes render.
- [ ] **G-06 — ZIP and deliver that partition.** Produce `BOM_Vault_Parts_<index>.zip` and companion manifest/hash; scratch-extract and validate uniqueness, YAML, link-planning metadata and no duplicate path with prior accepted partitions. **Repeat G-06** after each G-05.
- [ ] **G-07 — Build complete source/evidence segment.** ZIP the ledgers, source profiles, row reconciliation and revision records as `BOM_Vault_Evidence.zip`; optionally exclude raw XLSX binaries only if separately delivered and hashes/source-location instructions are complete.
- [ ] **G-08 — Assemble a scratch full vault.** Extract runtime ZIP, every notes ZIP and evidence ZIP into one root; reject duplicate paths, unexpected overwrites and omissions.
- [ ] **G-09 — Full-model validation.** Verify each canonical part has exactly one note, revisions preserved, graph closure, parent-owned usage only, references resolve, all status decisions evidence-backed, folder/path limits and total manifest checks.
- [ ] **G-10 — Batch delivery reconciliation.** Produce `BOM_Vault_Package_Index.md`, global `checksums.sha256`, missing/duplicate report and full extraction instructions. **Checkpoint C6:** all numbered production ZIPs accounted for.

### Phase H — Acceptance, recovery and release (H-01 through H-10)

- [ ] **H-01 — Validate rebuild reproducibility.** Rebuild one accepted batch from frozen inputs; compare stable model content/checksums; explain any allowed timestamp exceptions.
- [ ] **H-02 — Validate future incremental import.** Simulate a part description and BOM change; verify stable part-note UID/ID, parent-owned record refresh, and untouched human edits outside owned sections.
- [ ] **H-03 — Test retirement/recovery.** Verify unreachable parts have `Retired` status, remain searchable, and can return to active classification if later proven reachable without creating another note.
- [ ] **H-04 — Sample production assemblies.** Compare selected finished systems, PCBAs, cable assemblies and measured materials against their exact S1 and S2 rows.
- [ ] **H-05 — Inspect variant candidates.** Spot-check product-family grouping, the most important variants and `subtypeOf` review list; unresolved cases remain clearly labeled.
- [ ] **H-06 — Open scratch vault in Obsidian.** Confirm baseline navigation, Bases, Workbench, search, direct part notes and Where Used; record exact application/platform/version and actual results.
- [ ] **H-07 — Run performance acceptance.** Record open/index, queries and memory on representative hardware; no unsupported performance claims from synthetic-only measurements.
- [ ] **H-08 — Final source/data audit.** Reconcile all source rows and generated note counts, all ZIP contents and conflicts, retired count and exceptions, outstanding risks; produce concise acceptance report.
- [ ] **H-09 — Reissue the final package index.** Supply all ZIP download names, hashes, extraction order, included part number ranges, schema versions, restoration procedure and project continuity instructions.
- [ ] **H-10 — Deliver and record release state.** **Checkpoint C7:** complete downloadable vault, source/evidence/tooling artifacts and final QA report. Label as `BOM Vault Candidate` unless the official MDSE release/golden conditions have been met.

---

## 3. Core acceptance tests (must survive later chats)

| Test | Pass condition |
|---|---|
| Identity | Each canonical part number resolves to exactly one Object note; no part/revision duplicates; all UID/ID/local IDs unique; stable across rebuilds. |
| Parent ownership | Every effective BOM relationship exists as a child definition reference in its parent Object Local Model; no child-side generated assembly data. |
| Where Used | Where Used of a shared child lists every effective parent with correct quantity/UOM; deleting/changing a parent updates query results by rebuilding index without editing the child. |
| Revisions | Source revisions remain recoverable with correct original parent/child contexts; no revision note proliferation; competing active revisions never silently union. |
| Units | `multiplicity` integer instances, `quantity` numeric measurement per occurrence, `unitOfMeasure` a known exact unit; zero/unknown inputs retained and flagged; no unvalidated unit conversions. |
| Variant | `variantOf` is queryable and optional, cycles rejected, unproven candidates not asserted, no automatic subtypeOf; variant comparison uses actual configurations. |
| Retirement | Reachability derived from approved active roots and fallback dependencies; confirmed unreachable generated Objects have `status: Retired`, retain their file/source history; uncertain cases flagged. |
| Physical structure | One logical vault, prescribed categories, conductors under Electrical Part, category folders before notes, ≤75 generated notes per folder, no duplicate note in multiple family folders. |
| Schema/runtime | Note and Local Model schema-valid; generated plugin configs only regenerated from authority; no unsupported version upgrade or golden claim. |
| ZIP packages | Every path in global manifest appears once, every archive passes extraction and hash check, combined extraction yields the valid complete vault without an external chat-specific dependency. |

### Explicit known risks / decisions to confirm at the relevant step

1. **How an active BOM is selected when the same part number has multiple simultaneously released configurations.** Until evidence or explicit policy resolves this, generation for that assembly must be flagged and not silently combine rows. The plan includes a resolution/exception step.
2. **Source meaning of CL1/CL2, parent/child states and validity dates.** Do not presume their semantic meaning without profiling and sample verification.
3. **When quantity and multiplicity are both present.** The proposed meaning is measured amount *per occurrence*, which allows derived total consumption; confirm in A-04 using actual source examples. Never mix equivalent `ea` quantity and multiplicity in totals without defined precedence.
4. **`variantOf` target confidence.** “Add it wherever possible” means search exhaustively for defensible existing family/type targets, then record abstentions. Do not manufacture false inheritance or cyclic variant families to attain 100% coverage.
5. **Archive completeness.** Automatic retirement must run only after the production-root set, service exceptions, and dependency closure are accepted; ambiguity results in a logged exception, not unsupported retirement.
6. **Controlled runtime branch drift.** The current-state registry at review was dated 2026-10-05, while the decision log contains later work. Recheck branch HEAD before any governed edit and align manifests/tests to actual merged code.
7. **Source retention in final delivery.** Preferred: distribute original source workbooks once as separately hashed project inputs, keep normalized ledgers/evidence in the generated artifact, and avoid duplicating the ~large raw workbooks in each notes segment.

---

## 4. ZIP / chat handoff conventions

### ZIP classes

| Checkpoint | Purpose | Required contents |
|---|---|---|
| C0 | MDSE contract | Proposed/approved decisions, schema fixtures, change test evidence, version/source manifest |
| C1 | Normalized source | Complete partitions and source reconciliation |
| C2 | Product graph | Chosen active roots/effective BOMs, reachability, exceptions and retirement candidates |
| C3 | Categorization/variants | Part categories, family notes plan, variantOf candidates, generalization reviews |
| C4 | Pilot vault | Small directly opening Obsidian/MDSE vault with identity, usage and unit tests |
| C5 | Query tooling | Where Used and comparison code/tests; optionally refreshed pilot, but not duplicated production notes |
| C6 | Full vault parts | `00` runtime shell + numbered disjoint notes ZIPs + evidence ZIP + package index |
| C7 | Accepted deliverable | C6 ZIP set, build/recovery scripts, QA/performance reports, checksums, release status |

### Package rules

- All production ZIPs unpack **into the same vault root**; the runtime shell is unique. They may be compressed independent chunks for download size but they are not separate Obsidian vaults.
- Package relative paths must be identical to paths in the global output manifest. No ZIP may overwrite files already delivered by a different ZIP (except an explicitly versioned update package with a documented replacement map).
- Numbered note ZIP contents are immutable once accepted; improvements require a new named revision, not a silent replacement.
- Include `manifest.json` in each distribution with package ID, schema/release revisions, source hashes, generation tool revision, included file list, part-number range and content checksums. Put package manifests under a reserved distribution metadata prefix or distribute them adjacent to ZIPs to avoid collisions inside the reconstructed vault.
- In the user-facing reply for each ZIP, provide the sandbox download link, SHA-256, covered scope, validation PASS/FAIL, and exactly the next step/handoff prompt. If work encounters a tool or size limit, deliver the last completed partition and checkpoint, not an aspirational file.
- A fresh chat can start with this instruction: **“Read `BOM_MDSE_Vault_Implementation_Plan.md`; resume from the next incomplete step listed in the latest checkpoint. Use the frozen source hashes and deliver only that step's artifact. Do not redesign accepted rules.”**

### Future engineering changes

After delivery, the long-term model should support a new BOM import that refreshes **only importer-owned** assembly part blocks, source ledger rows, source-derived revision summaries, and derived classification; human-added engineering content remains preserved. Build this capability with a staging diff and human review if the vault has already been edited. Never delete historical part notes, reallocate their IDs, or turn child-side Where Used caches into authoritative data.

---

## 5. Current checkpoint

**Current state:** Plan written and ready for project upload. All execution steps remain open.  
**Next step:** **A-01 — Freeze source/repo manifest.**  
**No clarification required to start A-01.** Any unresolved semantic questions are isolated to a later, explicit decision step.  
**Final target:** reproducible, complete Obsidian/MDSE vault from the two BOM workbooks, distributed as downloadable, individually validated ZIP components with a complete manifest.

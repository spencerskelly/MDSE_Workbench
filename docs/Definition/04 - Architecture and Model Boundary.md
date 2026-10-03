# Architecture and Model Boundary

The sections at the end follow decisions WB-080 to WB-090 in [[02 - Workbench Decision Log]], approved 2026-09-30.

## Core rule

**Workbench is an interface to the MDSE model.**

It should not become a second model, a hidden schema, or an alternate persistence layer.

## Sources of authority

### Model semantics

Authoritative sources remain the current vault model governance, including:

- MDSE Modeling Ruleset;
- element type schema;
- relationship schema;
- templates;
- approved modeling decisions.

### Workbench product/interface

This folder registers the Workbench product/interface decisions alongside the other MDSE tool definitions. The standalone `spencerskelly/MDSE_Workbench` repository is the authoritative Workbench implementation source. Cross-tool ownership and boundaries are summarized in [[MDSE Tool Definitions and Boundaries]].

This folder defines how Workbench should expose and operate on those semantics.

If the interface definition and the current model schema conflict, the model schema remains authoritative until a separate governance decision changes it.

## Generic engine + vault configuration

Workbench should be reusable across MDSE vaults.

The plugin should read vault-defined configuration for:

- recognized element types;
- relationships and inverse/display behavior;
- validation rules;
- View Profiles;
- compatibility/version information;
- configured locations such as generated views.

Do not hard-code Ampure product semantics into the core plugin.

## Internal architecture

Recommended separation:

```text
Workbench UI
   ↓
Create / Explore / Review
   ↓
Model Services
   ├─ Index / identity
   ├─ Validation
   ├─ Relationship service
   ├─ Traversal / view service
   ├─ Model-health service
   └─ Transaction / undo service
   ↓
Obsidian vault Markdown + YAML
```

Canvas is one renderer/editor over the same services.

## Model index

A local index/cache is allowed for performance.

Requirements:

- derived from the vault;
- disposable;
- rebuildable;
- updated incrementally when safe;
- rebuilt when consistency is uncertain;
- not committed as authoritative model state.

> The index may be cached. The model may not.

## Identity

The vault already defines durable note identity.

Workbench should use durable identity internally where practical while preserving human-readable Markdown relationships.

Never rely on file path alone as permanent identity.

Ambiguous links must be treated as errors rather than guessed.

## Addressable Local Model

W-293/W-294 and W-298 add model content below the file-backed note level without changing the rule that the vault files are authoritative.

Workbench therefore indexes two addressable kinds:

W-315 fixes the local-reference token style and namespace: `part-*`, `ep-*`, `conn-*`, and `flow-*` wrap a globally unique 30-character identity token. The prefix is local representation metadata; the token is persistent identity and may not duplicate any note UID or other local token. Visible engineering names are display data.

- **note element** — durable identity is the note `uid`; file path is current location metadata, not permanent identity;
- **local model record** — persistent identity token is embedded in its kind-prefixed local ID; the semantic address remains owner UID + local ID so context/ownership is explicit.

The core index, traversal, Details, Inherited and Review/navigation APIs should operate on one common addressable `ModelRef` rather than assuming every subject is a `TFile` path. A `ModelRef` may identify a note or a local record. This common reference seam is the default implementation rule for new Workbench behavior and is also the correct seam for later cross-vault resolution.

For v0.8 keepability (WB-106), this is no longer optional architecture debt: the index must preserve note UID identity and local owner-UID + kind + local-ID identity, including block fragments from frontmatter links such as Requirement `appliesTo`.

W-306 makes Obsidian-native-first a Workbench architecture constraint: core Obsidian/standard Markdown/YAML first, broad plugin compatibility second, custom Workbench-only representation last. Workbench adds semantics and safety on top of native model content.

W-313/W-319 make `99_System/03_Schemas/local-model.yaml` the shared machine-readable contract. New writing is schema 0.2; Workbench must read 0.1 and 0.2 rather than maintaining a private body syntax.

Local Model records remain structured, human-readable Markdown in the owning note body. They are a governed region separate from ordinary narrative text. W-302/W-319 define exactly one managed region per note. Canonical new output begins `<!-- MDSE:LOCAL-MODEL START schema=0.2 -->` beneath `## Local Model` and ends `<!-- MDSE:LOCAL-MODEL END -->`; historical 0.1 regions remain readable. The Workbench popup presents the records in a separate **Local Model** section. The parser owns only content inside those markers. Missing/duplicate/nested/mismatched markers become findings and disable structured edits. The general text editor must never rewrite the governed region.

Each materialized local record exposes a native Obsidian block ID equal to its stable local ID (`^part-*`, `^ep-*`, `^conn-*`, `^flow-*`). Standard links such as `[[Owner Note#^ep-42bd90|J4]]` therefore navigate directly to the record without Workbench, while Workbench interprets the address semantically. Core Graph still treats the owner note as the graph node; that limitation is accepted.

W-312 requires persisted local-to-local references to use the same native block-link form rather than bare IDs: endpoint `part`/`parent`, connection endpoints, exposure and temporary local `equals`. W-311 requires connection ownership to stop at assembly boundaries: parent integration terminates on a child boundary endpoint; `exposes` traverses from that boundary endpoint to the internal endpoint without moving connection ownership.

W-310 requires Workbench to treat grouped multiplicity as non-addressable repetition only. A grouped `part-*` with `multiplicity: N` represents interchangeable copies; individually contextualized copies must appear as separate local records and be separately traversable. Repeated entries of the same note-level relationship are duplicate source/list evidence, not multiplicity, and must not be displayed as engineering quantity.

Definition links from a local record point to reusable file-backed MDSE elements. Part occurrences therefore reuse Object/assembly definitions and endpoint occurrences reuse Port/interface definitions. W-305 requires lazy endpoint materialization: nested pins, contacts and sub-interfaces stay implicit through the reusable definition until the local context needs one as an independently addressable occurrence. When materialized, it uses the same endpoint schema plus a parent endpoint address, not a new Workbench model kind. Workbench may show inherited members in interface browsing but must distinguish them from materialized local records. Context-specific wiring remains local. Flow truth is connection-owned and stored once; the index derives interface-centric flow views from each connection's endpoint roles rather than duplicating authoritative flow records. EA source provenance is not required for Workbench model operation and is kept separately in the import-evidence Local Model Source Map.

## Writing relationships

Workbench should use the relationship vocabulary and storage rules defined by the current schema.

Important interface behavior:

- engineer sees the relationship in the natural visual direction;
- Workbench resolves the canonical owner-side storage direction;
- authoritative YAML is updated immediately after confirmation;
- Workbench writes the derived inverse with the forward field (WB-085, W-275).

Workbench does not invent a separate graph database as the model of record.

## Relationship provenance

The view engine may render:

- explicit relationships;
- derived inverse relationships;
- contextual/inherited relationships allowed by a View Profile;
- future calculated/rolled-up relationships;
- Canvas-only visual connections.

The UI must keep those categories distinguishable.

Only explicit model changes should be written as authoritative relationships.

## Creation

All creation surfaces call one common creation service.

V1 modal creation and future Canvas-inline/workflow creation therefore produce the same validated result.

Creation should follow current:

- element type definitions;
- required properties;
- templates;
- UID/ID rules;
- relationship validity;
- placement conventions.

## Transaction safety

Workbench semantic edits should be explicit transactions.

A transaction should know:

- intended change;
- affected notes;
- validation result;
- before state;
- after state.

This supports:

- safe failure;
- Undo/Redo;
- batch operations;
- future audit improvements.

## Generated vs curated views

Generated Canvas files are working artifacts and may be replaced.

Curated Canvas files are intentional user artifacts and must not be overwritten automatically.

This boundary should exist in code, not merely documentation.

## Cross-vault boundary

V1 is single-vault for Workbench traversal and editing.

Do not design identity/traversal APIs so narrowly that every target must always be a local file path.

Future cross-vault support should be possible through an external resolver without rewriting core view logic.

## Community plugin boundary

Community plugin code and behavior can inform implementation, but core Workbench correctness must not depend on those plugins being installed.

Permissively licensed projects may provide implementation patterns where appropriate and attribution/license requirements are followed.

GPL code must not be copied into a differently licensed Workbench without consciously accepting the licensing consequence.

## Schema changes

Workbench is not the ordinary schema editor.

If a new engineering need cannot be expressed using the current schema:

1. keep the engineering need visible;
2. use approved provisional behavior if available;
3. take the semantic question to model governance;
4. update Workbench only after the model decision is made.

## Compatibility

The vault/schema should expose enough version information for Workbench to determine whether semantic actions are safe.

If incompatible:

- keep Markdown readable;
- explain the mismatch clearly;
- disable unsafe creation/edit/view generation rather than guessing.

## Principle

The simplest reliable architecture is:

> Obsidian files are the model. Workbench makes them easier to use.

## Performance *(WB-081)*

The index is the performance-critical part. Design for the full translated vault (up to about 60,000 notes): build the index off the UI thread or in small chunks, update incrementally from file events, persist a rebuildable cache, and never render an unbounded graph (node cap outranks depth, WB-082). Measure on the real vault in Phase 0.

## External change and Git *(WB-086)*

- Workbench edits files; it does not run Git or commit.
- Changes from pulls, AI tools or hand edits arrive as file events; update the index incrementally, rebuild after a large change set or on demand.
- Each semantic transaction records a before-state hash per note; Undo refuses with an explanation if a note changed since.
- Write relationship lists in a stable order to reduce merge conflicts.

## Inverse relationship fields *(settled, WB-085, W-275 trial)*

Workbench writes the inverse with each forward field it writes, and writes inverses after hand edits made on the same machine. Changes from pulls or outside AI edits are reported as missing-inverse findings, not rewritten automatically, so machines do not race each other. The forward field is the authority; the inverse is regenerated from it. No dependency on Nodian.

## Creation parity *(WB-084)*

The creation service reads the vault's class templates and the `uid`/`id`/author-code rules rather than duplicating them, so a Workbench-created note equals a template-created one. Both the template and Workbench therefore change together when the rule changes.

## Platform, distribution and versioning *(WB-087, WB-088)*

Desktop only, with mobile-ready code: only Obsidian's own APIs (no Node or Electron), narrow-screen layouts, select-then-command interactions, a compact index (WB-087). Plugin source lives in its own repository; releases are GitHub Releases pinned by MDSE Bootstrap. The vault holds only vault-side configuration (View Profiles, schema/compatibility declaration).

## Contextual usage and configuration boundary (W-314)

Workbench must preserve the W-314 three-layer boundary:

1. reusable definition hierarchy;
2. contextual Local Model occurrence;
3. configuration resolution.

The base Local Model stores `definition` plus contextual `usage` (`standard | variant | option`, omission = `standard`). Reusable definitions may later expose `abstract: true`. Workbench derives variant candidates from the transitive `subtypeOf` hierarchy and must not persist duplicate candidate lists merely for UI convenience.

A Workbench configuration session is a derived working state, not authoritative replacement model content. Selecting a concrete variant or excluding an option must not rewrite the base occurrence. If the engineer chooses to save a named configuration, Workbench will eventually write a separate native Markdown representation after that format is governed. Until that format is settled, configuration exploration may remain transient only.

Configured views are derived presentations over the same authoritative notes and Local Model. An absent option causes dependent contextual topology to disappear from the configured view through normal occurrence filtering; it does not require a second connection/flow variation language.

Workbench validation must reject or flag abstract effective definitions, out-of-family selections and selections invalidated by later hierarchy changes. It must never silently repair a saved configuration by choosing a different subtype.

W-319 implements the schema advance: `local-model.yaml` 0.2 and `element-types.yaml` 1.17 are now the executable write/configuration contracts. Workbench still implements WB-106 first, with read compatibility for Local Model 0.1 and 0.2, before adding W-314 variation UI.


## 2026-10-02 standalone implementation note

Workbench 0.1.15 resolves two immediate contradictions only:
- repeated note-level relationship targets are presented as duplicate evidence, never engineering quantity;
- ordinary body editing is refused when a governed Local Model marker is present.

The remaining Local Model architecture above is not yet implemented in the index. `WB106_IMPLEMENTATION_CONTRACT.md` in the standalone Workbench repository is the coding contract for that next step.

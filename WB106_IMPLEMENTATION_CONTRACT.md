# WB-106 Implementation Contract

## Authority and purpose

This file is the standalone Workbench continuation contract for MDSE v0.8.

The model remains Markdown/YAML in the vault. Workbench is a parser/index/view/editor over that model, never a second model database.

Read the methodology workspace's `00 - Current State.md` first, then the 2026-10-02 reconciliation. W-315 through W-319 govern Local Model semantics; W-321 governs the lean runtime-base and cross-tool release chain.

## Runtime/release compatibility

Workbench remains independently versioned from MDSE. It should not embed a second copy of the MDSE release registry. At runtime it reads the vault's actual schemas. The final v0.8 base will pin a WB-106-capable Workbench release in `.obsidian/plugin-lock.yaml`.

If the Local Model schema is unsupported, structured Local Model behavior is disabled rather than guessed. The methodology release checker verifies the pinned Workbench version and the portable schema fixtures before a base is issued.

## Required schema support

Workbench must load three vault schemas:
- `relationships.yaml` 1.35;
- `element-types.yaml` 1.17;
- `local-model.yaml`, reading 0.1 and 0.2.

Structured Local Model editing is now an approved WB-106 direction. Workbench may write only schema 0.2 records through the governed model-edit service. Schema 0.1 remains read-compatible and read-only unless an explicit migration operation converts the governed region to 0.2.

Unknown future Local Model versions remain readable as Markdown but structured Local Model actions are disabled.

## Model identity seam

Replace path-only semantic identity with a `ModelRef` seam.

Conceptually:

```ts
type ModelRef =
  | { kind: "note"; uid: string }
  | {
      kind: "local";
      ownerUid: string;
      localKind: "part" | "endpoint" | "connection" | "flow";
      localId: string;
    };
```

Paths and headings are navigation/display metadata, not semantic identity.

The local ID is the native Obsidian block ID and contains:
- a representation-kind prefix;
- a globally unique 30-character identity token.

The reader must preserve `#^local-id` fragments. A relationship such as Requirement `appliesTo` may resolve to a local `ModelRef`, not merely to the containing note.

## Local Model parser

Parse at most one governed region per note.

Support:
- 0.1 records exactly as governed by the historical schema;
- 0.2 records exactly as governed by current schema.

Normalize a 0.1 part/endpoint in memory as:
- `usage = standard`;
- `usageExplicit = false`;
- preserve `sourceSchemaVersion = "0.1"`.

Never mutate a 0.1 file simply because it was read.

0.2 omission of `usage` likewise means standard.

Connection and flow records reject `usage`.

## Editing boundary

The ordinary body editor must never rewrite the governed Local Model region.

Workbench has two explicit edit surfaces:
- **Context / Local Model edit** — edits occurrence-local data and contextual relationships through structured Local Model operations;
- **Definition edit** — edits the canonical reusable MDSE note through the normal note/property/relationship services.

These surfaces may be launched from the same details experience, but ownership must stay visible and they must not silently write into each other's storage.

For body text:
- narrative text before/after the governed region may be edited only by a region-aware writer that preserves the governed region byte-for-byte;
- until that writer is active, ordinary body text editing remains disabled for notes containing a governed region.

Structured Local Model editing:
- writes schema 0.2 only;
- never rewrites a 0.1 region merely because it was read;
- goes through the model-edit service rather than view-specific Markdown manipulation.

## Local Model findings

WB-106 must report at least:
- missing/duplicated/nested/mismatched markers;
- unsupported schema version;
- duplicate local IDs;
- malformed native block ID;
- global identity-token collision with any note/local record;
- broken local block links;
- missing/incompatible definitions;
- invalid part/parent references;
- invalid connection endpoints;
- orphan/misnested flow;
- unresolved local frontmatter target;
- invalid usage value or usage on connection/flow;
- standard occurrence pointing at `abstract: true`;
- variant/option family with no concrete candidate;
- specialization cycle;
- invalid `abstract` value.

An unresolved variant or option is not a base-model error. It becomes configuration state only when a configuration is being evaluated.

## Occurrence-aware views

Before a whole v0.8 import is accepted/kept:
- Structure understands local part occurrences;
- Interfaces understands local endpoints, exposure, connections and connection-scoped flows;
- Where Used understands occurrence references;
- Requirements resolves local `appliesTo` targets.

Canvas may render local records as derived/text nodes if native Canvas cannot address them as file cards. This does not create notes for the local records.

## Internal Structure view

WB-106 includes an occurrence-native Internal view for an Object that owns Local Model content.

- the selected note is the visual boundary;
- local part occurrences are inside it;
- assembly-boundary endpoint occurrences are compact boundary boxes;
- part-owned endpoints stay near their owning occurrence where practical;
- local connection records provide endpoint-to-endpoint semantic edges;
- connection-owned flows may be summarized on that connection;
- `exposes` is shown from the boundary endpoint to the internal endpoint it exposes;
- reusable-definition internals are not flattened into the owner's context.

Internal Canvas node IDs must be stable with respect to the addressed ModelRef/local ID. Canvas geometry is presentation-only. A semantic refresh of a curated Internal view preserves surviving node position/size where possible and must never treat manually drawn/moved Canvas geometry as new MDSE semantics.

## Duplicate relationship rule

Repeated identical note-level relationship entries are duplicate-source/model evidence, never engineering quantity.

Do not label them as `×N` quantity. True quantity is Local Model `multiplicity`.

## W-314 after WB-106

After the Local Model foundation is stable:
1. parse sparse optional `abstract`;
2. parse occurrence `usage`;
3. derive specialization candidates transitively from authored `subtypeOf`;
4. add variation validation and read-only UI;
5. add temporary session configuration keyed by stable ModelRefs/definition UIDs.

Candidate resolution:
- start at stated reusable definition;
- include root if non-abstract;
- traverse incoming authored `subtypeOf` edges from the family root because `subtypeOf` is specific → general;
- traverse through abstract and concrete nodes;
- candidates are concrete only;
- deduplicate by durable UID;
- protect against cycles;
- do not persist the candidate list.

A selection outside the family or selecting an abstract definition is invalid. If a previously valid stored/session selection becomes invalid after hierarchy change, report a finding; never silently substitute another definition.


## WB-106 editor architecture

WB-106 is now the Workbench model-editor boundary, not only a read/navigation gate.

### Service boundary

Views, popups and Canvas gestures do not write Markdown/YAML directly. They submit semantic model operations to a pure model-edit service. The service owns:
- validation;
- transaction scope;
- storage planning;
- before/after semantic change description;
- undo/redo records;
- impact-review requirements;
- deterministic repair rules.

The Obsidian adapter is responsible only for reading/writing the affected vault files and refreshing indexes/views.

This boundary is deliberate so Local Model syntax, schema versions, storage layout and UI can evolve independently.

### Transaction behavior

- Small atomic edits may apply immediately after validation.
- Multi-object or structural edits use a staged transaction with explicit Review / Apply / Cancel.
- A staged transaction may be temporarily invalid while being assembled.
- Validation runs continuously.
- Apply is blocked while required-integrity errors remain.
- Advisory warnings do not block Apply unless the schema/rule marks them blocking.
- Cancel discards the staged transaction without changing the model.

### Semantic history and undo/redo

Git remains authoritative durable file history.

Workbench also maintains a lightweight semantic edit history for the current session/workflow:
- affected ModelRefs;
- operation kind;
- before/after semantic summary;
- author identity available from the MDSE author/UID mechanism;
- timestamp;
- optional reason/comment for meaningful transactions.

Immediate edits and applied staged transactions enter one semantic undo/redo stack. An operation may be marked non-reversible when safe reversal cannot be guaranteed; that limitation must be shown before Apply.

### Identity

Workbench does not invent a second global identity system.

The existing MDSE UID/identity contract remains authoritative across notes and independently referenceable Local Model objects. Display names, hierarchy and Local Model position are not identity. Local Model block IDs remain native navigation addresses under the governed schema.

A nested metadata item that cannot be referenced independently does not gain a new UID merely because Workbench edits it.

### Presentation and ownership

Occurrence/context views use contextual identity first where context matters, and reusable definition identity first where definition traceability matters.

Occurrence details:
- show occurrence-local data first;
- place the reusable definition under a collapsed **Definition** section;
- expanding Definition renders the full authored definition;
- derived/incoming definition relationships appear under a nested **Relationships** expansion;
- unchanged inherited values are not copied into the occurrence-local section;
- local overrides appear in the occurrence section and expose their definition/base source on demand.

Override semantics are schema/property-specific: some are replacement-style, others additive/constraining. Workbench never guesses.

Contextual relationships are grouped by relationship type while preserving authored/local order inside each group. Relationship metadata is expandable only when it exists, and relationship detail contains relationship-owned metadata only; endpoint data remains on the endpoint occurrence.

Structure represents the contextual/local assembly hierarchy only. It does not merge definition structure into the same tree.

### Definition editing from context

Workbench may edit reusable definitions from the same overall interface, but definition editing is a distinct mode/surface writing the canonical note.

A Local Model context may launch the canonical definition-creation workflow. On successful creation, Workbench returns to the context and binds the occurrence. Cancel leaves the Local Model unchanged.

Definition edits use schema-driven impact rules. A change type may require a Where Used / occurrence impact review before Apply.

### Lifecycle and repair

- Deletion of a definition with active references is blocked.
- Retirement keeps the definition resolvable and makes affected usages visible.
- Supersession may offer a guided occurrence migration but never silently reassigns references.
- Mechanical/schema-safe repairs may be automatic and logged.
- Semantic repairs require explicit engineer review.
- Ambiguous cases are never automatically resolved.


## High-priority schema transition — WB-128 / Local Model 0.4

Before Workbench can accept or structured-edit importer output written under MDSE W-384, it must add explicit Local Model 0.4 support while preserving 0.1/0.2/0.3 behavior.

For 0.4:
- sections are `Parts`, `Interfaces`, and `Connections`;
- reusable Interface definitions resolve to `Object` notes with subtype `interface`;
- local Interface occurrences remain endpoint ModelRefs;
- `exposes` is owned by a Connection and targets an assembly-boundary Interface occurrence in the same Local Model context;
- Internal/Interfaces views render exposure from the internal/context Connection to the boundary Interface;
- new structured writes use 0.4 only after parser/validator/writer tests are complete;
- older 0.3 endpoint-owned exposure remains 0.3 semantics and is never silently rewritten.

Required validation includes: invalid exposure target kind, exposure to a non-boundary Interface, cross-context exposure without an approved representation, duplicate/ambiguous exposure evidence, and any attempt to write legacy Port-note semantics into a 0.4 region.


## Deferred

Do not fold these into WB-106:
- persisted named configuration syntax/editing;
- model-number/product-code mapping;
- configuration inheritance/composition;
- `allowedDefinitions`;
- compatibility matrices;
- topology variation;
- new local Function/Use Case/State occurrence kinds;
- connection/flow usage;
- promotion heuristics.

## Test requirements

Add fixtures/tests for:
- Local Model 0.1 read compatibility;
- Local Model 0.2 canonical parse;
- marker errors;
- native block-link preservation;
- 30-character global identity collisions;
- local Requirement target;
- nested endpoint;
- connection + multiple flows;
- abstract/usage validation;
- transitive candidate discovery including abstract intermediates and cycle protection;
- ordinary body edit refusal while a governed region exists;
- repeated note-level relationship target is duplicate evidence, not quantity.

WB-106 is the Workbench keepability gate for the first accepted v0.8 whole-model import.

## Implementation status (0.1.17, 2026-10-03)

**The original WB-106 read/navigation baseline is complete in the standalone 0.1.17 candidate.** The former keepability-gate behavior is present:

- three-schema compatibility remains in place: relationships 1.35, element-types 1.17, Local Model read 0.1 + 0.2;
- durable `ModelRef` identity and native block-fragment preservation;
- Local Model parser, validation, identity-collision checks, abstract/usage checks and specialization candidates;
- ordinary body-edit refusal around governed Local Model content;
- incrementally maintained Local Model index alongside the note index;
- Structure shows local part occurrences without parent reach-through;
- Interfaces shows local endpoints, exposure/parent topology, connections and connection-scoped flows;
- Where Used includes contextual occurrences of reusable definitions;
- Requirements preserves local `appliesTo` targets as exact occurrences rather than degrading them to the owner note;
- generated Canvas views render local records as derived/text cards linked to their native Obsidian block IDs;
- local occurrence data participates in generated-view stale signatures;
- clicking a generated local record opens a read-only Local Model details popup with native navigation;
- Review includes Local Model findings as a read-only category.

Workbench 0.1.17 completes the original read/navigation keepability baseline. The 2026-10-03 WB-114 decision expands WB-106 into the structured editor architecture above. Therefore 0.1.17 remains the validated read/navigation candidate, but WB-106 is not considered product-complete until the editor service and structured edit surfaces meet this contract.

Persisted named configuration state, topology variation, model-number rules and the other deferred W-314 items remain outside this editor expansion unless separately approved.

The standalone candidate must still pass the normal release/integration chain before the methodology workspace sets `wb106Version` or an issued v0.8 base is kept.

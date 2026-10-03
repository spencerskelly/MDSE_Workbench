# Build Outline and Roadmap

## Goal

Deliver the smallest Workbench release that makes the MDSE vault substantially easier for an engineer to use every day, and prove the interface and semantic-editing pattern before investing in advanced automation.

Status: the capability set and the release path (milestones, gates, Canvas-edit gating, WB-080 to WB-090) are approved direction (2026-09-30).

## V1 capability set

### Dashboard
- dedicated MDSE Workbench view;
- task-oriented **Create / Explore / Review** sections;
- common create actions;
- element selection for Explore;
- standard view launch buttons;
- Review finding counts.

### Create
- compact schema-driven modal;
- valid initial note creation, identical to a template-created note (WB-084);
- duplicate-name protection (id suffix rule, WB-083);
- folder/default placement support;
- automatic open of created note.

### Explore
- fast unique-name search, showing type and id beside the name;
- optional type filter;
- multi-select;
- Structure, Behavior, and Requirements views at minimum;
- one-click governed defaults;
- adjacent View Options path.

### View engine
- read current model index;
- bounded semantic traversal (depth and node cap, cap wins, WB-082);
- one or multiple starting elements;
- shared/connecting context for multi-start;
- all valid paths within bounds;
- omitted-branch indicators;
- deterministic standard layout;
- stale-view indication;
- generated-view refresh;
- generated view reuse by starting set + profile.

### Relationship service (surface-independent)
- schema-valid relationship choices for selected endpoints;
- canonical owner-side writeback, immediately after confirmation, with the inverse written in the same transaction (WB-085);
- batch one-to-many / many-to-one with valid/invalid preview;
- relationship removal confirmation;
- in-session semantic Undo/Redo with before-state check (WB-086);
- first surface: a command/modal on notes (WB-080).

### Canvas
- generated native Obsidian Canvas, View Mode by default;
- **release-gated (WB-080):** explicit temporary Model Edit mode; selected nodes → Create Relationship through the relationship service; Canvas node removal never removes the model element;
- Save as Curated View.

### Review
- categorized whole-vault findings;
- dedicated Review screen, filters/search;
- focused finding modal, open source/target;
- straightforward resolution actions;
- `tracesTo` replacement with an existing valid relationship;
- Previous / Next through the filtered queue (WB-063).

### Model/index foundation
- schema/config loader;
- element registry/index and relationship registry;
- validation service and traversal service;
- local disposable cache, incremental update, rebuild;
- plugin/schema compatibility check.

## Suggested internal modules

Workbench should feel like one plugin but use clear internal services.

- **Model Core** — vault scan/index; identity resolution; schema/config loading; relationship registry; validation; model-health findings; incremental cache update and rebuild.
- **Create** — dashboard create actions; schema-driven forms; naming/duplicate checks; placement; note creation (reads the vault templates, WB-084).
- **Explore** — element picker; View Profile selection; traversal; path finding; context expansion; View Options.
- **Relationships** — validation, owner-side writeback and inverse writes, missing-inverse detection, batch preview, transactions, Undo/Redo. No UI in this module.
- **Canvas** — Canvas generation; deterministic layout; provenance styling; View Mode / Model Edit; generated/curated behavior.
- **Review** — model-health categories; finding list; filtering; focused finding modal; resolution actions.

## Service-oriented design

Internal services must not encode gestures.

```text
createElement(...)
createRelationships(sourceIds[], targetIds[], relationshipType)
removeRelationship(...)
buildView(startIds[], viewProfile, options)
findModelHealthFindings(filters)
resolveFinding(...)
```

Exact APIs can change; the separation is what matters.

## Release path

**Where the build stands (2026-10-02, plugin 0.1.15).** Built. Spencer has seen these work in Obsidian: the Review header counts, the Structure view (legacy repeated links are now labeled explicitly as duplicate evidence), the Functional and Requirements views, the note popup and its Relationships dropdown (so the click detection works on his Obsidian version). Not yet confirmed there: editing in the popup, the view picker and the eight newer views, Replace relationship and Undo, and the Canvas selection menu on later versions (see [[06 - Test Sheet]]): M0 (gate R0 decided go); M1 (eleven views from a note or from a popup button, stale check, omission and undefined indicators); M3 in command form (relationship service, relate command, Replace relationship, one Undo for every Workbench edit; batch preview is not built); M4 (Review screen, filters, finding window; `tracesTo` resolution through Replace relationship); M5 (the standard views, WB-097, WB-098, WB-102; multi-start and Expand/Collapse are not built); a first part of M6 as a popup on a generated view (edit text, ordinary properties and relationships, WB-099 to WB-101), not yet on the Canvas itself. Not built: M2 Create, Canvas Model Edit proper, M7 hardening and pilot. The release pipeline files exist but are not switched on (see the Decision Log).

Each milestone has an exit criterion. A milestone is not done until its exit criterion is shown on the real translated vault, not only on a small sample.

**Update 2026-10-03 (plugin 0.1.16).** WB-106 part 1 is built: Local Model 0.1/0.2 reader, `ModelRef`, the finding list and a findings report command (WB-111), and Obsidian-style link writing (WB-112). Still to build before the gate: occurrence-aware Structure, Interfaces, Where Used and Requirements views, the Local Model popup (WB-105) and Review integration.

**WB-106 v0.8 keepability prerequisite before R1.** Workbench 0.1.15 is still frontmatter/note/path-only. It now refuses ordinary body editing when a governed Local Model marker exists, but before the first potentially keepable v0.8 import is accepted it must load `local-model.yaml`, read both schema 0.1 and 0.2, index durable note/local ModelRefs, preserve `#^local-id` fragments, expose the Local Model surface, add local model-health findings, and make Structure, Interfaces, Where Used and Requirements occurrence-aware. Repeated relationship entries are duplicate evidence, not quantity. Structured Local Model authoring is deliberately later than this read/navigation gate.

### M0 — Spike and feasibility (Phase 0)

Purpose: replace the riskiest assumptions with measurements before building more.

- plugin skeleton, config loading, compatibility check, model index, diagnostics;
- index the real translated vault and record the numbers against WB-081;
- generate one read-only Structure Canvas for a real element;
- write one relationship and its inverse through a throwaway command, and time a full missing-inverse scan of the real vault (WB-085);
- probe whether Canvas edge/selection events can be used without unsupported patching (WB-080);
- confirm the build and release pipeline produces an installable plugin that MDSE Bootstrap could pin (WB-088).

**Exit (gate R0):** a short written finding in the decision log: targets met or plan recorded; inverse writing and scanning shown to work; Canvas-edit go/no-go for V1.

### M1 — Explore, read-only
Element picker (name, type, id); Structure profile; native Canvas generation; deterministic layout; refresh; stale detection; omission indicators.
**Exit:** an engineer selects an element and gets a useful Structure view in one click.

### M2 — Create
Modal framework; common element creation from vault templates; duplicate-name check; folder selection; open note after create.
**Exit:** common elements are created without hand-writing YAML and their headers match template-created notes.

### M3 — Relationships via command/modal
Relationship service; endpoint validation; canonical writeback; removal prompt; batch preview; Undo/Redo; external-change handling.
**Exit:** an engineer safely adds and corrects relationships from a note, and an undo after an outside edit fails safely.

### M4 — Review
Finding categories/counts; Review screen; filters; focused modal; `tracesTo` resolution.
**Exit:** unresolved/model-health items can be worked without manual queries.

### M5 — More views
Behavior and Requirements (and approved others, WB-072); multi-start behavior; Expand/Collapse. After W-298/WB-105, the same traversal engine must also accept addressable Local Model records so Structure, Interfaces, Where Used and Requirements can show contextual occurrences without inventing duplicate notes.
**Exit:** several common engineering questions work through the same traversal engine, including local occurrence context on a current importer output.

### M6 — Canvas Model Edit (gated by WB-080)
Explicit Model Edit mode; selection + Create Relationship; Canvas node removal semantics; edit-mode reset on reopen.
**Exit:** an engineer corrects relationships from a generated Canvas through the same relationship service.

### M7 — Hardening and pilot
Large-vault performance; cache rebuild; schema-version compatibility; failed-edit recovery; test fixtures; documentation; Bootstrap install check.
**Exit (gates R1 then R2):** pilot on a real slice with two or three engineers, acceptance scenarios pass, findings resolved, fresh-vault install verified.

If M0 shows Canvas editing is low-risk, M6 may move before M5. If not, V1.0 is M0–M5 plus M7, and M6 becomes the next release.

## Non-functional requirements

| Area | Requirement | Reference |
|---|---|---|
| Scale | Up to about 60,000 notes; targets for index build, incremental update, view time, memory | WB-081 |
| Safety | Never corrupt authoritative notes; plugin failure leaves Markdown/YAML usable | testing priorities |
| Compatibility | Schema declares version; incompatible vault disables unsafe edits with a clear message | WB-069 |
| Git | Workbench never commits; external changes picked up; undo checks before-state | WB-086 |
| Platform | Desktop only (`isDesktopOnly: true`); code written mobile-ready: Obsidian APIs only, no Node or Electron, narrow-screen layouts, select-then-command | WB-087 |
| Distribution | Separate plugin repo; GitHub Releases; pinned by MDSE Bootstrap; semantic versions | WB-088 |
| Parity | Workbench-created notes match template-created notes | WB-084 |
| Independence | Correctness does not depend on community plugins; Workbench writes inverses itself | WB-003, WB-085 |

## Risk register

| Risk | Effect | Mitigation |
|---|---|---|
| Canvas editing relies on unsupported internals | Breaks on Obsidian updates; blocks V1 | Gate (WB-080); relationship service first; probe in M0 |
| Index too slow or large at full scale | Unusable on the real vault | Performance gate in M0; disposable cache; incremental updates |
| Path enumeration explodes | Views hang or flood | Node cap outranks depth (WB-082) |
| Creation drifts from templates | Notes differ by how they were made | One creation spec, parity test (WB-084) |
| Inverse fields missing or out of date | Inconsistent relationships | Written with the forward field; missing-inverse finding and Regenerate command (WB-085) |
| Merge conflicts on relationship lists | Lost or duplicated relationships | Stable ordering; external-change handling (WB-086) |
| GPL code copied from a reference plugin | Licensing obligations | Study patterns only; check each project's license before reuse |
| Design keeps growing before code exists | Nothing ships | Implementation details decided during build (WB-089); M0 starts now |

## V1 acceptance scenarios

### Create a Function
Open Workbench → Create Function → complete modal → Create → new Function note opens and its header matches one made from the template.

### View structure
Open Workbench → search/select PCBA → Structure → generated Canvas opens with profile-defined context and explicit omission indicators if bounded.

### Add a relationship
From a note (or, after M6, a generated Canvas in Model Edit) → select source and target → Create Relationship → choose a valid relationship → confirm → authoritative model updates immediately, the inverse appears, and Undo restores the before-state.

### Resolve a provisional relationship (`tracesTo`)
Workbench Review → Provisional Relationships → open finding → choose an existing valid replacement → confirm → finding clears.

### Preserve an important view
Generate quick view → adjust/annotate → Save as Curated View before refresh → curated Canvas becomes a normal intentional vault artifact.

### Outside change
Pull a commit that changes notes while Workbench is open → index updates; a stale view is flagged; an Undo for an older edit to a changed note is refused with an explanation.

### Full-size vault
On the real translated vault: cold index, one Structure view and one relationship write each meet the WB-081 targets.

## Explicit V1 deferrals

Do not delay V1 for:

- native drag-to-connect;
- full Canvas property editing;
- semantic Canvas groups;
- live redraw;
- non-destructive curated-view sync;
- cross-vault traversal;
- query/filter starting sets;
- advanced naming enforcement;
- bulk governance actions;
- schema authoring inside Workbench.

## Testing priorities

1. Never corrupt authoritative notes.
2. Never create a relationship the current schema rejects.
3. Never silently infer semantics.
4. Generated views are reproducible.
5. Undo reverses a Workbench semantic transaction, or refuses safely.
6. Refresh cannot destroy a curated view.
7. Index/cache can be rebuilt from the vault.
8. Plugin failure leaves Markdown/YAML usable.
9. Workbench-created notes match template-created notes.
10. Performance targets hold on the full-size vault.

Keep test fixtures: a small synthetic vault for unit tests, plus the real translated slice for scale and acceptance runs.

## Roadmap beyond V1

### V1.x — Improve high-use workflows
Add only after V1 usage shows clear value: recent elements; favorites; richer picker filters; saved personal filters; more View Profiles; improved layouts; better relationship source tracing; improved model-health explanations; faster repeated creation; Canvas Model Edit if it was gated out of V1.

### V2 — Rich graphical modeling
Native drag-to-connect; inline Canvas element creation; direct Canvas property editing; richer expansion/collapse; richer batch editing; semantic group binding; improved guided relationship creation. All reuse the V1 model services.

### Later
- **Curated-view synchronization:** Compare with Model; Update from Model; preserve manual placement and annotations; show added/removed context before applying. Do not retrofit this by making curated views disposable.
- **Advanced discovery:** query/filter starting sets; saved shared searches; analytical/rolled-up relationships; evidence-chain exploration; variant comparison; richer impact analysis.
- **Cross-vault Workbench:** resolve external UIDs; include external context; follow cross-vault relationships; clear read/write authority display; edit only with valid access. Core identity/traversal APIs keep this path open.

## Revision discipline

- **Preserve decisions.** When a decision changes: keep the prior one in the Decision Log, mark it superseded, add the replacement with its date, explain what changed, update affected notes.
- **Separate interface and model governance.** If Workbench discussion starts redefining the model, stop and move the question to model governance.
- **Favor evidence from use.** Simple V1 behavior, observe friction, identify repeated high-value needs, then add. Avoid feature depth just because the plugin could support it.
- **Backward compatibility.** Future improvements are new views or gestures over stable services: modal creation → richer workflow on the same creation service; select + command → drag-to-connect on the same relationship service; one-click profile → View Options on the same view engine; frozen curated view → later sync using preserved metadata.

Workbench is succeeding if it becomes more capable while the everyday workflow stays understandable to an engineer who does not care how the model is implemented.

**W-314 configuration follow-on.** After the WB-106 Local Model foundation can safely parse/index the governed body contract, add configuration support incrementally rather than combining it with the parser rewrite:

1. after WB-106, read the now-governed `usage` and definition-level `abstract` fields from Local Model 0.2 / element-types 1.17;
2. derive transitive concrete candidate families from `subtypeOf`;
3. expose read-only variation-space information and findings;
4. add temporary variant/option selections in Workbench session state without mutating base architecture;
5. govern the persisted named-configuration Markdown format before adding save/write support;
6. add configured architecture, comparison and filtered Canvas views;
7. add model-number rules only after the configuration state is independently correct.

This follow-on does not require new relationship types or a second persistence database. It must not delay the basic WB-106 read/navigation safety work by coupling configuration editing into the first Local Model parser.


### 2026-10-02 continuation boundary

For the next standalone plugin implementation, use `WB106_IMPLEMENTATION_CONTRACT.md` in `spencerskelly/MDSE_Workbench`. The schema advance is complete; WB-106 remains first. Do not combine persisted configuration editing with the parser/index rewrite.

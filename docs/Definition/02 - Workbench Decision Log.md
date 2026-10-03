# Workbench Decision Log

> IDs use the `WB-` prefix (renamed 2026-09-30 from `D-`, same numbers) so they cannot be confused with the Workspace Decision Log (`W-`) or the EA migration Decision Register. Former open items `O-001`…`O-009` are now `WB-063` and `WB-072`…`WB-079` (mapping at the end). This note replaces the separate Open Decisions, Continuation Handoff and Change Log notes.

## Purpose

This log consolidates the decisions that define the MDSE Workbench and dashboard direction.

It intentionally distinguishes:

- **interface/product decisions** that belong to Workbench;
- **supporting architecture decisions** needed to make the interface reliable;
- **model-mechanics questions** that are outside the Workbench scope unless separately governed.

The guiding correction made during the discussion was:

> Workbench is primarily a good interface to the existing model. It should not become a vehicle for redesigning model mechanics.

## Status legend

- **Settled** — use as the current Workbench direction.
- **V1** — implement in the first useful release.
- **Future path** — preserve the design path, but not required for V1.
- **Open** — not yet decided.
- **Proposed** — a recommendation written for approval. It is **not** direction until Spencer approves it; if approved, change the status and date in place and record any decision it supersedes.
- **Out of scope** — belongs to model/schema governance, not Workbench interface design.

---

## A. Product and architecture

### WB-001 — Generic Workbench, vault-defined configuration
**Status:** Settled

Workbench is a generic MDSE engine. Vault configuration defines element types, relationship vocabulary, validation, view profiles, and other model-specific behavior.

Ampure-specific semantics should not be hard-coded into the plugin.

### WB-002 — One primary everyday plugin
**Status:** Settled

The engineer should experience one main **MDSE Workbench** plugin.

Other responsibilities remain separate:

- Bootstrap for setup/config verification;
- Translator for EA/import/migration;
- Cross-Vault Resolver for cross-vault infrastructure.

Workbench may be internally modular.

### WB-003 — Core behavior owned by Workbench
**Status:** Settled

Workbench owns the critical user experience and should not require community plugins for:

- indexing;
- schema-driven validation;
- creation;
- traversal;
- view generation;
- semantic Canvas editing;
- review/model health.

Other plugins may enhance the experience but are not required for correctness.

### WB-004 — Dashboard implementation
**Status:** V1

Use a dedicated custom Obsidian Workbench view.

A Markdown landing/help note may be added later but is not the primary interactive dashboard.

### WB-005 — Interface, not metamodel
**Status:** Settled

Workbench consumes the existing MDSE schema and rules. Questions such as property inheritance, cardinality policy, and other metamodel mechanics are not Workbench decisions unless separately governed.

---

## B. Dashboard and navigation

### WB-006 — Dashboard is the primary V1 entry point
**Status:** V1

Do not crowd note/file context menus with MDSE actions in V1.

Engineers intentionally open Workbench when they want to perform MDSE actions.

### WB-007 — Task-oriented dashboard
**Status:** V1

Organize the dashboard around:

- **Create**
- **Explore**
- **Review**

Do not make the user navigate the metamodel taxonomy before knowing what task they want to perform.

### WB-008 — Future deeper workspaces
**Status:** Future path

Task areas may later open richer dedicated workspaces while keeping the simple task-oriented home screen.

### WB-009 — Personal dashboard presentation
**Status:** Future path

Allow local favorites/hide/reorder of actions.

Personal presentation must not change shared semantics or model state.

### WB-010 — Personal settings local by default
**Status:** Settled

Workbench personal settings should be stored locally rather than committed through Git by default.

Design for later export/import/sync.

---

## C. Create experience

### WB-011 — Compact modal creation in V1
**Status:** V1

Create actions use compact modal forms.

### WB-012 — Path to richer workflows
**Status:** Future path

Complex creation/planning activities may later use full Workbench workflow screens while reusing the same creation service.

### WB-013 — Open new note after creation
**Status:** V1

After successful creation, automatically open the new Markdown note.

### WB-014 — Rapid-entry mode later
**Status:** Future path

Add a future option to remain in Workbench for repeated creation.

### WB-015 — Schema-defined validity
**Status:** Settled

Creation should block only on information required for a valid element according to the current model rules.

Recommended/completeness information may be surfaced without turning every useful creation into a long form.

### WB-016 — Context-aware relationship suggestion
**Status:** Future path / supporting behavior

When creation is launched from a model context, Workbench may suggest a likely relationship, but the engineer confirms, changes, or chooses none.

Never silently infer semantic relationships.

### WB-017 — Placement assistance
**Status:** Settled

Workbench may show a default location and allow the engineer to choose another folder or create a folder.

Folder placement is organizational, not semantic.

### WB-018 — Unique note names
**Status:** Settled supporting constraint

Duplicate model note names are blocked. Workbench may suggest meaningful alternatives.

Naming nomenclature remains advisory rather than a strict Workbench gate unless separately governed.

---

## D. Explore experience

### WB-019 — Select element(s) first
**Status:** V1

The primary Explore workflow is:

```text
select element(s) → choose view
```

### WB-020 — Simple V1 picker
**Status:** V1

Element picker supports:

- fast unique-name search;
- optional type filter;
- multi-select.

### WB-021 — Richer picker later
**Status:** Future path

Possible later additions:

- recent elements;
- favorites;
- richer filters;
- saved searches;
- view-first selection flow.

### WB-022 — One-click standard view generation
**Status:** V1

Selecting a standard view immediately generates it using governed defaults.

### WB-023 — View Options
**Status:** V1

Provide an adjacent **View Options...** path for engineers who want to override defaults before generation.

### WB-024 — Starting set
**Status:** V1

Views may start from one or multiple selected notes.

Future query/filter starting sets are deferred.

### WB-025 — Multiple selected elements
**Status:** V1

Show shared/connecting context first. Local context around each selected element remains expandable.

### WB-026 — Bounded semantic traversal
**Status:** V1

View Profiles define sensible default traversal depth and allowed semantic paths.

Engineers may request deeper traversal.

### WB-027 — All valid bounded paths
**Status:** Settled

Within the chosen bounds, show all valid connecting paths rather than arbitrarily picking one shortest path.

*Amended 2026-09-30 by [[#WB-082 — Node cap outranks depth]]: bounds include a node cap that wins over depth.*

### WB-028 — Oversized view handling
**Status:** V1

Render a useful bounded view and explicitly show omitted branches, such as “+N additional”.

Never silently imply that omitted model connections do not exist.

---

## E. View Profiles and generated views

### WB-029 — Governed standard profiles + personal variants
**Status:** Settled

Shared standard View Profiles define approved engineering views.

Personal variants may change presentation/traversal choices but not redefine model semantics.

### WB-030 — Standard engineering layouts
**Status:** V1

Use deterministic engineering-oriented layouts for standard profiles.

Custom profiles may use a generic fallback layout.

### WB-031 — Generated views are disposable
**Status:** V1

Generated quick views are refreshable/disposable working views.

### WB-032 — Save as Curated View
**Status:** V1

Allow an engineer to promote a generated view into an intentional curated Canvas that Workbench will not automatically overwrite.

### WB-033 — Generated refresh behavior
**Status:** V1

Refresh may rebuild the generated Canvas and discard manual Canvas-only layout/annotations.

If manual work matters, save as a Curated View first.

### WB-034 — Staleness detection
**Status:** V1

Generated views should indicate when relevant model changes make the view out of date.

Do not continuously redraw the Canvas.

### WB-035 — Deterministic generated view identity
**Status:** V1

Reuse the generated view for the same starting set + View Profile rather than creating repeated numbered duplicates.

### WB-036 — Generated view storage
**Status:** V1

Use a vault-configured Generated Views location excluded from Git.

Curated views are saved to a normal engineer-selected vault location.

### WB-037 — Curated views are frozen snapshots in V1
**Status:** V1

V1 does not synchronize curated views automatically with model changes.

Preserve metadata needed for future non-destructive update-from-model behavior.

---

## F. Canvas editing

### WB-038 — View Mode by default
**Status:** V1

Generated Canvas opens in View Mode.

### WB-039 — Explicit Model Edit mode
**Status:** V1

The engineer explicitly enables Model Editing on the same Canvas when they want to change the model.

### WB-040 — Edit mode is temporary per Canvas
**Status:** V1

Closing the Canvas or restarting Obsidian returns it to View Mode.

Do not persist edit mode as durable Canvas state.

### WB-041 — V1 relationship creation
**Status:** V1

Select two nodes, then choose **Create Relationship**.

For multi-select, support one-to-many or many-to-one operations through the same relationship service.

### WB-042 — Future native drag-to-connect
**Status:** Future path

Native Canvas drag gestures may later call the same relationship service.

Do not make the V1 service depend on a particular gesture.

### WB-043 — Batch relationship preview
**Status:** V1

For batch operations, preview valid and invalid pairs before commit.

Allow creation of the valid subset only after explicit confirmation.

Do not silently skip invalid pairs.

### WB-044 — Avoid automatic many-to-many
**Status:** Settled

Initial batch behavior should not create all-to-all relationships implicitly.

### WB-045 — Relationship display direction
**Status:** V1

Display the relationship name that matches the visual reading direction while storing the canonical owner-side relationship required by the model.

### WB-046 — Immediate write on confirmation
**Status:** V1

Once the engineer confirms a valid relationship, update authoritative note/YAML content immediately.

### WB-047 — Delete semantic edge confirmation
**Status:** V1

Deleting a semantic edge prompts:

- Remove from this view only;
- Remove relationship from model;
- Cancel.

### WB-048 — Delete node affects Canvas only
**Status:** V1

Deleting a Canvas node does not delete or retire the underlying model element.

### WB-049 — Inherited/contextual edges read-only
**Status:** V1

Contextual/inherited visual edges are not directly editable as though they were explicit stored relationships.

Workbench should trace to the source and may offer actions such as opening the source relationship or adding an explicit relationship.

### WB-050 — Undo/Redo
**Status:** V1

Maintain an in-session semantic transaction stack.

A batch edit should be one undoable transaction.

Git remains durable history/audit.

### WB-051 — Groups visual by default
**Status:** V1

Canvas groups carry no model semantics by default.

A future bound semantic group may propose schema-defined relationships, never create them silently.

### WB-052 — Ordinary property editing
**Status:** V1 / Future path

V1: open the note to edit ordinary properties.

Long term: direct Canvas property editing is a goal.

---

## G. Relationship safety

### WB-053 — Strict relationship validation
**Status:** Settled

Relationship picker shows only relationships valid for the selected endpoints according to the current schema.

*Dependency (2026-09-30):* the schema does not yet state which classes each relationship may connect. Workspace decision W-272 puts those rules in `relationships.yaml`. W-277 wrote the format and family 1 (structure); a relationship with no rule yet is not restricted. WB-053 can be built against the format now; it is complete once every family is written. *Update:* every relationship has a rule as of W-285. `tracesTo` is offered as the provisional relationship (W-288), and every link of it becomes a Review finding.

### WB-054 — `newRelationship` escape hatch

*Implemented by `tracesTo` (2026-09-30, workspace decision W-288): the vault's existing trace relationship is the provisional relationship; no separate `newRelationship` field exists. Read `newRelationship` below as `tracesTo`.*
**Status:** Settled

A provisional `newRelationship` may be used when the engineer knows two elements are related but no approved relationship is known.

It is not treated as normal semantic reasoning until resolved.

No explanation is mandatory.

### WB-055 — `newRelationship` is engineer-usable
**Status:** Settled

Engineers may use `newRelationship` without AI intervention.

Workbench must make unresolved instances easy to review later.

### WB-056 — Resolve to existing valid relationship
**Status:** V1

Review of `newRelationship` allows replacement with an existing valid relationship.

If none fits, leave it unresolved. Do not turn the review modal into a schema-authoring tool.

### WB-057 — Model endpoints must be model elements
**Status:** Settled supporting constraint

Semantic MDSE relationships connect typed MDSE elements.

If an engineer attempts a semantic relationship to an ordinary note, Workbench may offer explicit **Convert to MDSE Element...** rather than silently converting it.

---

## H. Review experience

### WB-058 — Categorized dashboard queues
**Status:** V1

Dashboard shows concise categories/counts rather than a full governance table.

### WB-059 — Whole-vault default
**Status:** V1

Review represents the actual whole-vault model state.

Do not default to personnel/task-assignment semantics.

### WB-060 — Filters
**Status:** V1

Allow filtering by useful model dimensions such as finding type, element type, folder, product/system context, or relationship type where available.

### WB-061 — Dedicated Review screen
**Status:** V1

Clicking a dashboard Review category opens a dedicated Review screen inside Workbench.

### WB-062 — Focused finding modal
**Status:** V1

Clicking an individual finding opens a focused modal that explains the finding, presents relevant resolution actions, and allows opening source/target notes.

### WB-063 — Sequential Review
**Status:** Approved 2026-09-30: B, in V1 (Spencer: "b")

When a user opens a Review finding, should Workbench support moving through the current filtered queue?

- **A — Manual selection:** resolve/close, return to the list, choose another.
- **B — Previous / Next:** show `← Previous   4 of 17   Next →`; after a successful resolution, optionally advance to the next unresolved finding.
- **C — Batch resolution:** multi-select and bulk semantic correction.

Decided: **B** in V1, without batch editing. Post-import cleanup works through hundreds of findings of the same kind (REVIEW lines, Use Case include links), and B makes that a fast loop with no bulk-editing risk and no new model concept. C may come later, once the patterns are clear.

---

## I. Model/index reliability

### WB-064 — Stable identity handling
**Status:** Settled

Human-authored YAML remains readable; Workbench should resolve model identity robustly using durable IDs/UIDs internally where practical.

### WB-065 — Ambiguous links are errors
**Status:** Settled

Do not guess when a model link is ambiguous.

Require resolution.

### WB-066 — Relationship fields are lists
**Status:** Existing model constraint consumed by Workbench

Workbench must respect the vault's approved relationship storage form rather than inventing a different storage layer.

### WB-067 — Simple relationship edges
**Status:** Settled supporting principle

Do not add arbitrary metadata objects to every edge.

When a connection needs identity, rationale, evidence, lifecycle, or history, represent that using an appropriate first-class model element when the methodology requires it.

### WB-068 — Disposable local index
**Status:** Settled

Workbench may maintain a local cache/index for speed.

The cache is rebuildable and not authoritative.

“The index may be cached. The model may not.”

### WB-069 — Plugin/schema compatibility
**Status:** Settled

Schema/configuration should declare compatibility/version information.

If Workbench is too old for the vault schema, preserve note readability but disable unsafe semantic edit/view actions with a clear message.

---

## J. Scope corrections and deferred mechanics

### WB-070 — Property inheritance discussion paused
**Status:** Out of scope for Workbench

The discussion reached a question about schema-defined property inheritance.

The user explicitly redirected the effort:

> “this is getting into model mechanics and i really only want a good interface to the model”

No Workbench implementation should assume a new property-inheritance policy from that unfinished discussion.

### WB-071 — No schema redesign through UI design
**Status:** Settled

When an interface requirement exposes a real schema gap, record it for separate methodology review. Do not silently solve it inside Workbench.

---

## K. Implementation-level decisions (decide during the build)

These are build-time choices, not product questions. Decide them with the working plugin in hand ([[#WB-089 — Decide implementation details during the build]]), not one at a time up front.

### WB-072 — Exact V1 standard View Profile set
**Status:** Settled in practice 2026-10-01 for the views that fit the current engine: eleven are built (Structure, Functional, Requirements, Where Used, Interfaces, Verification, Design, Scenario, Behavior, Failure and risk, Evidence; WB-097, WB-098, WB-102). Still open: Impact (change impact, needs a longer walk grouped by distance), Compare, the allocation and trace matrices and the gap lists, which need new engine capabilities.

Original text: Committed minimum: Structure, Behavior, Requirements. Likely additions: Interfaces, Verification, Impact. Choose by implementation effort and the first real test slice.

### WB-073 — Generated-view folder/path
**Status:** Open (direction settled in WB-036)

Dedicated, configurable, excluded from Git. The default path/name is chosen at implementation.

### WB-074 — Workbench launch affordance
**Status:** Open

Ribbon icon, command palette action, dedicated sidebar/tab entry, or a combination. Does not change the dashboard information architecture.

### WB-075 — Create-action list shown on home
**Status:** Open

How many buttons show before an overflow/"more" action; test against the current schema and screen size. Do not hard-code element names.

### WB-076 — View Options contents for V1
**Status:** Open (existence settled in WB-023)

Candidates: depth, node limit, contextual relationships on/off, relationship-family toggles, layout choice. Prefer a very small initial set.

### WB-077 — Review finding severity/presentation
**Status:** Open

Whether findings need error/warning/info, or category + explanation is enough initially. Do not add severity just because conventional tooling has it.

### WB-078 — Curated-view metadata format
**Status:** Open

V1 curated views are frozen snapshots; keep enough metadata for a later Compare/Update. No model semantics in Canvas-only metadata.

### WB-079 — Folder-navigation ruleset reconciliation
**Status:** Open — methodology, not implementation

Ruleset 1.22 section 9 still requires a Views and Bases note, a base and a canvas in every model-facing folder (kept as written in W-260). The Workbench direction uses generated views instead. Resolve in a separate methodology decision; Workbench work does not change the ruleset. Nothing in V1 depends on the outcome.

---

## L. Release-path proposals (2026-09-30)

Written after a review of this folder for the path to a first release. Approved by Spencer on 2026-09-30 ("approved", all ten as written); WB-085 was settled separately by workspace decision W-275.

### WB-080 — Relationship service first; Canvas Model Edit is release-gated
**Status:** Approved 2026-09-30

Build the relationship service (validation, canonical owner-side writeback, batch preview, undo) first and expose it through a command/modal on notes. Canvas Model Edit (WB-039 to WB-043, WB-046, WB-047, WB-050) is a second surface over the same service.

Why: Canvas editing relies on Canvas internals Obsidian does not officially expose; the reference work (note [[05 - Reference Plugin Findings]]) depends on patching, and the most capable reference is GPL. Generated read-only Canvas is low risk; edit-in-Canvas is not.

Phase 0 probes Canvas edit feasibility; V1 ships with Canvas Model Edit only if the probe is low-risk, otherwise it ships in the next release. Behavior in WB-039 to WB-050 does not change, only timing: Canvas Model Edit ships in V1 only if the Phase 0 probe is low-risk.

### WB-081 — Performance gate in Phase 0
**Status:** Approved 2026-09-30

Phase 0 measures Workbench on the real translated vault before feature work continues. Starting targets (placeholders to revise after the first measurement):

- vault size assumed: up to about 60,000 notes;
- cold index build: under 60 s; incremental update after a note save: under 500 ms;
- Structure view with the default node cap: generated and opened in under 3 s;
- index memory: under 300 MB;
- Obsidian stays responsive while indexing (no blocking of the UI thread for more than a fraction of a second).

If a target cannot be met, the finding goes to the decision log before more is built on the index design.

### WB-082 — Node cap outranks depth
**Status:** Approved 2026-09-30 (amends WB-027)

Traversal is bounded by depth **and** a node cap, and the cap wins. When the cap is reached, keep nodes nearest the start first, then by the profile's relationship order; report omitted counts per branch (WB-028). Path enumeration is capped so dense graphs cannot explode.

For multiple starting elements (WB-025): compute the bounded paths that connect the selected elements first (shared context), then expand around each element on request.

### WB-083 — Duplicate note names: id suffix (already settled in the workspace)
**Status:** Settled elsewhere (W-198, W-199); Workbench consequence approved 2026-09-30

Workspace decisions W-198 and W-199 give every note in a duplicate-name group an id suffix, so note names stay unique (WB-018 holds).

Workbench consequence (approved): the element picker and Review modals show **type and id beside the name**, and link resolution uses `uid`/`id`, never the name alone (WB-064, WB-065).

### WB-084 — One creation spec shared with templates
**Status:** Approved 2026-09-30

The creation service reads the class templates in `99_System/05_Templates` and the rules in `99_System/02_AI/AI_INSTRUCTIONS.md` (property order, `uid`, `id`, author code from `.obsidian/author-code.txt`) instead of carrying its own definition. A note created by Workbench must have the same header as one created from the template by hand.

Acceptance test: create each common class both ways and compare the headers; they must match.

### WB-085 — Who writes inverse relationship fields
**Status:** Settled 2026-09-30 by workspace decision W-275 (trial of option B, judged after the first test slice)

Workbench writes the inverse with every forward field it writes: a paired field's inverse on the other note, a symmetric field on both notes, nothing for a one-way field. The forward field is the authority.

- **Workbench action** (inspector, modal, Canvas): inverse written in the same transaction; one Undo reverses both.
- **Hand edit on this machine:** inverse written about a second after typing stops, from the difference between the old and new forward list in the index.
- **Pull, outside AI edit, or edit while Obsidian was closed:** not rewritten automatically (that would make every machine write the same edits and cause merge conflicts). Shown as a "missing inverse" Review finding with a one-click fix; a **Regenerate inverses** command repairs everything.

Consequences: a relationship edit changes the source note and each target note; stable ordering (WB-086) keeps the added lines mergeable. Workbench does not depend on Nodian. Earlier text (before W-275): Workbench would write only the owner side and depend on a plugin for inverses; superseded.

---

### WB-086 — Git and external change
**Status:** Approved 2026-09-30

- Workbench never runs Git or commits in V1. People and AI tooling commit; Workbench only edits files.
- Changes made outside Workbench (a pull, an AI push, hand edits) are picked up from vault file events and update the index incrementally. After a large change set, or on demand (**Rebuild index**), the index is rebuilt.
- Each semantic transaction stores a before-state (content hash) per affected note. Undo refuses, with an explanation, when a note changed since.
- Relationship lists are written in a stable, deterministic order so two people adding relationships to the same note merge with fewer conflicts. Check the ordering rule against the storage form in `relationships.yaml` before implementing.
- The generated-view folder stays excluded from Git (WB-036).

### WB-087 — Platform support
**Status:** Approved 2026-09-30, amended the same day: desktop only, with mobile-ready code

Spencer: "have it ready the best we can, but expect this to run on desktop only."

- **Supported:** desktop only. The manifest sets `isDesktopOnly: true`; no mobile testing or mobile sync work is planned.
- **Mobile-ready code:** use only Obsidian's own APIs (vault, metadata cache, Canvas files), never Node or Electron (file system, paths, child processes); layouts that fit a narrow screen (inspector as a drawer); select-then-command interactions rather than drag-only ones; a compact, incremental index. Checked in code review.
- **Why:** turning mobile on later should be a decision, not a rewrite. The main blocker is outside Workbench: Obsidian Git is unstable on mobile and limited by memory, so a large vault on phones needs another sync method, and MDSE Bootstrap's mobile support is unknown.
- Revisit after the pilot.

### WB-088 — Distribution, versioning and build
**Status:** Approved 2026-09-30

- The plugin's source lives in its own repository, not in the vault. The vault holds only vault-side configuration: View Profiles and the schema/compatibility declaration (WB-069).
- Releases are GitHub Releases containing `main.js`, `manifest.json` and `styles.css`, with semantic versioning and `minAppVersion`.
- The controlled base ships the pinned Workbench build with the other runtime plugins; MDSE Bootstrap verifies the shipped release and completes per-person setup. It does not download or install Workbench.
- Build with TypeScript and esbuild following the official Obsidian sample plugin; CI on GitHub Actions. No local build toolchain is assumed: use a cloud development environment (for example GitHub Codespaces) so the work does not depend on one computer.
- Because the final vault leaves out methodology material, this folder's design notes belong in the plugin repository once that exists; the vault keeps a short pointer.

### WB-089 — Decide implementation details during the build
**Status:** Approved 2026-09-30

Product questions that change what an engineer sees still go one at a time. Implementation-level items (WB-072 to WB-078) are decided with the working plugin in hand and recorded here when settled. The roadmap and architecture already hold enough direction to start the Phase 0 spike.

### WB-090 — Release gates
**Status:** Approved 2026-09-30

- **R0 — Go/No-go after Phase 0:** performance targets (WB-081) met or a plan recorded; inverse-field behavior verified (WB-085); Canvas edit feasibility decided (WB-080).
- **R1 — Pilot:** two or three engineers use the plugin on a real test slice (the first slice is `02 Product Context`, W-267) and run the acceptance scenarios in [[03 - Build Outline and Roadmap]].
- **R2 — Team release:** pilot findings resolved; compatibility check and Bootstrap release/first-open verification passed on a fresh vault.

### WB-091 — Repeated relationship-list count (superseded as quantity)
**Status:** Superseded by W-310; display correction implemented in Workbench 0.1.15 on 2026-10-02

Repeated identical relationship targets are duplicate-source/model evidence, never engineering quantity. Workbench may collapse duplicates for display but labels them explicitly as duplicate evidence (for example `hasPart (duplicate ×6)`). Cards and semantic edges stay one per distinct target. True engineering quantity comes only from Local Model `multiplicity`. Original text: Evidence: in `20260930`, 276 repeated entries in 86 notes (`hasPart` 208, `hasChild` 68); `Cable - 2 twisted pair Strip and Strip` lists `Wire - Strip and Strip` 27 times and `Cable Jacket` 6 times (I first wrote 25 from a quick read of the file; corrected after Spencer's screenshot showed ×27). Seen in Obsidian 0.1.1: the counts display. A quantity change marks a view stale. Built in plugin 0.1.1.

### WB-092 — Missing notes are shown as undefined
**Status:** Approved 2026-10-01 (Spencer: "any missing notes should be shown as undefined")

A relationship link in a view whose target note does not exist is drawn as an undefined card: red, the link text in bold, the word *undefined* under it, not openable. It counts as a node (the node cap and 12-children limit apply) and may show its repeated-source count explicitly as duplicate evidence; that count is not engineering quantity. It is not an omission: it does not feed "+N more". Today these cards appear because the imported slice is partial; once the whole model is imported, the same cards show what still has to be defined, which is the to-do list. Applies to the relationships in the view profile (the Structure profile now). Review's Broken References count is unchanged. Built in plugin 0.1.2.

### WB-093 — Plugin builds are committed into the test vault
**Status:** Approved 2026-10-01 (Spencer asked whether builds could be written straight to the vault so he can pull)

Each build's `main.js`, `manifest.json` and `styles.css` are committed to `.obsidian/plugins/mdse-workbench/` in `spencerskelly/20260930` on `main`, after the same files are pushed to `MDSE_Workbench`. `data.json` stays ignored by the vault's `.gitignore`. `community-plugins.json` and `plugin-lock.yaml` are not touched. After a pull, Obsidian has to reload the plugin to run the new build. This is a test-vault convenience; the release pipeline and MDSE Bootstrap pinning (WB-088) replace it. First commit: 0.1.2.

### WB-094 — No inverse is written for a link that breaks its rule
**Status:** Approved 2026-10-01, my reading (Spencer confirmed the rule is right and that the links are modeling errors; he did not answer the question about the fix itself)

In Review, a Missing Inverses finding whose own link breaks its endpoint rule no longer shows **Write missing inverse**; the window says the link breaks its rule and to fix the link or leave it for the post-import review. The finding and its count stay. Reason: writing the inverse would copy a modeling error to the other note, and the writer already refuses it. Built in plugin 0.1.3.

### WB-095 — Relationship name on every link; taller cards
**Status:** Approved 2026-10-01 (Spencer: "yes", to the proposal)

Every edge in a Structure view carries its relationship name (`hasPart`, `hasPort`, `hasState`), and, only for legacy duplicate source entries, an explicit duplicate marker such as `hasPart (duplicate ×27)`; this is not quantity. Before, the name appeared only on the first link of a group, which read as if it belonged to that one link. Cards are 80 px high instead of 60, and the row spacing is 100 px, so a name that wraps to two lines is no longer clipped. Built in plugin 0.1.5. The `hasFlow` red conflict is closed by WB-096.

### WB-096 — One edge color per relationship; red only for undefined cards
**Status:** Approved 2026-10-01 (Spencer: "yes", to the proposal)

Each relationship in the Structure view has its own edge color and none is the red of undefined cards (WB-092). With `hasState` added there are seven relationships, and the old six-color list gave `exposes` the red and `hasFlow` the same green as `hasPart`. Now: `hasPart` green, `hasChild` cyan, `hasState` purple, `includes` orange, `hasPort` yellow, `exposes` grey, `hasFlow` brown (the last two are fixed hex colors, because Canvas has only six preset colors and red is reserved). Built in plugin 0.1.6.

### WB-097 — Functional view, from an Object or a Function
**Status:** Trial 2026-10-01 (Spencer chose the starting point: one view that works from either an Object or a Function; the contents below are my design and not yet seen by him)

Command "Explore functional view of current note"; it starts only from an Object or a Function. From an Object: the functions it performs (`performs`), their sub-functions (`hasChild`, Function only), what precedes or follows them (`precedes`), and the requirements they satisfy (`satisfies`). From a Function: who performs it, its parent function (start note only), its sub-functions, what comes before and after it, and the requirements it satisfies. Two levels, 12 children per note, 80 notes, as for Structure. Arrows follow the stored direction, so a performer points at its function and a predecessor at its successor. A function also performed by another Object shows that Object (shared allocation); an Object reached from a function does not pull in its other functions. A missing requirement or function shows as an undefined card (WB-092); a missing `hasChild` target does not, because its class is unknown. A Function's `hasChild` to a State, Requirement or Info is not followed. The generated canvas is `<name> - Functional.canvas`; refresh and stale checks use the profile stored with the view. Built in plugin 0.1.7. The engine gained per-step filters (source type, target type, start note only) and reverse-direction edges, so later profiles can reuse them.

### WB-098 — Requirements view
**Status:** Trial 2026-10-01 (Spencer asked for a requirements view after the Functional view "works great"; the contents below are my design and not yet seen by him)

Command "Explore requirements view of current note". It starts from a Requirement, or from an Object, Function, Design, State, Use Case or Verification. From a Requirement: where it sits (the owner element and the parent requirement, start note only), its sub-requirements (`hasChild`), what it is derived from (`derivedFrom`) and what is derived from it, what it refines (`refines`) and what refines it, what it `references` (Requirement or Document), what satisfies it (`satisfies`: Function, Design), what verifies it (Verification), what it `appliesTo`, and the Use Case that drives it. From the other types: the requirements they hold under them (`hasChild`), satisfy, verify or drive, and the requirements that apply to them (`appliesTo`), each of which opens one more level as a Requirement. Two levels, 12 children per note, 80 notes. Arrows follow the stored direction. A missing requirement (satisfied, verified, driven, derived from or refined) shows as an undefined card; a missing `hasChild`, `references` or `appliesTo` target does not, because its class is unknown. The other requirements a satisfier or verifier also covers are not pulled in. Built in plugin 0.1.8; the palette has nine colors for the eight relationships used.

### WB-099 — Note details popup on a generated view
**Status:** Approved 2026-10-01 (Spencer: clicking a note in the canvas should open a popup with its contents, "I don't want to have to open the note"); first build, not yet tested in Obsidian

Clicking a note on a generated view (a canvas in the views folder, or one Workbench generated) opens a floating, non-modal panel at the top right with the note's name, its type, subtype, id and status, its other properties (collapsed, links clickable), and its rendered text. It stays on screen while the canvas is used and follows the next note clicked. A link inside it opens that note in the same panel, ‹ goes back, **Open note** opens the note in a tab, × or Esc closes it, and it closes when another tab is activated. It can be resized. Clicking an undefined card says the note still has to be defined. Shift, Ctrl, Cmd and Alt clicks and drags (more than 5 px) are ignored, and the click is only observed, never stopped, so selecting and moving cards behaves as before. A setting turns it off. It does not apply to other canvases. Technique: a capture-phase click listener finds the card element and maps it to its note through Obsidian's own card objects (`canvas.nodes`, `nodeEl`, `file`), which are undocumented; if that fails it reads the card's `translate(x, y)` and matches it to the node in the canvas file. Same risk class as the selection-menu hook: recheck on each Obsidian version. **Check Canvas support** now reports whether the card elements are reachable. Built in plugin 0.1.9; 23 tests cover the pure parts (text without properties, card position, node match, undefined name, property rows), not the Obsidian side.

### WB-100 — Relationships dropdown in the note details popup
**Status:** Approved 2026-10-01 (Spencer, answering whether the popup should list relationships: "can relationships be a dropdown like properties is?")

The popup (WB-099) originally had two collapsed dropdowns: **Properties** (the note's properties other than relationships) and **Relationships** (every relationship field the note holds, forward and inverse, from its own properties; the stored inverses already give both directions). **Amended by WB-105:** notes with governed Local Model content add a third **Local Model** dropdown. Each summary shows a total, and a field with several entries shows its count (`hasPart (33)`). A repeated identical target appears once with an explicit duplicate marker; it is never presented as engineering quantity. A link to a note that does not exist is shown in red, not clickable, with the tooltip "undefined" (WB-092); other links open in the popup. Both stay closed until opened. Built in plugin 0.1.10.

### WB-101 — Editing in the note details popup
**Status:** Approved 2026-10-01 (Spencer: "now i'd like to be able to edit in that pop-up"; he chose all three parts: note text, ordinary properties, relationships). Amends WB-052 (properties were to be edited by opening the note); first build, not yet tested in Obsidian

**Edit mode** is explicit and temporary (WB-039, WB-040): an **Edit** button in the popup header; it is off again for every other note the popup shows, and the Properties and Relationships dropdowns open while it is on. The border and an "editing" chip show the mode. It is disabled while the index is building or when the vault's schema is older than 1.25.
- **Text.** The ordinary narrative body becomes a text box with **Save text** and **Revert** (Ctrl or Cmd + Enter saves). The properties block is kept byte for byte. **0.1.15 safety amendment:** when a governed Local Model START marker exists, ordinary body text editing is disabled for the whole note until region-aware editing is implemented by WB-106; this guarantees the governed region cannot be rewritten. A save is refused if the editable text changed since the popup loaded it. Moving to another note, closing, or leaving edit mode with unsaved text asks first.
- **Properties.** `type`, `id` and `uid` are never edited; translator-written properties (`eaType`) and relationship fields are read-only here. `subtype` is a dropdown of the class's subtypes from `element-types.yaml` (a value outside the list stays selectable; read-only for a class with no subtypes). `status` is a text box that suggests Draft, Active and Retired, because no complete list of values exists (Definitions, `status`). `tags` and other simple lists are comma-separated boxes; other simple values are text boxes. A property is saved when the box loses focus or Enter is pressed. Properties are not added or dropped (AI_INSTRUCTIONS); only a property the note already has can be set.
- **Relationships.** Each entry has a ✕. It asks for confirmation, names the inverse that goes with it and how many times a repeated link is listed, then removes the link and its inverse through the relationship service (WB-080, WB-085); removing an entry from an inverse field (for example `partOf`) removes the forward link on the other note. A link to a note that does not exist is removed from this note only. **Add relationship…** picks a note, then the relationship with the existing rule check, inverse and undo (WB-053).
- **Undo.** Every one of these is one transaction on the same undo stack as relationship edits, with the same refusal when a note changed afterwards (WB-086). An **Undo** button appears in edit mode; the command is now named **Undo last Workbench edit** (it was "Undo last relationship change"; the command id and any hotkey are unchanged).
- The popup refreshes when its note changes, including after an undo or a change made elsewhere, unless there is unsaved text.

Built in plugin 0.1.11. Verified in a simulated Obsidian (a DOM test with a fake vault, 28 checks: view mode, edit mode controls, saving status, tags and subtype, refusal of id, a relationship field and an unknown property, text save keeping the properties, the refusal on a changed note, removing a repeated link with its inverse and a missing link, two undos, and the discard prompt), and by 26 unit tests; not yet in Obsidian itself. Known effects and risks: (1) **Property and relationship writes go through Obsidian's `processFrontMatter`, which rewrites the whole properties block in its own YAML style** (for example `type: "State"` becomes `type: State`), so the first edit of an imported note changes more lines than the one edited; this was already true of relationship edits since 0.0.x and is now visible for properties too. (2) Typing in the popup's boxes might also reach canvas shortcuts (Delete on a selected card): key events are stopped at the box, but whether Obsidian's global keymap sees them first is not verified. (3) `status` has no agreed value list.

### WB-102 — Eight more standard views and a view picker
**Status:** Trial 2026-10-01 (Spencer asked for every view that could be built with the current engine; the step lists below are my design and not yet seen by him). Extends WB-072 (the V1 standard set) from three views to eleven.

New views, each with its own command and an entry in **Explore view of current note…** (a picker that lists the views able to start from the note's type, each with a one-line description). All use two levels unless stated, 12 children per note and 80 notes, arrows in the stored direction, a relationship label on every link, undefined cards for missing notes where the schema fixes the class at that end (WB-092, WB-097), and refresh through the profile stored with the view.
- **Where Used** (any note; three levels): parents through `hasPart`, `includes`, `hasChild`, `hasState`, `hasPort`; Objects that `performs` a Function; Objects or Documents with a `hasDesign`; Use Cases that `realizedBy` or have `participants`; `dependsOn`.
- **Interfaces** (Object, Port, Item Flow; three levels): `hasPort` both ways, `interfaces` (symmetric, drawn without an arrowhead), `exposes` both ways, `transmits`, `receives`, `exchanges`, `hasFlow` both ways. From an Object it reaches the owner of the port each port faces.
- **Verification** (Requirement, Verification, Function, Design, State): `verifies` both ways; `satisfies` only through Function/Design; a State reaches scoped Requirements through inverse `appliesTo`. A verification therefore shows what else it covers and the valid satisfiers of those Requirements.
- **Design** (Object, Document, Design): `hasDesign` both ways, sub-designs (`hasChild`), what each Design `satisfies`.
- **Scenario** (Use Case): `participants`, `realizedBy`, included Use Cases (`hasChild`), `optionOf` both ways, `drives`, and `precedes` among the realizing Functions.
- **Behavior** (State Machine, State, Object): `hasState` both ways, `initialState`, `finalState`, nested States (`hasChild`), `precedes` both ways, `triggeredBy` both ways.
- **Failure and risk** (any note): `affects` both ways, `drives` for Issues and Failure Modes, then the requirements a Function satisfies and the Object that performs it.
- **Evidence** (any note): `describes` both ways for Info, Artifact and Document, notes of those classes under the note (`hasChild`), and Documents a Requirement `references`.
The engine gained one step option, `noArrow` (a symmetric link carries no arrowhead; JSON Canvas `toEnd: none`), a `description` on every profile, and a 12-color palette (still no red, one color per relationship).

First run on `20260930` (Node, 19,379 links; views that give more than the start note): Where Used from 58% of Objects, 70% of Functions and 93% of Requirements; Interfaces from 12% of Objects (206) and 53% of Ports (467), none from Item Flows; Verification from 5% of Requirements (503), 96% of Verifications (54) and 36% of Functions; Design from 11% of Objects (201) and 78% of Designs (478), with 4 hitting the 80-note limit (`GSE Charger` at 80 notes and 92 more); Scenario from 54% of Use Cases (115); Behavior from 59% of States (47), none from the 2 State Machines or any Object; Failure and risk from 15 of 25 Issues, 327 Functions and 7 Objects; Evidence from 283 Requirements, 327 of 334 Artifacts and 28 Objects. Why some are empty: the slice has no Port to Item Flow links (the importer still has to write `transmits`, `receives` and `exchanges`), no State Machine or Object `hasState` links (this slice predates W-292, so its 12 States under a StateMachine are still `hasChild`; they appear after the next import with schema 1.35), and no Failure Mode notes. Coverage-style questions ("which requirements have no verifier") are not answered by these views; they are the gap lists, not built.

Built in plugin 0.1.12; 31 tests pass, including a check that every step of every view uses a field and classes that exist in the schema and one scenario test per view. Not tested in Obsidian.

### WB-103 — `satisfies` leaves the Functional view
**Status:** Approved 2026-10-01 (Spencer: "for now, satisfies stays out of functional view, it gets too large")

The Functional view (WB-097) no longer follows `satisfies`: it shows the functions an Object performs, their sub-functions and order, and for a Function its performer, parent, sub-functions and neighbors in the flow. The requirements a function satisfies are in the Requirements view (WB-098) and the Verification view (WB-102). "For now": it can come back as an option. In the first run on `20260930`, `satisfies` was 39 of the 80 notes shown for `GSE Charger`. Closes the open question carried since WB-097. Built in plugin 0.1.13.

### WB-104 — View… button in the note details popup
**Status:** Approved 2026-10-01 (Spencer: "I'd love the view popup", to the proposal)

The popup (WB-099) has a **View…** button, between Edit and Open note. It opens the same picker as the command **Explore view of current note…** for the note the popup shows: only the views that can start from that note's type, each with a line of description. Choosing one generates the canvas and opens it in a new tab. Reason: the Explore commands only appear while a Markdown note is the active tab, so from a canvas a view of a card needed the note to be opened first; now a card is clicked, **View…** is pressed and the view opens. The popup stays open and follows the next card clicked on the new canvas. Not shown for an undefined card, which has no note. Built in plugin 0.1.14; checked in a simulated DOM (the button is there and calls the picker with the note shown), not in Obsidian.

### WB-105 — Local Model is a separate popup dropdown and structured edit surface
**Status:** Approved 2026-10-01 (Spencer: interface-definition updates should be clear across the board; Local Model should be captured in another dropdown when editing is requested). Implements workspace decision W-298.

A note that contains addressable local part occurrences, endpoint occurrences, connections, connection-scoped flows or local relationship targets exposes a third collapsed popup section: **Local Model**, alongside **Properties** and **Relationships**.

- **View mode:** Local Model is structured and read-only. It groups the contained records by useful engineering category (parts, endpoints/interfaces, connections, flows and local relationships/applicability), shows stable local identity/address, and provides navigation to reusable definitions and addressable local records.
- **Edit mode:** ordinary note text remains independently editable, but its editor excludes/protects the governed Local Model region. Local Model changes are not made through the raw text box.
- **Structured Local Model edit:** once the canonical Local Model body schema/marker contract is frozen, Edit mode exposes controlled fields/actions inside the Local Model dropdown and uses the same transaction/undo principles as other Workbench edits. Until then the dropdown stays read-only even when Edit mode is on.
- **Quantity/context:** repeated note-level relationship entries are not treated as occurrence quantity. Occurrence count, multiplicity and connection-specific context come from Local Model records.
- **Safety:** a Workbench version that does not understand the Local Model contract must not rewrite that region.

This amends WB-100 (two dropdowns become three when Local Model data exists) and WB-101 (the text editor no longer means the entire post-frontmatter body once Local Model records exist). W-302 now settles the managed-region syntax: one region bounded by `<!-- MDSE:LOCAL-MODEL START schema=0.1 -->` and `<!-- MDSE:LOCAL-MODEL END -->`. The local-record field/local-ID contract remains model governance.

### WB-106 — Local Model read/navigation is a keepability gate for v0.8
**Status:** Approved 2026-10-01

The first complete import that may be kept must not depend on raw Markdown inspection for occurrence structure. Before that run is accepted, Workbench must:

- parse `local-model.yaml` schema 0.1 records and W-302 managed-region markers;
- index note and local-record identity through an addressable ModelRef rather than file path alone;
- preserve native `#^local-id` fragments when resolving note-level links to local targets;
- show the Local Model dropdown from WB-105;
- navigate local parts/endpoints/connections/flows and their reusable definitions;
- make Structure, Interfaces, Where Used and Requirements occurrence-aware where the Local Model changes the answer;
- protect the governed Local Model region from ordinary body editing;
- report malformed markers, duplicate local IDs, broken local block links, invalid definitions/endpoints, orphan flows and unresolved local applicability.

Structured Local Model authoring is not part of this gate and may follow after the read/index contract is proven on the real imported model.

Repeated relationship entries must not be rendered as engineering quantity. True quantity comes from Local Model multiplicity under W-310.

---

---

## How to use this log

When a future proposal conflicts with a settled decision:

1. identify the conflicting decision number;
2. explain why new information justifies reopening it;
3. record the revised decision and date;
4. update affected build/interface documents;
5. preserve the old decision in history rather than erasing it.

---

## History

### 2026-09-30 — Initial consolidated Workbench definition
Created the `MDSE Workbench` workspace from the Workbench/dashboard design discussion: Workbench is an interface to the existing MDSE model; Create / Explore / Review home; compact modal creation; selection-first Explore with one-click views; Canvas as first graphical surface, not model authority; explicit temporary Model Edit; whole-vault Review with categorized queues. A scope correction was recorded: a drift into property inheritance was stopped and is model governance (WB-070), not Workbench (see WB-071).

### 2026-09-30 — Release-path review and consolidation
**Changed**
- Consolidated 12 notes into 5: dashboard, Canvas and Review notes merged into the Product Definition; Build Outline and Roadmap merged; Open Decisions, Continuation Handoff and Change Log folded into this log and the README.
- Decision IDs renamed `D-` to `WB-`; open items folded in (WB-063, WB-072 to WB-079).
- Added proposals WB-080 to WB-090 (release gating, performance, traversal bounds, creation parity, inverse writes, Git and external change, platform, distribution, process, release gates).

**Reason**
- Review of the folder for the path to a first release: untested assumptions (scale, Canvas internals), decisions restated in many notes, missing non-functional requirements, and ID collisions with other logs.

**Affected decisions**
- No approved decision was changed. WB-027 has an amendment proposed (WB-082); WB-039 to WB-050 are subject to timing proposal WB-080.

### Earlier wording kept
The pause point before this review was the Sequential Review question (WB-063). The one-question-at-a-time method is unchanged: ask one focused question, explain the impact, offer options, recommend the simplest scalable one, record the decision, move on.

### Former open-item IDs
`O-001` → WB-063 · `O-002` → WB-072 · `O-003` → WB-073 · `O-004` → WB-074 · `O-005` → WB-075 · `O-006` → WB-076 · `O-007` → WB-077 · `O-008` → WB-078 · `O-009` → WB-079.

### 2026-09-30 — Release-path proposals approved
Spencer approved WB-080 to WB-084 and WB-086 to WB-090 as written ("approved"). WB-027 is amended by WB-082; WB-039 to WB-050 keep their behavior and follow the Canvas-edit gate in WB-080. Applied: statuses here; the release path in [[03 - Build Outline and Roadmap]]; the release gate note in [[01 - Workbench Product Definition]]; the section markers in [[04 - Architecture and Model Boundary]]; the README.

### 2026-09-30 — WB-087 amended
Desktop only stays the supported scope, and the code is written to run on mobile where it can (Spencer: "have it ready the best we can, but expect this to run on desktop only"). My reading: no phone testing or sync trial in Phase 0. Applied: WB-087; the Platform row in [[03 - Build Outline and Roadmap]]; the platform section in [[04 - Architecture and Model Boundary]].

### 2026-09-30 — WB-063 decided
Sequential Review is option B (Previous / Next through the filtered queue, advancing after a resolution) in V1. Applied: WB-063; Part C of [[01 - Workbench Product Definition]]; the Review list in [[03 - Build Outline and Roadmap]]; the README. No open product decision remains before the Phase 0 spike.

### 2026-09-30 — The provisional relationship is `tracesTo`
The schema had no `newRelationship` field. Spencer chose to add the capability and to use the existing trace relationship for it ("A, but we can also just use the existing trace relationship as the 'newrelationship'"). Workspace decision W-288 makes `tracesTo` provisional (creatable, every link a Review finding). WB-054 to WB-056 keep their behavior with `tracesTo`; the Review category is renamed Provisional Relationships. Applied: WB-054 note; Part C and the dashboard mock-ups in [[01 - Workbench Product Definition]]; M4 and the acceptance scenario in [[03 - Build Outline and Roadmap]].

### 2026-09-30 — M0 spike: first results (plugin 0.0.3, synthetic 60,000-note vault, in Obsidian)
**Performance (WB-081): passes with wide margin.** Index build 1.17 s (target under 60 s); findings scan 212 ms; 60,000 model notes, 107,526 links, all resolved; schema 1.33 and 1.16 read correctly. Whole-window JavaScript heap 363 MB, which includes Obsidian's own cache; Workbench's index alone measured about 80 MB in Node (target under 300 MB). Structure view builds in under 20 ms.

**Canvas feasibility (WB-080): partly answered, encouraging.** On a generated canvas, right-clicking two selected notes shows "Relate selected notes (Workbench)", so Obsidian's selection-menu event for Canvas works on this Obsidian version. Not yet tested: whether choosing it writes the relationship from the canvas, and whether it holds across Obsidian updates. The event is undocumented, so the gate stays: relationship editing from notes ships first; Canvas Model Edit ships in V1 only if these two tests pass.

**Startup bug found and fixed (0.0.2):** the first build froze Obsidian because first-time caching of a new vault fires one change event per note and each batch started a full rebuild. Changes before or during a build are now buffered, bursts schedule one quiet rebuild, and builds never overlap.

**Readability fix (0.0.3):** the first Structure view was a grid with a label on every edge and was hard to read. It is now a left-to-right tree: 12 children per note, an 80-note limit shared evenly per level, one label per relationship group, "+N more" shown.

**Gate R0 (WB-090) is not yet decided.** Still to check: a relationship written from a note (inverse written in the same step, Undo works, Undo refuses after an outside edit); the relationship written from the Canvas menu item; the release pipeline (the access token cannot write workflow files; CI and release sit in `ci-workflows/` in the plugin repository).

**Process note:** a commit of the 60,000-note test vault to the plugin repository replaced the source; `main` was force-reset to `1ad0b35`. The test vault belongs in its own repository (or is regenerated with `npm run bench:generate`), never in the plugin repository or in this vault.

### 2026-10-01 — Gate R0 (WB-090): go, with two open items
Spencer: "let's call this a pass" (plugin 0.0.5, 60,000-note synthetic vault, in Obsidian).

**Passed**
- **Performance (WB-081):** met with wide margin (index build 1.17 s against 60 s).
- **Inverse writing (WB-085):** relating two notes from the Canvas right-click menu wrote the forward link and its inverse on both notes.
- **Canvas edit feasibility (WB-080):** the `canvas:selection-menu` hook worked on this Obsidian version and wrote the relationship. Go for V1 Canvas Model Edit, kept behind a recheck at each Obsidian version the pilot uses, because the event is undocumented.
- **Undo (WB-086):** the Workbench command restored both notes. After a hand edit it refused with a "Not undone" message; Spencer saw the longer message but did not capture its exact text, so the refusal is recorded as user-reported.

**Found and fixed**
- **Open hang on a large vault (0.0.4):** the plugin waited only 5 s for Obsidian's cache, then indexed while Obsidian was still caching a new 60,000-note vault. The first open took about 10 minutes and Obsidian offered to reopen the vault. Workbench now does nothing until the cache is done and the vault has been quiet for 8 s, with no fixed timeout. After the cache existed, reopening took 5 to 10 seconds. The fix was not tested against a fresh cache on its own.
- **Notices vanished (0.0.5):** undo and error notices now stay for 15 s.

**Guidance recorded**
- Cmd/Ctrl-Z is not Workbench undo. It reverts one open note and can leave a relationship half-written. Use **Undo last relationship change**, ideally with a hotkey. Undo history is in memory and clears on restart. README updated.

**Still open (not gating R0)**
- Release pipeline: CI and release workflows are still in `ci-workflows/` until a token can write workflow files.
- The test vault belongs in its own repository, never in the plugin repository or this vault.
- Canvas hook behavior across Obsidian updates (see above).
- R1 pilot scope: first slice is `02 Product Context` (W-267), tested in the imported vault, not the synthetic one.
- Importer: correction, 2026-10-01. The shared-aggregation → `includes` change (W-277, W-287) is already in importer v0.5.1: the planner writes `includes` for `DestIsAggregate` = 1 and the writer adds the `includedIn` inverse. Checked by reading the code; not run against the `.qeax`. The line above this correction in the first R0 entry, which listed it as still to be made, was carried over from an earlier chat's list without checking.

### 2026-10-01 — M0 closed; Review screen built; engineering home raised (not decided)
**Measured on the imported test vault `spencerskelly/20260930`** (16,405 notes, plugin 0.0.5): index build 0.30 s, findings scan 36 ms, heap 115 MB for the whole Obsidian window. Findings: 5 missing inverses, 6 inverses with no forward link, 240 off-rule links, 242 provisional `tracesTo` links, 7,184 unresolved relationship links. A scan of a git copy suggests the unresolved targets are notes that are not in this vault (none is a case-only mismatch), which fits a partial import; this is an inference, to be checked against the full importer output.

**Built, not yet tested in Obsidian: 0.1.0 Review screen** (WB-063, Part C): five categories with counts, search plus note-type and relationship filters, a finding window with Previous / Next, **Replace relationship** (provisional → approved; two edits, so Undo is run twice) and **Write missing inverse**. Off-rule, orphan-inverse and broken-reference findings open the notes only. Added broken-link detail (field and link text) to the index.

**Raised by Spencer, not decided (no WB number yet):** an engineering home that opens by default, with a search box, the last 10 viewed notes, and a discipline switch (mechanical, electrical, systems, validation) that decides which action buttons show (for example Create a mechanical or electrical Object; Create a Plan, or relate a Verification to a Requirement). Review stays as the diagnostic screen. My reading: the discipline picks buttons and does not filter notes, so no `discipline` property is needed; the buttons would live in a vault YAML next to `relationships.yaml`. Create (M2) is not built, so a home first would show Create greyed out. Spencer: "maybe I'm skipping ahead"; the order is open.

**Other ideas offered, not decided:** traceability gaps per discipline (requirements nothing satisfies, functions with no verification), "changed since you last looked" after a pull, "my notes" by the author code in `uid`.

### 2026-10-01 — M1 started: first run on real elements; quantity (WB-091 trial)
**Review screen, 0.1.0 in Obsidian on `20260930`:** the header counts match the diagnostics numbers recorded above (242 provisional, 5 missing inverses, 6 inverses with no forward link, 240 off-rule, 7,184 broken). Spencer's screenshot; the Replace, Write inverse and Undo checks were still to be run.

**M1 first run (Node, read-only, 16,390 notes, 19,379 links):** four real elements through the Structure profile. Southern Africa, Assemble Wiring to PCBA and Ergonomic Design read well. The cable element did not: its 33 structure links showed 4 children.
1. Quantity is lost: repeated links collapse to one card (276 repeated entries in 86 notes). Trial fix: WB-091.
2. Omissions outside the slice are not shown: 1,955 of 14,541 structure links (13%) point at notes not in this vault (`hasChild` 1,087, `hasPort` 654, `hasPart` 212, `includes` 2), and the "+N more" count ignores them. The cable shows 2 parts and no sign of its 34 ports. Not yet decided.
3. Long names: 1 of 5 cable cards had a name too long for the 300 px card. Spencer is addressing long names in the importer.
Not yet run: a Requirement (largest has 117 structure children) and a Use Case (largest 49).

### 2026-10-01 — Quantity seen; undefined cards decided (WB-092)
Spencer saw WB-091 in Obsidian (0.1.1): `hasPart ×6` on Cable Jacket and `×27` on Wire - Strip and Strip. He decided that missing notes show as undefined (WB-092), replacing my proposal of a separate "+N not in this vault" card. On the cable in `20260930` (Node): 17 cards, 12 of them undefined ports, and "+24 more" for the rest. Of the 3,141 elements with a Structure view, 583 show at least one undefined card. Open, raised by Spencer's screenshot: the relationship name appears only on the first link of a group; two-line names are clipped at a 60 px card height.



### 2026-10-01 — First Review test: the five missing inverses are modeling errors
Spencer saw "Not changed: subtypeOf connects two notes of the same class only" from **Write missing inverse**. All five Missing Inverses findings in `20260930` are a State with `subtypeOf` to a Failure Mode (Damaged Package, Incorrect Part, Undamaged Package, Unknown Quality, Unkown Part), links that already break the rule. Spencer: this is likely a modeling error from quick building, not a missing inverse. So Write missing inverse cannot be tested on this vault, and the inverse write and Undo are tested through Replace relationship instead. WB-094. Open, for the model side: whether these five go to the post-import review list (Post-Import Tasks, Task 7).

### 2026-10-01 — The five State to Failure Mode links go to the post-import review
Spencer: "add them to review". Added as item 15 of Task 7 in `99_System/10_Docs/Post-Import Tasks.md` (and to its "Done when" line). These links carry no `REVIEW` line from the import, so item 6 (the 88 mixed-type Generalization links) does not cover them. I did not give this a W number: it is a task-list entry, not a rule change; say if you want it logged in the Workspace Decision Log.

### 2026-10-01 — Correction: the five State links are valid; the cause is a duplicate note name
My earlier finding and the Post-Import Tasks item 15 were wrong, and Spencer's reading ("a modeling error") rested on my wrong output. `[[Failure Mode]]` is ambiguous in `20260930`. There are two notes with that name: the imported State `Failure Mode` (STATE-00076, `07 Product Assembly/Gen2 Assembly`), which already lists the five States under `supertypeOf`, and the template `99_System/05_Templates/Failure Mode.md` (`type: Failure Mode`). Workbench resolved the link to the template, so the five links looked like State to Failure Mode, off-rule, with no inverse. The links are State to State and valid. Item 15 is removed from Post-Import Tasks. WB-094 stays as built (no inverse is offered for a link that really breaks its rule), but its example was this mistake. Removing the 99_System notes from the index, as a Node test on `20260930`: Missing Inverses 5 to 0, Inverses With No Forward Link 5 to 0, Off-Rule 240 to 235; Provisional (242) and Broken (7,185) unchanged. 24 notes under `99_System` carry a model class as `type`. Not decided: how Workbench should treat `99_System`. Also answered: `hasState`/`stateOf` was removed on purpose in W-185 (containment is `hasChild`).

### 2026-10-01 — `hasState`/`stateOf` restored in the schema (W-291)
Spencer restored the pair in the Workspace Decision Log (W-291): written on an Object or a State Machine, pointing at a State (my reading of the endpoints). Workbench reads the schema from the vault at run time, so it needs no code change (minimum schema version 1.25). The plugin's test fixtures and README follow schema 1.34 and a unit test covers the pair. Not done: the populated `20260930` keeps its copy of `relationships.yaml` at 1.33, so Workbench in that vault does not offer `hasState` until its schema file is updated; I did not touch it because it is the import evidence set.

### 2026-10-01 — `hasState` in the Structure view; schema 1.35 (W-292)
Spencer's rule (W-292): an Object `hasState` a State or State Machine and never `hasChild`. Because `hasChild` no longer carries those links, the Structure profile follows `hasState` (after `hasChild`), otherwise States under an Object would disappear from the view. Built in plugin 0.1.4; the fixtures and README follow schema 1.35 and the tests cover the pair, the `hasChild` exclusions and the view (14 tests pass). The populated `20260930` has no `hasState` links and a 1.33 schema copy, so nothing changes in what you see there. Not tested in Obsidian.

### 2026-10-01 — WB-095 built
Plugin 0.1.5 has the relationship name on every link and 80 px cards (14 tests pass). Not tested in Obsidian. Still to run by Spencer: Replace relationship and Undo (Test 4), the cable Structure view (Test 5).

### 2026-10-01 — WB-096 built
Plugin 0.1.6: seven distinct edge colors, red only for undefined cards (15 tests pass). Not tested in Obsidian.

### 2026-10-01 — Functional view built (WB-097, trial); first run on `20260930`
Plugin 0.1.7, 19 tests pass, not tested in Obsidian. Node run on `20260930`: 224 Objects perform functions (median 2, most 33) and 84 Functions have sub-functions (most 13). Small elements read well: `Antenna - WiFi` 3 notes; `Manage Communication w- LIN Bus` (a Function) 13 notes with 2 undefined, 5 performers, its parent and 4 sub-functions. Large ones hit the limits: `GSE Charger` stops at 80 notes (27 undefined, 103 more not shown) and the canvas is 7,280 px tall, with 39 of the 80 notes being satisfied requirements; `Process Signal` has 34 performing Objects, so 12 show and 48 are "more". 134 of the 224 Objects that perform functions hit a limit. Open: whether `satisfies` belongs in the Functional view, since it is the main cause of crowding and a Requirements view would show it better; and whether co-performers of a function should be shown.

### 2026-10-01 — Requirements view built (WB-098, trial); first run on `20260930`
Plugin 0.1.8, 22 tests pass, not tested in Obsidian. The slice has 9,888 Requirements, 9,022 `hasChild` links between them (1,944 requirements have sub-requirements, 212 are top-level, most direct children 41, nesting up to 7 levels), 348 Design and 197 Function `satisfies`, 294 Verification `verifies`, 307 `refines`, 196 `derivedFrom`, 87 `references`, 59 `appliesTo`, 14 Use Case `drives`. Node runs: a typical requirement `2.4.6.19 Minimum EQ Minutes` 15 notes (12 derived from it, 26 more not shown); `03 Terms and definitions_r_1` 11 notes of sub-requirements; `Permanent Marking` 19 notes, `Insertion - Extraction` (Verification) 4 notes; `Accept User Input` (Function) 13 notes with 4 undefined; `Pedestal` (Object) 10 notes with 4 undefined. No requirement's one-level view exceeds 40 notes, so the 80-note limit is rarely reached. Open: whether the Functional view should keep `satisfies` now that this view shows it (Spencer did not answer; left in).

### 2026-10-01 — Note details popup built (WB-099)
Plugin 0.1.9. Not tested in Obsidian: it depends on Canvas internals, so the first test decides whether the primary path or the fallback works. If clicking does nothing, run **Check Canvas support** and note the "Card elements" row.

### 2026-10-01 — Relationships dropdown built (WB-100)
Plugin 0.1.10, 24 tests pass (the new one covers relationship rows, quantity and keeping relationships out of Properties). Not tested in Obsidian. The first test of the popup (WB-099) is still outstanding.

### 2026-10-01 — Editing in the popup built (WB-101)
Plugin 0.1.11. To check in Obsidian: Edit on a note; save a status and a tag; change a subtype; edit the text and save; remove one relationship and Undo; add one with **Add relationship…**; try Delete and Backspace in a box while a card is selected (the card must stay); look at the git diff of a note after a property edit to see how much YAML Obsidian rewrote.

### 2026-10-01 — Eight more views built (WB-102, trial)
Plugin 0.1.12. To try in Obsidian after pulling and reloading: open a note and run **Explore view of current note…**; for example Where Used on `Wire - Strip and Strip`, Interfaces on `Product`, Verification on `TP0004 - Battery Charge Test (Wired)`, Design on `GSE Charger`, Scenario on `View data from all chargers on tarmac`, Behavior on `Pre-Charge`, Evidence on `UL 486 A-B Table 9 Dielectric-withstand test seque…`. Still open and unanswered: whether `satisfies` stays in the Functional view; whether property and relationship edits should keep going through Obsidian's YAML rewrite or become line edits.

### 2026-10-01 — `satisfies` out of the Functional view (WB-103); two reports to follow up
Plugin 0.1.13. Spencer reported that "all the canvas views are gone from the plugin"; the symptom is not pinned down. Checked: the built plugin loads in a simulated Obsidian and registers all 19 commands; nothing in the plugin deletes files; no commit to `20260930` removed a canvas (the only generated canvas ever committed is the cable Structure view, from Spencer's own commit); the view commands appear only while a Markdown note is the active file, not while a canvas is. Spencer also asked for the YAML rewrite (WB-101, risk 1) to be explained plainly before deciding between keeping it and writing line edits.

### 2026-10-01 — Report resolved; View… button built (WB-104)
Spencer's report that "all the canvas views are gone from the plugin" was not a defect: a canvas was the active tab and no note was selected, and the Explore commands appear only for a Markdown note. All views are there. Plugin 0.1.14 adds **View…** to the popup so a view can be started from a card on a canvas. Still open: whether property and relationship edits keep using Obsidian's YAML rewrite (explained to Spencer on 2026-10-01; recommended keeping it for now and checking one real git diff first); Tests 4 and 5 and the checks of the popup, editing and the eleven views in Obsidian.

### 2026-10-01 — Review of all repositories, test sheet
Checked the four repositories: `Test_Vault_`, `MDSE_Workbench`, `20260930` and the clean base vault (`Test_Vault_-base-vault-2026-09-30-rel133-v051`). Each local copy equals its remote `main`, nothing is uncommitted, every remote is the token-free address, and no tracked file contains a token. The plugin in `20260930` is byte for byte the 0.1.14 build; the base vault holds schema 1.35 and importer v0.5.2 (the vault's own schema copy in `20260930` stays at 1.33 on purpose). `MDSE_Workbench`: README, release notes (they still described the Phase 0 spike) and the lock file version brought up to date. **The CI and release workflows are still in `ci-workflows/`**: this session's plugin-repo token has no Workflows permission, and GitHub refused the push; with such a token, move both files to `.github/workflows/` (they parse and the commands they run work here, but neither has run on GitHub). Workspace: the Handoff, Translator Definition and Decision Log already describe schema 1.35 and W-292; this note's roadmap now has a "where the build stands" paragraph, WB-072 is updated, and [[06 - Test Sheet]] lists every outstanding check in the order that finds problems fastest. No release has been tagged.
Spencer's reports in this session that bear on the status lines above: the popup is "very cool" and the Relationships dropdown made the plugin "better and better" (WB-099, WB-100: working in his Obsidian, so click detection works on this version); the Functional view "works great" (WB-097); the editing build, the view picker and the eight newer views are not yet reported on beyond "I have all the views" (the commands appear).

### 2026-10-01 — Spencer's modeling changes read in (W-293 to W-297); what they mean for Workbench
New in `Test_Vault_` since the last review (11 commits by Spencer, 16:54 to 16:58): W-293 and W-294 (reusable definitions and local occurrences: parts, endpoints, connections that own their flows, addressed by owner UID plus local ID, kept as body records, with `definition` pointing at the reusable note), W-295 (the occurrence model is validated through the real importer; v0.6 and v0.6.1 are experimental), W-296 (v0.5.2 with schema 1.35 is the baseline; the occurrence work is merged forward onto it), W-297 (full-import governance: navigation folders, naming limits, reconciliation-based completion, repeated links are not quantity); Ruleset 1.22, AI_INSTRUCTIONS (a "Local occurrences" section), Translator Definition, the Handoff, the workspace README and a 743-line importer handoff with a repository audit were updated to match. Nothing in them changed schema 1.35, the templates or the importer v0.5.2 that the base vault carries.

For Workbench (no code changed today): (1) the indexing contract for body records stays open and Workbench is not to implement it until the merged importer produces real records (Spencer's handoff, section 11); (2) three changes do not depend on the record syntax and are proposed, not made: keep the anchor when a link is parsed so a link to a local occurrence is not read as a link to its note, make the popup editor refuse to touch a `## Local Model` section, and leave `99_System/` out of the index and refuse edits on ambiguous names; (3) the Interfaces view (WB-102) is built on Port and Item Flow notes and will be reworked when it is decided whether note-level `interfaces`, `hasFlow`, `transmits`, `receives` and `exchanges` stay as summaries; (4) the `×N` label (WB-091) is now only "listed N times" (see the update under WB-091). Repository state: the branch `handoff/full-import-2026-10-01` in `20260930` (PR #1, importer v0.6 and v0.6.1, a review note, Ruleset edits) does not touch the plugin files, and a trial merge into `main` has no conflicts, so merging it would not revert plugin 0.1.14. The base vault README still passes the importer's own check (it starts with "# MDSE Base Vault" and the schema is 1.35).



### WB-107 — 2026-10-02 v0.8 schema and safety alignment
**Status:** Approved/implemented where noted 2026-10-02

W-315 through W-319 advance the model-side contract:
- relationships 1.35 remains current;
- element-types 1.17 adds sparse optional `abstract`;
- Local Model 0.2 is the canonical writer format; Workbench must read 0.1 + 0.2;
- the 30-character token is globally unique across note UIDs and all Local Model reference points;
- part/endpoint `usage` is governed by W-314; connections/flows do not use it;
- repeated note-level relationship entries are duplicate evidence, not quantity.

Standalone plugin 0.1.15 implements only the immediate safe corrections:
1. repeated link counts are labeled explicitly as duplicate evidence rather than quantity;
2. ordinary body editing is refused when a governed Local Model marker is present.

WB-106 remains the next required implementation: ModelRef identity, Local Model 0.1/0.2 parser, block-fragment preservation, Local Model findings/surface, and occurrence-aware Structure/Interfaces/Where Used/Requirements. The standalone repo's `WB106_IMPLEMENTATION_CONTRACT.md` is the implementation handoff.

### WB-108 — 2026-10-02 fixture synchronization and authority pointers

**Status:** Decided and implemented (2026-10-02); no plugin behavior changed, version stays 0.1.15.

The Workbench test fixtures `relationships.yaml` and `element-types.yaml` had drifted from the authority schemas in `99_System/03_Schemas` (wording changes from W-311/W-314/W-319 and the element-types 1.17 optional-property text). They were copied over; typecheck, 31 tests and the production build pass. Rule: the fixtures are a verbatim copy of the authority schemas. `99_System/09_Tools/check-release.py --workbench <clone>` (W-320) fails when they differ or when the Workbench version in `package.json`, `manifest.json` and `mdse-release.yaml` disagree. The Workbench README now points to `00 - Current State` and states the fixture and CI rules. Workbench CI remains inactive until switched on by a separate decision; run `npm run build` and `npm test` before each push.


### WB-109 — 2026-10-02 W-321 runtime-contract fixture boundary

**Status:** Decided and implemented for fixtures/documentation; no plugin behavior changed and version remains 0.1.15.

Workbench does not copy the methodology release registry into its code. Runtime/model semantics continue to come from the vault schemas. For portable independent tests, duplication is limited to schema fixtures that are necessary: `relationships.yaml`, `element-types.yaml`, and current `local-model.yaml` are exact copies of the authority schemas; `local-model-0.1.yaml` is a frozen historical fixture used only to test backward compatibility. The authority release checker compares current fixtures exactly and verifies the historical fixture remains schema 0.1. W-321 keeps the deployed engineering vault lean and requires the final v0.8 base to pin a WB-106-capable Workbench release. WB-106 itself remains the next behavior gate.

### WB-110 — 2026-10-02 distribution through the controlled base release

**Status:** Decided (W-322). Amends WB-088.

Workbench reaches engineers inside the base vault, not by per-machine install: the built `main.js`, `manifest.json` and `styles.css` are vendored in the methodology workspace (`99_System/09_Tools/runtime-plugins/mdse-workbench/`), pinned and hashed in `.obsidian/plugin-lock.yaml`, and MDSE Bootstrap 0.3.0 reports any difference. Pre-release bases pin 0.1.15. To ship a new Workbench build: build in `MDSE_Workbench`, copy the three files into the payload, run `update-plugin-lock.py`, set the version in `mdse-release.yaml`, and run `check-release.py --workbench <clone>`. The issued 0.8.0 base pins the WB-106 release (`wb106Version`). Workbench `data.json` (generated-view registry) and `Workbench Views/` are git-ignored in the base.

### WB-111 — 2026-10-03 Local Model reader, ModelRef and findings report (WB-106 part 1)

**Status:** Built in plugin 0.1.16; 52 tests pass. WB-106 is not complete.

Spencer: bring Workbench up to date before the next importer run so each run is worth it. Built: a pure reader for the governed `## Local Model` region, schema 0.1 and 0.2 (0.1 read as standard usage, never rewritten; an unknown version leaves the text readable and structured use off); `ModelRef` (note UID, or owner UID plus local block ID) so a relationship such as `appliesTo` can point at a record; the WB-106 finding list across a vault (markers, schema, block IDs, 30-character token collisions across note UIDs and records, same-note and cross-note block links, kinds, parents, connection ends, flow roles, definitions, usage, abstract, variation candidates, specialization cycles, block targets in relationship fields); transitive `subtypeOf` candidates (concrete only, cycle-safe, never stored). The command **Check Local Model (write findings report)** reads only notes that have the `Local Model` heading or a record block ID and writes `Workbench Views/Local Model Findings.md` (git-ignored), grouped by finding code with links to each record. Reason for a report and not the Review screen: it gives an independent reading of the importer's Local Model output on the next run without new screens. **Not built, so the gate stays closed:** occurrence-aware Structure, Interfaces, Where Used and Requirements views (the core already has `occurrencesOf` and `recordsOf`), Canvas derived nodes, the Local Model popup (WB-105), Review integration. `wb106Version` stays unset in `mdse-release.yaml`.

### WB-112 — 2026-10-03 Links Workbench writes follow W-324

**Status:** Built in plugin 0.1.16. Answers the open point of W-324.

Finding: the indexer already resolved links through Obsidian's own resolver (`getFirstLinkpathDest`), so file-name links and path links, with or without a `#^block` fragment, were read correctly. The writer was the fault: Relate, Replace and Write missing inverse always wrote `[[<file name>]]`, which points at the wrong note where two notes share a name (about 17% of the notes in the EA8647 extract), and a repeat or a removal compared link text, so a target linked as `[[Folder/Name]]` was missed. Now the link text is what Obsidian writes for that target from that note (`generateMarkdownLink`, following `newLinkFormat`, with `fileToLinktext` as fallback): the file name when unique, else the shortest unique path. An existing entry is matched by the note it resolves to, not by its text. Undo restores the whole note as before.

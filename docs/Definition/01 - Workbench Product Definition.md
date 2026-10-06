# Workbench Product Definition

> Consolidated 2026-09-30: this note holds the product definition (top), the dashboard interface (Part A), the Canvas and view experience (Part B) and the Review experience (Part C). Decisions: [[02 - Workbench Decision Log]]. Build order and release path: [[03 - Build Outline and Roadmap]]. Architecture: [[04 - Architecture and Model Boundary]].

## Problem

The MDSE model can become highly connected and valuable while still being difficult for a normal engineer to use directly.

The engineering interface should make the model feel like a useful working environment rather than a database or formal modeling tool.

The primary problem is therefore not to create more model mechanics. It is to provide a simple interface that lets an engineer answer questions and make valid changes without needing to understand the implementation behind the model.

## Product statement

**MDSE Workbench is an Obsidian-native engineering workspace for creating, exploring, reviewing, and graphically editing an existing MDSE model.**

It provides a guided interface over the model while leaving Markdown notes, YAML, explicit relationships, and vault governance as the durable engineering record.

## Primary users

### Everyday engineer

Needs to:

- create engineering elements quickly;
- find an element by name;
- see useful connected context;
- create or correct relationships;
- identify things that need attention;
- move between graphical views and detailed notes.

Should not need to:

- know YAML syntax;
- know schema implementation;
- know how inverse fields are kept in sync;
- manually build routine Canvas views;
- understand Git for ordinary modeling actions.

### Model maintainer

Needs the same interface plus:

- visibility into unresolved or invalid content;
- model-health review;
- predictable schema-driven behavior;
- a controlled path for future Workbench capabilities.

Schema governance itself remains outside the ordinary Workbench interface.

## Product principles

### 1. Interface first

The model already exists. Workbench should expose it well rather than redesign it.

### 2. Task-oriented

The primary dashboard is organized around **Create**, **Explore**, and **Review**, not around the metamodel taxonomy.

### 3. Fast normal path

Common tasks should require very few actions.

Examples:

- Create element → compact modal → create → note opens.
- Explore → select element(s) → click view → Canvas opens.
- Review → click category → select finding → focused resolution modal.

### 4. Explicit semantics

Workbench may suggest, filter, and validate, but it must not silently invent engineering meaning.

### 5. Graphical views are interfaces, not authority

Canvas should visualize and help edit the underlying notes and relationships. The Canvas itself is not the authoritative model.

### 6. Useful defaults, optional depth

Normal use should work with governed defaults. Advanced controls should exist without blocking the quick path.

### 7. Reversible growth

V1 should be intentionally simple while keeping a clear path to:

- richer creation workflows;
- native graphical relationship gestures;
- direct property editing;
- richer filters and searches;
- non-destructive curated-view synchronization;
- cross-vault views.

## Primary user journeys

### Create

```text
Workbench
  → Create
  → choose element type/action
  → compact modal
  → Create
  → new note opens
```

### Explore

```text
Workbench
  → Explore
  → search/select one or more elements
  → optional type filter
  → click Structure / Behavior / Requirements / ...
  → generated Canvas opens
```

The main view button uses governed defaults. **View Options...** allows an engineer to alter the view before generation.

### Review

```text
Workbench
  → Review
  → see whole-vault finding counts
  → choose category
  → dedicated Review screen
  → filter/search
  → choose finding
  → focused resolution modal
```

## What V1 is not

V1 is not:

- a replacement for Obsidian;
- a SysML implementation;
- a full schema editor;
- a project-management system;
- a full issue tracker;
- a query language;
- a cross-vault graph engine;
- a live always-redrawing visualization system.

## Success criteria

V1 succeeds when an engineer can:

1. open Workbench and understand the main actions without training;
2. create a valid common MDSE element through a compact modal;
3. find a model element quickly by unique name;
4. generate a useful engineering view in one click;
5. enter Model Edit intentionally and change a relationship safely;
6. see unresolved/model-health items without running manual queries;
7. resolve straightforward review findings without editing YAML by hand;
8. leave the underlying vault readable and useful even if Workbench is unavailable;
9. do all of the above acceptably on a full-size vault (targets: [[02 - Workbench Decision Log#WB-081 — Performance gate in Phase 0|WB-081]]).

## Relationship to other MDSE tools

The intended tool split is:

- **MDSE Workbench** — everyday engineer interface.
- **MDSE Bootstrap** — controlled-release startup, plugin/configuration verification and per-person initialization.
- **MDSE Translator / Importer** — EA/native import and migration.
- **Cross-vault infrastructure** — deferred for the current v0.8 single-vault effort; the archived UID resolver remains reference material for the future return of cross-vault resolution.

Workbench should be internally modular, but it should feel like one primary plugin to the engineer.

---

## Part A — Dashboard interface

### Purpose

The dashboard is the primary intentional entry point for MDSE Workbench actions in V1.

Normal Obsidian notes and menus should remain clean. Engineers know that when they want to actively work with the model, they open Workbench.

### V1 dashboard organization

The dashboard is organized by **engineering activity**.

```text
MDSE WORKBENCH

CREATE
[ Object ] [ Requirement ] [ Function ] [ Design ]
[ Verification ] [ Plan ] [ Issue ] [ Interface Definition ] ...

EXPLORE
[ Search for one or more elements... ]
Type: [ All ▼ ]

Selected:
• Main Control PCBA
• Power Module

[ Structure ] [ Behavior ] [ Requirements ]
[ Interfaces ] [ Verification ] [ Impact ]

                        [ View Options... ]

REVIEW
Provisional Relationships 7
Model Errors            3
Incomplete Elements    12
Broken References       2
```

Exact labels and supported create actions should follow the current vault schema rather than be hard-coded from this mockup.

Under Local Model 0.4, an EA-style Port is **not** a first-class Workbench note type. A reusable interface definition is an `Object / interface` note; a contextual Interface occurrence is created/edited inside its owner's Local Model through the structured editor.

### Create area

#### V1 behavior

Creation uses a **compact modal form**.

The form:

- is schema-driven;
- asks only for information needed for a valid initial element plus useful basic fields;
- validates before creation;
- uses normal vault placement rules;
- creates the note through the same underlying creation service that future workflows will use.

After creation, the new note opens automatically.

#### Future path

Complex activities may later graduate to a dedicated Workbench workflow screen without changing the underlying creation service.

Examples that may eventually justify a richer workflow:

- planning verification campaigns;
- creating a connected set of elements;
- configuring a complex engineering context.

A future user preference may also allow rapid-entry mode that stays in Workbench after creation.

### Explore area

#### Selection-first workflow

V1 starts by selecting what the engineer wants to inspect.

The element picker supports:

- fast unique-name search;
- optional type filter;
- multi-select.

V1 intentionally does **not** begin as a general query builder.

#### Future picker improvements

Possible later additions:

- recent elements;
- favorites;
- richer property filters;
- saved searches;
- starting from a view button and selecting afterward.

#### View launch

The normal interaction is one click:

```text
select elements → click Structure → Canvas opens
```

The main button uses the standard governed View Profile.

An adjacent **View Options...** path allows overrides before generation.

Possible options include:

- depth;
- node limit;
- relationship categories;
- contextual/inherited content;
- expansion behavior.

The default path should not require these choices.

### Review area

The dashboard shows categorized whole-vault findings, such as:

- Provisional Relationships;
- Model Errors;
- Incomplete Elements;
- Broken References;
- Ambiguous References;
- other schema/model-health findings.

The dashboard should show concise counts rather than a long list of individual findings.

Clicking a category opens the dedicated Review screen.

### Dashboard personalization

The shared dashboard structure is common to the vault.

Future users may locally:

- favorite actions;
- hide low-use actions;
- reorder actions.

Personal dashboard changes affect presentation only. They never change schema semantics, permissions, or shared model state.

Personal Workbench settings should be local by default, with a future path to export/import or sync.

### Dashboard implementation direction

V1 should be a dedicated custom Obsidian Workbench view, not a Markdown dashboard.

A lightweight Markdown landing/help note may be added later for onboarding and documentation, but it should not be the primary interactive interface.

### V1 interaction priority

The dashboard should optimize for:

1. obviousness;
2. low click count;
3. safe model changes;
4. fast transition into normal Obsidian notes or Canvas;
5. minimal configuration before useful output.

---

## Part B — Canvas and view experience

### Purpose

Canvas is the first graphical renderer and graphical editing surface for MDSE Workbench.

The model remains in Markdown/YAML. Canvas is an interface over that model.

### View families

#### Core everyday views

- Structure
- Behavior
- Requirements
- Interfaces
- Verification
- Impact / Change Impact

#### Additional future profiles

- Where Used
- Type / Reuse
- Functional Allocation
- Function Context
- Requirement Trace
- Test Context
- State Context
- Scenario
- Failure / Risk Context
- Variant Comparison
- Design Rationale
- Evidence Chain
- Model Health

V1 does not need every profile. Prove the engine with a small number of high-value profiles first.

### View Profile concept

A View Profile defines how the same model should be explored for a particular engineering question.

A profile may define:

- allowed relationship types;
- traversal direction;
- default depth;
- stop conditions;
- node limits;
- whether contextual/inherited content is shown;
- layout rules;
- expansion rules;
- edge display rules.

The model is not duplicated for each view.

### Relationship provenance in views

Rendered connections should preserve how they were obtained.

Useful classes:

- **explicit** — directly stored model relationship;
- **derived inverse** — reverse presentation of an authoritative stored relationship;
- **contextual/inherited** — shown because the active profile permits context propagation;
- **calculated/rolled-up** — possible future analytical connection;
- **Canvas-only** — visual annotation with no model semantics.

Contextual/inherited edges must be visually distinct and read-only.

### Generated views

Generated views are for fast engineering exploration.

They are:

- generated from current model state;
- disposable;
- refreshable;
- deterministic enough to reproduce;
- stored in a configured generated-view location;
- excluded from Git.

#### Refresh

V1 may rebuild a generated Canvas completely.

Manual Canvas-only layout and annotations can be lost.

If manual work matters, the user should choose **Save as Curated View** before refresh.

#### Staleness

Workbench should indicate when relevant model changes make a generated view out of date.

The user can then refresh intentionally.

No continuous redraw is required.

### Curated views

V1 curated views are frozen intentional snapshots.

Workbench does not automatically overwrite them.

Future revisions may add:

- Compare with Model;
- Update from Model;
- non-destructive refresh;
- improved source trace.

Preserve enough generated-view metadata to keep that future path open.

### Starting elements

V1 supports one or multiple selected elements.

For multiple selected elements:

1. show shared/connecting context first;
2. avoid exploding each entire neighborhood immediately;
3. allow local expansion around each selected element.

### Traversal and bounds

The View Profile supplies a sensible default depth.

The engineer may request deeper traversal.

Within the current bound, Workbench should show all valid semantic paths relevant to the profile.

If the graph is too large:

- render a useful bounded result;
- show omitted-branch indicators such as “+12 additional requirements”;
- allow expansion.

Never imply that omitted content does not exist.

### Layout

Standard profiles should use predictable engineering-oriented layouts.

Examples:

#### Structure

Prefer parent/supertype above and child/part below where practical.

#### Behavior

Favor performer → behavior → flow/context reading.

#### Requirements

Favor scope/basis → requirement → satisfaction/verification trace.

These are view conventions only; they do not change model semantics.

### View Mode

Generated views open in View Mode.

Typical actions:

- inspect;
- navigate;
- expand/collapse;
- open notes;
- follow relationship source.

View Mode is the safe default.

### Model Edit mode

> **Release gate ([[02 - Workbench Decision Log#WB-080 — Relationship service first; Canvas Model Edit is release-gated|WB-080]]):** the relationship service ships first and is usable from a command/modal on notes. Canvas Model Edit depends on Canvas internals Obsidian does not officially expose, so it ships in V1 only if the Phase 0 spike shows it is low-risk. The behavior below is unchanged either way.

The engineer explicitly enables **Model Editing** on the current Canvas.

Edit mode is temporary for that Canvas session.

Closing/reopening the Canvas or restarting Obsidian returns to View Mode.

### Relationship creation

#### V1 gesture

1. select source/target model nodes;
2. choose **Create Relationship**;
3. Workbench shows schema-valid choices;
4. engineer selects one;
5. confirmation writes the authoritative relationship immediately.

#### Display vs storage direction

The Canvas should label a relationship in the natural visual reading direction.

The write service translates that into the canonical owner-side relationship required by the model.

#### Future drag gesture

Native drag-to-connect can later call the same relationship service.

The semantic service must therefore remain independent of the gesture.

### Batch relationship creation

The desired long-term interaction supports:

- many selected nodes → one target;
- one source → many selected targets.

V1 can expose the behavior through selection + command rather than drag.

Before commit:

- show valid pairs;
- show invalid pairs;
- require confirmation;
- do not silently skip invalid pairs.

Avoid automatic many-to-many/all-to-all creation.

### Relationship removal

Deleting a semantic edge prompts:

1. **Remove from this view only**
2. **Remove relationship from model**
3. **Cancel**

If the displayed edge is inverse/contextual/inherited, Workbench must trace to the authoritative stored source rather than pretending the rendered edge is directly stored.

### Node removal

Removing a node from Canvas removes only the Canvas node.

It does not delete, retire, or otherwise remove the model element.

### Element creation from Canvas

Long-term goal: allow natural model creation while working graphically.

V1 path:

- Canvas action opens the standard Workbench creation modal;
- common creation service creates the note;
- new node is placed on the Canvas.

Future inline creation should reuse the same service.

### Note details and editing

The generated-view note popup is the normal lightweight detail/edit surface (WB-099 to WB-105). It keeps the underlying note authoritative while avoiding unnecessary tab changes.

For a normal model note the popup separates:

- rendered/narrative note text;
- **Properties**;
- **Relationships**;
- **Local Model** when governed local records exist.

**Local Model** is not another frontmatter relationship group. It is the structured view of addressable local part occurrences, endpoints/interfaces, connections, connection-scoped flows and local relationship/applicability targets owned inside the note.

In View mode these sections are inspectable. In Edit mode:

- ordinary narrative text may be edited only through a region-aware writer that cannot replace the governed Local Model region;
- ordinary properties use their governed editors;
- note-level relationships use the relationship service;
- Local Model content uses structured occurrence/context controls through the Workbench model-edit service;
- reusable-definition editing is a separate mode/surface that writes the canonical note, even when launched from an occurrence.

The Local Model marker pair `<!-- MDSE:LOCAL-MODEL START schema=... -->` through `<!-- MDSE:LOCAL-MODEL END -->` is a governed parser/editor boundary, not engineering semantics. Raw text/property editing must never rewrite that region. WB-128 is the high-priority compatibility gate for importer v0.8.19 / Local Model 0.4: Workbench must preserve stable local block IDs and `#^local-id` references, understand Parts / Interfaces / Connections / connection-owned flows / Connection-owned `exposes`, and remain version-aware for older Local Model schemas. Structured writing uses only a schema version explicitly supported by the active writer; unsupported/newer semantics fail closed. The record/local-ID contract remains governed by `local-model.yaml`.

WB-114 expands WB-106 from its completed read/navigation baseline into a structured editor. Occurrence-local data remains visually and semantically separate from reusable-definition data.

The same separation applies when the popup is launched from Canvas: graphical presentation may change, but storage authority and edit services do not.

### Groups

V1 Canvas groups are visual only.

A future explicitly bound semantic group may propose a schema-defined relationship when a compatible element is dropped into it.

Any semantic change still requires engineer confirmation.

### Undo and recovery

Workbench provides in-session semantic Undo/Redo.

A batch edit is one semantic transaction.

Git provides durable history; normal mistakes should not require a Git operation to undo.

### Principle

Canvas should help engineers think spatially without making graphical layout a hidden source of model truth.

---

## Part C — Review experience

### Purpose

Review turns model-health findings into actionable engineering work.

The goal is not to build another issue tracker. It is to make the existing model easier to keep coherent.

### Dashboard presentation

The Workbench home screen shows concise finding categories and counts.

Example:

```text
REVIEW

Provisional Relationships   7
Model Errors              3
Incomplete Elements      12
Broken References         2
Ambiguous References      1
```

Exact categories should come from the model-health engine and current schema rather than being hard-coded to this example.

### Scope

Review represents the **whole-vault model state** by default.

The engineer can narrow the queue using filters.

Possible filters:

- finding category;
- element type;
- relationship type;
- folder;
- product/system context;
- status where relevant.

Saved personal filters may be added later.

### Dedicated Review screen

Clicking a category opens a dedicated Workbench screen.

Suggested flow:

```text
Workbench
  → Review
  → choose category
  → search/filter list
  → select finding
  → focused resolution modal
```

The home dashboard remains uncluttered.

### Focused finding modal

The modal should explain the issue in context and present only relevant actions.

For a provisional relationship:

```text
Provisional Relationship

Source:
Temperature Sensor

Current relationship:
tracesTo

Target:
Thermal Requirement

Valid replacements:
○ <schema-valid relationship>
○ <schema-valid relationship>

[Open Source] [Open Target]

[Cancel] [Replace Relationship]
```

### Provisional relationship (`tracesTo`) behavior

`tracesTo` (the vault's provisional relationship, workspace decision W-288) is intentionally available when an engineer knows two elements are related but does not know the approved semantic relationship.

#### Resolve

Replace it with an **existing valid relationship**.

#### No valid relationship

Leave it unresolved.

The Review modal must not become a schema-authoring interface.

#### Explanation

No explanation is required to create `tracesTo`.

### Other finding types

#### Broken reference

Show the source element, affected property, unresolved target, and safe repair actions.

#### Ambiguous reference

Show candidate targets and require explicit engineer selection.

Never guess.

#### Incomplete element

Show the element, missing/flagged information, and an action to open/edit it.

#### Invalid or legacy relationship

Show the current relationship, why it is rejected by the current schema, safe valid replacements if available, and the source note.

#### Stale generated view

Prefer a lightweight view-state notification rather than a governance finding unless future use shows that central review adds value.

### Sequential review

**Decided — [[02 - Workbench Decision Log#WB-063 — Sequential Review|WB-063]].** Previous / Next through the filtered queue (`← Previous   4 of 17   Next →`), advancing to the next unresolved finding after a resolution; no batch editing in V1.

### Batch review

Do not make broad batch resolution a V1 requirement.

If batch review is added later, require explicit preview and semantic validation.

### Dismiss/ignore behavior

No generic permanent “dismiss model error” behavior has been approved.

A finding that reflects current model state should normally remain until the model or governing rule changes.

Future finding types may justify explicit waivers, but those should be designed deliberately.

### Success criteria

Review succeeds when:

1. an engineer can see that unresolved work exists;
2. they can narrow the queue to the current engineering context;
3. each finding explains enough context to act;
4. straightforward corrections happen without manual YAML editing;
5. unresolved methodology gaps remain visible instead of being guessed away.

### Variation and configuration experience (W-314)

The Local Model eventually exposes contextual usage without turning variant management into a separate modeling subsystem.

For each configurable occurrence Workbench should show:

- the occurrence's visible name and stable local identity;
- stated reusable definition/family root;
- `usage`: standard, variant or option;
- whether the root is abstract;
- the concrete candidates derived from the specialization hierarchy;
- current temporary or persisted selection, when one exists;
- any configuration validity finding.

Expected interaction:

- `standard` — no configuration choice;
- `variant` — required dropdown/select control over allowable concrete candidates;
- `option` — present/absent control; when present, a definition selector if more than one concrete candidate exists.

These controls operate on a configuration state, not by editing the base architecture's `definition`. The unresolved reusable product architecture should remain reusable and inspectable.

Future high-value views include:

- **Generic Architecture** — unresolved base Local Model;
- **Variation Space** — configurable positions plus their derived candidate families;
- **Configured Architecture** — one resolved temporary or named configuration;
- **Configuration Comparison** — compare two resolved configurations by changed/absent occurrences;
- **Configuration-filtered Canvas** — render only occurrences/topology present in the selected configuration.

Model-number generation/reverse decoding may later use the same resolved configuration state, but commercial codes belong to product/configuration knowledge and must not be written as intrinsic properties of reusable component definitions.

The user-facing step-by-step workflow is intentionally deferred until schema support and the configuration interaction have been implemented and tested.


## 2026-10-02 v0.8 alignment

The model-side contract is now settled by W-315 through W-319.

- relationships 1.35;
- element-types 1.17;
- Local Model writer 0.2; reader compatibility 0.1 + 0.2;
- one globally unique 30-character identity-token namespace across notes and Local Model reference points;
- part/endpoint `usage` and sparse reusable-definition `abstract` are governed;
- repeated note-level links are duplicate evidence, never quantity;
- WB-106 remains the keepability gate before a full v0.8 import can be accepted.

Standalone Workbench 0.1.15 is a safety/alignment build: it labels repeated links as duplicate evidence and refuses ordinary body editing on notes containing a governed Local Model marker. It does not yet implement the WB-106 parser/index/view foundation.


## Internal Structure view

Internal Structure is the preferred occurrence-native view for an Object that owns Local Model content.

The selected note is shown as the visual boundary. Contextual part occurrences are inside it. Boundary endpoint occurrences are compact boxes at the edge. Part-owned endpoints stay near their part where practical. Context-owned connections are drawn between endpoint occurrences, and connection-owned flows may be summarized on the connection.

The view answers **what is inside this context and how is it connected?** It does not attempt to show every related definition, requirement or where-used fact at the same time.

Reusable-definition internals are reached by changing context to that definition's own Internal view rather than flattening deeper levels into the current view.

Automatic layout is a starting point. Engineers may curate the Canvas for readability. Geometry is presentation only and never creates model semantics. Refresh of a curated Internal view preserves surviving stable-node positions where practical.

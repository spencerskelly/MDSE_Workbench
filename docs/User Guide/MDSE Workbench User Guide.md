# MDSE Workbench User Guide

**Status:** living guide for the MDSE v0.8 pre-release Workbench. Check `99_System/01_Admin/Enabled Plugin Stack.md` in an engineering vault for the exact pinned Workbench version. Features marked **Candidate** are part of the current WB-106 development line but are not considered released until the controlled Base Vault release process promotes them.

## What Workbench is

MDSE Workbench is the everyday engineering interface to the Markdown model in Obsidian. It helps engineers create, inspect, navigate, review and edit the model without requiring them to work directly in YAML or understand the internal storage format.

The model remains the notes, governed properties, relationships and Local Model records in the vault. Workbench does not create a second model database.

Use Workbench for four everyday activities:

1. **Create** model elements using governed types, properties and identity rules.
2. **Explore** the model through focused generated views.
3. **Inspect and edit** notes, relationships and contextual occurrences through governed controls.
4. **Review** model-health findings before they become hidden data problems.

## 1. Starting Workbench

Open the vault in Obsidian and allow the controlled plugin stack to load. If Bootstrap reports a damaged or mismatched Workbench plugin, do not replace it manually; restore the released vault/plugin payload.

Useful commands are available from the Command Palette with `Cmd/Ctrl+P`.

Start with:

- **MDSE Workbench: Rebuild index** after a large pull/import or when the displayed model appears stale.
- **MDSE Workbench: Open Review** to inspect model-health findings.
- **MDSE Workbench: Check Local Model** when validating imported or heavily edited Local Model content.
- **MDSE Workbench: Inspect semantic cache** in a development/integration vault when validating the W-343/W-344 runtime candidate.
- **MDSE Workbench: Clear semantic cache** when cache recovery is needed; it deletes only derived Workbench state and forces the next startup onto the full rebuild path.

Workbench normally updates its semantic index incrementally as files change. The vault's Markdown/YAML remains authoritative; Workbench's index, semantic cache, findings and generated views are derived and disposable.

### Runtime status

Candidate Workbench builds expose startup state in the status bar:

- **starting** — schemas/runtime are being prepared;
- **waiting for vault** — Workbench is deliberately letting Obsidian finish its own metadata-cache activity;
- **restoring cache** — a compatible disposable semantic cache is being loaded;
- **reconciling** — cached state is being brought up to date from changed/added/deleted paths;
- **indexing** — Workbench is performing the full chunked rebuild path;
- **ready** — Workbench queries/views can be used.

A missing or invalid Workbench cache is a performance/recovery condition, not a model failure. Workbench must be able to rebuild from the vault. **Clear semantic cache** is the supported reset path; engineers should not delete arbitrary files under `.obsidian`.

### Semantic cache candidate

**Candidate — W-343/W-345 / RTA-2 and RTA-3.**

The development line writes a local, Git-ignored semantic cache after Workbench is already Ready. The cache is bound to the vault identity and schema/parser contract and uses two crash-safe A/B slots. It may be deleted at any time.

**Warm cache preview** is an explicit pre-release setting and is OFF by default. When enabled in an integration vault, Workbench may restore a validated cache and reconcile a bounded set of changed, added, deleted or renamed files. Semantic-cache v2 retains authored relationship-link evidence, so a path-set change can re-resolve otherwise unchanged relationship links through Obsidian's current metadata without rereading those note bodies. Large change sets still deliberately use the full chunked rebuild path.

Do not enable Warm cache preview in a controlled release merely because the setting exists; it remains a validation feature until the runtime acceptance sheet passes.

## 2. Opening a note from a Canvas

Click a normal model note on a Workbench-generated Canvas to open its Workbench details popup.

The popup is the preferred place to inspect the selected element because it keeps together:

- basic type/status information;
- authored properties;
- relationships;
- note text;
- applicable model actions.

Use **Open note** when you want the normal Markdown note.

Use **View…** when you want a model view centered on the selected note. Workbench only offers views that are applicable to that type/context where possible.

## 3. Choosing a useful view

Do not treat a view as "show me everything related to this note." Each view is intended to answer one engineering question clearly.

Common views include:

- **Structure** — composition/decomposition and contextual part occurrences.
- **Internal** — the inside of one occurrence-owning Object/assembly. **Candidate.**
- **Interfaces** — ports/endpoints, exposure, connections and flows.
- **Functional** — performed functions and functional decomposition/order.
- **Requirements** — requirement scope, decomposition, satisfaction and verification context.
- **Where Used** — where a reusable definition is used, including contextual occurrences.
- **Behavior** — state/state-machine structure and transitions/order.
- **Verification** — requirement verification context.
- **Design** — designs and the requirements they satisfy.
- **Scenario** — use-case participants and realizing behavior.
- **Failure and risk** — issues/failure modes and affected model elements.
- **Evidence** — documents/artifacts that describe model content.

A useful view should remain readable. If a view becomes a dense graph, switch to the view that matches the question rather than adding more relationship types to the same picture.

## 4. Internal view for occurrence-based assemblies

**Candidate — WB-123.**

Use **Internal** when a note owns Local Model occurrences and you want to understand what is inside that context.

The selected Object/note is the visual boundary.

Inside the boundary Workbench shows:

- local part occurrences;
- contextual endpoint/interface occurrences;
- context-owned connections;
- connection-owned flows.

Assembly boundary interfaces are intentionally shown as small text boxes on the outer edge of the boundary. An `exposes` path connects an outer boundary endpoint to the internal endpoint it exposes.

Internal view follows the Local Model ownership rule: it shows topology owned by the current context. It does not flatten every reusable definition's internals into one giant picture.

To inspect the next level down, open the part occurrence and then open the reusable definition's Internal view when that definition owns Local Model content. Full contextual "up one level" navigation remains part of the WB-106 candidate work.

### Manual layout is allowed

Automatic layout is a starting point, not engineering authority.

Engineers may move/resize Canvas nodes to make a complex Internal view readable. Node identity is stable so a semantic refresh can preserve the placement of nodes that still exist.

The following are presentation-only changes:

- moving a node;
- resizing a node or boundary;
- improving spacing;
- arranging interfaces to reduce crossing lines.

These do **not** change the MDSE model.

A semantic action such as creating/removing an occurrence, endpoint, connection or relationship must go through Workbench model-edit controls. Do not imply a model change by drawing or deleting a Canvas line manually.

## 5. Understanding a reusable definition versus an occurrence

A reusable definition is a normal MDSE note.

A contextual occurrence is a Local Model record owned by the note that provides its context.

For example:

- `Main Contactor` can be one reusable Object definition.
- `K1` and `K2` can be two different local part occurrences that both use that definition.

Workbench deliberately keeps those layers separate.

In occurrence-oriented views, the occurrence/context is primary and the reusable definition is secondary.

In definition-oriented views such as Where Used, the reusable definition can be primary and occurrences provide usage context.

Do not create duplicate definition notes merely because a product contains several occurrences of the same reusable thing.

## 6. Occurrence details and Definition

**Candidate editor direction — WB-114.**

Occurrence details show occurrence-owned/context-local information first.

Reusable information belongs under **Definition**. Expanding Definition should show the canonical reusable note, not a copied snapshot.

Relationships derived from or pointing to the definition are shown separately from occurrence-local relationships.

If a value is inherited unchanged, it belongs with the Definition. Only contextual overrides belong in the occurrence-local section.

Workbench must not silently change a reusable definition when the engineer believes they are editing one occurrence.

## 7. Editing

The WB-106 editor uses two clearly different editing scopes:

- **Context / Local Model edit** — changes a contextual occurrence, endpoint, connection, flow, or other local value.
- **Definition edit** — changes the canonical reusable MDSE note.

### Immediate edits

Small atomic edits may apply immediately after validation.

Examples include a normal property change or one safe occurrence-local field edit.

### Structural edits

Multi-element structural changes use a staged transaction:

1. make the proposed changes;
2. inspect validation findings;
3. review the transaction;
4. choose **Apply** or **Cancel**.

A staged transaction may be temporarily incomplete while it is being assembled, but Workbench blocks Apply when required integrity errors remain.

### Do not edit the governed Local Model region as ordinary text

New Local Model writes use schema 0.2. Workbench reads 0.1 for compatibility but does not use ordinary body editing to rewrite governed Local Model records.

Use structured Workbench controls for Local Model changes.

## 8. Relationships

When creating a relationship, Workbench offers only relationships allowed by the current governed schema for the two endpoint types.

Workbench writes the authoritative forward relationship and the governed inverse where applicable.

Use provisional `tracesTo` only when there is a real relationship but the existing vocabulary does not yet describe it. Review should bring provisional relationships back for later resolution.

A repeated identical note-level relationship is duplicate evidence, not quantity. Contextual quantity belongs in Local Model `multiplicity`.

## 9. Review

Open **Review** regularly, especially after imports, large edits or Git pulls.

Current finding categories include:

- provisional relationships;
- missing inverses;
- inverses with no forward relationship;
- off-rule relationships;
- broken references;
- Local Model findings.

Review is not only cleanup. It is the mechanism that keeps ambiguity visible instead of silently forcing a questionable semantic decision.

## 10. Undo and Git

Workbench semantic Undo is the preferred way to reverse a Workbench model edit because one semantic action may touch more than one note.

Workbench Undo refuses to overwrite a file that changed externally after the operation.

Git remains the durable model/file history. Workbench does not commit or push Git changes.

## 11. Generated versus curated views

A generated Canvas is a projection of the model.

A curated Canvas adds useful human layout work to that projection.

Rules:

- Canvas layout is presentation, not semantic authority.
- Manual placement must not create relationships.
- Refreshing a curated view must preserve existing manual positions where the same stable model nodes still exist.
- New semantic nodes may be placed automatically.
- Removed semantic nodes may disappear from the refreshed view.
- Workbench must never destroy curated layout without an explicit refresh/update action.

## 12. What not to do

Do not:

- edit generated runtime/plugin files by hand;
- invent relationship semantics because a Canvas line "looks right";
- duplicate reusable definitions for each occurrence;
- use folder location as model meaning;
- change a note UID or a Local Model identity token;
- manually repair a definition reference by silently selecting a different subtype;
- assume every visible Canvas element is an authoritative model element.

## 13. When something looks wrong

Try these in order:

1. **Rebuild index.** If a cache-related problem is suspected in a candidate build, **Inspect semantic cache** first; use **Clear semantic cache** for a supported reset rather than deleting arbitrary plugin files.
2. Open the source note/occurrence and confirm the underlying model content.
3. Run **Check Local Model** for occurrence/interface/connection issues.
4. Open **Review** for broken or off-rule relationships.
5. If a generated view is stale, refresh/regenerate it.
6. If a curated Internal view is being refreshed, preserve the existing layout rather than replacing it blindly.
7. If the problem requires a relationship or property the schemas do not currently support, stop and take the need to MDSE model governance instead of inventing a Workbench-only semantic rule.

## 14. Current pre-release boundary

The engineering Base Vault may still pin an older Workbench while a newer candidate is being developed. The pinned version shown in **Enabled Plugin Stack** is the runtime truth.

The current WB-106 development line adds structured Local Model editing, the Internal occurrence-native view, and the W-343/W-345 runtime architecture. Save-only semantic-cache behavior and opt-in warm-cache preview are candidate capabilities, not released merely because their source exists. Promotion still requires the Workbench test/typecheck/build gate, runtime acceptance on representative vaults, controlled payload/lock/release updates, and release-checker success.

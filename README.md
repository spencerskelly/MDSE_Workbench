# MDSE Workbench

The everyday engineer interface to the MDSE model vault: create model elements, explore them as generated views, and review model health, without editing YAML by hand.

The vault's Markdown and YAML are the model. Workbench reads the vault's own schema (`relationships.yaml`, `element-types.yaml`) and never embeds model rules. If Workbench is turned off, the vault stays complete and readable.

Design notes and decisions live in the vault, in the `MDSE Workbench` folder (decision IDs `WB-…`). Model decisions live in the vault's Workspace Decision Log (`W-…`).

## Status: Phase 0 spike (M0)

M0 replaces the riskiest assumptions with measurements before more is built (WB-081, gate R0 in WB-090). It is not for everyday use.

| M0 question | How this build answers it |
|---|---|
| Is the index fast enough at full size? | **Show diagnostics** reports build time, findings scan time and memory. Targets: index under 60 s, a view under 3 s, index memory under 300 MB. |
| Can a read-only Structure view be generated? | **Explore structure of current note** writes a native Canvas to the generated-views folder and opens it. |
| Does writing a relationship also write its inverse? | **Relate current note to another note** writes the forward field and its inverse in one step (W-275), with **Undo** that refuses if a note changed since (WB-086). |
| Can Canvas editing work without unsupported patching? | **Check Canvas support** reports what Obsidian exposes; right-click two selected notes on a canvas to see whether **Relate selected notes (Workbench)** appears (WB-080 gate). |
| Does the build and release pipeline produce an installable plugin? | Tagging `v*` runs `.github/workflows/release.yml`, which tests, builds and publishes `main.js`, `manifest.json`, `styles.css`. |

### First measurements (Node, synthetic vault)

`npm run bench:generate && npm run bench` on a generated vault of 60,000 notes and 107,526 authored links (240 MB on disk):

| Step | Result | Target |
|---|---|---|
| Read and parse frontmatter (Obsidian's own cache does this in the app) | 9.8 s | — |
| Workbench index build | 0.7 s | under 60 s |
| Index memory | about 80 MB | under 300 MB |
| Findings scan (missing inverses, off-rule, provisional) | 0.4 s | — |
| Incremental update of one note | 0.2 ms | under 500 ms |
| Structure view at the 80-note cap, with tree layout | 9–18 ms | under 3 s |

These are the pure index in Node. In Obsidian on the same vault (0.0.2), **Show diagnostics** reported an index build of 1.17 s and a findings scan of 212 ms, with every count at 0 as expected.

## Commands

- **Show diagnostics**: index size and timings, Review counts (missing inverses, inverses with no forward link, links that break endpoint rules, provisional `tracesTo` links, unresolved links), schema versions and warnings.
- **Rebuild index**
- **Explore structure of current note**: follows `hasPart`, `hasChild`, `hasState`, `includes`, `hasPort`, `exposes`, `hasFlow` two levels down as a left-to-right tree. Each note shows up to 12 children; the 80-note limit is shared evenly across each level and wins over depth (WB-082); "+N more" shows what was left out. One label per relationship group, colored by relationship.
- **Explore functional view of current note**: starts from an Object or a Function. From an Object it shows the functions it performs, their sub-functions, what precedes or follows them. From a Function it shows who performs it, its parent function and sub-functions, and what comes before and after it. Arrows follow the stored direction; the same limits apply (12 children per note, 80 notes, two levels). Missing functions show as undefined cards. The requirements a function satisfies are in the Requirements view.
- **Explore requirements view of current note**: starts from a Requirement, or from an Object, Function, Design, State, Use Case or Verification. From a Requirement it shows where it sits (owner element and parent requirement), its sub-requirements, what it is derived from and what is derived from it, what it refines or is refined by, what it references, and what satisfies, verifies, applies to or drives it. From the other types it shows the requirements they hold, satisfy, verify or drive, or that apply to them, and each of those requirements opens one more level. Arrows follow the stored direction; the same limits apply. Missing requirements and sources show as undefined cards.
- **Explore view of current note…** lists the views that can start from the note's type, with a line on each, and opens the one chosen. Each view also has its own command (**Explore where-used view…**, and so on). Every view uses the same limits (12 children per note, 80 notes), draws arrows in the stored direction, labels every link with its relationship, shows missing notes as undefined cards, and refreshes from **Check whether this view is current**:
  - **Where Used**: from any note, what contains or uses it, three levels up: parent assemblies (`hasPart`), notes that include it, owners, the Object that has a State, a Port or a Design, the Objects that perform a Function, Use Cases it realizes or takes part in, notes that depend on it.
  - **Interfaces**: from an Object, Port or Item Flow: ports, the port each faces (`interfaces`, drawn without an arrowhead) and that port's owner, outer and inner ports (`exposes`), and item flows (`transmits`, `receives`, `exchanges`, `hasFlow`). Three levels.
  - **Verification**: from a Requirement, Verification, Function, Design or State: what verifies a requirement, what else a verification covers, and what satisfies those requirements.
  - **Design**: from an Object, Document or Design: its designs, sub-designs and the requirements each satisfies.
  - **Scenario**: from a Use Case: participants, realizing Functions and Designs, included and optional Use Cases, driven requirements, and the order of the realizing functions.
  - **Behavior**: from a State Machine, State or Object: who has the states, initial and final states, order (`precedes`), nested states, and what triggers a state.
  - **Failure and risk**: from any note: what an Issue or Failure Mode affects, what affects an element, causes (`drives`), and the requirements and performers around the affected functions.
  - **Evidence**: from any note: the Artifacts, Documents and Info notes that describe it or sit under it, and what else each one describes.
- **Note details on click**: on a generated view (a canvas in the views folder), clicking a note opens a popup with its type, id and status, its properties and its relationships (two collapsed dropdowns, with counts; a note listed several times shows once as ×27; a missing note is shown in red and is not clickable) and its rendered text, so the note does not have to be opened. The popup stays on screen while you click other notes; links inside it open in the popup (‹ goes back), **View…** opens the view picker for that note, so a view of any card can be started without leaving the canvas, **Open note** opens the note in a tab, and × or Esc closes it. Clicking an undefined card says it still has to be defined. Shift, Ctrl, Cmd or Alt clicks and drags are ignored, so selecting and moving cards works as before. **Edit** (WB-101) switches the popup into edit mode for the note it shows (off again for every other note): the text becomes a box with **Save text** and **Revert**; subtype is a dropdown of the class's subtypes, status a box that suggests Draft, Active and Retired, tags a comma-separated box, and other simple properties text boxes (type, id, uid, translator-written properties and relationships cannot be edited there, and properties are not added or dropped); each relationship has a ✕ that removes it and its inverse after a confirmation, and **Add relationship…** picks a note and then the relationship, with the rule check. Every edit is one step that **Undo** (or the command **Undo last Workbench edit**) reverses. A save is refused if the note changed since the popup showed it. It can be switched off in the settings. It relies on Canvas internals that Obsidian does not document (a fallback matches the card's position to the canvas file), so recheck it on each Obsidian version; **Check Canvas support** reports whether the card elements are reachable.
- **Check whether this view is current**: compares the open generated view with the model and offers to refresh it.
- **Relate current note to another note**: pick the other note by name (type and id shown beside it), then pick from only the relationships the endpoint rules allow, in either direction. `tracesTo` is offered last, as the provisional relationship (W-288).
- **Undo last relationship change**: reverses both notes of the last relate, and refuses if either note was edited since. Use this, not Cmd/Ctrl-Z, which only undoes one open note and can leave a pair half-written. Give it a hotkey under Settings → Hotkeys. History is kept in memory and clears when Obsidian restarts.
- **Check Canvas support (Phase 0 probe)**
- **Open Review** (also the checklist icon in the ribbon): the whole-vault Review screen. Categories with counts (Provisional Relationships, Missing Inverses, Inverses With No Forward Link, Off-Rule Links, Broken References), search plus note-type and relationship filters, and a finding window with Previous / Next. Two findings can be resolved from the window: **Replace relationship** (provisional `tracesTo` → an approved relationship the endpoint rules allow; adds the new link, then removes the old one, so Undo reverses the removal first) and **Write missing inverse**. Everything else offers **Open source** and **Open target** only. The screen follows changes after a one-second pause and lists the first 200 rows of a filter.

Generated views go to `Workbench Views/` (configurable). Add that folder to the vault's `.gitignore` (WB-036).

### Local Model compatibility direction

Workspace decisions W-293/W-294/W-298 and Workbench decision WB-105 add addressable local part occurrences, endpoints, connections, connection-scoped flows and local applicability inside the owning note body.

The next occurrence-aware Workbench build will treat that content as a separate **Local Model** surface:

- Local Model is distinct from ordinary narrative text, Properties and note-level Relationships.
- W-302 bounds it with the managed START/END markers and schema `0.1`; the ordinary text editor must exclude/protect that region.
- W-303 gives local records durable `part-*`, `ep-*`, `conn-*`, and `flow-*` IDs independent of visible names.
- W-304 fixes heading + named-field Markdown records. Parts reuse Object/assembly definitions; endpoints reuse Port/interface definitions; nested pins/contacts/sub-interfaces are recursive endpoint records using a parent address.
- W-305 keeps inherited interface members implicit through the reusable definition until a local connection, Requirement target, override, or other contextual reference needs an independently addressable `ep-*` record. Workbench may display inherited members, but must distinguish them from materialized local occurrences.
- W-306 establishes an Obsidian-native-first rule: core Obsidian/standard Markdown/YAML first, broad plugin compatibility second, Workbench-only syntax last. Materialized local records use native Obsidian block IDs equal to their stable local IDs (`^part-*`, `^ep-*`, `^conn-*`, `^flow-*`), so ordinary links such as `[[Owner Note#^ep-42bd90|J4]]` navigate directly to the record without Workbench. Human-facing headings remain readable.
- W-310 constrains local multiplicity: `multiplicity: N` means N contextually interchangeable, non-individually-addressed copies. If any copy needs distinct connections, Requirement applicability, state, override, flow or other local context, Workbench must represent it as its own `part-*` occurrence.
- Connection-owned flow records are stored once but indexed and shown from each participating endpoint/interface.
- EA-only provenance is not required by Workbench and lives in the import-evidence `Local Model Source Map.csv` rather than engineering note records.
- Read-only parsing/indexing comes before structured editing; high-value views navigate local records rather than flattening them into duplicate note-level links.

**0.1.14 predates this contract. Do not use its body editor on notes containing `## Local Model` records.** The synchronized importer/base release after the current v0.7 merge candidate will start at v0.8.0; Workbench remains independently versioned.


## Design rules this code follows

- **Model core is pure TypeScript** (`src/core`): schema, endpoint rules, index, findings, traversal, layout, frontmatter edits. No Obsidian or Node imports, so it is unit-tested in Node and stays mobile-ready (WB-087).
- **Obsidian layer** (`src/obsidian`) uses only Obsidian's own APIs: metadata cache, vault, `processFrontMatter`. No Node or Electron; the build marks Node built-ins external so a stray import shows up in review.
- **Desktop only** for support (`isDesktopOnly: true`), mobile-ready code (WB-087).
- **Workbench never commits** (WB-086). It edits files; Git is done by people and AI tools.
- **Relationship lists are sorted by target name** so concurrent edits merge cleanly (WB-086). Where an inverse field sits relative to its forward field is still an open workspace decision; this build puts each inverse right after its forward field.

## Develop

No local install is needed: open the repository in GitHub Codespaces (`.devcontainer/`).

```
npm ci
npm test            # unit tests against the vault schema in test/fixtures
npm run build       # typecheck and bundle main.js
npm run bench:generate -- 60000 && npm run bench
```

`test/fixtures/` holds copies of the vault's `relationships.yaml` (schema 1.35) and `element-types.yaml`. Refresh them when the schema changes.

The CI and release workflows are in `ci-workflows/` because the access token used so far cannot write workflow files (it lacks the Workflows permission; GitHub refuses the push). With a token that has it, move both files to `.github/workflows/`. CI then runs the tests and the build on every push to `main` and on pull requests; the release workflow runs when a tag `v<version>` is pushed, checks the tag against `manifest.json`, builds, and publishes `main.js`, `manifest.json`, `styles.css` and the 60,000-note synthetic vault as a GitHub release. Both files parse, and the commands they run (`npm ci`, `npm test`, `npm run build`, `npm run bench:generate`) work here; neither workflow has run on GitHub yet.

To release: bump `version` in `manifest.json`, `package.json` and `versions.json`, commit, and push a tag `v<version>`.

# MDSE Workbench

The everyday engineer interface to the MDSE model vault: create model elements, explore them as generated views, and review model health, without editing YAML by hand.

The vault's Markdown and YAML are the model. Workbench reads the vault's own schema (`relationships.yaml`, `element-types.yaml`) and never embeds model rules. If Workbench is turned off, the vault stays complete and readable.

Design notes and decisions live in the vault, in the `MDSE Workbench` folder (decision IDs `WB-…`). Model decisions live in the vault's Workspace Decision Log (`W-…`).

## v0.8 implementation authority

Start from the methodology vault's `00_Workspace/00 - Current State.md`; it names the current authority through W-321. The v0.8 reconciliation remains the implementation contract, with W-321 governing the lean runtime-base/release chain.

Current schema target:
- relationships 1.35;
- element-types 1.17;
- Local Model writer 0.2;
- Workbench Local Model reader compatibility 0.1 + 0.2.

See `WB106_IMPLEMENTATION_CONTRACT.md` for the exact next Workbench build boundary.

Start from the methodology vault's `00_Workspace/00 - Current State.md`: it lists the current rules, tool status and which files are historical. Release versions are recorded in `Base Vault/Definition/mdse-release.yaml` there.

**Fixtures are copies only where independent Workbench tests require them.** `test/fixtures/relationships.yaml`, `element-types.yaml`, and `local-model.yaml` must exactly equal the current authority schemas. `local-model-0.1.yaml` is a frozen historical compatibility fixture and must not be updated to current semantics. After any current-schema change, sync the current fixture and run `npm test`. The vault's `python3 Base Vault/Tools/v0.8.0/check-release.py --workbench <this clone>` fails if they differ or if the version in `package.json`, `manifest.json` and the release manifest disagree (W-320, WB-108).

**CI/build note.** `.github/workflows/build-artifact.yml` runs `npm ci`, `npm test` and `npm run build` on pushes to `main` and pull requests; artifact synchronization is restricted to successful pushes on `main`. The RTA/WB-106 source passed **95/95 tests plus TypeScript/bundle build** on GitHub Actions at commit `2c5e8f5`; the workflow then created built-artifact commit `d05aa2a` containing root `main.js` and the synchronized vault plugin payload. Runtime promotion still requires the integration/acceptance gates; a green source build is necessary but not sufficient.

## Status: v0.8 pre-release candidate

The original Phase 0 measurements remain below as historical performance evidence, but current `main` is the WB-106 development line: occurrence-aware Local Model navigation/editing, Internal Structure, and the W-343/W-344 runtime architecture.

Current runtime work is intentionally staged:

- commands/status are registered immediately;
- the existing chunked full build remains the recovery baseline;
- a vault/schema-bound disposable semantic cache is written only after Workbench is ready;
- the cache uses bounded crash-safe A/B slots and can be inspected with **Inspect semantic cache**;
- an opt-in **Warm cache preview** setting exercises validated restore + conservative stable-path reconciliation; it is **off by default** and is not yet a released runtime behavior;
- Local Model validation uses the shared semantic index rather than rereading every Local Model region;
- adding/deleting/renaming Markdown paths still falls back to a full rebuild because that can change wikilink resolution in unchanged notes.

See `docs/Architecture/MDSE Runtime Architecture.md` for the governing runtime plan.

| M0 question | How this build answers it |
|---|---|
| Is the index fast enough at full size? | **Show diagnostics** reports build time, findings scan time and memory. Targets: index under 60 s, a view under 3 s, index memory under 300 MB. |
| Can a read-only Structure view be generated? | **Explore structure of current note** writes a native Canvas to the generated-views folder and opens it. |
| Does writing a relationship also write its inverse? | **Relate current note to another note** writes the forward field and its inverse in one step (W-275), with **Undo** that refuses if a note changed since (WB-086). |
| Can Canvas editing work without unsupported patching? | **Check Canvas support** reports what Obsidian exposes; right-click two selected notes on a canvas to see whether **Relate selected notes (Workbench)** appears (WB-080 gate). |
| Does the build and release pipeline produce an installable plugin? | Tagging `v*` runs `.github/workflows/release.yml`, which tests, builds and publishes `main.js`, `manifest.json`, `styles.css`. |

### Paired cold/warm core-startup measurement (CI, 60,000 notes)

On 2026-10-04, `npm run bench:startup -- 60000` compared both paths against the exact same synthetic repository fingerprint state; reconciliation reported `none` and both paths produced 60,000 notes / 59,999 links.

- Cold core rebuild: **168.2 ms**
- Warm core restore + fingerprint validation: **538.0 ms**
- Cold/warm ratio: **0.31x** (the warm core path was about 3.2× slower in this isolated benchmark)

This does **not** measure total Obsidian startup or filesystem/frontmatter work. It shows only that semantic-cache restore is not yet justified as a core-graph performance optimization by itself; any warm-start benefit must come from avoided source-read/parse work and must be proven in integrated vault startup measurements before promotion.

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
- **Explore structure of current note**: shows definition/navigation composition (`hasPart`, `hasChild`, `hasState`, `includes`) plus contextual Local Model **part occurrences**. It deliberately does not treat reusable Port/Item Flow notes as the assembly's internal topology; contextual endpoints/connections/flows belong in **Internal** and **Interfaces**. Each note shows up to 12 children; the 80-item limit wins over depth; "+N more" shows what was left out.
- **Explore internal structure of current Object**: occurrence-native view of one Local Model context. The selected Object is the visual boundary; part occurrences sit inside; boundary and part-owned endpoint occurrences are placed around their owning context; local connections join endpoint occurrences; connection-owned flows are summarized on those connections; `exposes` links boundary to internal endpoints. Reusable definitions remain references rather than being flattened into the context.
- **Explore functional view of current note**: starts from an Object or a Function. From an Object it shows the functions it performs, their sub-functions, what precedes or follows them. From a Function it shows who performs it, its parent function and sub-functions, and what comes before and after it. Arrows follow the stored direction; the same limits apply (12 children per note, 80 notes, two levels). Missing functions show as undefined cards. The requirements a function satisfies are in the Requirements view.
- **Explore requirements view of current note**: starts from a Requirement, or from an Object, Function, Design, State, Use Case or Verification. From a Requirement it shows where it sits (owner element and parent requirement), its sub-requirements, what it is derived from and what is derived from it, what it refines or is refined by, what it references, and what satisfies, verifies, applies to or drives it. Function and Design may reach Requirements through `satisfies`; State and State Machine never satisfy Requirements and reach scoped Requirements through inverse `appliesTo`. Other start types use only the relationships valid for their class, and each reached Requirement opens one more level. Arrows follow the stored direction; the same limits apply. Missing requirements and sources show as undefined cards.
- **Explore view of current note…** lists the views that can start from the note's type, with a line on each, and opens the one chosen. Each view also has its own command (**Explore where-used view…**, and so on). Every view uses the same limits (12 children per note, 80 notes), draws arrows in the stored direction, labels every link with its relationship, shows missing notes as undefined cards, and refreshes from **Check whether this view is current**:
  - **Where Used**: from any note, what contains or uses it, three levels up: parent assemblies (`hasPart`), notes that include it, owners, the Object that has a State, a Port or a Design, the Objects that perform a Function, Use Cases it realizes or takes part in, notes that depend on it.
  - **Interfaces**: from an Object, Port or Item Flow definition, combines note-level definition relationships with occurrence-aware topology. From an Object, Local Model endpoint, connection and flow occurrences are materialized without inventing notes; exposure/parent/connection links remain contextual. Starting from a reusable Port or Item Flow definition also shows where that definition occurs.
  - **Verification**: from a Requirement, Verification, Function, Design or State: what verifies a requirement, what else a verification covers, the valid Function/Design satisfiers, and—for a State—the Requirements that apply to that State.
  - **Design**: from an Object, Document or Design: its designs, sub-designs and the requirements each satisfies.
  - **Scenario**: from a Use Case: participants, realizing Functions and Designs, included and optional Use Cases, driven requirements, and the order of the realizing functions.
  - **Behavior**: from a State Machine, State or Object: who has the states, initial and final states, order (`precedes`), nested states, and what triggers a state.
  - **Failure and risk**: from any note: what an Issue or Failure Mode affects, what affects an element, causes (`drives`), and the requirements and performers around the affected functions.
  - **Evidence**: from any note: the Artifacts, Documents and Info notes that describe it or sit under it, and what else each one describes.
- **Note details on click**: on a generated view (a canvas in the views folder), clicking a note opens a popup with its type, id and status, its properties and its relationships (two collapsed dropdowns, with counts; a repeated identical relationship target is shown once with an explicit duplicate marker (never as engineering quantity); a missing note is shown in red and is not clickable) and its rendered text, so the note does not have to be opened. The popup stays on screen while you click other notes; links inside it open in the popup (‹ goes back), **View…** opens the view picker for that note, so a view of any card can be started without leaving the canvas, **Open note** opens the note in a tab, and × or Esc closes it. Clicking an undefined card says it still has to be defined. Shift, Ctrl, Cmd or Alt clicks and drags are ignored, so selecting and moving cards works as before. **Edit** (WB-101) switches the popup into edit mode for the note it shows (off again for every other note): the text becomes a box with **Save text** and **Revert**; subtype is a dropdown of the class's subtypes, status a box that suggests Draft, Active and Retired, tags a comma-separated box, and other simple properties text boxes (type, id, uid, translator-written properties and relationships cannot be edited there, and properties are not added or dropped); each relationship has a ✕ that removes it and its inverse after a confirmation, and **Add relationship…** picks a note and then the relationship, with the rule check. Every edit is one step that **Undo** (or the command **Undo last Workbench edit**) reverses. A save is refused if the note changed since the popup showed it. It can be switched off in the settings. It relies on Canvas internals that Obsidian does not document (a fallback matches the card's position to the canvas file), so recheck it on each Obsidian version; **Check Canvas support** reports whether the card elements are reachable.
- **Check whether this view is current**: compares the open generated view with the model and offers to refresh it.
- **Relate current note to another note**: pick the other note by name (type and id shown beside it), then pick from only the relationships the endpoint rules allow, in either direction. `tracesTo` is offered last, as the provisional relationship (W-288).
- **Undo last relationship change**: reverses both notes of the last relate, and refuses if either note was edited since. Use this, not Cmd/Ctrl-Z, which only undoes one open note and can leave a pair half-written. Give it a hotkey under Settings → Hotkeys. History is kept in memory and clears when Obsidian restarts.
- **Check Canvas support (Phase 0 probe)**
- **Open Review** (also the checklist icon in the ribbon): the whole-vault Review screen. Categories with counts (Provisional Relationships, Missing Inverses, Inverses With No Forward Link, Off-Rule Links, Broken References, Local Model Findings), search plus note-type and relationship filters, and a finding window with Previous / Next. Local Model findings are read-only in 0.1.17. Two findings can be resolved from the window: **Replace relationship** (provisional `tracesTo` → an approved relationship the endpoint rules allow; adds the new link, then removes the old one, so Undo reverses the removal first) and **Write missing inverse**. Everything else offers **Open source** and **Open target** only. The screen follows changes after a one-second pause and lists the first 200 rows of a filter.

Generated views go to `Workbench Views/` (configurable). Add that folder to the vault's `.gitignore` (WB-036).

### Local Model compatibility direction

Workspace decisions W-293/W-294/W-298 and Workbench decision WB-105 add addressable local part occurrences, endpoints, connections, connection-scoped flows and local applicability inside the owning note body.

Workbench treats that content as a separate **Local Model** surface:

- Local Model is distinct from ordinary narrative text, Properties and note-level Relationships.
- W-302/W-319 bound it with managed START/END markers; Workbench must read schema `0.1` and `0.2`, while new writers use `0.2`; the ordinary text editor must exclude/protect that region.
- W-303 gives local records durable `part-*`, `ep-*`, `conn-*`, and `flow-*` IDs independent of visible names.
- W-304 fixes heading + named-field Markdown records. Parts reuse Object/assembly definitions; endpoints reuse Port/interface definitions; nested pins/contacts/sub-interfaces are recursive endpoint records using a parent address.
- W-305 keeps inherited interface members implicit through the reusable definition until a local connection, Requirement target, override, or other contextual reference needs an independently addressable `ep-*` record. Workbench may display inherited members, but must distinguish them from materialized local occurrences.
- W-306 establishes an Obsidian-native-first rule: core Obsidian/standard Markdown/YAML first, broad plugin compatibility second, Workbench-only syntax last. Materialized local records use native Obsidian block IDs equal to their stable local IDs (`^part-*`, `^ep-*`, `^conn-*`, `^flow-*`), so ordinary links such as `[[Owner Note#^ep-42bd90|J4]]` navigate directly to the record without Workbench. Human-facing headings remain readable.
- W-310 constrains local multiplicity: `multiplicity: N` means N contextually interchangeable, non-individually-addressed copies. If any copy needs distinct connections, Requirement applicability, state, override, flow or other local context, Workbench must represent it as its own `part-*` occurrence.
- W-311 makes assembly boundaries authoritative for connection ownership: a parent connects to a child's boundary endpoint, while `exposes` relates that boundary endpoint to the child's internal endpoint. EA BindingConnector/temporary `equals` stays review evidence until confirmed.
- W-312 requires persisted local references (`part`, `parent`, connection endpoints, exposure and temporary local `equals`) to use native Obsidian block links rather than bare IDs.
- W-313/W-319 use vault-side `local-model.yaml`; `0.2` is the canonical writer schema and `0.1` remains readable for backward compatibility as the shared parser/validation contract for importer and Workbench.
- The original WB-106 read/navigation gate is implemented in 0.1.17. WB-114 expands WB-106 into the structured editor gate: Local Model edits go through the semantic transaction/model-edit service, while definition editing remains a distinct canonical-note mode.
- Repeated note-level relationship entries are not engineering quantity; true quantity comes from Local Model `multiplicity`.
- Connection-owned flow records are stored once but indexed and shown from each participating endpoint/interface.
- EA-only provenance is not required by Workbench and lives in the import-evidence `Local Model Source Map.csv` rather than engineering note records.
- High-value views navigate local records rather than flattening them into duplicate note-level links. Structured editing must preserve the same occurrence/definition ownership boundary.

**0.1.17 completes the original WB-106 read/navigation keepability gate.** Workbench reads Local Model regions (schema 0.1 and 0.2), gives records `ModelRef` identity, keeps them in the incremental index, reports findings, and uses them in Structure, Interfaces, Where Used and Requirements. Generated Canvas views show local records as derived cards linked to their native block IDs; Review includes Local Model Findings; a block-targeted relationship stays targeted at the exact occurrence rather than also becoming a note-level edge. WB-114 then expands WB-106 into the structured editor gate. The transaction/edit foundation is now on `main`; it is not considered released merely because the source exists. Links Workbench writes follow W-324: the file name when unique, else the shortest unique path.



## User guide

Engineer-facing operating instructions are in [docs/User Guide/MDSE Workbench User Guide.md](docs/User%20Guide/MDSE%20Workbench%20User%20Guide.md). The controlled Base Vault carries an exact runtime copy for ordinary engineering users. The guide distinguishes pinned runtime behavior from candidate WB-106 capabilities.

## Semantic guardrails

- `relationships.yaml` is authoritative for endpoint validity. View Profiles may select a subset of valid relationships, but must never broaden their allowed endpoint semantics.
- `satisfies` is Function/Design → Requirement only. State and State Machine use Requirement `appliesTo` for scope and are never treated as Requirement satisfiers.
- Workbench model navigation is converging on one common `ModelRef` abstraction for notes and Local Model records; new occurrence-aware traversal, Details, Inherited and Review behavior should use that seam rather than adding path-only special cases.

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
npm run bench:startup -- 60000   # paired cold/warm core-startup comparison on one identical synthetic state
```

`test/fixtures/` holds copies of the vault's relationship, element and Local Model schemas (the current 0.2 authority copy and the frozen 0.1 compatibility copy); `test/localmodel.test.ts` tests the reader against both.

The active build workflow is `.github/workflows/build-artifact.yml`. It runs tests and the TypeScript/bundle build on `main` pushes and pull requests, and synchronizes the checked-in plugin artifact only from a successful `main` push. The current RTA candidate has a confirmed green run (95 tests + build); keep the same gate for every promotion. Historical workflow material under `ci-workflows/`, if retained, is reference only unless explicitly activated.

To release: bump `version` in `manifest.json`, `package.json` and `versions.json`, commit, and push a tag `v<version>`.

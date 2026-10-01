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
- **Explore structure of current note**: follows `hasPart`, `hasChild`, `includes`, `hasPort`, `exposes`, `hasFlow` two levels down as a left-to-right tree. Each note shows up to 12 children; the 80-note limit is shared evenly across each level and wins over depth (WB-082); "+N more" shows what was left out. One label per relationship group, colored by relationship.
- **Check whether this view is current**: compares the open generated view with the model and offers to refresh it.
- **Relate current note to another note**: pick the other note by name (type and id shown beside it), then pick from only the relationships the endpoint rules allow, in either direction. `tracesTo` is offered last, as the provisional relationship (W-288).
- **Undo last relationship change**: reverses both notes of the last relate, and refuses if either note was edited since. Use this, not Cmd/Ctrl-Z, which only undoes one open note and can leave a pair half-written. Give it a hotkey under Settings → Hotkeys. History is kept in memory and clears when Obsidian restarts.
- **Check Canvas support (Phase 0 probe)**
- **Open Review** (also the checklist icon in the ribbon): the whole-vault Review screen. Categories with counts (Provisional Relationships, Missing Inverses, Inverses With No Forward Link, Off-Rule Links, Broken References), search plus note-type and relationship filters, and a finding window with Previous / Next. Two findings can be resolved from the window: **Replace relationship** (provisional `tracesTo` → an approved relationship the endpoint rules allow; adds the new link, then removes the old one, so Undo reverses the removal first) and **Write missing inverse**. Everything else offers **Open source** and **Open target** only. The screen follows changes after a one-second pause and lists the first 200 rows of a filter.

Generated views go to `Workbench Views/` (configurable). Add that folder to the vault's `.gitignore` (WB-036).

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

`test/fixtures/` holds copies of the vault's `relationships.yaml` (schema 1.33) and `element-types.yaml`. Refresh them when the schema changes.

The CI and release workflows are in `ci-workflows/` until the access token can write workflow files; move them to `.github/workflows/` to turn them on.

To release: bump `version` in `manifest.json`, `package.json` and `versions.json`, commit, and push a tag `v<version>`.

# Reference Plugin Findings

## Purpose

During Workbench design, several existing Obsidian plugins were reviewed for implementation patterns.

These projects are references, not required Workbench dependencies.

This note records the useful lessons so future implementation does not have to repeat the initial discovery.

## Semantic Canvas

Repository reviewed: `aarongilly/obsidian-semantic-canvas-plugin`

### Useful evidence

The plugin demonstrates that Canvas relationships can be translated into note-property/frontmatter updates.

Its implementation listens for Canvas edge interactions and writes frontmatter through Obsidian APIs.

### Relevance

Strong proof of concept for:

- Canvas edge → note relationship;
- semantic writeback;
- using Canvas as an editing surface over notes.

### Direction for Workbench

Use the concept, but route all changes through Workbench validation and relationship services.

## Breadcrumbs

Repository reviewed: `michaelpporter/breadcrumbs`

### Useful evidence

Breadcrumbs demonstrates a typed-link graph with:

- relationship vocabulary;
- inverse concepts;
- graph traversal;
- relationship-aware navigation.

### Relevance

Useful architectural reference for graph/index/traversal behavior.

### Direction for Workbench

Core Workbench behavior should not depend on Breadcrumbs being installed.

## Canvas Explorer

Repository reviewed: `hjamet/Canvas-Explorer`

### Useful evidence

The plugin demonstrates gathering notes/links and generating a native `.canvas` file by constructing nodes and edges.

### Relevance

Useful straightforward reference for:

- graph → native Canvas generation;
- creating Canvas artifacts programmatically.

## Advanced Canvas

Repository reviewed: `Developer-Mike/obsidian-advanced-canvas`

### Useful evidence

Advanced Canvas demonstrates deep interaction with Canvas behavior, including event/patch patterns around:

- edge changes;
- selection changes;
- connection dragging;
- node removal;
- popup menus.

### Relevance

Strong technical reference for the future richer graphical interaction layer.

### Licensing caution

The project is GPL-licensed.

Study behavior/patterns carefully, but do not copy GPL code into a differently licensed Workbench unless the project intentionally accepts the resulting licensing obligations.

## Enhanced Canvas

Repository reviewed: `RobertttBS/obsidian-enhanced-canvas`

### Useful evidence

The project demonstrates Canvas editing that can update properties and Markdown links.

### Relevance

Useful reference for bidirectional Canvas/note behavior.

## QuickAdd

Repository reviewed: `chhoumann/quickadd`

### Relevance

Useful UX/workflow reference for fast command-driven creation and guided user actions.

Workbench should own its core creation behavior rather than require QuickAdd at runtime.

## FileClass

Repository reviewed: `mdelobelle/fileclass`

### Relevance

Useful reference for:

- typed properties;
- validated metadata;
- guided input.

Workbench should read its own governed MDSE schema directly for core behavior.

## License check before reuse

Only Advanced Canvas is recorded above as GPL. Before any code or close pattern from a reference project is reused, check that project's license and record the result here; attribution and license terms apply even for permissive licenses.

## Design conclusion

The public plugin ecosystem shows that the major technical building blocks are feasible:

- custom Workbench UI;
- note/frontmatter editing;
- model indexing;
- typed graph traversal;
- native Canvas generation;
- Canvas event interception;
- graphical writeback.

The MDSE-specific value is not inventing those primitives.

The value is integrating them into one controlled engineering interface with:

- MDSE schema validation;
- explicit relationship semantics;
- engineering View Profiles;
- safe model editing;
- review/model-health workflows.

## Dependency principle

Prefer inspiration and permissively licensed reusable patterns where appropriate.

Do not make the correctness of the MDSE model depend on a collection of independently changing community plugins.

## Note for the release path

These references show the building blocks are feasible, not that the Canvas-editing ones are stable. Canvas edge and selection events depend on internals Obsidian does not officially expose (see [[02 - Workbench Decision Log#WB-080 — Relationship service first; Canvas Model Edit is release-gated|WB-080]]). Phase 0 tests this before V1 commits to it.

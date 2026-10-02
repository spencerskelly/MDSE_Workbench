# WB-106 Implementation Contract

## Authority and purpose

This file is the standalone Workbench continuation contract for MDSE v0.8.

The model remains Markdown/YAML in the vault. Workbench is a parser/index/view/editor over that model, never a second model database.

Read the methodology workspace's 2026-10-02 reconciliation and W-315 through W-319 when semantic details are needed.

## Required schema support

Workbench must load three vault schemas:
- `relationships.yaml` 1.35;
- `element-types.yaml` 1.17;
- `local-model.yaml`, reading 0.1 and 0.2.

New structured Local Model writes, when later enabled, write 0.2 only.

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

## Ordinary body editing

The ordinary body editor must never rewrite the governed Local Model region.

Until region-aware editing exists:
- if a governed START marker is present, ordinary body text editing is disabled for that note;
- properties/relationships may still use their governed frontmatter writers where safe.

Later region-aware text editing may edit narrative before/after the governed region while preserving the region byte-for-byte.

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

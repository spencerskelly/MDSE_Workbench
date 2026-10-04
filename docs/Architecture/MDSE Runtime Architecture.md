# MDSE Runtime Architecture and Stability Plan

**Status:** approved direction for the Workbench/Bootstrap runtime architecture, 2026-10-03.

## Purpose

MDSE must remain usable as the engineering model grows to tens of thousands of notes and multiple occurrence-aware views. Startup performance, recovery, validation and view generation are therefore treated as architecture, not as isolated optimizations.

The governing principle is:

> The Markdown/YAML vault and governed Local Model records are authoritative. Every index, cache, finding set and generated view is derived, disposable, versioned and recoverable.

## Runtime boundaries

### Bootstrap

Bootstrap protects the runtime environment. It owns:

- vault identity and release identity checks;
- author registration;
- controlled-plugin integrity and activation checks;
- Obsidian/core-plugin compatibility;
- concise release-health status and recovery guidance.

Bootstrap must remain small. It does not build or interpret the engineering model.

### Workbench

Workbench owns one semantic model service for:

- reusable MDSE notes;
- Local Model part/endpoint/connection/flow occurrences;
- relationship resolution;
- validation;
- Where Used and reverse indexes;
- occurrence-aware views;
- semantic edit transactions/history;
- later configuration evaluation and engineering analyses.

Individual views must query this shared model service rather than reparsing the vault independently.

## Startup states

Workbench uses explicit runtime states rather than one blocking startup operation:

1. **Starting** — commands, settings, listeners and status UI are registered. No vault-wide model traversal is required.
2. **Restoring** — a compatible persistent derived cache is loaded when available.
3. **Ready** — useful model queries can run from restored state.
4. **Reconciling** — changed files since the cached state are parsed incrementally in bounded batches.
5. **Verified** — requested or scheduled global checks are current.
6. **Rebuild required** — cache/schema/tool incompatibility requires a disposable cache rebuild.

Ready and Verified are intentionally different. Engineers may work while reconciliation or global verification continues.

## Persistent derived cache

Workbench will maintain a local cache under its plugin data area. It is never committed to Git and never becomes model authority.

The cache must:

- have an explicit cache-format version;
- record compatible Workbench/parser and schema versions;
- retain file fingerprints sufficient to identify changed files;
- support atomic replacement so interrupted shutdown cannot corrupt the only usable state;
- be sharded or otherwise bounded rather than one fragile monolithic file at large model sizes;
- be safe to delete at any time;
- never cause model files to be rewritten during restoration.

When compatibility is uncertain, Workbench discards the cache and rebuilds it.

## Incremental reconciliation

For each indexed Markdown file, Workbench retains lightweight change evidence such as path, modification time, size and—where required—a content fingerprint.

On warm startup:

1. restore compatible derived state;
2. compare current files to cached fingerprints;
3. remove deleted paths;
4. parse only new/changed files;
5. update affected forward/reverse relationships and Local Model references;
6. yield between bounded work batches so Obsidian remains responsive.

A large Git pull may produce a large reconciliation queue, but it must not force the UI to wait for a single unbroken full-vault loop.

## Validation strategy

Validation is split by scope.

### Immediate/local validation

Changes to one note or Local Model context immediately validate the affected neighborhood: schema/type compatibility, local identity, part/parent references, connections, flows, exposure and directly affected relationships.

### Global assurance

Expensive whole-vault checks are asynchronous, idle-time or explicit operations:

- global identity collision scan;
- full inverse/reconciliation audit;
- full Local Model validation;
- release-integrity revalidation;
- exhaustive Review refresh.

Opening the vault must not depend on completing these checks.

## Generated views

Views are demand-driven projections of the semantic index.

- Do not pre-generate views at startup.
- A view has a semantic signature and may be marked stale when inputs change.
- Regeneration is explicit or demand-driven.
- Stable ModelRef/local IDs preserve curated Canvas geometry for surviving nodes.
- Canvas geometry is never semantic authority.
- Manually drawn geometry is never silently interpreted as MDSE relationships.

## Bootstrap integrity optimization

The controlled-release hash contract remains authoritative. Long term Bootstrap may cache successful file verification using lock identity plus safe file-change evidence, but any suspected change forces the real SHA-256 check.

A full unconditional verification command remains available.

This improves startup cost without weakening release integrity.

## Plugin strategy

Third-party plugins remain only while they provide unique engineering/user value. As Workbench absorbs a capability reliably, the release should reconsider whether the corresponding dependency is still needed.

The goal is not the smallest plugin count at any cost; it is the smallest dependable runtime surface that preserves the desired engineering experience.

## Graceful degradation

Failure must be scoped.

- Workbench failure never makes Markdown unreadable.
- Cache corruption triggers cache replacement/rebuild, not model repair.
- Unsupported Local Model versions remain readable as Markdown while structured behavior is disabled.
- One malformed note produces findings for that note rather than disabling the whole vault.
- Canvas-internal API breakage may degrade interaction, but not the model.
- Schema migration is explicit, previewable and never a startup side effect.

## User-facing health model

The runtime should converge on a concise MDSE health surface with dimensions such as:

- vault identity;
- author identity;
- release integrity;
- model cache;
- schema compatibility;
- Local Model health;
- global Review state;
- Git/conflict state when available.

Normal display should be compact, for example **MDSE ✓**, **MDSE · syncing 23**, or **MDSE · 2 issues**. Detail is shown on demand.

## Recovery contract

Derived subsystems must have supported recovery actions:

- Rebuild model cache/index;
- Refresh current generated view;
- Check Local Model;
- Run full model review;
- Verify controlled release fully.

Users should not need to delete arbitrary Obsidian files as routine troubleshooting.

## Performance gates

Measure at minimum:

- first/cold startup;
- warm startup with no model changes;
- warm startup with a handful of changes;
- startup after a large Git pull;
- cache corruption/recovery;
- schema/cache-version change;
- full rebuild;
- Local Model check;
- representative Structure/Internal/Physical/Functional/Where Used views.

Test on small, medium and full-size vaults and on the slowest supported team computer.

Initial product targets:

- Workbench commands/status available immediately after plugin load;
- warm cached semantic state available in roughly 1–2 seconds on supported hardware;
- reconciliation runs in bounded background batches;
- no automatic full model validation as a prerequisite to work;
- no UI freeze from a long unyielding Workbench loop.

Targets are acceptance budgets, not promises until measured on the real model.

## Delivery plan

### RTA-1 — Runtime observability and boundaries

- explicit Workbench runtime status;
- architecture document and decision;
- no expensive new work in plugin onload;
- retain bounded/yielding full rebuild as recovery.

### RTA-2 — Persistent cache foundation

- cache-format contract;
- serializable semantic records;
- atomic local cache store;
- cache compatibility/invalidation tests;
- cache excluded from Git.

### RTA-3 — Warm restore and incremental reconciliation

- restore previous semantic state;
- file fingerprints/change journal;
- reconcile only changed/new/deleted files;
- bounded scheduler/yielding;
- visible progress.

### RTA-4 — Validation scheduler

- dependency-aware local validation after edits;
- global assurance jobs explicit/idle;
- Review freshness/status.

### RTA-5 — Bootstrap startup optimization

- separate quick startup check from unconditional full hash verification;
- safely reuse prior integrity proof only when locked inputs are unchanged;
- preserve full-verify command and W-322/W-331 integrity.

### RTA-6 — View/runtime consolidation

- Physical, Internal, Functional, Interfaces, Requirements, Where Used and later analyses query the same semantic index;
- remove duplicate parsing/traversal paths;
- preserve curated view geometry.

### RTA-7 — Dependency and rollout hardening

- review third-party runtime dependencies;
- corruption/interruption tests;
- macOS/Windows tests;
- slow-machine performance gate;
- documented recovery paths.

## Current implementation step

RTA-1 is implemented at source level: Workbench exposes explicit startup/indexing/ready status and retains the current chunked full rebuild as the safe fallback.

RTA-2 foundation is now implemented at source/test-contract level but is **not yet enabled at runtime**:
- `src/core/cache.ts` defines cache format v1, strict schema/parser compatibility, deterministic serialization/restoration, bounded note/Local Model shards, corruption refusal and file-fingerprint reconciliation planning;
- `src/core/cache-storage.ts` defines manifest-last generation persistence so a partially written next generation never becomes authoritative;
- `test/cache.test.ts` and `test/cache-storage.test.ts` cover JSON round-trip, schema invalidation, malformed data, sharding, mixed/partial generations, deterministic reconciliation and manifest-last behavior;
- generated Base Vaults now ignore `.obsidian/plugins/mdse-workbench/cache/`.

The next step is to run/typecheck this foundation in the standalone Workbench build, then add the thin Obsidian storage adapter and wire **save-only cache generation first**. Warm restore remains disabled until that write path is proven, so no startup behavior depends on unvalidated cached data.

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
3. **Ready (core)** — reusable-note/relationship queries can run from restored state or the metadata-only cold-build core.
4. **Hydrating Local Model** — only candidate note bodies are parsed in bounded background batches; occurrence-aware consumers wait explicitly for this phase.
5. **Reconciling** — changed files since the cached state are parsed incrementally in bounded batches.
6. **Verified** — requested or scheduled global checks are current.
7. **Rebuild required** — cache/schema/tool incompatibility requires a disposable cache rebuild.

Ready and Verified are intentionally different. Engineers may work while reconciliation or global verification continues.

## Persistent derived cache

Workbench will maintain a local cache under its plugin data area. It is never committed to Git and never becomes model authority.

The cache must:

- have explicit storage-format and semantic-parser contract versions;
- bind to the initialized `vault_uid`;
- record relationship/element schema versions **and** a deterministic signature of the parsed schema semantics, so an accidental rule change without a version bump cannot silently reuse stale state;
- retain cheap file fingerprints sufficient to identify changed files: semantic-cache v3 uses Obsidian FileStats ctime + mtime + size, with optional stronger content hashes available for future edge cases;
- be sharded or otherwise bounded rather than one fragile monolithic file at large model sizes;
- use stable path-hash bucket identities so unrelated path insertions do not reshuffle the entire persisted cache and future dirty-bucket persistence can update only affected buckets;
- use two bounded A/B commit slots with generation tokens: shards are written first, the slot manifest last, and the opposite slot remains a complete fallback if a write is interrupted;
- order committed cache slots with a monotonic local sequence number rather than wall-clock time, so clock rollback cannot make an older generation appear newer;
- be safe to delete at any time;
- never cause model files to be rewritten during restoration.

When compatibility is uncertain, Workbench discards the cache and rebuilds it.

## Incremental reconciliation

For each indexed Markdown file, Workbench retains lightweight change evidence: path plus Obsidian FileStats ctime, mtime and size. An optional content hash remains available where a future environment demonstrates that filesystem timestamps are insufficient.

On warm startup:

1. restore compatible derived state;
2. compare current files to cached fingerprints;
3. parse changed/new files in bounded batches and remove deleted paths;
4. when the path set changes, re-resolve cached authored relationship links for unchanged notes through Obsidian's current metadata cache rather than rereading those Markdown bodies;
5. update affected forward/reverse relationships, broken references, duplicate-source evidence and Local Model frontmatter targets;
6. yield between bounded work batches so Obsidian remains responsive.

Semantic-cache v2 retains the authored relationship field, original wikilink text and Obsidian linkpath for each governed relationship link. This means a new/deleted/renamed note can safely trigger metadata re-resolution of otherwise unchanged notes without assuming that the old resolved target is still correct. Large change sets still use the proven full chunked rebuild.

A large Git pull may therefore choose a full chunked rebuild, but it must not force the UI to wait for a single unbroken processing loop.

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
- Review/global findings cached by semantic revision rather than recomputed on every UI refresh;
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

RTA-2 foundation is implemented through the save-only runtime boundary, and RTA-3 has advanced into bounded warm-reconciliation preview:
- `src/core/cache.ts` defines cache format v1 plus semantic-parser contract v3, vault binding, parsed-schema semantic signatures, deterministic serialization/restoration, bounded note/Local Model shards, corruption refusal, ctime+mtime+size reconciliation fingerprints and the bounded reconciliation policy;
- `src/core/cache-storage.ts` uses two fixed A/B slots with unique generation tokens. Each target slot writes shards first and its manifest last; a partial/torn target slot cannot displace the opposite complete slot, disk usage is bounded, and a monotonic commit sequence prevents system-clock rollback from selecting stale cache state;
- `src/obsidian/cache.ts` is the thin Obsidian storage adapter;
- Workbench now writes the cache **after it is already Ready**, after a short quiet period. Cache-write failure is diagnostic only and cannot make the model unavailable;
- semantic-cache v2 retains authored relationship-link evidence, allowing added/deleted/renamed Markdown paths to reconcile safely by re-resolving unchanged notes through Obsidian metadata instead of rereading their bodies;
- **MDSE Workbench: Inspect semantic cache** performs a read-only restore/compatibility/reconciliation check;
- an opt-in **Warm cache preview** can now restore validated cache state and reconcile bounded path/content changes after Obsidian's metadata pass; controlled bases keep this off until representative runtime acceptance passes;
- the indexer now discards pre-build metadata-event backlog at the start of a full build because that state is already captured by the build, preventing a redundant second whole-vault rebuild after Obsidian's startup metadata burst;
- diagnostics report startup quiet-wait time, index time and cache-write time;
- generated Base Vaults ignore `.obsidian/plugins/mdse-workbench/cache/`.

RTA-5 has also begun safely in Bootstrap 0.3.1: safe activation repair and its immediately following release check now reuse one in-session integrity scan instead of hashing every locked plugin file twice. Persistent cross-start hash reuse is still deferred because it must not weaken W-322/W-331 integrity.

The standalone source gate is now green: GitHub Actions passed **95/95 tests and the TypeScript/bundle build** at commit `2c5e8f5`, then produced built-artifact commit `d05aa2a`. The exact 0.1.17 artifact has been installed into the disposable `261002083` integration vault with its plugin-lock hashes aligned.

RTA-3 source is also present behind the default-OFF **Warm cache preview** gate: a validated restored index can be installed, small stable-path changes reconcile in bounded batches, path-set/large-burst/concurrent ambiguity falls back to the proven full rebuild, and startup/rebuild requests are serialized. **This is not promoted behavior yet.**

The next gate is runtime acceptance in Obsidian using `docs/Testing/RTA Startup and Semantic Cache Test Sheet.md`: first prove save-only cache/inspection and normal full-build equivalence, then enable Warm cache preview in the disposable vault and compare no-change/small-change/path-change behavior against a manual full rebuild.


## RTA-4 implementation note — W-346

Workbench now carries a monotonic in-session semantic revision. Review recomputes whole-index plus Local Model assurance only when that revision changes, unless the engineer explicitly forces **Refresh**. The same revision is used to coalesce disposable semantic-cache persistence: unchanged semantic state is not rewritten, cache writes wait for quiet time and a minimum interval, and a semantic change during a write causes a later generation instead of blocking editing.

This is the first RTA-4 step. Dependency-scoped immediate validation and a fuller assurance freshness surface remain to be implemented.


## W-351 stable-bucket persistence foundation

Sequential sorted cache shards were replaced before promotion. They were simple, but inserting or renaming a path could shift many later records into different shard files and make incremental persistence inherently noisy.

Cache container v3 now uses deterministic path-hash buckets for:
- note semantic records;
- Local Model regions;
- file fingerprints.

The manifest contains only bounded bucket metadata rather than the full fingerprint table. Bucket identity remains stable when unrelated files are added. The current A/B writer still writes a complete inactive slot for the strongest recovery behavior while acceptance testing is underway. The stable bucket contract is the prerequisite for a later dirty-bucket writer; that optimization must preserve the same manifest-last and fail-closed recovery guarantees.


## W-352 staged cold-build readiness

A cold/full rebuild no longer needs to serialize ordinary note navigation behind every Local Model body read.

The full-build path now:
1. builds file fingerprints and reusable-note/relationship semantics from Obsidian metadata;
2. publishes that core state as usable;
3. collects only notes that metadata indicates may contain a governed Local Model;
4. hydrates those bodies in bounded background batches.

Occurrence-aware views, global assurance and semantic-cache persistence call the Local Model settle barrier before consuming contextual semantics. The status surface reports pending Local Model hydration while the core graph remains usable. Epoch/revision guards prevent stale asynchronous reads from overwriting a later edit/rebuild.


## RTA-4 implementation note — W-349 to W-352

The runtime now separates three concerns that previously risked being conflated:

- **Assurance:** one shared revision-scoped service owns whole-model findings and Local Model validation. Review and Diagnostics consume the same snapshot.
- **Health:** one lightweight runtime-health summary reports startup/sync/cache/schema/read state from already-known data only. It never triggers assurance.
- **Live indexing:** rapid editor/metadata events are coalesced per path for 250 ms before semantic reparsing, preventing repeated Local Model body reads during a typing burst. Bursts at the existing 300-path threshold deliberately fall back to the quiet-time full rebuild.

The user-facing consequence is intentional: **runtime health** answers “is the tool/model service working?”, while **Review** answers “what engineering/model findings exist?”. Engineering findings do not make the runtime itself appear broken.


## RTA-2/RTA-3 implementation note — W-353

Warm restoration now reads sharded cache families with bounded parallelism rather than one long serial chain or an unbounded read burst. Fingerprint, note and Local Model shards each use a small worker pool; together they cap concurrent cache reads while overlapping independent I/O. This is intended to reduce warm-start latency without recreating the same startup contention the cache architecture is meant to avoid.


## RTA-1/RTA-4 implementation note — W-354 staged capability readiness

Workbench now treats readiness as a capability boundary rather than one all-or-nothing startup state.

- **Core ready:** schemas plus reusable-note semantic graph are available. Ordinary note navigation and views that do not require occurrence data may run immediately.
- **Occurrence loading:** governed Local Model bodies are deliberately deferred until after core readiness. They begin after a short background delay or immediately when an occurrence-aware consumer asks for them.
- **Occurrence ready:** Internal, Structure, Interfaces, Where Used and Requirements can use complete Local Model occurrence semantics.
- **Assurance ready:** whole-model Review/validation remains demand-driven and revision-scoped.
- **Persistence ready:** semantic-cache writes remain later background work and never define engineering authority.

Cold-start runtime evidence no longer forces Local Model hydration simply to record a startup sample. Functional, Design, Verification, Scenario, Behavior, Failure/risk and Evidence views do not wait on Local Model hydration because their current semantics do not consume occurrence records.


## Stability-first startup refinements — W-355 to W-358

The startup policy now explicitly favors vault responsiveness over minimum feature latency.

- Heavy MDSE tasks are staggered into separate lanes: Obsidian/UI, Workbench core, occurrence hydration, cache persistence, then Bootstrap full verification.
- Long Workbench loops use elapsed-time cooperative slices rather than fixed item counts, so slower hardware yields more often.
- Deferred occurrence work is activity-aware and waits while the engineer is actively editing unless an occurrence-aware command explicitly requests it.
- Runtime-health observation is side-effect free and cannot start deferred work.
- Core startup, background occurrence processing, cache persistence and global assurance each have separate fault boundaries. A failure in one derived subsystem must not be presented as successful verification and must not destabilize ordinary Obsidian use.

The resulting design intentionally accepts that some MDSE capabilities may become ready seconds after the vault itself is usable.

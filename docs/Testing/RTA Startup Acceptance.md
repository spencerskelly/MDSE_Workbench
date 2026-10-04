# RTA Startup / Semantic Cache Acceptance

**Purpose:** validate W-343 through W-345 in a disposable integration vault before warm restore is promoted into the controlled Base Vault.

Use a disposable repository only. The Markdown/YAML model remains authoritative throughout this test.

## Preconditions

- Workbench candidate artifact built by GitHub Actions from standalone source.
- `.obsidian/plugin-lock.yaml` matches the installed Workbench artifact.
- `.vault.yaml` has an initialized `vault_uid`.
- `MDSE Bootstrap` reports no Workbench hash/version drift.
- Workbench setting **Warm cache preview** starts OFF.
- `.obsidian/plugins/mdse-workbench/cache/` is git-ignored.
- Installed candidate uses semantic-cache v3 fingerprints (`ctime + mtime + size`).

Record Workbench **Show diagnostics** after each startup.

## A. Cold full build / save-only cache

1. Delete the disposable semantic cache with **MDSE Workbench: Clear semantic cache**.
2. Ensure **Warm cache preview** is OFF.
3. Restart Obsidian.
4. Wait for **MDSE Workbench: ready**.
5. Open **Show diagnostics**.
6. After the vault is quiet for a few seconds, run **Inspect semantic cache**.

Pass:
- index mode = `full`;
- Workbench remains responsive during indexing;
- cache write succeeds after Ready, not before;
- Inspect semantic cache shows the current vault UID-compatible cache;
- no model files changed merely because the cache was written.

## B. Warm no-change restore

1. Enable **Warm cache preview**.
2. Restart Obsidian without changing model files.
3. Open **Show diagnostics**.

Pass:
- cache is accepted;
- startup finishes in `restored` or `reconciled` mode without a full vault body scan;
- pending change count is zero;
- model counts/links match section A;
- Internal/Structure/Where Used still resolve correctly.

## C. One content-only change

1. Change one ordinary model note without adding/removing/renaming files.
2. Restart Obsidian.
3. Record diagnostics and inspect the cache.

Pass:
- exactly the changed path is identified (subject to Obsidian metadata housekeeping); a ctime-only change must also be treated as changed;
- startup mode is `reconciled`;
- unchanged note bodies are not reparsed by Workbench;
- relationships and Local Model content for the changed note are current;
- new cache generation is written after Ready.

## D. Add a model note

1. Add one new model note that changes how a wikilink could resolve (use a duplicate basename in another folder if practical).
2. Restart Obsidian.

Pass:
- the new file is parsed;
- cached authored relationship links on unchanged notes are re-resolved through current Obsidian metadata;
- any changed relationship target/broken-reference state is correct;
- no blanket unchanged-body reread is required;
- mode remains `reconciled` while within the incremental threshold.

## E. Rename a referenced note

1. Rename one referenced model note in Obsidian.
2. Restart Obsidian.

Pass:
- old path is removed and new path is parsed;
- authored links are re-resolved;
- unresolved/broken/reference state matches what Obsidian actually resolves;
- Workbench does not retain stale old-path edges.

## F. Delete a referenced note

1. Delete one disposable referenced note.
2. Restart Obsidian.

Pass:
- deleted path disappears from the semantic index;
- unchanged authored links that targeted it become broken/unresolved when appropriate;
- Review/diagnostics reflect the new broken reference state;
- no stale reverse edge remains.

## G. Cache corruption fallback

1. With Obsidian closed, damage only the newest cache slot (one shard or manifest) under `.obsidian/plugins/mdse-workbench/cache/`.
2. Reopen Obsidian.

Pass:
- Workbench either uses the intact opposite A/B slot or rejects the cache and performs a full rebuild;
- no model file is repaired/rewritten because cache data was bad;
- Workbench becomes usable without manual cache surgery.

Then run **Clear semantic cache** and confirm recovery is straightforward.

## H. Large-change fallback

Create or pull more changes than the bounded incremental threshold (currently 300 total changed/added/deleted Markdown paths), or simulate an equivalent disposable change set.

Pass:
- Workbench deliberately chooses the chunked `full` rebuild;
- the UI yields during work rather than freezing in one unbounded operation;
- the resulting semantic model matches the vault;
- a new cache generation is saved after Ready.

## I. Occurrence-view regression

After the cache tests, open the WB-106 fixture and verify:

- Internal Structure uses Local Model part/endpoint/connection/flow occurrences;
- reusable Port notes are definitions, not the contextual topology;
- local `exposes` is visible;
- connection and flow labeling remains correct;
- curated Internal Canvas placement survives semantic refresh for stable local IDs.

## J. Stability-first staged readiness

1. Clear the semantic cache and leave **Warm cache preview** OFF.
2. Restart Obsidian and interact with ordinary notes as soon as the vault UI appears.
3. Observe Workbench status through core indexing and deferred occurrence loading.
4. As soon as Workbench shows core readiness, open a Functional or Design view.
5. While occurrence data is still queued/loading, perform a small ordinary note edit.
6. Then open an Internal view.

Pass:
- Obsidian remains usable before Workbench core is ready;
- Workbench reports core readiness separately from occurrence readiness;
- Functional/Design does not wait for Local Model hydration;
- queued occurrence work does not prevent ordinary note editing;
- background occurrence hydration yields/pauses when foreground activity resumes;
- opening Internal promotes the occurrence task and waits for complete occurrence semantics;
- runtime health observation does not itself start occurrence hydration or assurance;
- no unhandled error is shown if a derived subsystem is unavailable.

## K. Runtime fault containment

Use only a disposable test setup and reversible faults.

Pass:
- invalid/missing cache causes fallback/rebuild, not model changes;
- a Local Model read/processing issue is reported as an occurrence/runtime-health issue while ordinary Markdown remains usable;
- a global assurance failure is shown as **assurance unavailable**, never as zero findings;
- a Workbench core startup error leaves Obsidian usable and offers explicit recovery;
- only one cache write / assurance scan / full index operation can own that subsystem at a time.

## Acceptance record

Record:
- Obsidian version / OS;
- vault note count;
- cold startup quiet wait;
- time to core ready;
- cold full index time;
- occurrence hydration queued/start/complete behavior;
- warm restore/reconciliation time;
- cache write time;
- JavaScript heap (diagnostics);
- result for A through I;
- any incorrect relationship resolution or UI freeze.

Warm restore must remain default-OFF in the controlled Base Vault until these cases pass on the disposable integration vault and then on a representative larger imported vault.

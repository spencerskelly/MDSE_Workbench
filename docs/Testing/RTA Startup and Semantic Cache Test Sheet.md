# RTA Startup and Semantic Cache Test Sheet

**Status:** pre-release acceptance sheet for W-343/W-344 runtime architecture. Run against a built Workbench candidate in an **initialized disposable/integration vault**. The Markdown/YAML vault remains authoritative throughout this sheet.

Record:
- Workbench commit/version:
- Vault/repository:
- Obsidian version:
- OS/machine:
- Date:

Do not promote warm restore because source exists. The candidate must first pass `npm test` and `npm run build`, then this sheet.

## A. Cold start and save-only cache

- [ ] Start with `.obsidian/plugins/mdse-workbench/cache/` absent.
- [ ] **Warm cache preview** is OFF.
- [ ] Open the vault.
- [ ] Status progresses through starting/waiting/indexing/ready without an application freeze.
- [ ] **Show diagnostics** reports `Index mode: full`.
- [ ] Record **Startup quiet wait**: ______
- [ ] Record **Index build**: ______
- [ ] A few seconds after Ready, diagnostics reports a semantic-cache save and its write time: ______
- [ ] Cache files are only below `.obsidian/plugins/mdse-workbench/cache/`; `git status` does not show them.
- [ ] **Inspect semantic cache** opens and reports the expected cached note/Local Model counts.
- [ ] With no model changes after the save, Inspect reports: changed 0, added 0, deleted 0, safe mode `none`.

## B. Cache is derived and disposable

- [ ] Run **MDSE Workbench: Clear semantic cache** and confirm that it reports only derived state was removed.
- [ ] Close/reopen with Warm cache preview OFF.
- [ ] Workbench performs a normal full build and becomes Ready.
- [ ] No Markdown/YAML model file changed because the cache was missing.
- [ ] A new cache is written after Ready.

## C. Cache compatibility

For each case, restore the original file before continuing.

- [ ] Copy a cache from another initialized MDSE vault. **Inspect semantic cache** refuses it because `vault_uid` differs.
- [ ] Change a schema rule without changing its schema version. Inspect refuses the old cache because the parsed semantic schema signature differs.
- [ ] Restore the schema. A newly written cache becomes inspectable again.
- [ ] Corrupt one cache manifest. Inspect/read falls back to the other complete A/B slot when one exists.
- [ ] Corrupt a shard in the newest slot. The other complete slot is used.
- [ ] If both slots are made unreadable, Workbench treats the cache as unavailable and the model remains usable through the normal full build.

## D. Warm cache preview — no model changes

Enable **Settings → MDSE Workbench → Warm cache preview**.

- [ ] Close/reopen Obsidian with a valid cache and no Markdown changes.
- [ ] Workbench becomes Ready with an index mode of `reconciled` rather than `full`.
- [ ] Record startup quiet wait: ______
- [ ] Record reconciliation/index time: ______
- [ ] Model-note count and authored-link count equal the preceding full-build run.
- [ ] Internal/Structure/Interfaces/Requirements views on the same sample notes match the full-build result.
- [ ] Review category counts match the full-build result.
- [ ] Check Local Model counts/findings match the full-build result.

## E. Warm cache preview — stable-path content changes

With Obsidian closed, edit one existing Markdown file without renaming it.

- [ ] Reopen.
- [ ] Warm preview reports/reconciles one changed path rather than doing a full rebuild.
- [ ] The changed note's properties/relationships/Local Model appear correctly.
- [ ] Any affected Where Used / reverse relationship query reflects the change.
- [ ] Record reconciliation time: ______

Repeat with a small batch (for example 20 existing files):

- [ ] The batch reconciles incrementally.
- [ ] Obsidian remains responsive while it reconciles.
- [ ] Counts/views match a subsequent manual **Rebuild index**.

## F. Path-set safety fallback

Each case must use the full-build fallback because unchanged wikilinks may resolve differently.

- [ ] Add a new Markdown note before startup → diagnostics ends in `full` mode.
- [ ] Delete a Markdown note before startup → `full`.
- [ ] Rename/move a Markdown note before startup → `full`.
- [ ] After each case, Review/link resolution matches a manual full rebuild.

## G. Large-change fallback

- [ ] Change more files than the current incremental threshold.
- [ ] Warm preview chooses `full` instead of attempting a huge incremental replay.
- [ ] The full build remains chunked/responsive.

## H. Concurrent-change safety

During startup reconciliation, edit/save another existing note.

- [ ] Workbench does not run overlapping startup/rebuild operations.
- [ ] The concurrent change is either reconciled in the bounded retry or causes the safe full-build fallback.
- [ ] Final model state matches a manual Rebuild index.

While Workbench is waiting/indexing, invoke **Rebuild index**:

- [ ] Only one initialization runs at a time.
- [ ] At most one follow-up rebuild is queued.

## I. Local Model shared-index behavior

- [ ] Run **Check Local Model** after Workbench is Ready.
- [ ] It uses the maintained Local Model index and returns substantially faster than a redundant whole-vault reread would.
- [ ] Counts/findings match a fresh full build.
- [ ] Edit a Local Model owner note; after indexing settles, Check Local Model reflects the edit.

## J. Recovery and model-authority proof

- [ ] Disable Workbench: model Markdown and native block links remain usable.
- [ ] Use **Clear semantic cache**: no model data is lost and no arbitrary `.obsidian` cleanup is required.
- [ ] Put malformed JSON in both cache manifests: Workbench falls back safely; no model file is rewritten.
- [ ] Put an unsupported/future Local Model version in a test note: Markdown remains readable and structured handling is refused rather than guessed.
- [ ] `git diff` shows no semantic model edit caused merely by startup, cache restore, cache inspection or cache recovery.

## K. Performance record

Record on at least:
- a small test vault;
- the representative integration vault;
- the full imported vault when available;
- the slowest supported team computer.

| Case | Notes | Cold/full | Warm/no change | 1 changed | 20 changed | Cache write | Check Local Model |
|---|---:|---:|---:|---:|---:|---:|---:|
| Small | | | | | | | |
| Integration | | | | | | | |
| Full import | | | | | | | |
| Slowest team PC | | | | | | | |

## Acceptance boundary

Warm restore may become a default controlled-runtime capability only when:

- automated test/typecheck/build passes;
- cache corruption/invalidation tests pass;
- this sheet passes on representative macOS and Windows systems;
- warm results equal a full rebuild for the sampled views/findings/counts;
- no startup/cache action writes model semantics;
- fallback behavior remains obvious and recoverable.

Until then, **Warm cache preview stays OFF by default**.

/**
 * Feeds the pure ModelIndex from Obsidian's own metadata cache (works on desktop and mobile,
 * WB-087). Builds in chunks so Obsidian stays responsive (WB-081).
 */
import { App, getLinkpath, TFile } from "obsidian";
import { ModelIndex, type AuthoredRelationshipLink, type NoteRecord } from "../core/model";
import type { FileFingerprint, ReconciliationPlan, RestoredSemanticState } from "../core/cache";
import { LocalModelIndex, parseLocalModel, type LocalFinding } from "../core/localmodel";
import { resolveAuthoredRelationshipLinks } from "../core/relationship-resolution";
import { CooperativeBudget } from "../core/cooperative";
import type { Schema } from "../core/schema";

const CHUNK = 500;
const LOCAL_BLOCK_PREFIX = /^(part|ep|conn|flow)-/;
/** Outside changes within one burst before a full rebuild is scheduled (WB-086). */
const BURST_REBUILD = 300;
/** Quiet time before a scheduled rebuild runs, so a pull or first-time indexing finishes first. */
const QUIET_MS = 3000;
/** Coalesce rapid editor/metadata events before reparsing one note body. */
const LIVE_DEBOUNCE_MS = 250;
const WORK_SLICE_MS = 12;
const yieldToUi = () => new Promise<void>((resolve) => window.setTimeout(resolve, 0));

export interface BuildStats {
  mode: "full" | "restored" | "reconciled";
  files: number;
  notes: number;
  elements: number;
  links: number;
  ms: number;
  builtAt: number;
}

/**
 * Startup rule: Obsidian reports every note as "changed" while it builds its own cache the
 * first time a vault opens (tens of thousands of events). Changes arriving before the first
 * build, or during any build, are only remembered and applied once after it. A burst of
 * outside changes schedules one rebuild after things go quiet; builds never overlap.
 */
export class Indexer {
  index: ModelIndex;
  /** Parsed governed Local Model regions used by occurrence-aware views (WB-106). */
  local = new LocalModelIndex();
  stats: BuildStats | null = null;
  /** Cheap file evidence persisted with the disposable semantic cache. */
  readonly fingerprints = new Map<string, FileFingerprint>();
  private running: Promise<BuildStats> | null = null;
  private readonly dirty = new Set<string>();
  /** Startup metadata-cache churn is ignored until Workbench deliberately begins model reconciliation. */
  private liveChanges = false;
  private burst = 0;
  private burstStarted = 0;
  private timer: number | null = null;
  /** Prevents a slower cachedRead from overwriting a newer Local Model edit. */
  private readonly localRevision = new Map<string, number>();
  /** Body reads started by incremental Local Model updates; consumers can wait for semantic consistency. */
  private readonly pendingLocalReads = new Set<Promise<void>>();
  /** Monotonic in-session semantic revision used to coalesce disposable cache writes. */
  private semanticRevision = 0;
  /** Paths whose derived cache buckets no longer match the last committed cache generation. */
  private readonly cacheDirtyPaths = new Set<string>();
  /** Cold-build Local Model hydration is deliberately decoupled from core note-graph readiness. */
  private hydrationEpoch = 0;
  private hydrationTask: Promise<void> | null = null;
  private deferredHydrationFiles: TFile[] = [];
  private deferredHydrationEpoch = 0;
  private hydrationRemaining = 0;
  private hydrationStartedAt: number | null = null;
  private lastHydrationMsValue: number | null = null;
  private lastHydrationCandidatesValue = 0;
  /** Read failures are scoped findings; they never make ordinary Markdown unusable. */
  private readonly localReadErrors = new Map<string, string>();
  /** Rapid live edits are coalesced so one keystroke burst does not trigger repeated Local Model body reads. */
  private readonly livePending = new Set<string>();
  private liveApplyTimer: number | null = null;
  private liveApplyTask: Promise<void> | null = null;
  /** Path-set changes can alter Obsidian wikilink resolution in otherwise unchanged notes. */
  private relationshipResolveTimer: number | null = null;
  private relationshipResolveTask: Promise<void> | null = null;
  private relationshipResolvePending = false;

  constructor(private readonly app: App, private schema: Schema) {
    this.index = new ModelIndex(schema);
  }

  get building(): boolean {
    return this.running !== null;
  }

  get rebuildPending(): boolean {
    return this.timer !== null;
  }

  get revision(): number {
    return this.semanticRevision;
  }

  get localHydrationPending(): number {
    return this.hydrationRemaining + this.deferredHydrationFiles.length;
  }

  get liveUpdatePending(): number {
    return this.livePending.size + (this.liveApplyTask ? 1 : 0);
  }

  get lastLocalHydrationMs(): number | null {
    return this.lastHydrationMsValue;
  }

  get lastLocalHydrationCandidates(): number {
    return this.lastHydrationCandidatesValue;
  }

  get localReadErrorCount(): number {
    return this.localReadErrors.size;
  }

  localReadFindings(): LocalFinding[] {
    return [...this.localReadErrors.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([path, message]) => ({
        code: "local.read-failed",
        severity: "error" as const,
        message: `Could not read this note's Local Model body: ${message}`,
        path,
      }));
  }

  private bumpRevision(path?: string): void {
    this.semanticRevision++;
    if (path) this.cacheDirtyPaths.add(path);
  }

  get cacheDirtyPathCount(): number {
    return this.cacheDirtyPaths.size;
  }

  cacheDirtyPathsSnapshot(): string[] {
    return [...this.cacheDirtyPaths].sort();
  }

  /** Clear dirty evidence only if no newer semantic revision appeared during persistence. */
  markCacheCommitted(revision: number): void {
    if (this.semanticRevision === revision) this.cacheDirtyPaths.clear();
  }

  enableLiveChanges(): void {
    this.liveChanges = true;
  }

  /** Start deferred occurrence parsing when an occurrence-aware consumer actually needs it. */
  beginDeferredLocalHydration(): void {
    if (this.hydrationTask || !this.deferredHydrationFiles.length) return;
    const files = this.deferredHydrationFiles;
    const epoch = this.deferredHydrationEpoch;
    this.deferredHydrationFiles = [];
    this.startLocalHydration(files, epoch);
  }

  /** Wait until all asynchronous semantic work that can affect occurrence-aware queries has settled. */
  async whenLocalSettled(): Promise<void> {
    this.beginDeferredLocalHydration();
    while (this.hydrationTask || this.pendingLocalReads.size || this.livePending.size || this.liveApplyTimer !== null || this.liveApplyTask || this.relationshipResolvePending || this.relationshipResolveTimer !== null || this.relationshipResolveTask) {
      const work: Promise<unknown>[] = [...this.pendingLocalReads];
      if (this.liveApplyTask) work.push(this.liveApplyTask);
      if (this.hydrationTask) work.push(this.hydrationTask);
      if (this.relationshipResolveTask) work.push(this.relationshipResolveTask);
      if (work.length) await Promise.all(work);
      else await new Promise((r) => window.setTimeout(r, 50));
    }
  }

  /** Current Markdown path/mtime/size evidence without parsing note bodies. */
  currentFingerprints(): Map<string, FileFingerprint> {
    const out = new Map<string, FileFingerprint>();
    for (const file of this.app.vault.getMarkdownFiles()) {
      out.set(file.path, { ctime: file.stat.ctime, mtime: file.stat.mtime, size: file.stat.size });
    }
    return out;
  }

  setSchema(schema: Schema): void {
    this.schema = schema;
  }

  /**
   * Install already-validated disposable cache state. This does not read or write model files.
   * Runtime callers must perform cache compatibility checks before calling it.
   */
  installRestored(state: RestoredSemanticState, createdAt: number): BuildStats {
    if (this.running) throw new Error("Cannot install restored state while indexing is active.");
    this.hydrationEpoch++;
    this.hydrationTask = null;
    this.deferredHydrationFiles = [];
    this.deferredHydrationEpoch = this.hydrationEpoch;
    this.hydrationRemaining = 0;
    this.hydrationStartedAt = null;
    this.lastHydrationMsValue = 0;
    this.lastHydrationCandidatesValue = 0;
    this.localReadErrors.clear();
    this.index = state.index;
    this.local = state.local;
    this.fingerprints.clear();
    for (const [path, fp] of state.fingerprints) this.fingerprints.set(path, { ...fp });
    this.dirty.clear();
    this.cacheDirtyPaths.clear();
    this.burst = 0;
    this.bumpRevision();
    this.stats = this.makeStats("restored", 0, createdAt);
    return this.stats;
  }

  /**
   * Reparse content-changed files when the Markdown path set is known to be unchanged.
   * Added/deleted/renamed paths are deliberately outside this API because they can change
   * resolution of links authored in otherwise unchanged notes (W-344).
   */
  reconcileStablePaths(paths: readonly string[]): Promise<BuildStats> {
    return this.reconcilePlan({ unchanged: [], changed: [...paths], added: [], deleted: [] });
  }

  /**
   * Reconcile a warm-cache plan. Content changes/additions are parsed; deletions are removed.
   * When the path set changes, every cached authored relationship link is re-resolved against
   * Obsidian's current metadata cache without rereading unchanged Markdown bodies.
   */
  reconcilePlan(plan: ReconciliationPlan): Promise<BuildStats> {
    if (!this.running) this.running = this.doReconcilePlan(plan).finally(() => (this.running = null));
    return this.running;
  }

  record(file: TFile): NoteRecord | null {
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter;
    if (!fm) return null;
    const authoredLinks: AuthoredRelationshipLink[] = [];
    for (const fl of cache.frontmatterLinks ?? []) {
      const field = fl.key.split(".")[0];
      if (!this.schema.byField.has(field) && !this.schema.byInverse.has(field)) continue;
      authoredLinks.push({ field, link: fl.link, linkpath: getLinkpath(fl.link) });
    }
    const resolved = resolveAuthoredRelationshipLinks(
      authoredLinks,
      file.path,
      this.schema,
      (linkpath, fromPath) => this.app.metadataCache.getFirstLinkpathDest(linkpath, fromPath)?.path,
    );
    const str = (v: unknown) => (v === undefined || v === null || v === "" ? undefined : String(v));
    const abstract = fm.abstract === true ? true : fm.abstract === false ? false : undefined;
    const abstractInvalid = fm.abstract !== undefined && fm.abstract !== null && fm.abstract !== "" && abstract === undefined;
    return {
      path: file.path,
      name: file.basename,
      type: str(fm.type),
      id: str(fm.id),
      uid: str(fm.uid),
      authoredLinks,
      fields: resolved.fields,
      unresolved: resolved.unresolved,
      broken: resolved.broken,
      repeat: resolved.repeat,
      abstract,
      abstractInvalid: abstractInvalid || undefined,
      localRefs: resolved.localRefs,
    };
  }

  /** Metadata-only prefilter: body reads are limited to notes that can actually contain a Local Model region. */
  private mayHaveLocalModel(file: TFile): boolean {
    const cache = this.app.metadataCache.getFileCache(file);
    if (!cache) return false;
    if (cache.headings?.some((h) => h.level === 2 && h.heading.trim().toLowerCase() === "local model")) return true;
    return Object.keys(cache.blocks ?? {}).some((id) => LOCAL_BLOCK_PREFIX.test(id));
  }

  private makeStats(mode: BuildStats["mode"], ms: number, builtAt: number): BuildStats {
    let elements = 0;
    for (const r of this.index.notes.values()) if (this.index.isElement(r)) elements++;
    return {
      mode,
      files: this.fingerprints.size,
      notes: this.index.size,
      elements,
      links: this.index.edgeCount(),
      ms,
      builtAt,
    };
  }

  private async doReconcilePlan(plan: ReconciliationPlan): Promise<BuildStats> {
    const t0 = performance.now();
    const changedOrAdded = [...new Set([...plan.changed, ...plan.added])].sort();
    const deleted = [...new Set(plan.deleted)].sort();

    for (const path of deleted) {
      this.index.remove(path);
      this.local.remove(path);
      this.localReadErrors.delete(path);
      this.fingerprints.delete(path);
      this.localRevision.set(path, (this.localRevision.get(path) ?? 0) + 1);
      this.bumpRevision(path);
    }

    const reconcileBudget = new CooperativeBudget(WORK_SLICE_MS);
    for (let i = 0; i < changedOrAdded.length; i++) {
      const path = changedOrAdded[i];
      const f = this.app.vault.getAbstractFileByPath(path);
      if (!(f instanceof TFile) || f.extension !== "md") {
        throw new Error(`Warm reconciliation expected Markdown file ${path}, but it is unavailable.`);
      }
      await this.applyAwaited(path, f);
      await reconcileBudget.checkpoint(yieldToUi);
    }

    if (plan.added.length || plan.deleted.length) await this.reResolveAllRelationships();

    // Changes arriving during reconciliation are replayed once. Concurrent path-set changes
    // deliberately schedule the safe full rebuild; the next startup can remain incremental.
    const backlog = [...this.dirty];
    this.dirty.clear();
    if (backlog.length > CHUNK) this.scheduleRebuild();
    else {
      let needsFull = false;
      for (let i = 0; i < backlog.length; i++) {
        const path = backlog[i];
        const f = this.app.vault.getAbstractFileByPath(path);
        if (!(f instanceof TFile) || f.extension !== "md") {
          needsFull = true;
          break;
        }
        await this.applyAwaited(path, f);
        await reconcileBudget.checkpoint(yieldToUi);
      }
      if (needsFull) this.scheduleRebuild();
    }

    this.stats = this.makeStats("reconciled", Math.round(performance.now() - t0), Date.now());
    return this.stats;
  }

  /**
   * Re-resolve relationship links from cached authored evidence after the note path set changes.
   * This is CPU/metadata work only: unchanged Markdown files and Local Model bodies are not read.
   */
  private async reResolveAllRelationships(): Promise<number> {
    const notes = [...this.index.notes.values()];
    let changed = 0;
    const resolveBudget = new CooperativeBudget(WORK_SLICE_MS);
    for (let i = 0; i < notes.length; i++) {
      const rec = notes[i];
      if (!rec.authoredLinks) throw new Error(`Cached note ${rec.path} has no authored-link evidence; full rebuild required.`);
      const resolved = resolveAuthoredRelationshipLinks(
        rec.authoredLinks,
        rec.path,
        this.schema,
        (linkpath, fromPath) => this.app.metadataCache.getFirstLinkpathDest(linkpath, fromPath)?.path,
      );
      if (!sameResolvedEvidence(rec, resolved)) {
        this.index.upsert({
          ...rec,
          fields: resolved.fields,
          unresolved: resolved.unresolved,
          broken: resolved.broken,
          repeat: resolved.repeat,
          localRefs: resolved.localRefs,
        });
        this.cacheDirtyPaths.add(rec.path);
        changed++;
      }
      await resolveBudget.checkpoint(yieldToUi);
    }
    if (changed) this.bumpRevision();
    return changed;
  }

  /**
   * Debounce live add/delete/rename events, then re-resolve authored links from metadata only.
   * This keeps an open vault semantically correct without rereading unchanged Markdown bodies.
   */
  private scheduleRelationshipReresolution(): void {
    if (!this.liveChanges) return;
    this.relationshipResolvePending = true;
    if (this.relationshipResolveTimer !== null) window.clearTimeout(this.relationshipResolveTimer);
    // Prefer Obsidian's metadata "resolved" signal. This timer is only a bounded fallback for
    // environments that do not emit it after a path-set change.
    this.relationshipResolveTimer = window.setTimeout(() => {
      this.relationshipResolveTimer = null;
      this.beginRelationshipReresolution();
    }, 1500);
  }

  /** Called by the plugin when Obsidian reports that wikilink resolution has settled. */
  linkResolutionSettled(): void {
    if (!this.relationshipResolvePending) return;
    if (this.relationshipResolveTimer !== null) {
      window.clearTimeout(this.relationshipResolveTimer);
      this.relationshipResolveTimer = null;
    }
    this.beginRelationshipReresolution();
  }

  private beginRelationshipReresolution(): void {
    if (!this.relationshipResolvePending) return;
    if (this.rebuildPending || this.running || !this.stats) {
      this.scheduleRelationshipReresolution();
      return;
    }
    if (this.relationshipResolveTask) return;
    this.relationshipResolvePending = false;
    let task: Promise<void>;
    task = this.reResolveAllRelationships()
      .then(() => undefined)
      .finally(() => {
        if (this.relationshipResolveTask === task) this.relationshipResolveTask = null;
        if (this.relationshipResolvePending) this.scheduleRelationshipReresolution();
      });
    this.relationshipResolveTask = task;
  }

  /** Awaited variant used by controlled startup reconciliation. */
  private async applyAwaited(path: string, file: TFile): Promise<void> {
    this.fingerprints.set(path, { ctime: file.stat.ctime, mtime: file.stat.mtime, size: file.stat.size });
    const rec = this.record(file);
    if (rec) this.index.upsert(rec);
    else this.index.remove(path);

    const revision = (this.localRevision.get(path) ?? 0) + 1;
    this.localRevision.set(path, revision);
    this.local.remove(path);
    if (this.mayHaveLocalModel(file)) {
      try {
        const text = await this.app.vault.cachedRead(file);
        if (this.localRevision.get(path) === revision) {
          this.local.set(path, parseLocalModel(text));
          this.localReadErrors.delete(path);
        }
      } catch (e) {
        if (this.localRevision.get(path) === revision) this.localReadErrors.set(path, (e as Error).message);
      }
    } else this.localReadErrors.delete(path);
    this.bumpRevision(path);
  }

  /**
   * Parse only notes prefiltered by Obsidian metadata as Local Model candidates. This runs after
   * the core note graph is already usable. Occurrence-aware consumers call whenLocalSettled().
   */
  private startLocalHydration(files: TFile[], epoch: number): void {
    this.hydrationRemaining = files.length;
    this.lastHydrationCandidatesValue = files.length;
    this.hydrationStartedAt = performance.now();
    if (!files.length) {
      this.hydrationTask = null;
      this.lastHydrationMsValue = 0;
      this.hydrationStartedAt = null;
      return;
    }
    let task: Promise<void>;
    task = (async () => {
      let changed = false;
      const hydrationBudget = new CooperativeBudget(WORK_SLICE_MS);
      for (let i = 0; i < files.length; i++) {
        if (epoch !== this.hydrationEpoch) return;
        const file = files[i];
        const path = file.path;
        const revision = (this.localRevision.get(path) ?? 0) + 1;
        this.localRevision.set(path, revision);
        try {
          const text = await this.app.vault.cachedRead(file);
          if (epoch === this.hydrationEpoch && this.localRevision.get(path) === revision) {
            this.local.set(path, parseLocalModel(text));
            this.localReadErrors.delete(path);
            this.cacheDirtyPaths.add(path);
            changed = true;
          }
        } catch (e) {
          if (epoch === this.hydrationEpoch && this.localRevision.get(path) === revision) {
            this.localReadErrors.set(path, (e as Error).message);
            this.cacheDirtyPaths.add(path);
            changed = true;
          }
        } finally {
          if (epoch === this.hydrationEpoch) this.hydrationRemaining = Math.max(0, files.length - i - 1);
        }
        await hydrationBudget.checkpoint(yieldToUi);
      }
      if (changed && epoch === this.hydrationEpoch) this.bumpRevision();
    })().finally(() => {
      if (this.hydrationTask === task) {
        this.hydrationTask = null;
        this.hydrationRemaining = 0;
        if (this.hydrationStartedAt !== null) {
          this.lastHydrationMsValue = Math.round(performance.now() - this.hydrationStartedAt);
          this.hydrationStartedAt = null;
        }
      }
    });
    this.hydrationTask = task;
  }

  /** Builds the index; a second call while building returns the same promise. */
  build(): Promise<BuildStats> {
    if (!this.running) this.running = this.doBuild().finally(() => (this.running = null));
    return this.running;
  }

  private async doBuild(): Promise<BuildStats> {
    const t0 = performance.now();
    // A full build reads the vault's current state. Events queued before the build started are
    // therefore already represented by what it is about to read. Keep only events that arrive
    // during the build; otherwise Obsidian's first-start metadata burst can trigger a redundant
    // second whole-vault rebuild immediately after the first one (W-343 / RTA-1).
    this.dirty.clear();
    this.livePending.clear();
    if (this.liveApplyTimer !== null) {
      window.clearTimeout(this.liveApplyTimer);
      this.liveApplyTimer = null;
    }
    this.localReadErrors.clear();
    const epoch = ++this.hydrationEpoch;
    const index = new ModelIndex(this.schema);
    const local = new LocalModelIndex();
    const files = this.app.vault.getMarkdownFiles();
    const localCandidates: TFile[] = [];
    const fingerprints = new Map<string, FileFingerprint>();
    const buildBudget = new CooperativeBudget(WORK_SLICE_MS);
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      fingerprints.set(file.path, { ctime: file.stat.ctime, mtime: file.stat.mtime, size: file.stat.size });
      const rec = this.record(file);
      if (rec) index.upsert(rec);
      if (this.mayHaveLocalModel(file)) localCandidates.push(file);
      await buildBudget.checkpoint(yieldToUi);
    }
    this.index = index;
    this.local = local;
    this.fingerprints.clear();
    this.cacheDirtyPaths.clear();
    for (const [path, fp] of fingerprints) {
      this.fingerprints.set(path, fp);
      this.cacheDirtyPaths.add(path);
    }
    this.bumpRevision();
    // Core graph readiness comes first. Governed Local Model bodies are deferred until either
    // an occurrence-aware consumer asks for them or the plugin starts background hydration later.
    this.deferredHydrationFiles = localCandidates;
    this.deferredHydrationEpoch = epoch;
    this.hydrationRemaining = 0;
    this.lastHydrationCandidatesValue = localCandidates.length;
    this.lastHydrationMsValue = null;
    // Apply what changed while building. A large backlog (first-time caching, a big pull)
    // is cheaper as one more chunked build after things go quiet than as one long loop.
    const backlog = this.dirty.size;
    if (backlog <= CHUNK) for (const path of this.dirty) this.apply(path);
    this.dirty.clear();
    if (backlog > CHUNK) this.scheduleRebuild();
    this.burst = 0;
    this.stats = this.makeStats("full", Math.round(performance.now() - t0), Date.now());
    return this.stats;
  }

  private apply(path: string): void {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (f instanceof TFile && f.extension === "md") this.fingerprints.set(path, { ctime: f.stat.ctime, mtime: f.stat.mtime, size: f.stat.size });
    else this.fingerprints.delete(path);
    const rec = f instanceof TFile ? this.record(f) : null;
    if (rec) this.index.upsert(rec);
    else this.index.remove(path);
    this.applyLocal(path, f instanceof TFile ? f : null);
    this.bumpRevision(path);
  }

  /** Update one governed Local Model region without rebuilding the whole vault. */
  private applyLocal(path: string, file: TFile | null): void {
    const revision = (this.localRevision.get(path) ?? 0) + 1;
    this.localRevision.set(path, revision);
    this.local.remove(path);
    if (!file || !this.mayHaveLocalModel(file)) {
      this.localReadErrors.delete(path);
      return;
    }
    let task: Promise<void>;
    task = this.app.vault.cachedRead(file)
      .then((text) => {
        if (this.localRevision.get(path) !== revision) return;
        this.local.set(path, parseLocalModel(text));
        this.localReadErrors.delete(path);
        // Local Model body parsing completes after the note/frontmatter apply. Treat that as
        // a second semantic revision so Review/cache consumers cannot mistake pre-parse state
        // for the final semantic state of this edit.
        this.bumpRevision(path);
      })
      .catch((e) => {
        if (this.localRevision.get(path) !== revision) return;
        this.localReadErrors.set(path, (e as Error).message);
        this.bumpRevision(path);
      })
      .finally(() => this.pendingLocalReads.delete(task));
    this.pendingLocalReads.add(task);
  }

  /** One file changed or was created. Rapid events are coalesced by path. */
  changed(path: string): void {
    if (!this.liveChanges) return;
    if (!this.stats || this.running) {
      this.dirty.add(path);
      return;
    }
    this.livePending.add(path);
    const now = Date.now();
    if (now - this.burstStarted > 10000) {
      this.burstStarted = now;
      this.burst = 0;
    }
    this.burst++;
    if (this.burst >= BURST_REBUILD || this.livePending.size >= BURST_REBUILD) {
      this.livePending.clear();
      if (this.liveApplyTimer !== null) {
        window.clearTimeout(this.liveApplyTimer);
        this.liveApplyTimer = null;
      }
      this.scheduleRebuild();
      return;
    }
    this.scheduleLiveApply();
  }

  removed(path: string): void {
    this.changed(path);
  }

  private scheduleLiveApply(): void {
    if (!this.liveChanges || this.rebuildPending) return;
    if (this.liveApplyTimer !== null) window.clearTimeout(this.liveApplyTimer);
    this.liveApplyTimer = window.setTimeout(() => {
      this.liveApplyTimer = null;
      this.beginLiveApply();
    }, LIVE_DEBOUNCE_MS);
  }

  private beginLiveApply(): void {
    if (!this.liveChanges || this.rebuildPending || this.running || this.liveApplyTask || !this.livePending.size) {
      if (this.livePending.size && !this.rebuildPending && !this.liveApplyTask) this.scheduleLiveApply();
      return;
    }
    const paths = [...this.livePending].sort();
    this.livePending.clear();
    let task: Promise<void>;
    task = (async () => {
      let pathSetChanged = false;
      const liveBudget = new CooperativeBudget(WORK_SLICE_MS);
      for (let i = 0; i < paths.length; i++) {
        const path = paths[i];
        const existed = this.fingerprints.has(path);
        this.apply(path);
        const existsNow = this.fingerprints.has(path);
        if (existed !== existsNow) pathSetChanged = true;
        await liveBudget.checkpoint(yieldToUi);
      }
      if (pathSetChanged) this.scheduleRelationshipReresolution();
    })().finally(() => {
      if (this.liveApplyTask === task) this.liveApplyTask = null;
      if (this.livePending.size) this.scheduleLiveApply();
    });
    this.liveApplyTask = task;
  }

  scheduleRebuild(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.build();
    }, QUIET_MS);
  }

  dispose(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    if (this.liveApplyTimer !== null) window.clearTimeout(this.liveApplyTimer);
    this.liveApplyTimer = null;
    this.livePending.clear();
    this.liveApplyTask = null;
    if (this.relationshipResolveTimer !== null) window.clearTimeout(this.relationshipResolveTimer);
    this.relationshipResolveTimer = null;
    this.relationshipResolveTask = null;
    this.relationshipResolvePending = false;
    this.hydrationEpoch++;
    this.hydrationTask = null;
    this.deferredHydrationFiles = [];
    this.deferredHydrationEpoch = this.hydrationEpoch;
    this.hydrationRemaining = 0;
  }
}


function sameResolvedEvidence(
  rec: NoteRecord,
  next: ReturnType<typeof resolveAuthoredRelationshipLinks>,
): boolean {
  if (rec.unresolved !== next.unresolved) return false;
  if (!sameMapOfStrings(rec.fields, next.fields)) return false;
  if (!sameBroken(rec.broken ?? [], next.broken)) return false;
  if (!sameNumberMap(rec.repeat, next.repeat)) return false;
  if (!sameLocalRefs(rec.localRefs ?? [], next.localRefs ?? [])) return false;
  return true;
}

function sameMapOfStrings(a: ReadonlyMap<string, string[]>, b: ReadonlyMap<string, string[]>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, av] of a) {
    const bv = b.get(k);
    if (!bv || av.length !== bv.length || av.some((v, i) => v !== bv[i])) return false;
  }
  return true;
}

function sameBroken(a: Array<{ field: string; link: string }>, b: Array<{ field: string; link: string }>): boolean {
  return a.length === b.length && a.every((v, i) => v.field === b[i].field && v.link === b[i].link);
}

function sameNumberMap(a?: ReadonlyMap<string, number>, b?: ReadonlyMap<string, number>): boolean {
  if (!a?.size && !b?.size) return true;
  if (!a || !b || a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

function sameLocalRefs(
  a: Array<{ field: string; path: string; localId: string }>,
  b: Array<{ field: string; path: string; localId: string }>,
): boolean {
  return a.length === b.length && a.every((v, i) => v.field === b[i].field && v.path === b[i].path && v.localId === b[i].localId);
}

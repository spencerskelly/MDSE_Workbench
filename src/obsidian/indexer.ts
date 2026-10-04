/**
 * Feeds the pure ModelIndex from Obsidian's own metadata cache (works on desktop and mobile,
 * WB-087). Builds in chunks so Obsidian stays responsive (WB-081).
 */
import { App, getLinkpath, TFile } from "obsidian";
import { ModelIndex, type NoteRecord } from "../core/model";
import type { FileFingerprint, RestoredSemanticState } from "../core/cache";
import { LocalModelIndex, parseLocalModel } from "../core/localmodel";
import type { Schema } from "../core/schema";

const CHUNK = 500;
const LOCAL_BLOCK_PREFIX = /^(part|ep|conn|flow)-/;
/** Outside changes within one burst before a full rebuild is scheduled (WB-086). */
const BURST_REBUILD = 300;
/** Quiet time before a scheduled rebuild runs, so a pull or first-time indexing finishes first. */
const QUIET_MS = 3000;

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

  constructor(private readonly app: App, private schema: Schema) {
    this.index = new ModelIndex(schema);
  }

  get building(): boolean {
    return this.running !== null;
  }

  enableLiveChanges(): void {
    this.liveChanges = true;
  }

  /** Current Markdown path/mtime/size evidence without parsing note bodies. */
  currentFingerprints(): Map<string, FileFingerprint> {
    const out = new Map<string, FileFingerprint>();
    for (const file of this.app.vault.getMarkdownFiles()) {
      out.set(file.path, { mtime: file.stat.mtime, size: file.stat.size });
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
    this.index = state.index;
    this.local = state.local;
    this.fingerprints.clear();
    for (const [path, fp] of state.fingerprints) this.fingerprints.set(path, { ...fp });
    this.dirty.clear();
    this.burst = 0;
    this.stats = this.makeStats("restored", 0, createdAt);
    return this.stats;
  }

  /**
   * Reparse content-changed files when the Markdown path set is known to be unchanged.
   * Added/deleted/renamed paths are deliberately outside this API because they can change
   * resolution of links authored in otherwise unchanged notes (W-344).
   */
  reconcileStablePaths(paths: readonly string[]): Promise<BuildStats> {
    if (!this.running) this.running = this.doReconcileStable(paths).finally(() => (this.running = null));
    return this.running;
  }

  record(file: TFile): NoteRecord | null {
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter;
    if (!fm) return null;
    const fields = new Map<string, string[]>();
    let unresolved = 0;
    const broken: Array<{ field: string; link: string }> = [];
    const repeat = new Map<string, number>();
    const localRefs: Array<{ field: string; path: string; localId: string }> = [];
    for (const fl of cache.frontmatterLinks ?? []) {
      const field = fl.key.split(".")[0];
      if (!this.schema.byField.has(field) && !this.schema.byInverse.has(field)) continue;
      const dest = this.app.metadataCache.getFirstLinkpathDest(getLinkpath(fl.link), file.path);
      if (!dest) {
        unresolved++;
        broken.push({ field, link: fl.link });
        continue;
      }
      const hash = fl.link.indexOf("#^");
      if (hash >= 0) {
        // A block-targeted relationship semantically points at the local occurrence, not at its owning note.
        // Keep it out of note-to-note edges; occurrence-aware views resolve it through localRefs (WB-106).
        localRefs.push({ field, path: dest.path, localId: fl.link.slice(hash + 2).split("|")[0].trim() });
        continue;
      }
      let list = fields.get(field);
      if (!list) fields.set(field, (list = []));
      if (!list.includes(dest.path)) list.push(dest.path);
      else repeat.set(`${field}|${dest.path}`, (repeat.get(`${field}|${dest.path}`) ?? 1) + 1);
    }
    const str = (v: unknown) => (v === undefined || v === null || v === "" ? undefined : String(v));
    const abstract = fm.abstract === true ? true : fm.abstract === false ? false : undefined;
    const abstractInvalid = fm.abstract !== undefined && fm.abstract !== null && fm.abstract !== "" && abstract === undefined;
    return {
      path: file.path, name: file.basename, type: str(fm.type), id: str(fm.id), uid: str(fm.uid), fields, unresolved, broken,
      repeat: repeat.size ? repeat : undefined, abstract, abstractInvalid: abstractInvalid || undefined, localRefs: localRefs.length ? localRefs : undefined,
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

  private async doReconcileStable(paths: readonly string[]): Promise<BuildStats> {
    const t0 = performance.now();
    const unique = [...new Set(paths)].sort();
    for (let i = 0; i < unique.length; i++) {
      const path = unique[i];
      const f = this.app.vault.getAbstractFileByPath(path);
      if (!(f instanceof TFile) || f.extension !== "md") {
        throw new Error(`Stable-path reconciliation found missing Markdown file ${path}; full rebuild required.`);
      }
      await this.applyAwaited(path, f);
      if (i % 100 === 99) await new Promise((r) => window.setTimeout(r, 0));
    }

    // Changes arriving during reconciliation are replayed once. A very large concurrent burst
    // falls back to the existing proven full rebuild scheduler.
    const backlog = [...this.dirty];
    this.dirty.clear();
    if (backlog.length > CHUNK) this.scheduleRebuild();
    else {
      for (let i = 0; i < backlog.length; i++) {
        const path = backlog[i];
        const f = this.app.vault.getAbstractFileByPath(path);
        if (!(f instanceof TFile) || f.extension !== "md") {
          this.scheduleRebuild();
          break;
        }
        await this.applyAwaited(path, f);
        if (i % 100 === 99) await new Promise((r) => window.setTimeout(r, 0));
      }
    }

    this.stats = this.makeStats("reconciled", Math.round(performance.now() - t0), Date.now());
    return this.stats;
  }

  /** Awaited variant used by controlled startup reconciliation. */
  private async applyAwaited(path: string, file: TFile): Promise<void> {
    this.fingerprints.set(path, { mtime: file.stat.mtime, size: file.stat.size });
    const rec = this.record(file);
    if (rec) this.index.upsert(rec);
    else this.index.remove(path);

    const revision = (this.localRevision.get(path) ?? 0) + 1;
    this.localRevision.set(path, revision);
    this.local.remove(path);
    if (!this.mayHaveLocalModel(file)) return;
    const text = await this.app.vault.cachedRead(file);
    if (this.localRevision.get(path) === revision) this.local.set(path, parseLocalModel(text));
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
    const index = new ModelIndex(this.schema);
    const local = new LocalModelIndex();
    const files = this.app.vault.getMarkdownFiles();
    const fingerprints = new Map<string, FileFingerprint>();
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      fingerprints.set(file.path, { mtime: file.stat.mtime, size: file.stat.size });
      const rec = this.record(file);
      if (rec) index.upsert(rec);
      if (this.mayHaveLocalModel(file)) local.set(file.path, parseLocalModel(await this.app.vault.cachedRead(file)));
      if (i % CHUNK === CHUNK - 1) await new Promise((r) => window.setTimeout(r, 0));
    }
    this.index = index;
    this.local = local;
    this.fingerprints.clear();
    for (const [path, fp] of fingerprints) this.fingerprints.set(path, fp);
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
    if (f instanceof TFile && f.extension === "md") this.fingerprints.set(path, { mtime: f.stat.mtime, size: f.stat.size });
    else this.fingerprints.delete(path);
    const rec = f instanceof TFile ? this.record(f) : null;
    if (rec) this.index.upsert(rec);
    else this.index.remove(path);
    this.applyLocal(path, f instanceof TFile ? f : null);
  }

  /** Update one governed Local Model region without rebuilding the whole vault. */
  private applyLocal(path: string, file: TFile | null): void {
    const revision = (this.localRevision.get(path) ?? 0) + 1;
    this.localRevision.set(path, revision);
    this.local.remove(path);
    if (!file || !this.mayHaveLocalModel(file)) return;
    void this.app.vault.cachedRead(file).then((text) => {
      if (this.localRevision.get(path) !== revision) return;
      this.local.set(path, parseLocalModel(text));
    });
  }

  /** One file changed or was created. Cheap; never starts a build directly. */
  changed(path: string): void {
    if (!this.liveChanges) return;
    if (!this.stats || this.running) {
      this.dirty.add(path);
      return;
    }
    this.apply(path);
    const now = Date.now();
    if (now - this.burstStarted > 10000) {
      this.burstStarted = now;
      this.burst = 0;
    }
    if (++this.burst >= BURST_REBUILD) this.scheduleRebuild();
  }

  removed(path: string): void {
    this.changed(path);
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
  }
}

/**
 * MDSE Workbench, Phase 0 spike (WB-081, WB-090 gate R0).
 * Commands: diagnostics, rebuild index, explore Structure from the current note,
 * relate the current note to another, undo, and the Canvas probe.
 */
import { App, getLinkpath, normalizePath, Notice, parseYaml, Plugin, PluginSettingTab, Setting, TFile } from "obsidian";
import type { NoteRecord } from "./core/model";
import { summarizeRuntimeHealth } from "./core/runtime-health";
import { cacheDirtyBucketsForPaths, planReconciliation, reconciliationMode, restoreSemanticState, serializeSemanticState } from "./core/cache";
import { readSemanticCacheGeneration, writeSemanticCacheGeneration } from "./core/cache-storage";
import { validateLocalModels } from "./core/localmodel";
import { optionsBetween } from "./core/rules";
import { editingBlocked, parseSchema, type Schema } from "./core/schema";
import { INTERNAL_PROFILE, PROFILES, profileNeedsLocalOccurrences, signature, STRUCTURE_PROFILE, toCanvas, traverse, withLocalOccurrences, type ViewProfile } from "./core/views";
import { Indexer } from "./obsidian/indexer";
import { probeReport, registerSelectionMenu } from "./obsidian/probe";
import { ConfirmModal, ElementPicker, RelationshipPicker, ReportModal, ViewPicker } from "./obsidian/ui";
import { NoteDetailPanel } from "./obsidian/detail";
import { nodeAt, parseTranslate, undefinedName, type CanvasNodeJson } from "./core/detail";
import { ReviewView, REVIEW_VIEW } from "./obsidian/review";
import { RelationshipWriter } from "./obsidian/writer";
import { analyzeLocalModel, writeFindingsReport } from "./obsidian/localmodel";
import { clearWorkbenchCache, ObsidianCacheStorage, WORKBENCH_CACHE_ROOT } from "./obsidian/cache";
import { AssuranceManager, type AssuranceSnapshot } from "./obsidian/assurance";

/** Quiet time with no cache activity before the first index build starts. */
const QUIET_START_MS = 8000; // fallback only when Obsidian's metadata "resolved" signal is not observed
const CORE_AFTER_METADATA_DELAY_MS = 1000;
const LOCAL_BACKGROUND_DELAY_MS = 3000;
const CACHE_QUIET_MS = 8000;
const MIN_CACHE_WRITE_INTERVAL_MS = 30000;

interface Settings {
  relationshipsPath: string;
  elementTypesPath: string;
  /** Generated views go here; keep it out of Git (WB-036). Default chosen at build (WB-073). */
  viewsFolder: string;
  canvasProbe: boolean;
  /** Clicking a note on a generated view opens its details in a popup (WB-099). */
  showDetails: boolean;
  /** Pre-release gate for RTA-3 warm restore. Off in controlled bases until runtime validation passes. */
  warmCachePreview: boolean;
}

const DEFAULTS: Settings = {
  relationshipsPath: "99_System/03_Schemas/relationships.yaml",
  elementTypesPath: "99_System/03_Schemas/element-types.yaml",
  viewsFolder: "Workbench Views",
  canvasProbe: true,
  showDetails: true,
  warmCachePreview: false,
};

interface RuntimeSample {
  at: number;
  mode: "full" | "restored" | "reconciled";
  files: number;
  elements: number;
  coreMs: number;
  startupWaitMs: number | null;
  localHydrationMs: number | null;
  localCandidates: number;
  warmRestore: string | null;
}

interface Stored {
  settings: Settings;
  /** Generated canvas path → signature at generation, for stale-view checks (WB-035). */
  views: Record<string, { starts: string[]; profile: string; signature: string; at: number }>;
  /** Local-only bounded performance evidence; plugin data.json is git-ignored. */
  runtimeHistory?: RuntimeSample[];
}

function localCardTarget(text: string | undefined): { target: string; localId: string } | null {
  const m = /\[\[([^#\]|]+)#\^([^\]|]+)(?:\|[^\]]*)?\]\]/.exec(text ?? "");
  return m ? { target: m[1].trim(), localId: m[2].trim() } : null;
}

export default class MdseWorkbench extends Plugin {
  settings: Settings = { ...DEFAULTS };
  views: Stored["views"] = {};
  private runtimeHistory: RuntimeSample[] = [];
  schema: Schema | null = null;
  indexer: Indexer | null = null;
  writer: RelationshipWriter | null = null;
  detail: NoteDetailPanel | null = null;
  private statusEl: HTMLElement | null = null;
  private healthRefreshTimer: number | null = null;
  private localBackgroundTimer: number | null = null;
  private cacheWriteTimer: number | null = null;
  private lastCacheWriteAt: number | null = null;
  private lastCacheWriteMs: number | null = null;
  private lastCacheWriteError: string | null = null;
  private lastCoreError: string | null = null;
  private lastOccurrenceError: string | null = null;
  private lastCachedRevision: number | null = null;
  private lastWarmRestore: string | null = null;
  private assurance: AssuranceManager | null = null;
  private lastStartupWaitMs: number | null = null;
  private startPromise: Promise<void> | null = null;
  private pendingRebuild = false;
  /** Last time Obsidian reported a note changed; first-time caching reports one per note. */
  private lastChange = Date.now();
  /** Latched once Obsidian says its metadata/link-resolution pass is complete. */
  private metadataResolved = false;
  private unloaded = false;

  async onload(): Promise<void> {
    const stored = ((await this.loadData()) ?? {}) as Partial<Stored>;
    this.settings = { ...DEFAULTS, ...(stored.settings ?? {}) };
    this.views = stored.views ?? {};
    this.runtimeHistory = Array.isArray(stored.runtimeHistory) ? stored.runtimeHistory.slice(-20) : [];
    this.addSettingTab(new WorkbenchSettings(this.app, this));
    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass("mod-clickable");
    this.registerDomEvent(this.statusEl, "click", () => this.showRuntimeHealth());
    this.setRuntimeStatus("starting");
    this.detail = new NoteDetailPanel(this.app, {
      schema: () => this.schema,
      writer: () => this.writer,
      editBlocked: () => (!this.isReady() ? "Workbench is still indexing; try again in a moment." : this.schema && editingBlocked(this.schema) ? "The vault's schema is older than this Workbench supports, so editing is off." : null),
      elements: (exclude) => this.elements().filter((r) => r.path !== exclude),
      relate: (a, b) => this.relate(a, b),
      undo: () => this.undo(),
      pickView: (path) => this.pickView(path),
    });
    this.addChild(this.detail);
    this.registerDetailClicks();

    this.addCommand({ id: "diagnostics", name: "Show diagnostics", callback: () => void this.diagnostics() });
    this.addCommand({ id: "runtime-health", name: "Show runtime health", callback: () => this.showRuntimeHealth() });
    this.addCommand({ id: "runtime-history", name: "Show runtime history", callback: () => this.showRuntimeHistory() });
    this.addCommand({ id: "inspect-semantic-cache", name: "Inspect semantic cache", callback: () => void this.inspectSemanticCache() });
    this.addCommand({ id: "clear-semantic-cache", name: "Clear semantic cache", callback: () => this.confirmClearSemanticCache() });
    this.addCommand({ id: "rebuild-index", name: "Rebuild index", callback: () => this.start(true) });
    this.addCommand({
      id: "explore-structure",
      name: "Explore structure of current note",
      checkCallback: (checking) => this.withActive(checking, (f) => this.explore([f.path])),
    });
    this.addCommand({
      id: "explore-internal",
      name: "Explore internal structure of current Object",
      checkCallback: (checking) => this.withActive(checking, (f) => this.explore([f.path], INTERNAL_PROFILE)),
    });
    this.addCommand({
      id: "explore-functional",
      name: "Explore functional view of current note",
      checkCallback: (checking) => this.withActive(checking, (f) => this.explore([f.path], PROFILES.Functional)),
    });
    this.addCommand({
      id: "explore-requirements",
      name: "Explore requirements view of current note",
      checkCallback: (checking) => this.withActive(checking, (f) => this.explore([f.path], PROFILES.Requirements)),
    });
    // One command per further view (WB-102), and a picker that lists the views that fit the current note.
    const more: Array<[string, string, string]> = [
      ["explore-where-used", "Explore where-used view of current note", "Where Used"],
      ["explore-interfaces", "Explore interfaces view of current note", "Interfaces"],
      ["explore-verification", "Explore verification view of current note", "Verification"],
      ["explore-design", "Explore design view of current note", "Design"],
      ["explore-scenario", "Explore scenario view of current note", "Scenario"],
      ["explore-behavior", "Explore behavior view of current note", "Behavior"],
      ["explore-failure", "Explore failure and risk view of current note", "Failure and risk"],
      ["explore-evidence", "Explore evidence view of current note", "Evidence"],
    ];
    for (const [id, name, key] of more) {
      this.addCommand({ id, name, checkCallback: (checking) => this.withActive(checking, (f) => this.explore([f.path], PROFILES[key])) });
    }
    this.addCommand({
      id: "explore-pick",
      name: "Explore view of current note…",
      checkCallback: (checking) => this.withActive(checking, (f) => this.pickView(f.path)),
    });
    this.addCommand({
      id: "check-view",
      name: "Check whether this view is current",
      callback: () => this.checkView(),
    });
    this.addCommand({
      id: "relate",
      name: "Relate current note to another note",
      checkCallback: (checking) => this.withActive(checking, (f) => this.pickTargetThenRelate(f.path)),
    });
    this.addCommand({ id: "undo", name: "Undo last Workbench edit", callback: () => this.undo() });
    this.addCommand({
      id: "probe-canvas",
      name: "Check Canvas support (Phase 0 probe)",
      callback: () => new ReportModal(this.app, "Canvas support", probeReport(this.app), [
        "If 'Relate selected notes (Workbench)' appears when you right-click two selected notes on a canvas, the selection menu hook works.",
      ]).open(),
    });
    if (this.settings.canvasProbe) {
      registerSelectionMenu(this.app, (ref) => this.registerEvent(ref), (a, b) => this.relate(a.path, b.path));
    }

    this.registerView(
      REVIEW_VIEW,
      (leaf) =>
        new ReviewView(leaf, {
          app: this.app,
          ready: () => this.isReady(),
          index: () => (this.indexer as Indexer).index,
          schema: () => this.schema as Schema,
          writer: () => this.writer as RelationshipWriter,
          assurance: (force = false) => this.getAssurance(force),
        }),
    );
    this.addCommand({ id: "open-review", name: "Open Review", callback: () => void this.openReview() });
    this.addCommand({ id: "local-model-findings", name: "Check Local Model (write findings report)", callback: () => void this.checkLocalModel() });
    this.addRibbonIcon("list-checks", "Workbench Review", () => void this.openReview());
    this.registerEvent(this.app.metadataCache.on("changed", () => (this.lastChange = Date.now())));
    this.registerEvent(this.app.metadataCache.on("resolved", () => {
      this.metadataResolved = true;
      this.indexer?.linkResolutionSettled();
    }));
    this.register(() => {
      this.unloaded = true;
      if (this.cacheWriteTimer !== null) window.clearTimeout(this.cacheWriteTimer);
      if (this.healthRefreshTimer !== null) window.clearTimeout(this.healthRefreshTimer);
      if (this.localBackgroundTimer !== null) window.clearTimeout(this.localBackgroundTimer);
    });
    this.app.workspace.onLayoutReady(() => void this.start(false));
  }

  private setRuntimeStatus(state: "starting" | "waiting" | "restoring" | "reconciling" | "indexing" | "ready" | "error", detail = ""): void {
    if (!this.statusEl) return;
    const label =
      state === "starting" ? "MDSE Workbench: starting" :
      state === "waiting" ? "MDSE Workbench: waiting for vault" :
      state === "restoring" ? "MDSE Workbench: restoring cache" :
      state === "reconciling" ? "MDSE Workbench: reconciling" :
      state === "indexing" ? "MDSE Workbench: indexing" :
      state === "ready" ? "MDSE Workbench: ready" :
      "MDSE Workbench: attention";
    this.statusEl.setText(detail ? `${label} · ${detail}` : label);
    this.statusEl.setAttr("aria-label", "MDSE Workbench runtime status");
  }

  /** Cheap health summary from already-known state. Never runs global assurance. */
  private runtimeHealth() {
    const indexer = this.indexer;
    const cachedAssurance = this.assurance?.peek() ?? null;
    return summarizeRuntimeHealth({
      ready: this.isReady(),
      building: !!indexer?.building,
      coreError: this.lastCoreError,
      occurrenceError: this.lastOccurrenceError,
      localPending: indexer?.localHydrationPending ?? 0,
      localQueued: indexer?.localHydrationQueued ?? 0,
      livePending: indexer?.liveUpdatePending ?? 0,
      localReadErrors: indexer?.localReadErrorCount ?? 0,
      schemaWarnings: this.schema?.warnings.length ?? 0,
      cacheWriteError: this.lastCacheWriteError,
      cacheCurrent: !!indexer && indexer.revision === this.lastCachedRevision,
      assurance: cachedAssurance
        ? {
            current: cachedAssurance.revision === indexer?.revision && !cachedAssurance.stale,
            findings: cachedAssurance.all.length,
            computedAt: cachedAssurance.computedAt,
            error: cachedAssurance.error,
          }
        : null,
    });
  }

  private refreshRuntimeHealth(): void {
    if (!this.statusEl || !this.isReady()) return;
    const health = this.runtimeHealth();
    this.statusEl.setText(health.label);
    this.statusEl.setAttr("aria-label", `MDSE Workbench runtime health: ${health.detail}`);
  }

  private showRuntimeHealth(): void {
    const health = this.runtimeHealth();
    new ReportModal(this.app, "MDSE Workbench runtime health", health.rows, [
      health.detail,
      "This view is lightweight: it reports already-known runtime state and does not trigger a whole-model assurance scan.",
      "Engineering findings are not treated as a runtime failure; open Review when you want the current global assurance results.",
    ]).open();
  }

  private scheduleRuntimeHealthRefresh(): void {
    this.refreshRuntimeHealth();
    if (this.healthRefreshTimer !== null) window.clearTimeout(this.healthRefreshTimer);
    this.healthRefreshTimer = window.setTimeout(() => {
      this.healthRefreshTimer = null;
      this.refreshRuntimeHealth();
      const indexer = this.indexer;
      // Health is observation only. If background/live work is already pending, poll its cheap
      // counters later; never call a settle/ensure method from the health path because that would
      // make status rendering itself pull deferred capabilities into the foreground.
      if (indexer && this.isReady() && indexer.liveUpdatePending + indexer.localHydrationActive > 0) {
        this.scheduleRuntimeHealthRefresh();
      }
    }, 400);
  }

  /**
   * Prefer Obsidian's own metadata/link-resolution completion signal over a fixed startup delay.
   * The quiet timer remains a conservative fallback for versions/environments that do not emit it
   * after Workbench loads.
   */
  private async whenVaultQuiet(): Promise<void> {
    while (!this.unloaded) {
      if (this.metadataResolved) {
        // Give Obsidian/UI and other lightweight plugin onload work one short lane before
        // Workbench starts core indexing/restoration. Workbench readiness may come later;
        // vault usability wins over minimum feature latency.
        await new Promise((r) => window.setTimeout(r, CORE_AFTER_METADATA_DELAY_MS));
        return;
      }
      if (Date.now() - this.lastChange >= QUIET_START_MS) return;
      await new Promise((r) => window.setTimeout(r, 250));
    }
  }

  async saveAll(): Promise<void> {
    await this.saveData({ settings: this.settings, views: this.views, runtimeHistory: this.runtimeHistory } satisfies Stored);
  }

  private async recordRuntimeSample(indexer: Indexer, stats: NonNullable<Indexer["stats"]>): Promise<void> {
    // Runtime evidence must never pull deferred capabilities into the startup critical path.
    if (this.unloaded || this.indexer !== indexer || indexer.stats?.builtAt !== stats.builtAt) return;
    this.runtimeHistory.push({
      at: Date.now(),
      mode: stats.mode,
      files: stats.files,
      elements: stats.elements,
      coreMs: stats.ms,
      startupWaitMs: this.lastStartupWaitMs,
      localHydrationMs: indexer.lastLocalHydrationMs,
      localCandidates: indexer.lastLocalHydrationCandidates,
      warmRestore: this.lastWarmRestore,
    });
    this.runtimeHistory = this.runtimeHistory.slice(-20);
    await this.saveAll();
  }

  private showRuntimeHistory(): void {
    const recent = this.runtimeHistory.slice(-10).reverse();
    const rows: Array<[string, string]> = recent.length
      ? recent.map((s) => [
          new Date(s.at).toLocaleString(),
          `${s.mode} · core ${(s.coreMs / 1000).toFixed(2)} s · Local ${s.localHydrationMs === null ? "n/a" : (s.localHydrationMs / 1000).toFixed(2) + " s"} (${s.localCandidates}) · wait ${s.startupWaitMs === null ? "n/a" : (s.startupWaitMs / 1000).toFixed(2) + " s"}`,
        ])
      : [["Runtime history", "No completed startup samples yet."]];
    new ReportModal(this.app, "MDSE Workbench runtime history", rows, [
      "Local-only performance evidence; this history is stored in the git-ignored Workbench data.json.",
      "Use it to compare cold/full, warm/restored and reconciled startup behavior across candidate builds.",
    ]).open();
  }

  /**
   * Stability-first capability staging: the core note graph is usable before occurrence bodies.
   * Local Model hydration starts later in the background, or immediately if an occurrence-aware
   * command/Review explicitly asks for it.
   */
  private scheduleBackgroundLocalHydration(): void {
    if (this.localBackgroundTimer !== null) window.clearTimeout(this.localBackgroundTimer);
    const indexer = this.indexer;
    if (!indexer || !this.isReady() || !indexer.localHydrationPending) return;
    this.localBackgroundTimer = window.setTimeout(() => {
      this.localBackgroundTimer = null;
      if (this.unloaded || this.indexer !== indexer || !this.isReady()) return;
      // Background occurrence parsing must yield to active use. If the engineer just edited
      // something or live semantic updates are pending, leave the capability queued and try later.
      if (Date.now() - this.lastChange < LOCAL_BACKGROUND_DELAY_MS || indexer.liveUpdatePending > 0) {
        this.scheduleBackgroundLocalHydration();
        return;
      }
      indexer.beginDeferredLocalHydration();
      this.scheduleRuntimeHealthRefresh();
      void indexer.whenLocalSettled()
        .then(() => {
          if (this.unloaded || this.indexer !== indexer) return;
          this.lastOccurrenceError = null;
          this.refreshRuntimeHealth();
          this.scheduleSemanticCacheWrite();
        })
        .catch((e) => {
          if (this.unloaded || this.indexer !== indexer) return;
          this.lastOccurrenceError = (e as Error).message || String(e);
          this.refreshRuntimeHealth();
        });
    }, LOCAL_BACKGROUND_DELAY_MS);
  }

  /**
   * RTA-2 save-only cache path. Runtime restore is intentionally not enabled yet.
   * The write happens after Workbench is already ready and only after a short quiet period,
   * so cache persistence cannot block startup usability.
   */
  private scheduleSemanticCacheWrite(): void {
    if (this.cacheWriteTimer !== null) window.clearTimeout(this.cacheWriteTimer);
    const indexer = this.indexer;
    if (!indexer?.stats || indexer.revision === this.lastCachedRevision) return;
    const sinceLast = this.lastCacheWriteAt === null ? Infinity : Date.now() - this.lastCacheWriteAt;
    const delay = Math.max(CACHE_QUIET_MS, MIN_CACHE_WRITE_INTERVAL_MS - sinceLast);
    this.cacheWriteTimer = window.setTimeout(() => {
      this.cacheWriteTimer = null;
      if (this.unloaded) return;
      const current = this.indexer;
      if (!current?.stats || current.revision === this.lastCachedRevision) return;
      if (current.building || current.rebuildPending || Date.now() - this.lastChange < CACHE_QUIET_MS) {
        this.scheduleSemanticCacheWrite();
        return;
      }
      void this.persistSemanticCache();
    }, delay);
  }

  private async persistSemanticCache(): Promise<void> {
    const schema = this.schema;
    const indexer = this.indexer;
    if (!schema || !indexer || indexer.building || !indexer.stats || indexer.revision === this.lastCachedRevision) return;
    const t0 = performance.now();
    try {
      await indexer.whenLocalSettled();
      if (indexer.building || indexer.rebuildPending) {
        this.scheduleSemanticCacheWrite();
        return;
      }
      if (indexer.localReadErrorCount) {
        this.lastCacheWriteError = `cache not updated: ${indexer.localReadErrorCount} Local Model read error(s)`;
        this.refreshRuntimeHealth();
        return;
      }
      const revision = indexer.revision;
      const createdAt = Date.now();
      const scope = { vaultUid: await this.loadVaultUid() };
      const cache = serializeSemanticState(
        indexer.index,
        indexer.local,
        indexer.fingerprints,
        schema,
        scope,
        this.manifest.version,
        createdAt,
      );
      const generation = `g-${createdAt}`;
      await writeSemanticCacheGeneration(
        new ObsidianCacheStorage(this.app),
        WORKBENCH_CACHE_ROOT,
        cache,
        generation,
      );
      this.lastCacheWriteAt = Date.now();
      this.lastCacheWriteMs = Math.round(performance.now() - t0);
      this.lastCacheWriteError = null;
      if (indexer.revision === revision) {
        this.lastCachedRevision = revision;
        indexer.markCacheCommitted(revision);
      } else this.scheduleSemanticCacheWrite();
      this.refreshRuntimeHealth();
    } catch (e) {
      // Cache is disposable. Failure is diagnostic only and never makes the model unavailable.
      this.lastCacheWriteMs = Math.round(performance.now() - t0);
      this.lastCacheWriteError = (e as Error).message;
      this.refreshRuntimeHealth();
    }
  }

  private withActive(checking: boolean, run: (f: TFile) => void): boolean {
    const f = this.app.workspace.getActiveFile();
    if (!f || f.extension !== "md") return false;
    if (!checking) run(f);
    return true;
  }

  async loadSchema(): Promise<Schema> {
    const read = async (p: string) => parseYaml(await this.app.vault.adapter.read(normalizePath(p)));
    return parseSchema(await read(this.settings.relationshipsPath), await read(this.settings.elementTypesPath));
  }

  private async loadVaultUid(): Promise<string> {
    const raw = parseYaml(await this.app.vault.adapter.read(".vault.yaml")) as { vault_uid?: unknown };
    const uid = raw?.vault_uid;
    if (typeof uid !== "string" || !uid.trim() || uid.trim() === "UNINITIALIZED") {
      throw new Error(".vault.yaml does not yet have an initialized vault_uid.");
    }
    return uid.trim();
  }

  /**
   * Serialize startup/rebuild requests. Schema edits or a manual Rebuild command may arrive
   * while startup is still waiting/indexing; they queue one follow-up rebuild instead of
   * running two model initializations concurrently.
   */
  async start(rebuild: boolean): Promise<void> {
    if (this.startPromise) {
      if (rebuild) this.pendingRebuild = true;
      await this.startPromise;
      return;
    }
    this.startPromise = this.runStart(rebuild);
    try {
      await this.startPromise;
    } catch (e) {
      const message = (e as Error).message || String(e);
      this.lastCoreError = message;
      this.setRuntimeStatus("error", "core model unavailable");
      new Notice(`MDSE Workbench: core model startup failed. Obsidian remains usable. ${message} Use “Rebuild index” after correcting the issue.`, 12000);
    } finally {
      this.startPromise = null;
    }
    if (this.pendingRebuild && !this.unloaded) {
      this.pendingRebuild = false;
      await this.start(true);
    }
  }

  /** Load schema, build/restore the index, then follow vault changes (WB-033, WB-086, W-343/W-344). */
  private async runStart(rebuild: boolean): Promise<void> {
    this.lastCoreError = null;
    this.setRuntimeStatus("starting");
    try {
      this.schema = await this.loadSchema();
    } catch (e) {
      const message = (e as Error).message || String(e);
      this.lastCoreError = `schema: ${message}`;
      this.setRuntimeStatus("error", "schema");
      new Notice(`MDSE Workbench: could not read the schema files. ${message} Check the paths in settings.`);
      return;
    }

    const schema = this.schema;
    const firstStart = !this.indexer;
    if (!this.indexer) {
      this.indexer = new Indexer(this.app, schema);
      this.writer = new RelationshipWriter(this.app, () => this.schema as Schema, () => (this.indexer as Indexer).index);
      this.assurance = new AssuranceManager({
        revision: () => (this.indexer as Indexer).revision,
        settle: () => (this.indexer as Indexer).whenLocalSettled(),
        index: () => (this.indexer as Indexer).index,
        localFindings: () => {
          const indexer = this.indexer as Indexer;
          const resolve = (target: string, from: string) => this.app.metadataCache.getFirstLinkpathDest(getLinkpath(target), from)?.path;
          return [
            ...validateLocalModels({ index: indexer.index, local: indexer.local, resolve }),
            ...indexer.localReadFindings(),
          ];
        },
      });
      const schemaPaths = () => [normalizePath(this.settings.relationshipsPath), normalizePath(this.settings.elementTypesPath)];

      this.registerEvent(
        this.app.metadataCache.on("changed", (file) => {
          if (schemaPaths().includes(file.path)) return;
          this.indexer?.changed(file.path);
          this.scheduleRuntimeHealthRefresh();
          if (this.indexer?.stats) this.scheduleSemanticCacheWrite();
        }),
      );
      this.registerEvent(this.app.vault.on("delete", (f) => {
        this.indexer?.removed(f.path);
        this.scheduleRuntimeHealthRefresh();
        if (this.indexer?.stats) this.scheduleSemanticCacheWrite();
      }));
      this.registerEvent(
        this.app.vault.on("rename", (f, old) => {
          this.indexer?.removed(old);
          this.indexer?.changed(f.path);
          this.scheduleRuntimeHealthRefresh();
          if (this.indexer?.stats) this.scheduleSemanticCacheWrite();
        }),
      );
      this.registerEvent(
        this.app.vault.on("modify", (f) => {
          if (schemaPaths().includes(f.path)) void this.start(true);
        }),
      );
      this.register(() => this.indexer?.dispose());

      // Obsidian's first metadata-cache pass can emit a changed event for every note.
      // Do not compete with it. The initial full build or warm reconciliation reads the
      // current filesystem after the vault becomes quiet.
      this.setRuntimeStatus("waiting");
      const waitStarted = performance.now();
      await this.whenVaultQuiet();
      this.lastStartupWaitMs = Math.round(performance.now() - waitStarted);
      if (this.unloaded) return;
    } else {
      this.indexer.setSchema(schema);
    }

    const indexer = this.indexer;
    if (!indexer) return;
    let stats = null as Awaited<ReturnType<Indexer["build"]>> | null;

    // RTA-3 preview is deliberately opt-in. It restores only after Obsidian is quiet; this
    // proves cache/reconciliation correctness before we later consider earlier UI availability.
    if (firstStart && !rebuild && this.settings.warmCachePreview) {
      try {
        this.setRuntimeStatus("restoring");
        const scope = { vaultUid: await this.loadVaultUid() };
        const cache = await readSemanticCacheGeneration(new ObsidianCacheStorage(this.app), WORKBENCH_CACHE_ROOT);
        const restored = restoreSemanticState(cache, schema, scope);
        const initialPlan = planReconciliation(restored.fingerprints, indexer.currentFingerprints());
        const initialMode = reconciliationMode(initialPlan);

        if (initialMode !== "full") {
          stats = indexer.installRestored(restored, cache.header.createdAt);
          this.lastCachedRevision = indexer.revision;
          const initialChanges = initialPlan.changed.length + initialPlan.added.length + initialPlan.deleted.length;
          this.lastWarmRestore = initialChanges
            ? `restored; ${initialChanges} path change(s) to reconcile`
            : "restored; cache matched current file fingerprints";
          indexer.enableLiveChanges();

          if (initialMode === "incremental") {
            this.setRuntimeStatus("reconciling", `${initialChanges} path change(s)`);
            stats = await indexer.reconcilePlan(initialPlan);
          }

          // Catch changes that happened after the first fingerprint snapshot. One bounded
          // incremental retry is allowed; if the vault remains busy or exceeds the incremental
          // budget, fall back to the proven full build instead of chasing a moving target.
          let after = planReconciliation(indexer.fingerprints, indexer.currentFingerprints());
          let afterMode = reconciliationMode(after);
          if (afterMode === "incremental") {
            const retryChanges = after.changed.length + after.added.length + after.deleted.length;
            this.setRuntimeStatus("reconciling", `${retryChanges} newer path change(s)`);
            stats = await indexer.reconcilePlan(after);
            after = planReconciliation(indexer.fingerprints, indexer.currentFingerprints());
            afterMode = reconciliationMode(after);
          }
          if (afterMode !== "none") stats = null;
        }
      } catch (e) {
        this.lastWarmRestore = `not used: ${(e as Error).message}`;
        stats = null;
      }
    }

    if (!stats) {
      indexer.enableLiveChanges();
      this.setRuntimeStatus("indexing");
      stats = await indexer.build();
    }

    const localPending = indexer.localHydrationPending;
    this.setRuntimeStatus(
      "ready",
      `${stats.elements} elements · ${stats.mode}${localPending ? ` · occurrence features loading later` : ""}`,
    );
    this.refreshRuntimeHealth();
    if (localPending) this.scheduleBackgroundLocalHydration();
    else this.scheduleSemanticCacheWrite();
    void this.recordRuntimeSample(indexer, stats);
    if (rebuild || schema.warnings.length) {
      new Notice(`MDSE Workbench: indexed ${stats.elements} model notes in ${(stats.ms / 1000).toFixed(1)} s${schema.warnings.length ? `; ${schema.warnings.length} schema warning(s), see diagnostics` : ""}.`);
    }
  }

  /** Quiet version of ready(): no notice. Used by Review, which waits and retries. */
  private isReady(): boolean {
    return !!(this.schema && this.indexer && this.writer && !this.indexer.building && this.indexer.stats);
  }

  private confirmClearSemanticCache(): void {
    new ConfirmModal(
      this.app,
      "Delete Workbench's disposable semantic cache? The Markdown/YAML model is not changed. The next startup will use the full rebuild path.",
      "Clear semantic cache",
      () => void this.clearSemanticCache(),
    ).open();
  }

  private async clearSemanticCache(): Promise<void> {
    if (this.cacheWriteTimer !== null) {
      window.clearTimeout(this.cacheWriteTimer);
      this.cacheWriteTimer = null;
    }
    try {
      await clearWorkbenchCache(this.app);
      this.lastCacheWriteAt = null;
      this.lastCacheWriteMs = null;
      this.lastCacheWriteError = null;
      this.lastCachedRevision = null;
      this.lastWarmRestore = "cache cleared; next startup will rebuild from the vault";
      this.refreshRuntimeHealth();
      new Notice("MDSE Workbench: semantic cache cleared. Model files were not changed.");
    } catch (e) {
      new Notice(`MDSE Workbench: could not clear semantic cache: ${(e as Error).message}`, 12000);
    }
  }

  async inspectSemanticCache(): Promise<void> {
    const schema = this.schema;
    const indexer = this.indexer;
    if (!schema || !indexer) {
      new Notice("MDSE Workbench has not loaded the model schemas yet.");
      return;
    }
    try {
      const scope = { vaultUid: await this.loadVaultUid() };
      const cache = await readSemanticCacheGeneration(new ObsidianCacheStorage(this.app), WORKBENCH_CACHE_ROOT);
      const restored = restoreSemanticState(cache, schema, scope);
      const current = indexer.currentFingerprints();
      const plan = planReconciliation(restored.fingerprints, current);
      const mode = reconciliationMode(plan);
      const localRecords = [...restored.local.regions.values()].reduce((n, region) => n + region.records.length, 0);
      const rows: Array<[string, string, boolean?]> = [
        ["Cache producer", cache.header.producerVersion],
        ["Cache created", new Date(cache.header.createdAt).toLocaleString()],
        ["Cached notes", String(restored.index.size)],
        ["Cached Local Model records", String(localRecords)],
        ["Unchanged paths", String(plan.unchanged.length)],
        ["Changed paths", String(plan.changed.length)],
        ["Added paths", String(plan.added.length), plan.added.length > 0],
        ["Deleted paths", String(plan.deleted.length), plan.deleted.length > 0],
        ["Safe next-start mode", mode],
      ];
      new ReportModal(this.app, "MDSE semantic cache", rows, [
        "Inspection is read-only. The vault remains authoritative; cache state is always disposable.",
        mode === "incremental" && (plan.added.length || plan.deleted.length)
          ? "Path-set changes are safe to reconcile because semantic-cache v2 retains authored relationship links and re-resolves them against current Obsidian metadata."
          : mode === "full"
            ? "The pending change set exceeds the bounded incremental startup budget, so the safe next-start path is a full chunked rebuild."
            : "",
      ].filter(Boolean)).open();
    } catch (e) {
      new Notice(`Semantic cache is unavailable or invalid: ${(e as Error).message}`, 15000);
    }
  }

  /** WB-111: validate the shared Local Model index, write the report and open it. */
  async checkLocalModel(): Promise<void> {
    if (!this.ready()) return;
    const notice = new Notice("MDSE Workbench: checking Local Model…", 0);
    try {
      const indexer = this.indexer as Indexer;
      await indexer.whenLocalSettled();
      const resolve = (target: string, from: string) => this.app.metadataCache.getFirstLinkpathDest(getLinkpath(target), from)?.path;
      const scan = analyzeLocalModel(indexer.index, indexer.local, resolve);
      const file = await writeFindingsReport(this.app, this.settings.viewsFolder, scan);
      const errors = scan.findings.filter((f) => f.severity === "error").length;
      new Notice(`Local Model: ${scan.notesWithRegion} notes, ${scan.records} records, ${errors} errors, ${scan.findings.length - errors} warnings (${(scan.ms / 1000).toFixed(1)} s).`, 10000);
      await this.app.workspace.getLeaf(false).openFile(file);
    } catch (e) {
      new Notice(`Local Model check failed: ${(e as Error).message}`, 15000);
    } finally {
      notice.hide();
    }
  }

  async openReview(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(REVIEW_VIEW)[0];
    const leaf = existing ?? this.app.workspace.getLeaf("tab");
    if (!existing) await leaf.setViewState({ type: REVIEW_VIEW, active: true });
    void this.app.workspace.revealLeaf(leaf);
  }

  private ready(): boolean {
    if (!this.schema || !this.indexer || this.indexer.building || !this.indexer.stats) {
      new Notice("MDSE Workbench is still indexing. Try again in a moment.");
      return false;
    }
    return true;
  }

  private async getAssurance(force = false): Promise<AssuranceSnapshot> {
    if (!this.assurance || !this.indexer || !this.schema) throw new Error("Workbench assurance is not ready.");
    const snapshot = await this.assurance.get(force);
    this.refreshRuntimeHealth();
    return snapshot;
  }

  async diagnostics(): Promise<void> {
    if (!this.ready()) return;
    const s = this.indexer!.stats!;
    const schema = this.schema!;
    const assurance = await this.getAssurance(false);
    const f = assurance.model;
    const dirtyBuckets = cacheDirtyBucketsForPaths(this.indexer!.cacheDirtyPathsSnapshot());
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    const rows: Array<[string, string, boolean?]> = [
      ["Index mode", s.mode],
      ["Markdown files", String(s.files)],
      ["Notes with properties", String(s.notes)],
      ["Model notes", String(s.elements)],
      ["Authored links", String(s.links)],
      ["Local Model hydration", this.indexer!.localHydrationPending ? `${this.indexer!.localHydrationPending} note(s) pending` : "settled"],
      ["Local Model read errors", String(this.indexer!.localReadErrorCount), this.indexer!.localReadErrorCount > 0],
      ["Startup quiet wait", this.lastStartupWaitMs === null ? "not measured" : `${(this.lastStartupWaitMs / 1000).toFixed(2)} s`],
      ["Index build", `${(s.ms / 1000).toFixed(2)} s (target under 60 s)`, s.ms > 60000],
      ["Assurance snapshot", assurance.error
        ? `unavailable · ${assurance.ms} ms · revision ${assurance.revision}`
        : `${assurance.ms} ms · revision ${assurance.revision}${assurance.stale ? " · stale/retrying" : ""}`, !!assurance.error],
      ["Assurance error", assurance.error ?? "none", !!assurance.error],
      ["Missing inverses", assurance.error ? "not evaluated" : String(f.missingInverse.length), !assurance.error && f.missingInverse.length > 0],
      ["Inverses with no forward link", assurance.error ? "not evaluated" : String(f.orphanInverse.length), !assurance.error && f.orphanInverse.length > 0],
      ["Links that break endpoint rules", assurance.error ? "not evaluated" : String(f.offRule.length)],
      ["Provisional links (tracesTo)", assurance.error ? "not evaluated" : String(f.provisional.length)],
      ["Unresolved relationship links", assurance.error ? "not evaluated" : String(f.unresolvedLinks), !assurance.error && f.unresolvedLinks > 0],
      ["relationships.yaml", schema.relationshipsVersion],
      ["element-types.yaml", schema.elementTypesVersion],
      ["Editing", editingBlocked(schema) ? "off (schema too old)" : "on", editingBlocked(schema)],
      ["Semantic cache mode", this.settings.warmCachePreview ? "warm restore preview enabled" : "save-only"],
      ["Warm restore", this.lastWarmRestore ?? "not attempted"],
      ["Semantic cache", this.lastCacheWriteError ? `write failed: ${this.lastCacheWriteError}` : this.lastCacheWriteAt ? `saved ${new Date(this.lastCacheWriteAt).toLocaleTimeString()}` : "not written yet", !!this.lastCacheWriteError],
      ["Semantic cache write", this.lastCacheWriteMs === null ? "not measured" : `${this.lastCacheWriteMs} ms`],
      ["Semantic cache persistence", this.indexer!.revision === this.lastCachedRevision ? "current" : "pending/coalesced"],
      ["Cache dirty paths", String(this.indexer!.cacheDirtyPathCount)],
      ["Cache dirty buckets", `${dirtyBuckets.notes.length} note · ${dirtyBuckets.localRegions.length} local · ${dirtyBuckets.fingerprints.length} fingerprint`],
    ];
    if (mem) rows.push(["JavaScript heap in use", `${Math.round(mem.usedJSHeapSize / 1048576)} MB (whole Obsidian window)`]);
    new ReportModal(this.app, "MDSE Workbench diagnostics", rows, schema.warnings).open();
  }

  /** Lists the views that can start from this note's type and opens the one chosen. */
  pickView(path: string): void {
    if (!this.isReady()) {
      new Notice("MDSE Workbench is still indexing. Try again in a moment.");
      return;
    }
    const rec = this.indexer!.index.notes.get(path);
    const type = rec?.type ?? "";
    const fits = Object.values(PROFILES).filter((p) => !p.startTypes || p.startTypes.includes(type));
    new ViewPicker(this.app, fits, rec?.name ?? "this note", (p) => void this.explore([path], p)).open();
  }

  async explore(starts: string[], profile: ViewProfile = STRUCTURE_PROFILE): Promise<void> {
    if (!this.ready()) return;
    const indexer = this.indexer as Indexer;
    if (profileNeedsLocalOccurrences(profile)) {
      this.setRuntimeStatus("ready", `${indexer.stats?.elements ?? 0} elements · loading occurrence data for ${profile.name}`);
      await indexer.whenLocalSettled();
      this.refreshRuntimeHealth();
    }
    const index = indexer.index;
    const t0 = performance.now();
    if (profile.startTypes) {
      const type = index.notes.get(starts[0])?.type ?? "";
      if (!profile.startTypes.includes(type)) {
        new Notice(`The ${profile.name} view starts from ${profile.startTypes.join(" or ")}. This note is ${type ? `a ${type}` : "not a model note"}.`);
        return;
      }
    }
    const baseView = traverse(index, starts, profile);
    const resolve = (target: string, from: string) => this.app.metadataCache.getFirstLinkpathDest(getLinkpath(target), from)?.path;
    const view = withLocalOccurrences(index, indexer.local, resolve, baseView, profile);
    if (view.depthOf.size <= 1 && view.omitted.size === 0) {
      new Notice(`Nothing to show: this note has no links the ${profile.name} view follows (${[...new Set(profile.steps.map((s) => s.field))].join(", ")}).`);
      return;
    }
    const canvas = toCanvas(index, view, profile);
    const name = (index.notes.get(starts[0])?.name ?? "view").replace(/[\\/:*?"<>|#^[\]]/g, "_");
    const folder = normalizePath(this.settings.viewsFolder);
    if (!this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
    // Same starting set + profile reuses the same file (WB-037).
    const path = normalizePath(`${folder}/${name} - ${view.profile}.canvas`);
    const json = JSON.stringify(canvas, null, "\t");
    const existing = this.app.vault.getAbstractFileByPath(path);
    const file = existing instanceof TFile ? (await this.app.vault.modify(existing, json), existing) : await this.app.vault.create(path, json);
    this.views[path] = { starts: view.starts, profile: view.profile, signature: signature(view), at: Date.now() };
    await this.saveAll();
    const ms = Math.round(performance.now() - t0);
    await this.app.workspace.getLeaf(true).openFile(file);
    new Notice(`${view.profile}: ${view.depthOf.size} items${view.localNodes.size ? ` (${view.localNodes.size} local occurrences)` : ""}${view.undefinedCount ? `, ${view.undefinedCount} undefined` : ""} in ${ms} ms${view.capReached ? `, stopped at the ${profile.nodeCap}-item limit` : ""}.`);
  }

  /**
   * Clicking a card on a generated view opens its details (WB-099). It only watches clicks and never stops
   * them, so selecting and moving cards on the canvas works as before. It relies on Canvas internals that
   * Obsidian does not document (the card elements and `canvas.nodes`), so a fallback reads the card's
   * position and matches it to the canvas file; check it again on each Obsidian version.
   */
  private registerDetailClicks(): void {
    let down: { x: number; y: number } | null = null;
    this.registerDomEvent(document, "pointerdown", (e) => (down = { x: e.clientX, y: e.clientY }), true);
    this.registerDomEvent(
      document,
      "click",
      (e) => {
        const moved = down ? Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5 : false;
        if (!this.settings.showDetails || moved || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
        void this.onCanvasClick(e.target as HTMLElement | null);
      },
      true,
    );
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (leaf?.view.getViewType() !== "canvas") this.detail?.closeIfClean();
      }),
    );
  }

  private isWorkbenchCanvas(file: TFile | null | undefined): boolean {
    if (!file) return false;
    return !!this.views[file.path] || file.path.startsWith(normalizePath(this.settings.viewsFolder) + "/");
  }

  private async onCanvasClick(target: HTMLElement | null): Promise<void> {
    const cardEl = target?.closest?.(".canvas-node") as HTMLElement | null;
    if (!cardEl || target?.closest("a, button, input, textarea")) return;
    const view = this.app.workspace.getLeavesOfType("canvas").map((l) => l.view as any).find((v) => v?.containerEl?.contains(cardEl)); // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!view || !this.isWorkbenchCanvas(view.file)) return;
    let file: TFile | null = null;
    let localTarget: { target: string; localId: string } | null = null;
    let missing: string | null = null;
    // 1. Obsidian's own card objects (undocumented).
    try {
      const nodes: unknown = view.canvas?.nodes;
      const list: any[] = nodes instanceof Map ? [...nodes.values()] : Array.isArray(nodes) ? nodes : []; // eslint-disable-line @typescript-eslint/no-explicit-any
      const node = list.find((n) => n?.nodeEl === cardEl);
      if (node?.file instanceof TFile) file = node.file;
      else if (node) localTarget = localCardTarget(node.text) ?? null;
      if (node && !localTarget && !file) missing = undefinedName(node.text);
    } catch {
      /* fall through to the position match */
    }
    // 2. Fallback: the card's position, matched to the canvas file's JSON.
    if (!file && missing === null) {
      const pos = parseTranslate(cardEl.getAttribute("style"));
      if (pos) {
        try {
          const json = JSON.parse(await this.app.vault.cachedRead(view.file)) as { nodes?: CanvasNodeJson[] };
          const n = nodeAt(json.nodes ?? [], pos.x, pos.y);
          if (n?.file) {
            const f = this.app.vault.getAbstractFileByPath(n.file);
            if (f instanceof TFile) file = f;
          } else if (n) {
            localTarget = localCardTarget(n.text) ?? null;
            if (!localTarget) missing = undefinedName(n.text);
          }
        } catch {
          /* nothing to show */
        }
      }
    }
    if (localTarget) {
      const owner = this.app.metadataCache.getFirstLinkpathDest(getLinkpath(localTarget.target), view.file.path);
      const record = owner ? this.indexer?.local.recordsOf(owner.path).find((r) => r.localId === localTarget?.localId) : undefined;
      if (owner && record) this.detail?.showLocal(owner, record);
      else if (owner) new Notice(`Local Model record ${localTarget.localId} was not found in ${owner.basename}.`);
    } else if (file) await this.detail?.show(file);
    else if (missing) this.detail?.showUndefined(missing);
  }

  async checkView(): Promise<void> {
    if (!this.ready()) return;
    const indexer = this.indexer as Indexer;
    await indexer.whenLocalSettled();
    const f = this.app.workspace.getActiveFile();
    const meta = f ? this.views[f.path] : undefined;
    if (!f || !meta) {
      new Notice("Open a view generated by Workbench first.");
      return;
    }
    const profile = PROFILES[meta.profile] ?? STRUCTURE_PROFILE;
    const index = indexer.index;
    const baseView = traverse(index, meta.starts, profile);
    const resolve = (target: string, from: string) => this.app.metadataCache.getFirstLinkpathDest(getLinkpath(target), from)?.path;
    const current = withLocalOccurrences(index, indexer.local, resolve, baseView, profile);
    const now = signature(current);
    if (now === meta.signature) new Notice("This view is current.");
    else
      new ConfirmModal(this.app, "The model changed since this view was generated.", "Refresh view", () => void this.explore(meta.starts, profile)).open();
  }

  private elements(): NoteRecord[] {
    const index = this.indexer!.index;
    return [...index.notes.values()].filter((r) => index.isElement(r)).sort((a, b) => a.name.localeCompare(b.name));
  }

  pickTargetThenRelate(firstPath: string): void {
    if (!this.ready()) return;
    const first = this.indexer!.index.notes.get(firstPath);
    if (!this.indexer!.index.isElement(first)) {
      new Notice("This note has no known type, so Workbench cannot relate it.");
      return;
    }
    new ElementPicker(this.app, this.elements().filter((r) => r.path !== firstPath), `Relate ${first.name} to…`, (second) =>
      this.relate(firstPath, second.path),
    ).open();
  }

  relate(firstPath: string, secondPath: string): void {
    if (!this.ready()) return;
    const index = this.indexer!.index;
    const a = index.notes.get(firstPath);
    const b = index.notes.get(secondPath);
    if (!index.isElement(a) || !index.isElement(b)) {
      new Notice("Both notes need a known type to be related.");
      return;
    }
    const options = optionsBetween(this.schema!, a.type, b.type);
    new RelationshipPicker(this.app, options, a, b, async (o) => {
      const [owner, target] = o.ownerIsFirst ? [a, b] : [b, a];
      try {
        const tx = await this.writer!.add(o.def, owner.path, target.path);
        new Notice(tx.files.length ? `Added: ${owner.name} ${o.def.field} ${target.name}.` : "That link already exists.", 8000);
      } catch (e) {
        new Notice(`Not added: ${(e as Error).message}`, 15000);
      }
    }).open();
  }

  async undo(): Promise<void> {
    if (!this.writer) return;
    new Notice(await this.writer.undo(), 15000);
  }
}

class WorkbenchSettings extends PluginSettingTab {
  constructor(app: App, private readonly plugin: MdseWorkbench) {
    super(app, plugin);
  }
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const text = (name: string, desc: string, key: "relationshipsPath" | "elementTypesPath" | "viewsFolder") =>
      new Setting(containerEl)
        .setName(name)
        .setDesc(desc)
        .addText((t) =>
          t.setValue(this.plugin.settings[key]).onChange(async (v) => {
            this.plugin.settings[key] = v.trim();
            await this.plugin.saveAll();
          }),
        );
    text("Relationship schema", "Path to relationships.yaml in this vault.", "relationshipsPath");
    text("Element types", "Path to element-types.yaml in this vault.", "elementTypesPath");
    text("Generated views folder", "Generated canvases are written here. Add this folder to .gitignore.", "viewsFolder");
    new Setting(containerEl)
      .setName("Note details on click")
      .setDesc("Clicking a note on a generated view (a canvas in the views folder) opens its properties and text in a popup. Uses Canvas internals that Obsidian does not document.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.showDetails).onChange(async (v) => {
          this.plugin.settings.showDetails = v;
          if (!v) this.plugin.detail?.close();
          await this.plugin.saveAll();
        }),
      );
    new Setting(containerEl)
      .setName("Canvas probe")
      .setDesc("Adds 'Relate selected notes' to the canvas right-click menu, to test whether Canvas editing is possible (Phase 0). Reload Obsidian after changing.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.canvasProbe).onChange(async (v) => {
          this.plugin.settings.canvasProbe = v;
          await this.plugin.saveAll();
        }),
      );
    new Setting(containerEl)
      .setName("Warm cache preview")
      .setDesc("Pre-release RTA-3 test only. Restore a validated local semantic cache before reconciling the vault. Keep off in controlled releases until the startup gate passes.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.warmCachePreview).onChange(async (v) => {
          this.plugin.settings.warmCachePreview = v;
          await this.plugin.saveAll();
        }),
      );
  }
}

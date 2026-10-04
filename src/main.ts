/**
 * MDSE Workbench, Phase 0 spike (WB-081, WB-090 gate R0).
 * Commands: diagnostics, rebuild index, explore Structure from the current note,
 * relate the current note to another, undo, and the Canvas probe.
 */
import { App, getLinkpath, normalizePath, Notice, parseYaml, Plugin, PluginSettingTab, Setting, TFile } from "obsidian";
import type { NoteRecord } from "./core/model";
import { planReconciliation, reconciliationMode, restoreSemanticState, serializeSemanticState } from "./core/cache";
import { readSemanticCacheGeneration, writeSemanticCacheGeneration } from "./core/cache-storage";
import { validateLocalModels } from "./core/localmodel";
import { optionsBetween } from "./core/rules";
import { editingBlocked, parseSchema, type Schema } from "./core/schema";
import { INTERNAL_PROFILE, PROFILES, signature, STRUCTURE_PROFILE, toCanvas, traverse, withLocalOccurrences, type ViewProfile } from "./core/views";
import { Indexer } from "./obsidian/indexer";
import { probeReport, registerSelectionMenu } from "./obsidian/probe";
import { ConfirmModal, ElementPicker, RelationshipPicker, ReportModal, ViewPicker } from "./obsidian/ui";
import { NoteDetailPanel } from "./obsidian/detail";
import { nodeAt, parseTranslate, undefinedName, type CanvasNodeJson } from "./core/detail";
import { ReviewView, REVIEW_VIEW } from "./obsidian/review";
import { RelationshipWriter } from "./obsidian/writer";
import { analyzeLocalModel, writeFindingsReport } from "./obsidian/localmodel";
import { clearWorkbenchCache, ObsidianCacheStorage, WORKBENCH_CACHE_ROOT } from "./obsidian/cache";

/** Quiet time with no cache activity before the first index build starts. */
const QUIET_START_MS = 8000; // fallback only when Obsidian's metadata "resolved" signal is not observed

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

interface Stored {
  settings: Settings;
  /** Generated canvas path → signature at generation, for stale-view checks (WB-035). */
  views: Record<string, { starts: string[]; profile: string; signature: string; at: number }>;
}

function localCardTarget(text: string | undefined): { target: string; localId: string } | null {
  const m = /\[\[([^#\]|]+)#\^([^\]|]+)(?:\|[^\]]*)?\]\]/.exec(text ?? "");
  return m ? { target: m[1].trim(), localId: m[2].trim() } : null;
}

export default class MdseWorkbench extends Plugin {
  settings: Settings = { ...DEFAULTS };
  views: Stored["views"] = {};
  schema: Schema | null = null;
  indexer: Indexer | null = null;
  writer: RelationshipWriter | null = null;
  lastFindingsMs = 0;
  detail: NoteDetailPanel | null = null;
  private statusEl: HTMLElement | null = null;
  private cacheWriteTimer: number | null = null;
  private lastCacheWriteAt: number | null = null;
  private lastCacheWriteMs: number | null = null;
  private lastCacheWriteError: string | null = null;
  private lastWarmRestore: string | null = null;
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
    this.addSettingTab(new WorkbenchSettings(this.app, this));
    this.statusEl = this.addStatusBarItem();
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

    this.addCommand({ id: "diagnostics", name: "Show diagnostics", callback: () => this.diagnostics() });
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
          localFindings: () => {
            const indexer = this.indexer as Indexer;
            const resolve = (target: string, from: string) => this.app.metadataCache.getFirstLinkpathDest(getLinkpath(target), from)?.path;
            return validateLocalModels({ index: indexer.index, local: indexer.local, resolve });
          },
        }),
    );
    this.addCommand({ id: "open-review", name: "Open Review", callback: () => void this.openReview() });
    this.addCommand({ id: "local-model-findings", name: "Check Local Model (write findings report)", callback: () => void this.checkLocalModel() });
    this.addRibbonIcon("list-checks", "Workbench Review", () => void this.openReview());
    this.registerEvent(this.app.metadataCache.on("changed", () => (this.lastChange = Date.now())));
    this.registerEvent(this.app.metadataCache.on("resolved", () => {
      this.metadataResolved = true;
    }));
    this.register(() => {
      this.unloaded = true;
      if (this.cacheWriteTimer !== null) window.clearTimeout(this.cacheWriteTimer);
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

  /**
   * Prefer Obsidian's own metadata/link-resolution completion signal over a fixed startup delay.
   * The quiet timer remains a conservative fallback for versions/environments that do not emit it
   * after Workbench loads.
   */
  private async whenVaultQuiet(): Promise<void> {
    while (!this.unloaded) {
      if (this.metadataResolved) return;
      if (Date.now() - this.lastChange >= QUIET_START_MS) return;
      await new Promise((r) => window.setTimeout(r, 250));
    }
  }

  async saveAll(): Promise<void> {
    await this.saveData({ settings: this.settings, views: this.views } satisfies Stored);
  }

  /**
   * RTA-2 save-only cache path. Runtime restore is intentionally not enabled yet.
   * The write happens after Workbench is already ready and only after a short quiet period,
   * so cache persistence cannot block startup usability.
   */
  private scheduleSemanticCacheWrite(): void {
    if (this.cacheWriteTimer !== null) window.clearTimeout(this.cacheWriteTimer);
    this.cacheWriteTimer = window.setTimeout(() => {
      this.cacheWriteTimer = null;
      if (this.unloaded) return;
      const indexer = this.indexer;
      if (!indexer?.stats || indexer.building || indexer.rebuildPending || Date.now() - this.lastChange < 1500) {
        if (indexer?.stats) this.scheduleSemanticCacheWrite();
        return;
      }
      void this.persistSemanticCache();
    }, 2000);
  }

  private async persistSemanticCache(): Promise<void> {
    const schema = this.schema;
    const indexer = this.indexer;
    if (!schema || !indexer || indexer.building || !indexer.stats) return;
    const t0 = performance.now();
    try {
      await indexer.whenLocalSettled();
      if (indexer.building || indexer.rebuildPending) {
        this.scheduleSemanticCacheWrite();
        return;
      }
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
    } catch (e) {
      // Cache is disposable. Failure is diagnostic only and never makes the model unavailable.
      this.lastCacheWriteMs = Math.round(performance.now() - t0);
      this.lastCacheWriteError = (e as Error).message;
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
    this.setRuntimeStatus("starting");
    try {
      this.schema = await this.loadSchema();
    } catch (e) {
      this.setRuntimeStatus("error", "schema");
      new Notice(`MDSE Workbench: could not read the schema files. ${(e as Error).message} Check the paths in settings.`);
      return;
    }

    const schema = this.schema;
    const firstStart = !this.indexer;
    if (!this.indexer) {
      this.indexer = new Indexer(this.app, schema);
      this.writer = new RelationshipWriter(this.app, () => this.schema as Schema, () => (this.indexer as Indexer).index);
      const schemaPaths = () => [normalizePath(this.settings.relationshipsPath), normalizePath(this.settings.elementTypesPath)];

      this.registerEvent(
        this.app.metadataCache.on("changed", (file) => {
          if (schemaPaths().includes(file.path)) return;
          this.indexer?.changed(file.path);
          if (this.indexer?.stats) this.scheduleSemanticCacheWrite();
        }),
      );
      this.registerEvent(this.app.vault.on("delete", (f) => {
        this.indexer?.removed(f.path);
        if (this.indexer?.stats) this.scheduleSemanticCacheWrite();
      }));
      this.registerEvent(
        this.app.vault.on("rename", (f, old) => {
          this.indexer?.removed(old);
          this.indexer?.changed(f.path);
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

    this.setRuntimeStatus("ready", `${stats.elements} elements · ${stats.mode}`);
    this.scheduleSemanticCacheWrite();
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
      this.lastWarmRestore = "cache cleared; next startup will rebuild from the vault";
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

  diagnostics(): void {
    if (!this.ready()) return;
    const s = this.indexer!.stats!;
    const schema = this.schema!;
    const t0 = performance.now();
    const f = this.indexer!.index.findings();
    this.lastFindingsMs = Math.round(performance.now() - t0);
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    const rows: Array<[string, string, boolean?]> = [
      ["Index mode", s.mode],
      ["Markdown files", String(s.files)],
      ["Notes with properties", String(s.notes)],
      ["Model notes", String(s.elements)],
      ["Authored links", String(s.links)],
      ["Startup quiet wait", this.lastStartupWaitMs === null ? "not measured" : `${(this.lastStartupWaitMs / 1000).toFixed(2)} s`],
      ["Index build", `${(s.ms / 1000).toFixed(2)} s (target under 60 s)`, s.ms > 60000],
      ["Findings scan", `${this.lastFindingsMs} ms`],
      ["Missing inverses", String(f.missingInverse.length), f.missingInverse.length > 0],
      ["Inverses with no forward link", String(f.orphanInverse.length), f.orphanInverse.length > 0],
      ["Links that break endpoint rules", String(f.offRule.length)],
      ["Provisional links (tracesTo)", String(f.provisional.length)],
      ["Unresolved relationship links", String(f.unresolvedLinks), f.unresolvedLinks > 0],
      ["relationships.yaml", schema.relationshipsVersion],
      ["element-types.yaml", schema.elementTypesVersion],
      ["Editing", editingBlocked(schema) ? "off (schema too old)" : "on", editingBlocked(schema)],
      ["Semantic cache mode", this.settings.warmCachePreview ? "warm restore preview enabled" : "save-only"],
      ["Warm restore", this.lastWarmRestore ?? "not attempted"],
      ["Semantic cache", this.lastCacheWriteError ? `write failed: ${this.lastCacheWriteError}` : this.lastCacheWriteAt ? `saved ${new Date(this.lastCacheWriteAt).toLocaleTimeString()}` : "not written yet", !!this.lastCacheWriteError],
      ["Semantic cache write", this.lastCacheWriteMs === null ? "not measured" : `${this.lastCacheWriteMs} ms`],
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
    await indexer.whenLocalSettled();
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

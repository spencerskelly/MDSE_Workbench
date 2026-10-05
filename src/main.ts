/**
 * MDSE Workbench, Phase 0 spike (WB-081, WB-090 gate R0).
 * Commands: diagnostics, rebuild index, explore Structure from the current note,
 * relate the current note to another, undo, and the Canvas probe.
 */
import { App, getLinkpath, normalizePath, Notice, parseYaml, Plugin, PluginSettingTab, Setting, TFile } from "obsidian";
import type { NoteRecord } from "./core/model";
import { summarizeRuntimeHealth } from "./core/runtime-health";
import { BACKGROUND_MAX_DEFERRAL_MS, BACKGROUND_RESUME_QUIET_MS, canRunBackgroundWork, canStartRuntimeWork, type RuntimeWorkKind } from "./core/background";
import { CACHE_PERSIST_QUIET_MS, cachePersistenceDelayMs } from "./core/cache-persistence";
import { CacheMutationGate } from "./core/cache-mutation";
import { TransactionManager } from "./core/transaction";
import { ModelEditService } from "./core/model-edit";
import { DefinitionCreationService, nextAvailableDefinitionUid, normalizeAuthorSuffix, type StagedDefinitionCreation } from "./core/definition-create";
import { DefinitionDeletionService } from "./core/definition-delete";
import { DefinitionRetirementService } from "./core/definition-retire";
import { DefinitionSupersessionService } from "./core/definition-supersede-service";
import { definitionMigrationCandidates, type DefinitionMigrationCandidate } from "./core/definition-supersede";
import { DefinitionNoteMigrationService } from "./core/definition-note-migrate-service";
import { assertDefinitionSourceUid, planDefinitionOccurrenceMigration } from "./core/definition-migrate";
import type { DefinitionDeletionImpact } from "./core/definition-lifecycle";
import { canPublishCoreReady } from "./core/core-readiness";
import { recoverWithColdBuild } from "./core/startup-recovery";
import { formatCacheBytes } from "./core/cache-size";
import { scheduleStartupHandoff } from "./core/startup-handoff";
import { cacheDirtyBucketsForPaths, planReconciliation, reconciliationMode, restoreCoreSemanticState, restoreSemanticState, serializeSemanticState } from "./core/cache";
import { readCoreCacheGeneration, readSemanticCacheGeneration, writeSemanticCacheGeneration } from "./core/cache-storage";
import { parseLocalModel, validateLocalModels } from "./core/localmodel";
import { optionsBetween } from "./core/rules";
import { editingBlocked, parseSchema, type Schema } from "./core/schema";
import { editingBlockedReason } from "./core/edit-availability";
import { INTERNAL_PROFILE, PROFILES, profileNeedsLocalOccurrences, signature, STRUCTURE_PROFILE, toCanvas, traverse, withLocalOccurrences, type ViewProfile } from "./core/views";
import { Indexer } from "./obsidian/indexer";
import { probeReport, registerSelectionMenu } from "./obsidian/probe";
import { ConfirmModal, ElementPicker, RelationshipPicker, ReportModal, ViewPicker } from "./obsidian/ui";
import { NoteDetailPanel } from "./obsidian/detail";
import { nodeAt, parseTranslate, undefinedName, type CanvasNodeJson } from "./core/detail";
import { ReviewView, REVIEW_VIEW } from "./obsidian/review";
import { RelationshipWriter } from "./obsidian/writer";
import { analyzeLocalModel, writeFindingsReport } from "./obsidian/localmodel";
import { clearWorkbenchCache, ObsidianCacheStorage, WORKBENCH_CACHE_ROOT, workbenchCacheSizeBytes } from "./obsidian/cache";
import { AssuranceManager, type AssuranceSnapshot } from "./obsidian/assurance";

/** Quiet time with no cache activity before the first index build starts. */
const QUIET_START_MS = 8000; // fallback only when Obsidian's metadata "resolved" signal is not observed
const CORE_AFTER_METADATA_DELAY_MS = 1000;
const LOCAL_BACKGROUND_DELAY_MS = 3000;

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
  /** 13 ASCII letters used as the governed creator suffix for newly created note UIDs. */
  creatorSuffix: string;
}

const DEFAULTS: Settings = {
  relationshipsPath: "99_System/03_Schemas/relationships.yaml",
  elementTypesPath: "99_System/03_Schemas/element-types.yaml",
  viewsFolder: "Workbench Views",
  canvasProbe: true,
  showDetails: true,
  warmCachePreview: false,
  creatorSuffix: "",
};

interface RuntimeSample {
  at: number;
  mode: "full" | "restored" | "reconciled";
  files: number;
  elements: number;
  coreMs: number;
  /** User-visible elapsed time from Workbench startup handoff to core model readiness. Optional for pre-W-360 local history. */
  timeToCoreReadyMs?: number | null;
  /** User-visible elapsed time from Workbench startup handoff until occurrence data is fully usable. */
  timeToOccurrenceReadyMs?: number | null;
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
  /** Context edits apply atomically; structural Local Model edits require service-enforced Review before Apply, new Local Model identities retry collisions at +1 ms, empty Object owners can create their first part occurrence directly, all current Local Model definitions use indexed model-note pickers, endpoint part assignment clears parent atomically, flow endpoint-role edits are staged, a flow can move between existing connections through one reviewed structural transaction without changing its identity, occurrence details expose the canonical reusable definition lazily, definition editing launched from an occurrence uses the canonical note editor with an explicit return to that occurrence, complete note/occurrence impact evidence is available, each used-definition mutation consumes one explicit impact review before Apply regardless of whether the canonical definition was opened from an occurrence or directly, direct canonical model notes expose the same Review impact entry point before edit mode, retirement/supersession/deletion lifecycle actions are available from any canonical reusable-definition view while retaining the same guarded lifecycle services, new reusable definitions have a pure governed creation planner, definition-note creation uses structural Review/Apply/Cancel with guarded history, creator identity is explicit, the definition creation service is bound to real vault storage plus shared semantic history, missing part/endpoint/flow definition workflows stage and visibly review both definition creation and occurrence binding before either Apply begins, a failed second-stage binding exposes a guarded rollback that can only undo the still-latest definition creation, destructive reusable-definition deletion is blocked by active references, deletion uses structural Review/Apply/Cancel with guarded history, the deletion service is bound to real vault storage plus fully hydrated impact evidence, non-destructive retirement is runtime-integrated, reusable-definition supersession is runtime-integrated with complete migration evidence and semantic link resolution prevents duplicate alternate-link relationships, guided Local Model migration verifies the expected old definition from fresh source before staging, the supersession UI supports one reviewed occurrence migration at a time, note-level guided migration has a relationship-safe planner and governed runtime service with forward- and inverse-authored paired relationship support, and paired migration fails closed on missing or duplicate inverse state instead of silently repairing it, and the supersession UI refreshes live dependent inventory after each reviewed occurrence or note migration so multiple migrations can continue in one session without stale candidates, while post-apply refresh failures are reported separately and never misstate a committed migration as unapplied; note migration also removes relationship properties that become empty instead of persisting empty arrays; lifecycle impact queries scan both forward- and inverse-authored governed relationships rather than only forward graph edges; supersession relationship writes also fail closed when any existing relationship target cannot be semantically resolved; shared governed relationship removal keeps frontmatter sparse by deleting a relationship property when its final target is removed; when supersession migration reaches zero remaining engineering dependents, the UI marks migration complete and may hand off to a separate governed retirement review without auto-retiring the replaced definition; lifecycle provenance relationships (supersedes/supersededBy) remain impact evidence but are excluded from migration candidates; retirement Apply revalidates the complete reviewed impact inventory and refuses stale evidence; destructive deletion keeps lifecycle provenance authoritative, so a superseded definition remains blocked from deletion while any supersedes/supersededBy reference still points to it; retirement redo also revalidates the reviewed dependency inventory so semantic history cannot reapply retirement after new dependents appear; supersession redo likewise revalidates the reviewed dependency inventory before restoring the paired lifecycle relationships; deletion redo also treats newly appeared lifecycle provenance as an active reference and refuses destructive replay; supersession undo relies on the unified chronological semantic-history stack, so newer migration edits must be undone before the supersession relationship pair can be removed; note-level paired relationship migration undo is atomic across all affected files and rolls back partial reverts on write failure; redo is likewise atomic and restores earlier files to the pre-redo state if a later paired-file write fails; guided occurrence migration carries a target-validity semantic guard so Apply and Redo refuse a missing replacement definition even when the owner note is otherwise unchanged; note-level migration also verifies replacement existence at Stage, Apply, and Redo, including one-way relationships where the replacement note is not otherwise part of the affected write set; governed definition creation undo revalidates complete lifecycle impact and refuses removal once active note or occurrence references exist; creation redo revalidates both destination-path availability and global UID uniqueness after undo, preventing semantic identity collision before recreating the canonical note; definition deletion undo likewise revalidates global UID uniqueness before restoring a deleted canonical definition, so external post-delete identity reuse cannot create duplicate durable identities; deletion Stage also validates the caller UID against the source note frontmatter before Review, preventing stale UI/index identity from opening a transaction for the wrong canonical definition; retirement Stage applies the same source-UID validation before Review; supersession Stage likewise validates both replaced and replacement UIDs against their canonical source YAML before opening Review, with regressions covering stale identity on either side of the pair; supersession class compatibility and replacement retirement warning are derived from those fresh source notes rather than cached caller type/status; note-level relationship migration Stage validates owner, replaced, and replacement UIDs against fresh canonical source YAML before Review, and pins replacement UID through Apply/Redo even for one-way relationships where the replacement note is not otherwise in the affected write set; staged structural Local Model patches validate indexed owner UID against the freshly read owner note before Review, closing the same stale-identity gap for occurrence migration; structural Local Model create, flow-move, and delete transactions now use the same fresh owner-UID proof before Review, and the immediate atomic Local Model patch path uses that same assertion before writing; the immediate atomic Local Model patch path uses that same source-identity assertion before writing, with explicit regression coverage. the immediate atomic Local Model patch path also validates indexed owner UID against fresh source before writing, so every Local Model edit entry point shares the same owner-identity invariant; occurrence migration also pins the indexed replacement definition UID and revalidates that UID against fresh source YAML at Stage and through the Apply/Redo semantic guard, so in-place path identity swaps fail closed; direct occurrence definition binding now uses the same durable-UID pinning and semantic-guard path, with shared regression coverage proving the guard runs on both Apply and Redo. */
  modelEditor: ModelEditService | null = null;
  /** Canonical reusable-definition creation shares the same semantic transaction history. */
  definitionCreator: DefinitionCreationService | null = null;
  /** Destructive definition deletion is governed by complete impact evidence and shared history. */
  definitionDeleter: DefinitionDeletionService | null = null;
  /** Non-destructive retirement shares complete impact evidence and semantic history. */
  definitionRetirer: DefinitionRetirementService | null = null;
  /** Supersession records replacement intent while leaving dependent migration explicit. */
  definitionSuperseder: DefinitionSupersessionService | null = null;
  /** Guided note-level supersession migration preserves relationship pairing in one transaction. */
  definitionNoteMigrator: DefinitionNoteMigrationService | null = null;
  /** One semantic history stack for every Workbench model writer (WB-114). */
  private readonly transactions = new TransactionManager();
  detail: NoteDetailPanel | null = null;
  private statusEl: HTMLElement | null = null;
  private cancelStartupHandoff: (() => void) | null = null;
  private healthRefreshTimer: number | null = null;
  private localBackgroundTimer: number | null = null;
  private cacheWriteTimer: number | null = null;
  private cacheWriteTask: Promise<void> | null = null;
  private readonly cacheMutationGate = new CacheMutationGate();
  private lastCacheWriteAt: number | null = null;
  private lastCacheWriteMs: number | null = null;
  private lastCacheWriteError: string | null = null;
  private lastSchemaError: string | null = null;
  private lastCoreError: string | null = null;
  private lastOccurrenceError: string | null = null;
  private lastCachedRevision: number | null = null;
  private lastWarmRestore: string | null = null;
  private assurance: AssuranceManager | null = null;
  private lastStartupWaitMs: number | null = null;
  private lastTimeToCoreReadyMs: number | null = null;
  private lastTimeToOccurrenceReadyMs: number | null = null;
  private startupRunStartedAt: number | null = null;
  /** Explicit publication gate: restored/build stats are internal until source validation settles. */
  private coreReadyPublished = false;
  private startPromise: Promise<void> | null = null;
  private pendingRebuild = false;
  /** Last foreground model/UI activity; background subsystems share this preemption signal. */
  private lastChange = Date.now();
  /** First time each optional background lane became pending; intermittent edits must not starve it forever. */
  private readonly backgroundPendingSince = new Map<"backgroundHydration" | "assurance" | "cacheWrite", number>();
  /** Latched once Obsidian says its metadata/link-resolution pass is complete. */
  private metadataResolved = false;
  /** Disposable integration-vault probe; absent in normal vaults. */
  private integrationProbe: { launchStartedAt: number; noteCount?: number; label?: string } | null = null;
  private integrationPluginLoadedAt: number | null = null;
  private integrationMetadataResolvedAt: number | null = null;
  private integrationMetadataCoverageAt: number | null = null;
  private unloaded = false;

  async onload(): Promise<void> {
    const stored = ((await this.loadData()) ?? {}) as Partial<Stored>;
    this.settings = { ...DEFAULTS, ...(stored.settings ?? {}) };
    this.views = stored.views ?? {};
    this.runtimeHistory = Array.isArray(stored.runtimeHistory) ? stored.runtimeHistory.slice(-20) : [];
    await this.loadIntegrationProbe();
    this.addSettingTab(new WorkbenchSettings(this.app, this));
    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass("mod-clickable");
    this.registerDomEvent(this.statusEl, "click", () => this.showRuntimeHealth());
    this.setRuntimeStatus("starting");
    this.detail = new NoteDetailPanel(this.app, {
      schema: () => this.schema,
      writer: () => this.writer,
      modelEditor: () => this.modelEditor,
      editBlocked: () => editingBlockedReason(this.isReady(), this.schema),
      elements: (exclude) => this.elements().filter((r) => r.path !== exclude),
      relate: (a, b) => this.relate(a, b),
      undo: () => this.undo(),
      pickView: (path) => this.pickView(path),
      definitionImpact: (path) => this.definitionImpact(path),
      stageDefinitionCreation: (kind, name, path) => this.stageDefinitionCreation(kind, name, path),
      applyDefinitionCreation: (transactionId) => this.applyDefinitionCreation(transactionId),
      cancelDefinitionCreation: (transactionId) => this.cancelDefinitionCreation(transactionId),
      rollbackDefinitionCreation: (transactionId) => this.rollbackDefinitionCreation(transactionId),
      stageDefinitionDeletion: (path, uid) => this.stageDefinitionDeletion(path, uid),
      applyDefinitionDeletion: (transactionId) => this.applyDefinitionDeletion(transactionId),
      cancelDefinitionDeletion: (transactionId) => this.cancelDefinitionDeletion(transactionId),
      stageDefinitionRetirement: (path, uid) => this.stageDefinitionRetirement(path, uid),
      applyDefinitionRetirement: (transactionId) => this.applyDefinitionRetirement(transactionId),
      cancelDefinitionRetirement: (transactionId) => this.cancelDefinitionRetirement(transactionId),
      stageDefinitionSupersession: (replacedPath, replacedUid, replacedType, replacementPath) => this.stageDefinitionSupersession(replacedPath, replacedUid, replacedType, replacementPath),
      applyDefinitionSupersession: (transactionId) => this.applyDefinitionSupersession(transactionId),
      cancelDefinitionSupersession: (transactionId) => this.cancelDefinitionSupersession(transactionId),
      stageDefinitionOccurrenceMigration: (ownerPath, localId, replacedPath, replacementPath) => this.stageDefinitionOccurrenceMigration(ownerPath, localId, replacedPath, replacementPath),
      applyDefinitionOccurrenceMigration: (transactionId) => this.applyOccurrenceDefinitionBinding(transactionId),
      cancelDefinitionOccurrenceMigration: (transactionId) => this.cancelOccurrenceDefinitionBinding(transactionId),
      stageDefinitionNoteMigration: (ownerPath, field, replacedPath, replacementPath) => this.stageDefinitionNoteMigration(ownerPath, field, replacedPath, replacementPath),
      definitionSupersessionMigrationCandidates: (replacedPath) => this.definitionSupersessionMigrationCandidates(replacedPath),
      applyDefinitionNoteMigration: (transactionId) => this.applyDefinitionNoteMigration(transactionId),
      cancelDefinitionNoteMigration: (transactionId) => this.cancelDefinitionNoteMigration(transactionId),
      stageOccurrenceDefinitionBinding: (ownerPath, localId, definitionPath) => this.stageOccurrenceDefinitionBinding(ownerPath, localId, definitionPath),
      applyOccurrenceDefinitionBinding: (transactionId) => this.applyOccurrenceDefinitionBinding(transactionId),
      cancelOccurrenceDefinitionBinding: (transactionId) => this.cancelOccurrenceDefinitionBinding(transactionId),
    });
    this.addChild(this.detail);
    this.registerDetailClicks();

    // Keep lightweight runtime health/history available during startup. Whole-model diagnostics
    // and cache inspection are nonessential and stay unavailable until the core model is ready.
    this.addCommand({
      id: "diagnostics",
      name: "Show diagnostics",
      checkCallback: (checking) => {
        if (!this.isReady()) return false;
        if (!checking) void this.diagnostics();
        return true;
      },
    });
    this.addCommand({ id: "runtime-health", name: "Show runtime health", callback: () => this.showRuntimeHealth() });
    this.addCommand({ id: "runtime-history", name: "Show runtime history", callback: () => this.showRuntimeHistory() });
    this.addCommand({
      id: "inspect-semantic-cache",
      name: "Inspect semantic cache",
      checkCallback: (checking) => {
        if (!this.isReady()) return false;
        if (!checking) void this.inspectSemanticCache();
        return true;
      },
    });
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
    this.addCommand({ id: "redo", name: "Redo last Workbench edit", callback: () => this.redo() });
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
    this.registerEvent(this.app.metadataCache.on("changed", () => this.markForegroundActivity()));
    this.registerEvent(this.app.metadataCache.on("resolved", () => {
      this.metadataResolved = true;
      if (this.integrationProbe && this.integrationMetadataResolvedAt === null) {
        this.integrationMetadataResolvedAt = Date.now();
      }
      this.indexer?.linkResolutionSettled();
    }));
    this.register(() => {
      this.unloaded = true;
      this.cancelStartupHandoff?.();
      this.cancelStartupHandoff = null;
      if (this.cacheWriteTimer !== null) window.clearTimeout(this.cacheWriteTimer);
      if (this.healthRefreshTimer !== null) window.clearTimeout(this.healthRefreshTimer);
      if (this.localBackgroundTimer !== null) window.clearTimeout(this.localBackgroundTimer);
    });
    this.app.workspace.onLayoutReady(() => {
      // Startup safety slice: onLayoutReady only enqueues Workbench. The shared handoff helper
      // guarantees that this call stack returns before schemas, indexes, caches, Local Models,
      // assurance, or any other Workbench startup work can run.
      const handoff = scheduleStartupHandoff(
        (run) => window.setTimeout(run, 0),
        (handle) => window.clearTimeout(handle as number),
        () => {
          this.cancelStartupHandoff = null;
          if (!this.unloaded) void this.start(false);
        },
      );
      this.cancelStartupHandoff = handoff.cancel;
    });
  }

  private definitionUidInUse(uid: string): boolean {
    const indexer = this.indexer;
    if (indexer) {
      for (const note of indexer.index.notes.values()) if (note.uid === uid) return true;
    }
    for (const file of this.app.vault.getMarkdownFiles()) {
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
      if (fm?.uid === uid) return true;
    }
    return false;
  }

  private stageDefinitionCreation(
    kind: "part" | "endpoint" | "connection" | "flow",
    name: string,
    path: string,
  ): StagedDefinitionCreation {
    const creator = this.definitionCreator;
    if (!creator || !this.isReady()) throw new Error("Workbench is still starting.");
    const suffix = normalizeAuthorSuffix(this.settings.creatorSuffix);
    const uid = nextAvailableDefinitionUid(suffix, (candidate) => this.definitionUidInUse(candidate));
    return creator.stageAndReview({ localKind: kind, name, uid, path });
  }

  private async applyDefinitionCreation(transactionId: string): Promise<void> {
    const creator = this.definitionCreator;
    if (!creator) throw new Error("Definition creation is unavailable.");
    await creator.apply(transactionId);
  }

  private cancelDefinitionCreation(transactionId: string): void {
    const creator = this.definitionCreator;
    if (!creator) throw new Error("Definition creation is unavailable.");
    creator.cancel(transactionId);
  }

  private async rollbackDefinitionCreation(transactionId: string): Promise<void> {
    const creator = this.definitionCreator;
    if (!creator) throw new Error("Definition creation is unavailable.");
    await creator.rollbackApplied(transactionId);
  }

  private async stageDefinitionDeletion(path: string, uid: string) {
    const deleter = this.definitionDeleter;
    if (!deleter || !this.isReady()) throw new Error("Definition deletion is unavailable while Workbench is starting.");
    return deleter.stageAndReview(normalizePath(path), uid);
  }

  private async applyDefinitionDeletion(transactionId: string): Promise<void> {
    const deleter = this.definitionDeleter;
    if (!deleter) throw new Error("Definition deletion is unavailable.");
    await deleter.apply(transactionId);
  }

  private cancelDefinitionDeletion(transactionId: string): void {
    const deleter = this.definitionDeleter;
    if (!deleter) throw new Error("Definition deletion is unavailable.");
    deleter.cancel(transactionId);
  }

  private async stageDefinitionRetirement(path: string, uid: string) {
    const retirer = this.definitionRetirer;
    if (!retirer || !this.isReady()) throw new Error("Definition retirement is unavailable while Workbench is starting.");
    return retirer.stageAndReview(normalizePath(path), uid);
  }

  private async applyDefinitionRetirement(transactionId: string): Promise<void> {
    const retirer = this.definitionRetirer;
    if (!retirer) throw new Error("Definition retirement is unavailable.");
    await retirer.apply(transactionId);
  }

  private cancelDefinitionRetirement(transactionId: string): void {
    const retirer = this.definitionRetirer;
    if (!retirer) throw new Error("Definition retirement is unavailable.");
    retirer.cancel(transactionId);
  }

  private async stageDefinitionSupersession(
    replacedPath: string,
    replacedUid: string,
    replacedType: string,
    replacementPath: string,
  ) {
    const superseder = this.definitionSuperseder;
    const indexer = this.indexer;
    if (!superseder || !indexer || !this.isReady()) throw new Error("Definition supersession is unavailable while Workbench is starting.");

    const replacement = indexer.index.notes.get(normalizePath(replacementPath));
    if (!replacement?.uid || !replacement.type) throw new Error("Replacement must be an indexed model definition with type and uid.");
    if (replacement.type !== replacedType) throw new Error(`Replacement must be the same model class (${replacedType}).`);

    const file = this.app.vault.getAbstractFileByPath(replacement.path);
    if (!(file instanceof TFile)) throw new Error("Replacement definition no longer exists.");
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
    const replacementStatus = typeof fm?.status === "string" ? fm.status : null;

    return superseder.stageAndReview({
      replacedPath: normalizePath(replacedPath),
      replacedUid,
      replacedType,
      replacementPath: replacement.path,
      replacementUid: replacement.uid,
      replacementType: replacement.type,
      replacementStatus,
    });
  }

  private async applyDefinitionSupersession(transactionId: string): Promise<void> {
    const superseder = this.definitionSuperseder;
    if (!superseder) throw new Error("Definition supersession is unavailable.");
    await superseder.apply(transactionId);
  }

  private cancelDefinitionSupersession(transactionId: string): void {
    const superseder = this.definitionSuperseder;
    if (!superseder) throw new Error("Definition supersession is unavailable.");
    superseder.cancel(transactionId);
  }

  private async stageDefinitionOccurrenceMigration(
    ownerPath: string,
    localId: string,
    replacedPath: string,
    replacementPath: string,
  ) {
    const editor = this.modelEditor;
    const indexer = this.indexer;
    if (!editor || !indexer) throw new Error("Workbench is still starting.");

    const normalizedOwner = normalizePath(ownerPath);
    const ownerFile = this.app.vault.getAbstractFileByPath(normalizedOwner);
    if (!(ownerFile instanceof TFile)) throw new Error(`${normalizedOwner} no longer exists.`);

    const source = await this.app.vault.read(ownerFile);
    const local = parseLocalModel(source);
    const record = local?.records.find((candidate) => candidate.localId === localId);
    if (!record) throw new Error(`Occurrence ^${localId} no longer exists in ${normalizedOwner}.`);

    const currentDefinitionPath = record.definition?.target
      ? this.app.metadataCache.getFirstLinkpathDest(getLinkpath(record.definition.target), normalizedOwner)?.path ?? null
      : null;

    const plan = planDefinitionOccurrenceMigration({
      ownerPath: normalizedOwner,
      localId,
      currentDefinitionPath,
      replacedPath: normalizePath(replacedPath),
      replacementPath: normalizePath(replacementPath),
    });

    const normalizedReplacement = normalizePath(replacementPath);
    const indexedReplacement = indexer.index.notes.get(normalizedReplacement);
    if (!indexedReplacement?.uid) {
      throw new Error(`${normalizedReplacement} is not an indexed model definition with a durable uid.`);
    }
    const replacementUid = indexedReplacement.uid;
    const replacementFile = this.app.vault.getAbstractFileByPath(normalizedReplacement);
    if (!(replacementFile instanceof TFile)) throw new Error(`${normalizedReplacement} no longer exists.`);
    const validateReplacementIdentity = async (): Promise<void> => {
      const currentReplacement = this.app.vault.getAbstractFileByPath(normalizedReplacement);
      if (!(currentReplacement instanceof TFile)) {
        throw new Error(`${normalizedReplacement} no longer exists; reopen supersession migration review.`);
      }
      const text = await this.app.vault.read(currentReplacement);
      assertDefinitionSourceUid(text, normalizedReplacement, replacementUid);
    };
    await validateReplacementIdentity();

    return editor.stageAndReviewLocalRecordPatch(
      normalizedOwner,
      localId,
      { fields: { definition: plan.definitionLink } },
      validateReplacementIdentity,
    );
  }

  private async definitionSupersessionMigrationCandidates(replacedPath: string): Promise<DefinitionMigrationCandidate[]> {
    const impact = await this.definitionDeletionImpact(normalizePath(replacedPath));
    return definitionMigrationCandidates(impact);
  }

  private async stageDefinitionNoteMigration(
    ownerPath: string,
    field: string,
    replacedPath: string,
    replacementPath: string,
  ) {
    const migrator = this.definitionNoteMigrator;
    const schema = this.schema;
    const indexer = this.indexer;
    if (!migrator || !schema || !indexer || !this.isReady()) {
      throw new Error("Definition relationship migration is unavailable while Workbench is starting.");
    }

    const relationship = schema.byField.get(field) ?? schema.byInverse.get(field);
    if (!relationship) throw new Error(`${field} is not a governed relationship field.`);

    const normalizedOwner = normalizePath(ownerPath);
    const normalizedReplaced = normalizePath(replacedPath);
    const normalizedReplacement = normalizePath(replacementPath);
    const owner = indexer.index.notes.get(normalizedOwner);
    const replaced = indexer.index.notes.get(normalizedReplaced);
    const replacement = indexer.index.notes.get(normalizedReplacement);

    if (!owner) throw new Error(`${normalizedOwner} is not an indexed model note.`);
    if (!replaced) throw new Error(`${normalizedReplaced} is not an indexed model definition.`);
    if (!replacement) throw new Error(`${normalizedReplacement} is not an indexed model definition.`);

    return migrator.stageAndReview({
      ownerPath: normalizedOwner,
      ownerUid: owner.uid,
      field,
      replacedPath: normalizedReplaced,
      replacedUid: replaced.uid,
      replacementPath: normalizedReplacement,
      replacementUid: replacement.uid,
      relationship,
    });
  }

  private async applyDefinitionNoteMigration(transactionId: string): Promise<void> {
    const migrator = this.definitionNoteMigrator;
    if (!migrator) throw new Error("Definition relationship migration is unavailable.");
    await migrator.apply(transactionId);
  }

  private cancelDefinitionNoteMigration(transactionId: string): void {
    const migrator = this.definitionNoteMigrator;
    if (!migrator) throw new Error("Definition relationship migration is unavailable.");
    migrator.cancel(transactionId);
  }

  private async stageOccurrenceDefinitionBinding(
    ownerPath: string,
    localId: string,
    definitionPath: string,
  ) {
    const editor = this.modelEditor;
    const indexer = this.indexer;
    if (!editor || !indexer) throw new Error("Workbench is still starting.");

    const normalized = normalizePath(definitionPath);
    const indexedDefinition = indexer.index.notes.get(normalized);
    if (!indexedDefinition?.uid) {
      throw new Error(`${normalized} is not an indexed model definition with a durable uid.`);
    }
    const definitionUid = indexedDefinition.uid;
    const validateDefinitionIdentity = async (): Promise<void> => {
      const file = this.app.vault.getAbstractFileByPath(normalized);
      if (!(file instanceof TFile)) {
        throw new Error(`${normalized} no longer exists; reopen occurrence definition review.`);
      }
      const text = await this.app.vault.read(file);
      assertDefinitionSourceUid(text, normalized, definitionUid);
    };
    await validateDefinitionIdentity();

    const definitionLink = `[[${normalized.replace(/\.md$/i, "")}]]`;
    return editor.stageAndReviewLocalRecordPatch(
      ownerPath,
      localId,
      { fields: { definition: definitionLink } },
      validateDefinitionIdentity,
    );
  }

  private async applyOccurrenceDefinitionBinding(transactionId: string): Promise<void> {
    const editor = this.modelEditor;
    if (!editor) throw new Error("Workbench is still starting.");
    await editor.applyLocalPatch(transactionId);
  }

  private cancelOccurrenceDefinitionBinding(transactionId: string): void {
    const editor = this.modelEditor;
    if (!editor) throw new Error("Workbench is still starting.");
    editor.cancelLocalPatch(transactionId);
  }

  private async definitionDeletionImpact(path: string): Promise<DefinitionDeletionImpact> {
    const indexer = this.indexer;
    if (!indexer || !this.isReady()) throw new Error("Workbench is still starting.");

    // Destructive lifecycle decisions require complete evidence, never the bounded retained subset.
    await indexer.whenSourceSettled();
    await indexer.whenLocalSettled(true);

    const normalized = normalizePath(path);
    const noteUses = indexer.index.authoredUsesOf(normalized).map((use) => ({
      fromPath: use.from,
      field: use.field,
    }));
    const occurrenceUses = indexer.local.occurrencesOf(
      normalized,
      (target, fromPath) => this.app.metadataCache.getFirstLinkpathDest(target, fromPath)?.path,
    ).map(({ path: ownerPath, record }) => ({
      ownerPath,
      localId: record.localId,
      kind: record.kind,
      identifier: record.identifier,
    }));

    return { definitionPath: normalized, noteUses, occurrenceUses };
  }

  private async definitionImpact(path: string): Promise<{ rows: string[]; notes: number; occurrences: number }> {
    const indexer = this.indexer;
    if (!indexer || !this.isReady()) throw new Error("Workbench is still starting.");

    // Impact review is an explicit foreground request, so complete occurrence hydration before
    // reporting usage. This avoids presenting a partial Where Used result from bounded retention.
    await indexer.whenSourceSettled();
    await indexer.whenLocalSettled(true);

    const noteUses = indexer.index.authoredUsesOf(path).slice().sort((a, b) =>
      a.from.localeCompare(b.from) || a.field.localeCompare(b.field)
    );
    const occurrences = indexer.local.occurrencesOf(
      path,
      (target, fromPath) => this.app.metadataCache.getFirstLinkpathDest(target, fromPath)?.path,
    ).sort((a, b) =>
      a.path.localeCompare(b.path) ||
      a.record.kind.localeCompare(b.record.kind) ||
      a.record.identifier.localeCompare(b.record.identifier)
    );

    const rows: string[] = [];
    if (noteUses.length) {
      rows.push("Note-level uses:");
      for (const use of noteUses) {
        const source = indexer.index.notes.get(use.from);
        rows.push(`- ${source?.name ?? use.from} — ${use.field}`);
      }
    }
    if (occurrences.length) {
      if (rows.length) rows.push("");
      rows.push("Local Model occurrences:");
      for (const occurrence of occurrences) {
        const owner = indexer.index.notes.get(occurrence.path);
        rows.push(`- ${owner?.name ?? occurrence.path} — ${occurrence.record.kind} ${occurrence.record.identifier} (^${occurrence.record.localId})`);
      }
    }
    return { rows, notes: noteUses.length, occurrences: occurrences.length };
  }

  private async loadIntegrationProbe(): Promise<void> {
    try {
      const raw = await this.app.vault.adapter.read(".mdse_integration_probe.json");
      const parsed = JSON.parse(raw) as { launchStartedAt?: unknown; noteCount?: unknown; label?: unknown };
      if (typeof parsed.launchStartedAt !== "number") return;
      this.integrationProbe = {
        launchStartedAt: parsed.launchStartedAt,
        noteCount: typeof parsed.noteCount === "number" ? parsed.noteCount : undefined,
        label: typeof parsed.label === "string" ? parsed.label : undefined,
      };
      this.integrationPluginLoadedAt = Date.now();
    } catch {
      // Normal vaults have no integration sentinel.
    }
  }

  private async updateIntegrationResult(patch: Record<string, unknown>): Promise<void> {
    if (!this.integrationProbe) return;
    try {
      const path = ".mdse_integration_result.json";
      const current = JSON.parse(await this.app.vault.adapter.read(path)) as Record<string, unknown>;
      await this.app.vault.adapter.write(path, JSON.stringify({ ...current, ...patch }, null, 2) + "\n");
    } catch {
      // Core-ready creates the result file; later occurrence/cache milestones are best-effort.
    }
  }

  private async writeIntegrationColdResult(stats: NonNullable<Indexer["stats"]>): Promise<void> {
    const probe = this.integrationProbe;
    if (!probe) return;
    const coreReadyAt = Date.now();
    let readableAt: number | null = null;
    let readableSource: string | null = null;
    try {
      const raw = JSON.parse(await this.app.vault.adapter.read(".mdse_integration_readable.json")) as { at?: unknown; source?: unknown };
      if (typeof raw.at === "number") {
        readableAt = raw.at;
        readableSource = typeof raw.source === "string" ? raw.source : "external-controller";
      }
    } catch {
      // Step 49/50 validator fails closed if the controller did not observe the vault renderer.
    }
    let metadataResolvedAt = this.integrationMetadataResolvedAt;
    let metadataResolutionSource = metadataResolvedAt === null ? null : "workbench-resolved-event";
    if (metadataResolvedAt === null) {
      try {
        const raw = JSON.parse(await this.app.vault.adapter.read(".mdse_integration_metadata.json")) as { at?: unknown; source?: unknown };
        if (typeof raw.at === "number") {
          metadataResolvedAt = raw.at;
          metadataResolutionSource = typeof raw.source === "string" ? raw.source : "external-observer";
        }
      } catch {
        // The integration validator will fail closed if neither Workbench nor the controller
        // observed real Obsidian metadata resolution.
      }
    }
    const result = {
      label: probe.label ?? "cold-integration",
      noteCount: probe.noteCount ?? stats.files,
      launchStartedAt: probe.launchStartedAt,
      pluginLoadedAt: this.integrationPluginLoadedAt,
      readableAt,
      readableSource,
      metadataResolvedAt,
      metadataResolutionSource,
      metadataCoverageReadyAt: this.integrationMetadataCoverageAt,
      launchToMetadataCoverageMs: this.integrationMetadataCoverageAt === null ? null : this.integrationMetadataCoverageAt - probe.launchStartedAt,
      coreReadyAt,
      occurrenceReadyAt: this.indexer?.localHydrationPending ? null : coreReadyAt,
      cacheReadyAt: null,
      launchToReadableMs: readableAt === null ? null : readableAt - probe.launchStartedAt,
      launchToPluginMs: this.integrationPluginLoadedAt === null ? null : this.integrationPluginLoadedAt - probe.launchStartedAt,
      launchToMetadataResolvedMs: metadataResolvedAt === null ? null : metadataResolvedAt - probe.launchStartedAt,
      launchToCoreReadyMs: coreReadyAt - probe.launchStartedAt,
      launchToOccurrenceReadyMs: this.indexer?.localHydrationPending ? null : coreReadyAt - probe.launchStartedAt,
      pluginToCoreReadyMs: this.integrationPluginLoadedAt === null ? null : coreReadyAt - this.integrationPluginLoadedAt,
      workbenchCoreWorkMs: stats.ms,
      files: stats.files,
      elements: stats.elements,
      links: stats.links,
      mode: stats.mode,
      measuredAt: new Date(coreReadyAt).toISOString(),
    };
    await this.app.vault.adapter.write(".mdse_integration_result.json", JSON.stringify(result, null, 2) + "\n");
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
      schemaLoaded: !!this.schema,
      schemaError: this.lastSchemaError,
      schemaWarnings: this.schema?.warnings.length ?? 0,
      cacheWriteError: this.lastCacheWriteError,
      cacheCurrent: !!indexer && indexer.revision === this.lastCachedRevision,
      cachePending: !!indexer?.stats && (!!this.cacheWriteTask || this.cacheWriteTimer !== null || indexer.revision !== this.lastCachedRevision),
      assuranceActive: !!this.assurance?.active,
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

  private markForegroundActivity(): void {
    this.lastChange = Date.now();
  }

  /** Single policy gate used by every optional/background Workbench subsystem. */
  private activeRuntimeWork(indexer: Indexer): RuntimeWorkKind[] {
    const active: RuntimeWorkKind[] = [];
    if (indexer.building || indexer.rebuildPending) active.push("indexing");
    if (indexer.localHydrationActive > 0) {
      active.push(indexer.localHydrationDemanded ? "requestedHydration" : "backgroundHydration");
    }
    if (this.assurance?.active) active.push("assurance");
    if (this.cacheWriteTask) active.push("cacheWrite");
    return active;
  }

  private markBackgroundPending(kind: "backgroundHydration" | "assurance" | "cacheWrite"): void {
    if (!this.backgroundPendingSince.has(kind)) this.backgroundPendingSince.set(kind, Date.now());
  }

  private clearBackgroundPending(kind: "backgroundHydration" | "assurance" | "cacheWrite"): void {
    this.backgroundPendingSince.delete(kind);
  }

  private backgroundWorkAllowed(kind: "backgroundHydration" | "assurance" | "cacheWrite", indexer: Indexer | null = this.indexer): boolean {
    if (!indexer || this.indexer !== indexer) return false;
    const now = Date.now();
    const pendingSince = this.backgroundPendingSince.get(kind);
    const base = canRunBackgroundWork({
      unloaded: this.unloaded,
      ready: this.isReady(),
      building: indexer.building,
      rebuildPending: indexer.rebuildPending,
      liveUpdatePending: indexer.liveUpdatePending,
      quietForMs: now - this.lastChange,
      minimumQuietMs: kind === "cacheWrite" ? CACHE_PERSIST_QUIET_MS : BACKGROUND_RESUME_QUIET_MS,
      waitingForMs: pendingSince === undefined ? 0 : now - pendingSince,
      maxDeferralMs: BACKGROUND_MAX_DEFERRAL_MS,
    });
    return base && canStartRuntimeWork(kind, this.activeRuntimeWork(indexer));
  }

  private async waitForBackgroundWork(kind: "backgroundHydration" | "assurance" | "cacheWrite", indexer: Indexer): Promise<void> {
    this.markBackgroundPending(kind);
    while (!this.unloaded && this.indexer === indexer && !this.backgroundWorkAllowed(kind, indexer)) {
      await new Promise((r) => window.setTimeout(r, 250));
    }
    if (this.unloaded || this.indexer !== indexer) throw new Error("Workbench background work was cancelled.");
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
      if (this.metadataResolved || Date.now() - this.lastChange >= QUIET_START_MS) break;
      await new Promise((r) => window.setTimeout(r, 250));
    }
    if (this.unloaded) return;

    // Obsidian's global "resolved" event can precede completion of per-file metadata entries in
    // large vaults. Workbench's core graph depends on those entries for frontmatter and authored
    // links, so do not publish/build authoritative core state until every current Markdown file
    // has a metadata cache entry.
    const pending = new Set(this.app.vault.getMarkdownFiles().map((file) => file.path));
    while (!this.unloaded && pending.size) {
      for (const path of [...pending]) {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile) || file.extension !== "md" || this.app.metadataCache.getFileCache(file)) {
          pending.delete(path);
        }
      }
      if (pending.size) await new Promise((r) => window.setTimeout(r, 250));
    }
    if (this.unloaded) return;
    if (this.integrationProbe) this.integrationMetadataCoverageAt = Date.now();

    // Give Obsidian/UI and other lightweight plugin onload work one short lane before
    // Workbench starts core indexing/restoration. Workbench readiness may come later;
    // vault usability wins over minimum feature latency.
    await new Promise((r) => window.setTimeout(r, CORE_AFTER_METADATA_DELAY_MS));
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
      timeToCoreReadyMs: this.lastTimeToCoreReadyMs,
      timeToOccurrenceReadyMs: this.lastTimeToOccurrenceReadyMs,
      startupWaitMs: this.lastStartupWaitMs,
      localHydrationMs: indexer.lastLocalHydrationMs,
      localCandidates: indexer.lastLocalHydrationCandidates,
      warmRestore: this.lastWarmRestore,
    });
    this.runtimeHistory = this.runtimeHistory.slice(-20);
    await this.saveAll();
  }

  private async markOccurrenceReady(indexer: Indexer): Promise<void> {
    if (this.unloaded || this.indexer !== indexer || indexer.localHydrationPending > 0 || this.startupRunStartedAt === null) return;
    this.lastTimeToOccurrenceReadyMs = Math.round(performance.now() - this.startupRunStartedAt);
    if (this.integrationProbe) {
      const occurrenceReadyAt = Date.now();
      await this.updateIntegrationResult({
        occurrenceReadyAt,
        launchToOccurrenceReadyMs: occurrenceReadyAt - this.integrationProbe.launchStartedAt,
      });
    }
    const latest = this.runtimeHistory[this.runtimeHistory.length - 1];
    if (latest) {
      latest.timeToOccurrenceReadyMs = this.lastTimeToOccurrenceReadyMs;
      latest.localHydrationMs = indexer.lastLocalHydrationMs;
      latest.localCandidates = indexer.lastLocalHydrationCandidates;
      await this.saveAll();
    }
  }

  private showRuntimeHistory(): void {
    const recent = this.runtimeHistory.slice(-10).reverse();
    const rows: Array<[string, string]> = recent.length
      ? recent.map((s) => [
          new Date(s.at).toLocaleString(),
          `${s.mode} · core ready ${s.timeToCoreReadyMs == null ? "n/a" : (s.timeToCoreReadyMs / 1000).toFixed(2) + " s"} · occurrence ready ${s.timeToOccurrenceReadyMs == null ? "pending/n/a" : (s.timeToOccurrenceReadyMs / 1000).toFixed(2) + " s"} · core work ${(s.coreMs / 1000).toFixed(2)} s · Local work ${s.localHydrationMs === null ? "deferred" : (s.localHydrationMs / 1000).toFixed(2) + " s"} (${s.localCandidates}) · wait ${s.startupWaitMs === null ? "n/a" : (s.startupWaitMs / 1000).toFixed(2) + " s"}`,
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
    if (!indexer || !this.isReady() || !indexer.localHydrationPending) {
      this.clearBackgroundPending("backgroundHydration");
      return;
    }
    this.markBackgroundPending("backgroundHydration");
    this.localBackgroundTimer = window.setTimeout(() => {
      this.localBackgroundTimer = null;
      if (this.unloaded || this.indexer !== indexer || !this.isReady()) return;
      // Background occurrence parsing must yield to active use. If the engineer just edited
      // something or live semantic updates are pending, leave the capability queued and try later.
      if (!this.backgroundWorkAllowed("backgroundHydration", indexer)) {
        this.scheduleBackgroundLocalHydration();
        return;
      }
      indexer.beginDeferredLocalHydration(true);
      this.scheduleRuntimeHealthRefresh();
      void indexer.whenLocalSettled(false)
        .then(() => {
          if (this.unloaded || this.indexer !== indexer) return;
          this.lastOccurrenceError = null;
          if (!indexer.localHydrationPending) this.clearBackgroundPending("backgroundHydration");
          void this.markOccurrenceReady(indexer);
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
    if (!this.cacheMutationGate.writesAllowed()) return;
    if (this.cacheWriteTimer !== null) window.clearTimeout(this.cacheWriteTimer);
    const indexer = this.indexer;
    if (!indexer?.stats || indexer.revision === this.lastCachedRevision) {
      this.clearBackgroundPending("cacheWrite");
      return;
    }
    this.markBackgroundPending("cacheWrite");
    const delay = cachePersistenceDelayMs(Date.now(), this.lastCacheWriteAt);
    this.cacheWriteTimer = window.setTimeout(() => {
      this.cacheWriteTimer = null;
      if (this.unloaded) return;
      const current = this.indexer;
      if (!current?.stats || current.revision === this.lastCachedRevision) return;
      if (!this.backgroundWorkAllowed("cacheWrite", current)) {
        this.scheduleSemanticCacheWrite();
        return;
      }
      // Persistence must not become the reason deferred occurrence capabilities start. If
      // occurrence data is still queued/active, leave the cache dirty and try after that
      // background lane has completed (or after an explicit consumer requested it).
      if (current.localHydrationPending > 0) {
        this.scheduleBackgroundLocalHydration();
        this.scheduleSemanticCacheWrite();
        return;
      }
      if (this.cacheWriteTask) return;
      let task: Promise<void>;
      task = this.persistSemanticCache().finally(() => {
        if (this.cacheWriteTask === task) this.cacheWriteTask = null;
        const latest = this.indexer;
        if (!this.unloaded && latest?.stats && latest.revision !== this.lastCachedRevision) {
          this.scheduleSemanticCacheWrite();
        }
      });
      this.cacheWriteTask = task;
    }, delay);
  }

  private async persistSemanticCache(): Promise<void> {
    const schema = this.schema;
    const indexer = this.indexer;
    if (!schema || !indexer || indexer.building || !indexer.stats || indexer.revision === this.lastCachedRevision) return;
    const t0 = performance.now();
    try {
      await indexer.whenLocalSettled(false);
      if (
        indexer.building ||
        indexer.rebuildPending ||
        !this.backgroundWorkAllowed("cacheWrite", indexer)
      ) {
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
        this.clearBackgroundPending("cacheWrite");
        if (this.integrationProbe) {
          const cacheReadyAt = Date.now();
          await this.updateIntegrationResult({
            cacheReadyAt,
            launchToCacheReadyMs: cacheReadyAt - this.integrationProbe.launchStartedAt,
          });
        }
      } else this.scheduleSemanticCacheWrite();
      indexer.trimLocalRetention();
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
    const runStartedAt = performance.now();
    this.coreReadyPublished = false;
    this.lastCoreError = null;
    this.lastSchemaError = null;
    const firstStart = !this.indexer;
    if (firstStart) {
      this.startupRunStartedAt = runStartedAt;
      this.lastTimeToCoreReadyMs = null;
      this.lastTimeToOccurrenceReadyMs = null;
    }

    // First-start safety gate comes before *all* model/schema I/O. Workbench commands and status
    // are already registered, while Obsidian keeps the startup lane until metadata resolution
    // (or the bounded quiet fallback) plus a short handoff delay.
    if (firstStart) {
      this.setRuntimeStatus("waiting");
      const waitStarted = performance.now();
      await this.whenVaultQuiet();
      this.lastStartupWaitMs = Math.round(performance.now() - waitStarted);
      if (this.unloaded) return;
    }

    this.setRuntimeStatus("starting");
    try {
      this.schema = await this.loadSchema();
    } catch (e) {
      const message = (e as Error).message || String(e);
      this.lastSchemaError = message;
      this.setRuntimeStatus("error", "schema");
      new Notice(`MDSE Workbench: could not read the schema files. ${message} Check the paths in settings.`);
      return;
    }

    const schema = this.schema;
    if (!this.indexer) {
      this.indexer = new Indexer(this.app, schema);
      this.indexer.setBackgroundIdleCheck(() => this.backgroundWorkAllowed("backgroundHydration", this.indexer));
      this.writer = new RelationshipWriter(this.app, () => this.schema as Schema, () => (this.indexer as Indexer).index, this.transactions);
      const localFile = (path: string): TFile => {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) throw new Error(path + " no longer exists.");
        return file;
      };
      this.modelEditor = new ModelEditService(
        {
          read: (path) => this.app.vault.read(localFile(path)),
          write: (path, text) => this.app.vault.modify(localFile(path), text),
        },
        (path) => (this.indexer as Indexer).index.notes.get(path)?.uid ?? null,
        this.transactions,
        (ownerPath, localId) => {
          const impacts: Array<{ path: string; field: string }> = [];
          for (const note of (this.indexer as Indexer).index.notes.values()) {
            for (const ref of note.localRefs ?? []) {
              if (ref.path === ownerPath && ref.localId === localId) impacts.push({ path: note.path, field: ref.field });
            }
          }
          return impacts;
        },
      );
      this.definitionCreator = new DefinitionCreationService(
        {
          exists: async (path) => this.app.vault.getAbstractFileByPath(normalizePath(path)) !== null,
          read: async (path) => this.app.vault.read(localFile(normalizePath(path))),
          create: async (path, text) => {
            const normalized = normalizePath(path);
            if (this.app.vault.getAbstractFileByPath(normalized)) throw new Error(normalized + " already exists.");
            await this.app.vault.create(normalized, text);
          },
          remove: async (path) => {
            const normalized = normalizePath(path);
            const file = this.app.vault.getAbstractFileByPath(normalized);
            if (!(file instanceof TFile)) throw new Error(normalized + " no longer exists.");
            await this.app.vault.delete(file);
          },
        },
        (uid) => this.definitionUidInUse(uid),
        this.transactions,
        (path) => this.definitionDeletionImpact(path),
      );
      this.definitionDeleter = new DefinitionDeletionService(
        {
          exists: async (path) => this.app.vault.getAbstractFileByPath(normalizePath(path)) !== null,
          read: async (path) => this.app.vault.read(localFile(normalizePath(path))),
          remove: async (path) => {
            const normalized = normalizePath(path);
            const file = this.app.vault.getAbstractFileByPath(normalized);
            if (!(file instanceof TFile)) throw new Error(normalized + " no longer exists.");
            await this.app.vault.delete(file);
          },
          create: async (path, text) => {
            const normalized = normalizePath(path);
            if (this.app.vault.getAbstractFileByPath(normalized)) throw new Error(normalized + " already exists.");
            await this.app.vault.create(normalized, text);
          },
        },
        (path) => this.definitionDeletionImpact(path),
        this.transactions,
        (uid) => this.definitionUidInUse(uid),
      );
      this.definitionRetirer = new DefinitionRetirementService(
        {
          exists: async (path) => this.app.vault.getAbstractFileByPath(normalizePath(path)) !== null,
          read: async (path) => this.app.vault.read(localFile(normalizePath(path))),
          write: async (path, text) => this.app.vault.modify(localFile(normalizePath(path)), text),
        },
        (path) => this.definitionDeletionImpact(path),
        this.transactions,
      );
      this.definitionSuperseder = new DefinitionSupersessionService(
        {
          exists: async (path) => this.app.vault.getAbstractFileByPath(normalizePath(path)) !== null,
          read: async (path) => this.app.vault.read(localFile(normalizePath(path))),
          write: async (path, text) => this.app.vault.modify(localFile(normalizePath(path)), text),
        },
        (path) => this.definitionDeletionImpact(path),
        (target, fromPath) => this.app.metadataCache.getFirstLinkpathDest(getLinkpath(target), normalizePath(fromPath))?.path ?? null,
        (targetPath, fromPath) => {
          const file = localFile(normalizePath(targetPath));
          return this.app.metadataCache.fileToLinktext(file, normalizePath(fromPath), true);
        },
        this.transactions,
      );
      this.definitionNoteMigrator = new DefinitionNoteMigrationService(
        {
          exists: async (path) => this.app.vault.getAbstractFileByPath(normalizePath(path)) !== null,
          read: async (path) => this.app.vault.read(localFile(normalizePath(path))),
          write: async (path, text) => this.app.vault.modify(localFile(normalizePath(path)), text),
        },
        (target, fromPath) => this.app.metadataCache.getFirstLinkpathDest(getLinkpath(target), normalizePath(fromPath))?.path ?? null,
        (targetPath, fromPath) => {
          const file = localFile(normalizePath(targetPath));
          return this.app.metadataCache.fileToLinktext(file, normalizePath(fromPath), true);
        },
        this.transactions,
      );
      this.assurance = new AssuranceManager({
        revision: () => (this.indexer as Indexer).revision,
        // Assurance ranks below background occurrence hydration. It waits for occurrence work
        // without promoting deferred hydration into the requested/foreground priority lane.
        settle: () => (this.indexer as Indexer).whenLocalSettled(false),
        index: () => (this.indexer as Indexer).index,
        localFindings: () => {
          const indexer = this.indexer as Indexer;
          const resolve = (target: string, from: string) => this.app.metadataCache.getFirstLinkpathDest(getLinkpath(target), from)?.path;
          return [
            ...validateLocalModels({ index: indexer.index, local: indexer.local, resolve }),
            ...indexer.localReadFindings(),
          ];
        },
        waitForBackgroundPermission: () => this.waitForBackgroundWork("assurance", this.indexer as Indexer),
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
        const cache = await readCoreCacheGeneration(new ObsidianCacheStorage(this.app), WORKBENCH_CACHE_ROOT);
        const restored = restoreCoreSemanticState(cache, schema, scope);
        const initialPlan = planReconciliation(restored.fingerprints, indexer.currentFingerprints());
        const initialMode = reconciliationMode(initialPlan);

        if (initialMode !== "full") {
          stats = indexer.installRestoredCore(restored, cache.header.createdAt);
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
      this.setRuntimeStatus("indexing");
      stats = await recoverWithColdBuild(
        () => indexer.discardProvisionalSemanticState(),
        async () => {
          indexer.enableLiveChanges();
          return await indexer.build();
        },
      );
    }

    // Restored/build stats are not a readiness signal. Publish core-ready only after every
    // source/path lane (including any rebuild queued by startup churn) has actually settled.
    await indexer.whenSourceSettled();
    if (!indexer.stats) throw new Error("Core source reconciliation settled without publishable index statistics.");
    stats = indexer.stats;
    this.coreReadyPublished = true;

    this.lastTimeToCoreReadyMs = Math.round(performance.now() - runStartedAt);
    const localPending = indexer.localHydrationPending;
    if (!localPending) this.lastTimeToOccurrenceReadyMs = this.lastTimeToCoreReadyMs;
    this.setRuntimeStatus(
      "ready",
      `${stats.elements} elements · ${stats.mode}${localPending ? ` · occurrence features loading later` : ""}`,
    );
    this.refreshRuntimeHealth();
    await this.writeIntegrationColdResult(stats);
    if (localPending) this.scheduleBackgroundLocalHydration();
    else this.scheduleSemanticCacheWrite();
    void this.recordRuntimeSample(indexer, stats);
    if (rebuild || schema.warnings.length) {
      new Notice(`MDSE Workbench: indexed ${stats.elements} model notes in ${(stats.ms / 1000).toFixed(1)} s${schema.warnings.length ? `; ${schema.warnings.length} schema warning(s), see diagnostics` : ""}.`);
    }
  }

  /** Quiet version of ready(): no notice. Used by Review, which waits and retries. */
  private isReady(): boolean {
    const indexer = this.indexer;
    return canPublishCoreReady({
      publicationGate: this.coreReadyPublished,
      schemaLoaded: !!this.schema,
      writerReady: !!this.writer,
      statsAvailable: !!indexer?.stats,
      sourceReconciliationPending: indexer?.sourceReconciliationPending ?? true,
      building: !!indexer?.building,
    });
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
      await this.cacheMutationGate.clear(this.cacheWriteTask, () => clearWorkbenchCache(this.app));
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
    if (!this.isReady()) return;
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
    this.markForegroundActivity();
    if (!this.ready()) return;
    const notice = new Notice("MDSE Workbench: checking Local Model…", 0);
    try {
      const indexer = this.indexer as Indexer;
      await indexer.whenLocalSettled();
      void this.markOccurrenceReady(indexer);
      const resolve = (target: string, from: string) => this.app.metadataCache.getFirstLinkpathDest(getLinkpath(target), from)?.path;
      const scan = analyzeLocalModel(indexer.index, indexer.local, resolve);
      indexer.trimLocalRetention();
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
    this.markForegroundActivity();
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
    if (!force) this.markBackgroundPending("assurance");
    try {
      const snapshot = await this.assurance.get(force);
      this.refreshRuntimeHealth();
      return snapshot;
    } finally {
      this.clearBackgroundPending("assurance");
    }
  }

  async diagnostics(): Promise<void> {
    this.markForegroundActivity();
    if (!this.ready()) return;
    const s = this.indexer!.stats!;
    const schema = this.schema!;
    const assurance = await this.getAssurance(false);
    const f = assurance.model;
    const dirtyBuckets = cacheDirtyBucketsForPaths(this.indexer!.cacheDirtyPathsSnapshot());
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    const cacheSizeBytes = await workbenchCacheSizeBytes(this.app);
    const relationshipReconciliation = this.indexer!.lastRelationshipReresolution;
    const relationshipDependencySize = this.indexer!.relationshipDependencySize;
    const rows: Array<[string, string, boolean?]> = [
      ["Index mode", s.mode],
      ["Markdown files", String(s.files)],
      ["Notes with properties", String(s.notes)],
      ["Model notes", String(s.elements)],
      ["Authored links", String(s.links)],
      ["Relationship reconciliation", relationshipReconciliation
        ? `${relationshipReconciliation.mode} · ${relationshipReconciliation.candidateCount} candidate(s) · ${relationshipReconciliation.elapsedMs.toFixed(1)} ms`
        : "not measured"],
      ["Relationship sources changed", relationshipReconciliation ? String(relationshipReconciliation.changedSourceCount) : "not measured"],
      ["Reverse relationship index", `${relationshipDependencySize.sources} source(s) · ${relationshipDependencySize.resolvedTargetKeys + relationshipDependencySize.authoredKeys} key(s) · ${relationshipDependencySize.storedMemberships} stored membership(s)`],
      ["Reverse relationship associations", `${relationshipDependencySize.resolvedAssociations} resolved · ${relationshipDependencySize.authoredAssociations} authored-key`],
      ["Local Model hydration", this.indexer!.localHydrationPending ? `${this.indexer!.localHydrationPending} note(s) pending` : "settled"],
      ["Local Model read errors", String(this.indexer!.localReadErrorCount), this.indexer!.localReadErrorCount > 0],
      ["Hydration cost / Object", (() => {
        const h = this.indexer!.localHydrationCostSummary;
        return h.owners
          ? `${h.averageMs.toFixed(2)} ms avg · read ${h.averageReadMs.toFixed(2)} ms · parse ${h.averageParseMs.toFixed(2)} ms · ${h.owners} owner(s)`
          : "not measured";
      })()],
      ["Slowest hydrated Object", (() => {
        const h = this.indexer!.localHydrationCostSummary;
        return h.maxPath ? `${h.maxPath} · ${h.maxMs.toFixed(2)} ms` : "not measured";
      })()],
      ["Startup quiet wait", this.lastStartupWaitMs === null ? "not measured" : `${(this.lastStartupWaitMs / 1000).toFixed(2)} s`],
      ["Time to core ready", this.lastTimeToCoreReadyMs === null ? "not measured" : `${(this.lastTimeToCoreReadyMs / 1000).toFixed(2)} s`],
      ["Time to occurrence ready", this.lastTimeToOccurrenceReadyMs === null ? (this.indexer!.localHydrationPending ? "pending" : "not measured") : `${(this.lastTimeToOccurrenceReadyMs / 1000).toFixed(2)} s`],
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
      ["Semantic cache persistence", this.cacheWriteTask ? "writing" : this.indexer!.revision === this.lastCachedRevision ? "current" : "pending/coalesced"],
      ["Semantic cache size", cacheSizeBytes === null ? "unavailable" : formatCacheBytes(cacheSizeBytes)],
      ["Cache dirty paths", String(this.indexer!.cacheDirtyPathCount)],
      ["Cache dirty buckets", `${dirtyBuckets.notes.length} note · ${dirtyBuckets.localRegions.length} local · ${dirtyBuckets.fingerprints.length} fingerprint`],
    ];
    if (mem) rows.push(["JavaScript heap in use", `${Math.round(mem.usedJSHeapSize / 1048576)} MB (whole Obsidian window)`]);
    new ReportModal(this.app, "MDSE Workbench diagnostics", rows, schema.warnings).open();
  }

  /** Lists the views that can start from this note's type and opens the one chosen. */
  pickView(path: string): void {
    this.markForegroundActivity();
    if (!this.isReady()) {
      new Notice("MDSE Workbench is still indexing. Try again in a moment.");
      return;
    }
    const rec = this.indexer!.index.notes.get(path);
    const type = rec?.type ?? "";
    const fits = Object.values(PROFILES).filter((p) => !p.startTypes || p.startTypes.includes(type));
    new ViewPicker(this.app, fits, rec?.name ?? "this note", (p) => void this.explore([path], p)).open();
  }

  /**
   * Exact Local Model owners knowable from the core graph alone.
   * null means the profile needs a vault-wide occurrence search to remain complete.
   */
  private occurrenceOwnerPaths(profile: ViewProfile, starts: readonly string[], baseDepths: ReadonlyMap<string, number>): string[] | null {
    const index = (this.indexer as Indexer).index;
    switch (profile.name) {
      case "Internal": {
        const owner = starts[0];
        return owner && index.notes.get(owner)?.type === "Object" ? [owner] : [];
      }
      case "Structure":
        return [...baseDepths.entries()]
          .filter(([path, depth]) => depth < profile.depth && index.notes.get(path)?.type === "Object")
          .map(([path]) => path)
          .sort();
      case "Requirements": {
        const owners = new Set<string>();
        for (const requirementPath of starts) {
          if (index.notes.get(requirementPath)?.type !== "Requirement") continue;
          for (const ref of index.notes.get(requirementPath)?.localRefs ?? []) if (ref.field === "appliesTo") owners.add(ref.path);
        }
        return [...owners].sort();
      }
      // Interfaces may follow cross-owner local topology and definition starts; Where Used is
      // inherently an inverse search across every hydrated owner. Keep both complete for now.
      case "Interfaces":
      case "Where Used":
        return null;
      default:
        return [];
    }
  }

  async explore(starts: string[], profile: ViewProfile = STRUCTURE_PROFILE): Promise<void> {
    this.markForegroundActivity();
    if (!this.ready()) return;
    const indexer = this.indexer as Indexer;
    await indexer.whenSourceSettled();
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
    if (profileNeedsLocalOccurrences(profile)) {
      this.setRuntimeStatus("ready", `${indexer.stats?.elements ?? 0} elements · loading occurrence data for ${profile.name}`);
      const owners = this.occurrenceOwnerPaths(profile, starts, baseView.depthOf);
      if (owners === null) {
        await indexer.whenLocalSettled();
        void this.markOccurrenceReady(indexer);
      } else {
        await indexer.hydrateLocalOwners(owners);
      }
      this.refreshRuntimeHealth();
    }
    // Source files may have changed while occurrence hydration was running; cross the source
    // barrier again so traversal never writes a derived canvas from a half-reconciled revision.
    await indexer.whenSourceSettled();
    const resolve = (target: string, from: string) => this.app.metadataCache.getFirstLinkpathDest(getLinkpath(target), from)?.path;
    const view = profileNeedsLocalOccurrences(profile)
      ? withLocalOccurrences(index, indexer.local, resolve, baseView, profile)
      : baseView;
    if (view.depthOf.size <= 1 && view.omitted.size === 0) {
      new Notice(`Nothing to show: this note has no links the ${profile.name} view follows (${[...new Set(profile.steps.map((s) => s.field))].join(", ")}).`);
      return;
    }
    const canvas = toCanvas(index, view, profile);
    if (profileNeedsLocalOccurrences(profile)) indexer.trimLocalRetention();
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
    this.markForegroundActivity();
    if (!this.ready()) return;
    const indexer = this.indexer as Indexer;
    const f = this.app.workspace.getActiveFile();
    const meta = f ? this.views[f.path] : undefined;
    if (!f || !meta) {
      new Notice("Open a view generated by Workbench first.");
      return;
    }
    const profile = PROFILES[meta.profile] ?? STRUCTURE_PROFILE;
    await indexer.whenSourceSettled();
    const index = indexer.index;
    const baseView = traverse(index, meta.starts, profile);
    if (profileNeedsLocalOccurrences(profile)) {
      const owners = this.occurrenceOwnerPaths(profile, meta.starts, baseView.depthOf);
      if (owners === null) {
        await indexer.whenLocalSettled();
        void this.markOccurrenceReady(indexer);
      } else {
        await indexer.hydrateLocalOwners(owners);
      }
    }
    await indexer.whenSourceSettled();
    const resolve = (target: string, from: string) => this.app.metadataCache.getFirstLinkpathDest(getLinkpath(target), from)?.path;
    const current = profileNeedsLocalOccurrences(profile)
      ? withLocalOccurrences(index, indexer.local, resolve, baseView, profile)
      : baseView;
    const now = signature(current);
    if (profileNeedsLocalOccurrences(profile)) indexer.trimLocalRetention();
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
    this.markForegroundActivity();
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
    this.markForegroundActivity();
    if (!this.writer) return;
    new Notice(await this.writer.undo(), 15000);
  }

  async redo(): Promise<void> {
    this.markForegroundActivity();
    if (!this.writer) return;
    new Notice(await this.writer.redo(), 15000);
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
      .setName("Creator UID suffix")
      .setDesc("13 ASCII letters used for new governed note UIDs, typically normalized last name + first name. Example: skellyspencer. Workbench will not create reusable definitions until this is valid.")
      .addText((t) =>
        t.setValue(this.plugin.settings.creatorSuffix).onChange(async (v) => {
          this.plugin.settings.creatorSuffix = v.replace(/[^A-Za-z]/g, "").toLowerCase();
          await this.plugin.saveAll();
        }),
      );
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

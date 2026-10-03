/**
 * MDSE Workbench, Phase 0 spike (WB-081, WB-090 gate R0).
 * Commands: diagnostics, rebuild index, explore Structure from the current note,
 * relate the current note to another, undo, and the Canvas probe.
 */
import { App, getLinkpath, normalizePath, Notice, parseYaml, Plugin, PluginSettingTab, Setting, TFile } from "obsidian";
import type { NoteRecord } from "./core/model";
import { optionsBetween } from "./core/rules";
import { editingBlocked, parseSchema, type Schema } from "./core/schema";
import { PROFILES, signature, STRUCTURE_PROFILE, toCanvas, traverse, withLocalOccurrences, type ViewProfile } from "./core/views";
import { Indexer } from "./obsidian/indexer";
import { probeReport, registerSelectionMenu } from "./obsidian/probe";
import { ConfirmModal, ElementPicker, RelationshipPicker, ReportModal, ViewPicker } from "./obsidian/ui";
import { NoteDetailPanel } from "./obsidian/detail";
import { nodeAt, parseTranslate, undefinedName, type CanvasNodeJson } from "./core/detail";
import { ReviewView, REVIEW_VIEW } from "./obsidian/review";
import { RelationshipWriter } from "./obsidian/writer";
import { scanLocalModel, writeFindingsReport } from "./obsidian/localmodel";

/** Quiet time with no cache activity before the first index build starts. */
const QUIET_START_MS = 8000;

interface Settings {
  relationshipsPath: string;
  elementTypesPath: string;
  /** Generated views go here; keep it out of Git (WB-036). Default chosen at build (WB-073). */
  viewsFolder: string;
  canvasProbe: boolean;
  /** Clicking a note on a generated view opens its details in a popup (WB-099). */
  showDetails: boolean;
}

const DEFAULTS: Settings = {
  relationshipsPath: "99_System/03_Schemas/relationships.yaml",
  elementTypesPath: "99_System/03_Schemas/element-types.yaml",
  viewsFolder: "Workbench Views",
  canvasProbe: true,
  showDetails: true,
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
  /** Last time Obsidian reported a note changed; first-time caching reports one per note. */
  private lastChange = Date.now();
  private unloaded = false;

  async onload(): Promise<void> {
    const stored = ((await this.loadData()) ?? {}) as Partial<Stored>;
    this.settings = { ...DEFAULTS, ...(stored.settings ?? {}) };
    this.views = stored.views ?? {};
    this.addSettingTab(new WorkbenchSettings(this.app, this));
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
    this.addCommand({ id: "rebuild-index", name: "Rebuild index", callback: () => this.start(true) });
    this.addCommand({
      id: "explore-structure",
      name: "Explore structure of current note",
      checkCallback: (checking) => this.withActive(checking, (f) => this.explore([f.path])),
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
        }),
    );
    this.addCommand({ id: "open-review", name: "Open Review", callback: () => void this.openReview() });
    this.addCommand({ id: "local-model-findings", name: "Check Local Model (write findings report)", callback: () => void this.checkLocalModel() });
    this.addRibbonIcon("list-checks", "Workbench Review", () => void this.openReview());
    this.registerEvent(this.app.metadataCache.on("changed", () => (this.lastChange = Date.now())));
    this.register(() => (this.unloaded = true));
    this.app.workspace.onLayoutReady(() => void this.start(false));
  }

  /** Resolves once the layout is ready and no note has changed for QUIET_START_MS. */
  private async whenVaultQuiet(): Promise<void> {
    while (!this.unloaded && Date.now() - this.lastChange < QUIET_START_MS) {
      await new Promise((r) => window.setTimeout(r, 1000));
    }
  }

  async saveAll(): Promise<void> {
    await this.saveData({ settings: this.settings, views: this.views } satisfies Stored);
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

  /** Load schema, build the index, then follow vault changes (WB-033, WB-086). */
  async start(rebuild: boolean): Promise<void> {
    try {
      this.schema = await this.loadSchema();
    } catch (e) {
      new Notice(`MDSE Workbench: could not read the schema files. ${(e as Error).message} Check the paths in settings.`);
      return;
    }
    const schema = this.schema;
    if (!this.indexer) {
      this.indexer = new Indexer(this.app, schema);
      this.writer = new RelationshipWriter(this.app, () => this.schema as Schema, () => (this.indexer as Indexer).index);
      const schemaPaths = () => [normalizePath(this.settings.relationshipsPath), normalizePath(this.settings.elementTypesPath)];
      // Follow changes from the start; the indexer only remembers them until its first build.
      this.registerEvent(
        this.app.metadataCache.on("changed", (file) => {
          if (!schemaPaths().includes(file.path)) this.indexer?.changed(file.path);
        }),
      );
      this.registerEvent(this.app.vault.on("delete", (f) => this.indexer?.removed(f.path)));
      this.registerEvent(
        this.app.vault.on("rename", (f, old) => {
          this.indexer?.removed(old);
          this.indexer?.changed(f.path);
        }),
      );
      this.registerEvent(
        this.app.vault.on("modify", (f) => {
          // Schema edited: reload rules and rebuild, so rules are never stale.
          if (schemaPaths().includes(f.path)) void this.start(true);
        }),
      );
      this.register(() => this.indexer?.dispose());
      // Do nothing until Obsidian's own cache has finished and the vault has been quiet.
      // On a large vault that first caching takes minutes; indexing alongside it made the app
      // look frozen (0.0.4). No fixed timeout: a slow vault just starts later.
      await this.whenVaultQuiet();
      if (this.unloaded) return;
    } else {
      this.indexer.setSchema(schema);
    }
    const stats = await this.indexer.build();
    if (rebuild || schema.warnings.length) {
      new Notice(`MDSE Workbench: indexed ${stats.elements} model notes in ${(stats.ms / 1000).toFixed(1)} s${schema.warnings.length ? `; ${schema.warnings.length} schema warning(s), see diagnostics` : ""}.`);
    }
  }

  /** Quiet version of ready(): no notice. Used by Review, which waits and retries. */
  private isReady(): boolean {
    return !!(this.schema && this.indexer && this.writer && !this.indexer.building && this.indexer.stats);
  }

  /** WB-111: read every Local Model region, run the WB-106 checks, write the report and open it. */
  async checkLocalModel(): Promise<void> {
    if (!this.ready()) return;
    const notice = new Notice("MDSE Workbench: reading Local Model regions…", 0);
    try {
      const scan = await scanLocalModel(this.app, (this.indexer as Indexer).index);
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
      ["Markdown files", String(s.files)],
      ["Notes with properties", String(s.notes)],
      ["Model notes", String(s.elements)],
      ["Authored links", String(s.links)],
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
    const index = this.indexer!.index;
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
    const view = withLocalOccurrences(index, this.indexer!.local, resolve, baseView, profile);
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
    const f = this.app.workspace.getActiveFile();
    const meta = f ? this.views[f.path] : undefined;
    if (!f || !meta) {
      new Notice("Open a view generated by Workbench first.");
      return;
    }
    const profile = PROFILES[meta.profile] ?? STRUCTURE_PROFILE;
    const index = this.indexer!.index;
    const baseView = traverse(index, meta.starts, profile);
    const resolve = (target: string, from: string) => this.app.metadataCache.getFirstLinkpathDest(getLinkpath(target), from)?.path;
    const current = withLocalOccurrences(index, this.indexer!.local, resolve, baseView, profile);
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
  }
}

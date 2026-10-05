/**
 * Note detail popup (WB-099, WB-100, WB-101): a floating panel that shows a note's properties,
 * relationships and rendered text, so a person navigating a generated view does not have to open the
 * note, and, in an explicit edit mode, changes the text, the ordinary properties and the relationships
 * through the governed writer (rules, inverses, undo). Not modal: it stays on screen while the canvas is
 * used and follows the next note clicked. Links inside it open in the same panel.
 */
import { App, Component, MarkdownRenderer, Notice, TFile } from "obsidian";
import { bodyOf, propertyRows, relationshipRows, type PropertyRow } from "../core/detail";
import { coerceValue, parseListInput, propertyEditor } from "../core/edit";
import type { NoteRecord } from "../core/model";
import { parseLocalModel, type LinkRef, type LocalRecord } from "../core/localmodel";
import { nextAvailableLocalId, type LocalRecordPatch } from "../core/localmodel-edit";
import type { ModelEditService } from "../core/model-edit";
import type { StagedDefinitionCreation } from "../core/definition-create";
import type { StagedDefinitionDelete } from "../core/definition-delete";
import type { StagedDefinitionRetirement } from "../core/definition-retire";
import type { StagedDefinitionSupersession } from "../core/definition-supersede-service";
import type { DefinitionMigrationCandidate } from "../core/definition-supersede";
import type { StagedDefinitionNoteMigration } from "../core/definition-note-migrate-service";
import type { Schema } from "../core/schema";
import type { RelationshipWriter } from "./writer";
import { ConfirmModal, DefinitionCreateFromOccurrenceModal, DefinitionDeleteModal, DefinitionRetireModal, DefinitionSupersedeModal, ElementPicker, LocalConnectionCreateModal, LocalConnectionDefinitionEditModal, LocalConnectionEndpointRewireModal, LocalEndpointCreateModal, LocalEndpointDefinitionEditModal, LocalEndpointEqualsEditModal, LocalEndpointExposureEditModal, LocalEndpointParentReassignModal, LocalEndpointPartReassignModal, LocalFlowConnectionMoveModal, LocalFlowCreateModal, LocalFlowDefinitionEditModal, LocalFlowRolesEditModal, LocalOccurrenceDeleteModal, LocalPartCreateModal, LocalPartDefinitionEditModal, ReportModal } from "./ui";

/** What the popup needs from the plugin. */
export interface DetailHost {
  schema(): Schema | null;
  writer(): RelationshipWriter | null;
  modelEditor(): ModelEditService | null;
  /** Why editing is not possible right now, or null. */
  editBlocked(): string | null;
  /** Model notes the given note could be related to. */
  elements(excludePath: string): NoteRecord[];
  /** Pick the relationship and write it; the popup refreshes when the note changes. */
  relate(firstPath: string, secondPath: string): void;
  undo(): Promise<void>;
  /** Opens the view picker for a note (WB-104). */
  pickView(path: string): void;
  /** Where-used/occurrence evidence for definition impact review (WB-114). */
  definitionImpact(path: string): Promise<{ rows: string[]; notes: number; occurrences: number }>;
  stageDefinitionCreation(kind: LocalRecord["kind"], name: string, path: string): StagedDefinitionCreation;
  applyDefinitionCreation(transactionId: string): Promise<void>;
  cancelDefinitionCreation(transactionId: string): void;
  rollbackDefinitionCreation(transactionId: string): Promise<void>;
  stageDefinitionDeletion(path: string, uid: string): Promise<StagedDefinitionDelete>;
  applyDefinitionDeletion(transactionId: string): Promise<void>;
  cancelDefinitionDeletion(transactionId: string): void;
  stageDefinitionRetirement(path: string, uid: string): Promise<StagedDefinitionRetirement>;
  applyDefinitionRetirement(transactionId: string): Promise<void>;
  cancelDefinitionRetirement(transactionId: string): void;
  stageDefinitionSupersession(replacedPath: string, replacedUid: string, replacedType: string, replacementPath: string): Promise<StagedDefinitionSupersession>;
  applyDefinitionSupersession(transactionId: string): Promise<void>;
  cancelDefinitionSupersession(transactionId: string): void;
  stageDefinitionOccurrenceMigration(ownerPath: string, localId: string, replacedPath: string, replacementPath: string): Promise<import("../core/model-edit").StagedLocalPatch>;
  applyDefinitionOccurrenceMigration(transactionId: string): Promise<void>;
  cancelDefinitionOccurrenceMigration(transactionId: string): void;
  stageDefinitionNoteMigration(ownerPath: string, field: string, replacedPath: string, replacementPath: string): Promise<StagedDefinitionNoteMigration>;
  definitionSupersessionMigrationCandidates(replacedPath: string): Promise<DefinitionMigrationCandidate[]>;
  applyDefinitionNoteMigration(transactionId: string): Promise<void>;
  cancelDefinitionNoteMigration(transactionId: string): void;
  stageOccurrenceDefinitionBinding(ownerPath: string, localId: string, definitionPath: string): Promise<import("../core/model-edit").StagedLocalPatch>;
  applyOccurrenceDefinitionBinding(transactionId: string): Promise<void>;
  cancelOccurrenceDefinitionBinding(transactionId: string): void;
}

export class NoteDetailPanel extends Component {
  private el: HTMLElement | null = null;
  private renderer: Component | null = null;
  private history: string[] = [];
  private current: TFile | null = null;
  private currentLocal: LocalRecord | null = null;
  /** Exact occurrence to return to while definition editing is active. */
  private definitionReturn: { ownerPath: string; localId: string; definitionPath: string } | null = null;
  /** Definition path whose current Where Used/occurrence impact has been explicitly reviewed this session. */
  private definitionImpactReviewedPath: string | null = null;
  private generation = 0;
  /** Edit mode is explicit and temporary (WB-039, WB-040): off for every note the popup opens. */
  private editing = false;
  private bodyArea: HTMLTextAreaElement | null = null;
  private bodyLoaded = "";
  private refreshTimer: number | null = null;
  private escape = (e: KeyboardEvent) => {
    if (e.key === "Escape" && this.el) this.requestClose();
  };

  constructor(private readonly app: App, private readonly host: DetailHost) {
    super();
  }

  onload(): void {
    // Keep the popup current when its note changes: after its own edits, a relationship added from the
    // picker, an undo, or a change made elsewhere.
    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        if (!this.el || !this.current || this.currentLocal || file.path !== this.current.path || this.isDirty()) return;
        if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
        this.refreshTimer = window.setTimeout(() => {
          this.refreshTimer = null;
          if (this.current && !this.isDirty()) void this.show(this.current, false);
        }, 150);
      }),
    );
  }

  onunload(): void {
    this.close();
  }

  isDirty(): boolean {
    return !!this.bodyArea && this.bodyArea.value !== this.bodyLoaded;
  }

  /** Closes unless there is unsaved text (used when the active tab changes). */
  closeIfClean(): void {
    if (!this.isDirty()) this.close();
  }

  private requestClose(): void {
    if (this.isDirty()) new ConfirmModal(this.app, "Discard the unsaved text changes?", "Discard", () => this.close()).open();
    else this.close();
  }

  async show(file: TFile, remember = true): Promise<void> {
    const switching = !this.current || this.current.path !== file.path;
    if (switching && this.isDirty()) {
      new ConfirmModal(this.app, `Discard the unsaved text changes to ${this.current?.basename ?? "this note"}?`, "Discard", () => {
        this.bodyArea = null;
        void this.show(file, remember);
      }).open();
      return;
    }
    if (switching) {
      this.editing = false;
      if (this.definitionReturn && file.path !== this.definitionReturn.definitionPath) {
        this.definitionReturn = null;
        this.definitionImpactReviewedPath = null;
      }
      if (remember && this.current) this.history.push(this.current.path);
    }
    this.current = file;
    this.currentLocal = null;
    const root = this.ensure();
    const gen = ++this.generation;
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = (cache?.frontmatter ?? null) as Record<string, unknown> | null;
    const text = await this.app.vault.cachedRead(file);
    if (gen !== this.generation) return; // a newer click arrived while reading
    this.renderer?.unload();
    this.renderer = new Component();
    this.renderer.load();
    this.bodyArea = null;
    root.empty();
    root.toggleClass("mdse-detail-editing", this.editing);
    const blocked = this.host.editBlocked();

    const head = root.createDiv({ cls: "mdse-detail-head" });
    const back = head.createEl("button", { text: "‹", cls: "mdse-detail-btn", attr: { "aria-label": "Back" } });
    back.disabled = this.history.length === 0;
    back.onclick = () => {
      const prev = this.history.pop();
      const f = prev ? this.app.vault.getAbstractFileByPath(prev) : null;
      if (f instanceof TFile) void this.show(f, false);
    };
    head.createDiv({ cls: "mdse-detail-title", text: file.basename }).setAttr("title", file.path);
    const modelType = typeof fm?.type === "string" && this.host.schema()?.classNames.has(fm.type) ? fm.type : null;
    if (modelType) {
      const impact = head.createEl("button", { text: "Review impact", cls: "mdse-detail-btn" });
      impact.setAttr("title", "Review note-level and occurrence-level uses before changing this canonical model definition.");
      impact.onclick = () => { void this.reviewDefinitionImpact(file); };
    }
    if (this.definitionReturn?.definitionPath === file.path) {
      const returnToOccurrence = head.createEl("button", { text: "Back to occurrence", cls: "mdse-detail-btn" });
      returnToOccurrence.setAttr("title", "Return to the contextual Local Model occurrence without changing its storage.");
      returnToOccurrence.onclick = () => { void this.returnToOccurrence(); };
    }

    const uid = typeof fm?.uid === "string" ? fm.uid : "";
    if (modelType && uid) {
      const retire = head.createEl("button", { text: "Retire definition…", cls: "mdse-detail-btn" });
      retire.setAttr("title", "Review all current uses, then set only canonical lifecycle status to retired.");
      retire.onclick = () => {
        new DefinitionRetireModal(
          this.app,
          file.basename,
          () => this.host.stageDefinitionRetirement(file.path, uid),
          (transactionId) => this.host.applyDefinitionRetirement(transactionId),
          (transactionId) => this.host.cancelDefinitionRetirement(transactionId),
          () => { void this.show(file, false); },
        ).open();
      };

      const supersede = head.createEl("button", { text: "Supersede definition…", cls: "mdse-detail-btn" });
      supersede.setAttr("title", "Choose a same-class replacement and review the complete guided migration inventory.");
      supersede.onclick = () => {
        const candidates = this.host.elements(file.path)
          .filter((candidate) => candidate.type === modelType)
          .sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
        new DefinitionSupersedeModal(
          this.app,
          file.basename,
          candidates,
          (replacementPath) => this.host.stageDefinitionSupersession(file.path, uid, modelType, replacementPath),
          (transactionId) => this.host.applyDefinitionSupersession(transactionId),
          (transactionId) => this.host.cancelDefinitionSupersession(transactionId),
          (ownerPath, localId, replacedPath, replacementPath) => this.host.stageDefinitionOccurrenceMigration(ownerPath, localId, replacedPath, replacementPath),
          (transactionId) => this.host.applyDefinitionOccurrenceMigration(transactionId),
          (transactionId) => this.host.cancelDefinitionOccurrenceMigration(transactionId),
          (ownerPath, field, replacedPath, replacementPath) => this.host.stageDefinitionNoteMigration(ownerPath, field, replacedPath, replacementPath),
          (transactionId) => this.host.applyDefinitionNoteMigration(transactionId),
          (transactionId) => this.host.cancelDefinitionNoteMigration(transactionId),
          (replacedPath) => this.host.definitionSupersessionMigrationCandidates(replacedPath),
          () => {
            new DefinitionRetireModal(
              this.app,
              file.basename,
              () => this.host.stageDefinitionRetirement(file.path, uid),
              (transactionId) => this.host.applyDefinitionRetirement(transactionId),
              (transactionId) => this.host.cancelDefinitionRetirement(transactionId),
              () => { void this.show(file, false); },
            ).open();
          },
          () => { void this.show(file, false); },
        ).open();
      };

      const remove = head.createEl("button", { text: "Delete definition…", cls: "mdse-detail-btn" });
      remove.setAttr("title", "Review all active references before destructive definition deletion.");
      remove.onclick = () => {
        new DefinitionDeleteModal(
          this.app,
          file.basename,
          () => this.host.stageDefinitionDeletion(file.path, uid),
          (transactionId) => this.host.applyDefinitionDeletion(transactionId),
          (transactionId) => this.host.cancelDefinitionDeletion(transactionId),
          () => {
            if (this.definitionReturn?.definitionPath === file.path) void this.returnToOccurrence();
            else this.close();
          },
        ).open();
      };
    }
    const edit = head.createEl("button", { text: this.editing ? "Done" : "Edit definition", cls: this.editing ? "mdse-detail-btn mod-cta" : "mdse-detail-btn" });
    if (!this.definitionReturn || this.definitionReturn.definitionPath !== file.path) {
      edit.setText(this.editing ? "Done" : "Edit");
    }
    if (blocked && !this.editing) {
      edit.disabled = true;
      edit.setAttr("title", blocked);
    }
    edit.onclick = () => {
      if (this.editing && this.isDirty()) {
        new ConfirmModal(this.app, "Discard the unsaved text changes?", "Discard", () => {
          this.editing = false;
          void this.show(file, false);
        }).open();
        return;
      }
      if (!this.editing && modelType) {
        void this.enterDefinitionEdit(file);
        return;
      }
      this.editing = !this.editing;
      void this.show(file, false);
    };
    if (this.editing) {
      const undo = head.createEl("button", { text: "Undo", cls: "mdse-detail-btn", attr: { title: "Undo the last Workbench edit" } });
      undo.disabled = !this.host.writer()?.canUndo;
      undo.onclick = () => void this.host.undo();

      const local = parseLocalModel(text);
      const canCreateFirstPart =
        fm?.type === "Object" &&
        (!local || (local.structured && local.records.length === 0));
      if (canCreateFirstPart) {
        const addPart = head.createEl("button", { text: "Add first part occurrence…", cls: "mdse-detail-btn" });
        addPart.onclick = () => { void this.createPartOccurrence(file); };
      }
    }
    const view = head.createEl("button", { text: "View…", cls: "mdse-detail-btn", attr: { title: "Open a view of this note: Structure, Functional, Where Used and more" } });
    view.onclick = () => this.host.pickView(file.path);
    const open = head.createEl("button", { text: "Open note", cls: "mdse-detail-btn" });
    open.onclick = () => void this.app.workspace.getLeaf(true).openFile(file);
    head.createEl("button", { text: "×", cls: "mdse-detail-btn", attr: { "aria-label": "Close" } }).onclick = () => this.requestClose();

    const chips = root.createDiv({ cls: "mdse-detail-chips" });
    for (const k of ["type", "subtype", "id", "status"]) {
      const v = fm?.[k];
      if (v !== undefined && v !== null && String(v) !== "") chips.createSpan({ cls: "mdse-detail-chip", text: k === "type" || k === "subtype" ? String(v) : `${k} ${String(v)}` });
    }
    if (this.editing) {
      chips.createSpan({
        cls: "mdse-detail-chip mdse-detail-chip-edit",
        text: this.definitionReturn?.definitionPath === file.path ? "editing definition" : "editing",
      });
    }

    const schema = this.host.schema();
    const fields = new Set(schema ? [...schema.byField.keys(), ...schema.byInverse.keys()] : []);
    this.propertiesSection(root, file, fm, fields, schema);
    this.relationshipsSection(root, file, relationshipRows(fm, fields), fields);

    const md = bodyOf(text, cache?.frontmatterPosition?.end.offset);
    if (this.editing) this.textEditor(root, file, md);
    else {
      const body = root.createDiv({ cls: "mdse-detail-body markdown-rendered" });
      if (md.trim()) {
        await MarkdownRenderer.render(this.app, md, body, file.path, this.renderer);
        if (gen !== this.generation) return;
        body.querySelectorAll<HTMLAnchorElement>("a.internal-link").forEach((a) => {
          a.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const target = this.app.metadataCache.getFirstLinkpathDest((a.getAttribute("data-href") ?? "").split("#")[0], file.path);
            if (target) void this.show(target);
          });
        });
      } else body.createEl("p", { cls: "mdse-detail-empty", text: "This note has no text." });
    }
    root.scrollTop = 0;
  }

  /** WB-105/WB-106/WB-114: contextual Local Model details with safe atomic editing. */
  showLocal(file: TFile, record: LocalRecord, editMode = false): void {
    if (this.isDirty()) {
      new ConfirmModal(this.app, `Discard the unsaved text changes to ${this.current?.basename ?? "this note"}?`, "Discard", () => {
        this.bodyArea = null;
        this.showLocal(file, record, editMode);
      }).open();
      return;
    }
    this.generation++;
    this.current = file;
    this.currentLocal = record;
    const blocked = this.host.editBlocked();
    const localBlocked = record.sourceSchemaVersion !== "0.2"
      ? `Local Model schema ${record.sourceSchemaVersion || "unknown"} is read-only. Structured writes require schema 0.2.`
      : blocked;
    this.editing = editMode && !localBlocked;
    this.bodyArea = null;
    this.renderer?.unload();
    this.renderer = null;
    const root = this.ensure();
    root.empty();
    root.toggleClass("mdse-detail-editing", this.editing);

    const head = root.createDiv({ cls: "mdse-detail-head" });
    head.createDiv({ cls: "mdse-detail-title", text: record.identifier }).setAttr("title", `${file.path}#^${record.localId}`);
    const edit = head.createEl("button", { text: this.editing ? "Done" : "Edit context", cls: this.editing ? "mdse-detail-btn mod-cta" : "mdse-detail-btn" });
    if (localBlocked && !this.editing) {
      edit.disabled = true;
      edit.setAttr("title", localBlocked);
    }
    edit.onclick = () => this.showLocal(file, record, !this.editing);
    if (this.editing) {
      const undo = head.createEl("button", { text: "Undo", cls: "mdse-detail-btn", attr: { title: "Undo the last Workbench edit" } });
      undo.disabled = !this.host.writer()?.canUndo;
      undo.onclick = async () => {
        await this.host.undo();
        await this.refreshLocal(file, record.localId, true);
      };
    }
    if (this.editing) {
      const addPart = head.createEl("button", { text: "Add part occurrence…", cls: "mdse-detail-btn" });
      addPart.onclick = () => { void this.createPartOccurrence(file); };
    }
    if (this.editing && record.kind === "part") {
      const definition = head.createEl("button", { text: "Change definition…", cls: "mdse-detail-btn" });
      definition.onclick = () => this.editPartDefinition(file, record);
      const addEndpoint = head.createEl("button", { text: "Add endpoint…", cls: "mdse-detail-btn" });
      addEndpoint.onclick = () => { void this.createEndpointOccurrence(file, record); };
    }
    if (this.editing && record.kind === "endpoint") {
      const definition = head.createEl("button", { text: "Change definition…", cls: "mdse-detail-btn" });
      definition.onclick = () => this.editEndpointDefinition(file, record);
      const reassignPart = head.createEl("button", { text: "Change part…", cls: "mdse-detail-btn" });
      reassignPart.onclick = () => { void this.reassignEndpointPart(file, record); };
      const reassignParent = head.createEl("button", { text: "Change parent…", cls: "mdse-detail-btn" });
      reassignParent.onclick = () => { void this.reassignEndpointParent(file, record); };
      const exposures = head.createEl("button", { text: "Edit exposures…", cls: "mdse-detail-btn" });
      exposures.onclick = () => { void this.editEndpointExposures(file, record); };
      const equals = head.createEl("button", { text: "Edit equals…", cls: "mdse-detail-btn" });
      equals.onclick = () => { void this.editEndpointEquals(file, record); };
      const connect = head.createEl("button", { text: "Connect to endpoint…", cls: "mdse-detail-btn" });
      connect.onclick = () => { void this.createConnectionOccurrence(file, record); };
    }
    if (this.editing && record.kind === "connection") {
      const definition = head.createEl("button", { text: "Change definition…", cls: "mdse-detail-btn" });
      definition.onclick = () => { void this.editConnectionDefinition(file, record); };
      const rewireA = head.createEl("button", { text: "Change endpoint A…", cls: "mdse-detail-btn" });
      rewireA.onclick = () => { void this.rewireConnectionEndpoint(file, record, "endpointA"); };
      const rewireB = head.createEl("button", { text: "Change endpoint B…", cls: "mdse-detail-btn" });
      rewireB.onclick = () => { void this.rewireConnectionEndpoint(file, record, "endpointB"); };
      const addFlow = head.createEl("button", { text: "Add flow…", cls: "mdse-detail-btn" });
      addFlow.onclick = () => { void this.createFlowOccurrence(file, record); };
    }
    if (this.editing && record.kind === "flow") {
      const definition = head.createEl("button", { text: "Change definition…", cls: "mdse-detail-btn" });
      definition.onclick = () => this.editFlowDefinition(file, record);
      const roles = head.createEl("button", { text: "Change endpoint roles…", cls: "mdse-detail-btn" });
      roles.onclick = () => this.editFlowRoles(file, record);
      const move = head.createEl("button", { text: "Move to connection…", cls: "mdse-detail-btn" });
      move.onclick = () => { void this.moveFlowConnection(file, record); };
    }
    if (this.editing && (record.kind === "part" || record.kind === "endpoint" || record.kind === "connection" || record.kind === "flow")) {
      const deleteOccurrence = head.createEl("button", { text: "Delete occurrence…", cls: "mdse-detail-btn" });
      deleteOccurrence.onclick = () => this.deleteOccurrence(file, record);
    }
    const owner = head.createEl("button", { text: "Open owner", cls: "mdse-detail-btn" });
    owner.onclick = () => void this.app.workspace.getLeaf(true).openFile(file);
    const occurrence = head.createEl("button", { text: "Open occurrence", cls: "mdse-detail-btn" });
    occurrence.onclick = () => void this.app.workspace.openLinkText(`${file.path.replace(/\.md$/i, "")}#^${record.localId}`, file.path, true);
    head.createEl("button", { text: "×", cls: "mdse-detail-btn", attr: { "aria-label": "Close" } }).onclick = () => this.close();

    const chips = root.createDiv({ cls: "mdse-detail-chips" });
    chips.createSpan({ cls: "mdse-detail-chip", text: record.kind });
    chips.createSpan({ cls: "mdse-detail-chip", text: "context" });
    if (record.usage !== "standard") chips.createSpan({ cls: "mdse-detail-chip", text: record.usage });
    if (record.endpointKind) chips.createSpan({ cls: "mdse-detail-chip", text: record.endpointKind });
    if (this.editing) chips.createSpan({ cls: "mdse-detail-chip mdse-detail-chip-edit", text: "editing context" });

    const table = root.createEl("table", { cls: "mdse-finding" });
    const row = (key: string, value: string, action?: () => void) => {
      if (!value) return;
      const tr = table.createEl("tr");
      tr.createEl("td", { text: key });
      const td = tr.createEl("td");
      if (action) {
        const a = td.createEl("a", { text: value, href: "#" });
        a.onclick = (e) => { e.preventDefault(); action(); };
      } else td.setText(value);
    };
    const editRow = (key: string, value: string, patch: (value: string) => LocalRecordPatch, placeholder = "") => {
      const tr = table.createEl("tr");
      tr.createEl("td", { text: key });
      const td = tr.createEl("td");
      const input = td.createEl("input", { type: "text", cls: "mdse-detail-input", value });
      if (placeholder) input.setAttr("placeholder", placeholder);
      input.onkeydown = (e) => {
        if (e.key === "Enter") input.blur();
        e.stopPropagation();
      };
      input.onchange = () => void this.saveLocalPatch(file, record, patch(input.value));
    };
    const linkText = (r: LinkRef | null) => r?.text ?? "";
    const open = (r: LinkRef | null) => r?.target ? () => void this.app.workspace.openLinkText(r.target, file.path, true) : undefined;

    row("Owner", file.basename, () => void this.app.workspace.getLeaf(true).openFile(file));
    row("Local ID", record.localId);
    if (this.editing) editRow("Occurrence name", record.identifier, (value) => ({ heading: value }));
    else row("Occurrence name", record.identifier);

    row("Reusable definition", linkText(record.definition), open(record.definition));
    if (!record.definition?.target && record.kind !== "connection") {
      const tr = table.createEl("tr");
      tr.createEl("td", { text: "Definition creation" });
      const td = tr.createEl("td");
      const createDefinition = td.createEl("button", { text: "Create reusable definition…", cls: "mdse-detail-btn" });
      createDefinition.setAttr("title", "Create a compatible reusable definition through governed Review/Apply, then bind this occurrence.");
      createDefinition.onclick = () => {
        new DefinitionCreateFromOccurrenceModal(
          this.app,
          file.basename,
          record,
          (name, path) => this.host.stageDefinitionCreation(record.kind, name, path),
          (transactionId) => this.host.applyDefinitionCreation(transactionId),
          (transactionId) => this.host.cancelDefinitionCreation(transactionId),
          (transactionId) => this.host.rollbackDefinitionCreation(transactionId),
          (definitionPath) => this.host.stageOccurrenceDefinitionBinding(file.path, record.localId, definitionPath),
          (transactionId) => this.host.applyOccurrenceDefinitionBinding(transactionId),
          (transactionId) => this.host.cancelOccurrenceDefinitionBinding(transactionId),
          () => { void this.refreshLocal(file, record.localId, false); },
        ).open();
      };
    }
    if (record.definition?.target) {
      const tr = table.createEl("tr");
      tr.createEl("td", { text: "Definition editing" });
      const td = tr.createEl("td");
      const button = td.createEl("button", { text: "Open definition", cls: "mdse-detail-btn" });
      button.setAttr("title", "Definition properties belong to the reusable definition note, not this occurrence context.");
      button.onclick = () => void this.app.workspace.openLinkText(record.definition!.target, file.path, true);
    }

    if (this.editing && (record.kind === "part" || record.kind === "endpoint")) {
      editRow("Usage", record.usage, (value) => ({ fields: { usage: value } }), "standard");
      editRow("Multiplicity", record.multiplicity ?? "", (value) => ({ fields: { multiplicity: value || null } }));
    } else {
      row("Usage", record.usage !== "standard" ? record.usage : "");
      row("Multiplicity", record.multiplicity ?? "");
    }

    if (record.kind === "endpoint" && this.editing) {
      editRow("Endpoint kind", record.endpointKind ?? "", (value) => ({ fields: { kind: value || null } }));
    } else row("Endpoint kind", record.endpointKind ?? "");

    // Structural/topology fields remain read-only until the Review/Apply/Cancel transaction slice.
    row("Part", linkText(record.part));
    row("Parent endpoint", linkText(record.parent));
    if (record.exposes.length) row("Exposes", record.exposes.map((r) => r.text).join(", "));
    if (record.equals.length) row("Equals (temporary)", record.equals.map((r) => r.text).join(", "));
    if (record.kind !== "flow") {
      row("Endpoint A", linkText(record.endpointA));
      row("Endpoint B", linkText(record.endpointB));
    }
    row("Connection", record.connectionId ?? "");

    if (record.kind === "flow") {
      row("Endpoint A role", record.roleA ?? "");
      row("Endpoint B role", record.roleB ?? "");
    }

    this.localDefinitionSection(root, file, record);

    root.createEl("p", {
      cls: "mdse-muted",
      text: this.editing
        ? "Editing context only. Definition identity and structural/topology links remain separate and read-only here."
        : "This is contextual occurrence data stored in the owner note. Open the reusable definition separately to edit definition-level data.",
    });
    root.scrollTop = 0;
  }

  /**
   * WB-114 definition/context ownership seam. The reusable definition is visible from an occurrence
   * without copying definition data into the Local Model. The section is lazy and read-only; definition
   * edits continue to use the canonical note surface.
   */
  private localDefinitionSection(root: HTMLElement, ownerFile: TFile, record: LocalRecord): void {
    const link = record.definition;
    if (!link?.target) return;

    const details = root.createEl("details", { cls: "mdse-local-definition" });
    details.createEl("summary", { text: "Definition" });
    const content = details.createDiv({ cls: "mdse-local-definition-content" });
    content.createEl("p", { cls: "mdse-muted", text: "Expand to load the reusable definition." });
    let loaded = false;

    details.addEventListener("toggle", () => {
      if (!details.open || loaded) return;
      loaded = true;
      void this.renderLocalDefinition(content, ownerFile, link.target);
    });
  }

  private async renderLocalDefinition(content: HTMLElement, ownerFile: TFile, linkpath: string): Promise<void> {
    content.empty();
    const definitionFile = this.app.metadataCache.getFirstLinkpathDest(linkpath.split("#")[0], ownerFile.path);
    if (!definitionFile) {
      content.createEl("p", { cls: "mdse-warn", text: `Definition could not be resolved: ${linkpath}` });
      return;
    }

    const cache = this.app.metadataCache.getFileCache(definitionFile);
    const fm = (cache?.frontmatter ?? null) as Record<string, unknown> | null;
    const text = await this.app.vault.cachedRead(definitionFile);
    if (!this.el || this.current !== ownerFile || !this.currentLocal) return;

    const head = content.createDiv({ cls: "mdse-detail-head" });
    head.createDiv({ cls: "mdse-detail-title", text: definitionFile.basename }).setAttr("title", definitionFile.path);
    const editDefinition = head.createEl("button", { text: "Edit definition", cls: "mdse-detail-btn mod-cta" });
    editDefinition.setAttr("title", "Edit the canonical reusable note in a separate definition surface.");
    editDefinition.onclick = () => { void this.editDefinitionFromOccurrence(ownerFile, this.currentLocal, definitionFile); };
    const open = head.createEl("button", { text: "Open note", cls: "mdse-detail-btn" });
    open.setAttr("title", "Open the canonical reusable definition note in a tab.");
    open.onclick = () => void this.app.workspace.getLeaf(true).openFile(definitionFile);

    const chips = content.createDiv({ cls: "mdse-detail-chips" });
    chips.createSpan({ cls: "mdse-detail-chip", text: "definition" });
    for (const key of ["type", "subtype", "id", "status"]) {
      const value = fm?.[key];
      if (value !== undefined && value !== null && String(value) !== "") {
        chips.createSpan({ cls: "mdse-detail-chip", text: key === "type" || key === "subtype" ? String(value) : `${key} ${String(value)}` });
      }
    }

    const schema = this.host.schema();
    const relationshipFields = new Set(schema ? [...schema.byField.keys(), ...schema.byInverse.keys()] : []);
    const properties = propertyRows(fm, relationshipFields);
    if (properties.length) {
      const table = content.createEl("table", { cls: "mdse-finding" });
      for (const property of properties) this.renderDefinitionRow(table, property, definitionFile);
    }

    const relationships = relationshipRows(fm, relationshipFields);
    const relationshipDetails = content.createEl("details", { cls: "mdse-local-definition-relationships" });
    relationshipDetails.createEl("summary", { text: `Relationships (${relationships.length})` });
    if (relationships.length) {
      const table = relationshipDetails.createEl("table", { cls: "mdse-finding" });
      for (const relationship of relationships) this.renderDefinitionRow(table, relationship, definitionFile);
    } else {
      relationshipDetails.createEl("p", { cls: "mdse-detail-empty", text: "No authored relationships." });
    }

    const md = bodyOf(text, cache?.frontmatterPosition?.end.offset);
    const body = content.createDiv({ cls: "mdse-detail-body markdown-rendered" });
    if (md.trim()) await MarkdownRenderer.render(this.app, md, body, definitionFile.path, this);
    else body.createEl("p", { cls: "mdse-detail-empty", text: "This definition has no text." });
  }

  /**
   * Impact review is consumed by one canonical-definition mutation. This makes the gate apply
   * immediately before Apply rather than only when edit mode was entered.
   */
  private async ensureDefinitionImpactReviewed(file: TFile): Promise<boolean> {
    const impact = await this.host.definitionImpact(file.path);
    if (impact.notes + impact.occurrences === 0) return true;
    if (this.definitionImpactReviewedPath === file.path) return true;
    new Notice(
      `Review impact before applying this definition change: ${impact.notes} note-level use${impact.notes === 1 ? "" : "s"} and ${impact.occurrences} occurrence${impact.occurrences === 1 ? "" : "s"} depend on ${file.basename}.`,
      10000,
    );
    return false;
  }

  private consumeDefinitionImpactReview(file: TFile): void {
    if (this.definitionImpactReviewedPath === file.path) this.definitionImpactReviewedPath = null;
  }

  private async reviewDefinitionImpact(file: TFile): Promise<void> {
    try {
      const impact = await this.host.definitionImpact(file.path);
      this.definitionImpactReviewedPath = file.path;
      new ReportModal(
        this.app,
        `Definition impact — ${file.basename}`,
        impact.rows.length
          ? impact.rows.map((row) => ["Use", row] as [string, string])
          : [["Use", "No current note-level or occurrence-level uses were found."]],
        [
          `${impact.notes} note-level use${impact.notes === 1 ? "" : "s"}; ${impact.occurrences} Local Model occurrence${impact.occurrences === 1 ? "" : "s"}.`,
          "This is read-only impact evidence. It does not change the definition or any occurrence.",
        ],
      ).open();
    } catch (e) {
      new Notice(`Cannot review definition impact: ${(e as Error).message}`, 12000);
    }
  }

  private async editDefinitionFromOccurrence(ownerFile: TFile, record: LocalRecord | null, definitionFile: TFile): Promise<void> {
    if (!record) return;
    this.definitionReturn = {
      ownerPath: ownerFile.path,
      localId: record.localId,
      definitionPath: definitionFile.path,
    };
    this.definitionImpactReviewedPath = null;
    await this.show(definitionFile, false);
    if (this.current?.path === definitionFile.path) {
      new Notice("Definition opened. Review impact before editing when this definition is currently used.", 6000);
    }
  }

  private async enterDefinitionEdit(file: TFile): Promise<void> {
    try {
      const impact = await this.host.definitionImpact(file.path);
      const hasImpact = impact.notes + impact.occurrences > 0;
      if (hasImpact && this.definitionImpactReviewedPath !== file.path) {
        new Notice(
          `Review impact before editing ${file.basename}: ${impact.notes} note-level use${impact.notes === 1 ? "" : "s"} and ${impact.occurrences} occurrence${impact.occurrences === 1 ? "" : "s"} depend on it.`,
          10000,
        );
        return;
      }
      this.editing = true;
      await this.show(file, false);
    } catch (e) {
      new Notice(`Cannot enter definition edit mode: ${(e as Error).message}`, 12000);
    }
  }

  private async returnToOccurrence(): Promise<void> {
    const back = this.definitionReturn;
    if (!back) return;
    if (this.isDirty()) {
      new ConfirmModal(this.app, "Discard the unsaved definition text changes?", "Discard", () => {
        this.bodyArea = null;
        void this.returnToOccurrence();
      }).open();
      return;
    }

    const owner = this.app.vault.getAbstractFileByPath(back.ownerPath);
    if (!(owner instanceof TFile)) {
      new Notice("The occurrence owner note no longer exists.", 8000);
      this.definitionReturn = null;
      return;
    }
    const text = await this.app.vault.cachedRead(owner);
    const region = parseLocalModel(text);
    const record = region?.records.find((candidate) => candidate.localId === back.localId);
    if (!record) {
      new Notice("The original occurrence no longer exists.", 8000);
      this.definitionReturn = null;
      return;
    }

    this.definitionReturn = null;
    this.definitionImpactReviewedPath = null;
    this.editing = false;
    this.showLocal(owner, record, false);
  }

  private renderDefinitionRow(table: HTMLElement, row: PropertyRow, sourceFile: TFile): void {
    const tr = table.createEl("tr");
    tr.createEl("td", { text: row.key });
    const td = tr.createEl("td");
    for (const part of row.parts) {
      if (!part.link) {
        td.appendText(part.text);
        continue;
      }
      const a = td.createEl("a", { text: part.text, href: "#" });
      a.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        const target = this.app.metadataCache.getFirstLinkpathDest(part.link!, sourceFile.path);
        if (target) void this.show(target);
      };
    }
  }

  private async editEndpointEquals(file: TFile, endpoint: LocalRecord): Promise<void> {
    try {
      const editor = this.host.modelEditor();
      if (!editor) throw new Error("Workbench is still starting.");
      const text = await this.app.vault.read(file);
      const region = parseLocalModel(text);
      if (!region?.structured) throw new Error("The owner note has no usable Local Model.");

      const endpoints = region.records.filter((record) => record.kind === "endpoint" && record.localId !== endpoint.localId);
      const equalIds = new Set(endpoint.equals.filter((link) => !link.target && link.blockId).map((link) => link.blockId));
      const addOptions = endpoints.filter((candidate) => !equalIds.has(candidate.localId));
      const removeOptions = endpoints.filter((candidate) => equalIds.has(candidate.localId));
      if (!addOptions.length && !removeOptions.length) throw new Error("This endpoint has no same-note equals edit available.");

      new LocalEndpointEqualsEditModal(
        this.app,
        file.basename,
        endpoint,
        addOptions,
        removeOptions,
        (mode, target) => {
          const remaining = endpoint.equals
            .filter((link) => !(mode === "remove" && !link.target && link.blockId === target.localId))
            .map((link) => link.text);
          if (mode === "add") remaining.push(`[[#^${target.localId}|${target.identifier}]]`);
          return editor.stageAndReviewLocalRecordPatch(file.path, endpoint.localId, {
            fields: { equals: remaining.length ? remaining.join(" ") : null },
          });
        },
        (transactionId) => editor.applyLocalPatch(transactionId),
        (transactionId) => { editor.cancelLocalPatch(transactionId); },
        () => { void this.refreshLocal(file, endpoint.localId, true); },
      ).open();
    } catch (e) {
      new Notice(`Cannot edit endpoint equals: ${(e as Error).message}`, 12000);
    }
  }

  private async editEndpointExposures(file: TFile, endpoint: LocalRecord): Promise<void> {
    try {
      const editor = this.host.modelEditor();
      if (!editor) throw new Error("Workbench is still starting.");
      const text = await this.app.vault.read(file);
      const region = parseLocalModel(text);
      if (!region?.structured) throw new Error("The owner note has no usable Local Model.");

      const endpoints = region.records.filter((record) => record.kind === "endpoint" && record.localId !== endpoint.localId);
      const exposedIds = new Set(endpoint.exposes.filter((link) => !link.target && link.blockId).map((link) => link.blockId));
      const addOptions = endpoints.filter((candidate) => !exposedIds.has(candidate.localId));
      const removeOptions = endpoints.filter((candidate) => exposedIds.has(candidate.localId));
      if (!addOptions.length && !removeOptions.length) throw new Error("This endpoint has no same-note exposure edit available.");

      new LocalEndpointExposureEditModal(
        this.app,
        file.basename,
        endpoint,
        addOptions,
        removeOptions,
        (mode, target) => {
          const remaining = endpoint.exposes
            .filter((link) => !(mode === "remove" && !link.target && link.blockId === target.localId))
            .map((link) => link.text);
          if (mode === "add") remaining.push(`[[#^${target.localId}|${target.identifier}]]`);
          return editor.stageAndReviewLocalRecordPatch(file.path, endpoint.localId, {
            fields: { exposes: remaining.length ? remaining.join(" ") : null },
          });
        },
        (transactionId) => editor.applyLocalPatch(transactionId),
        (transactionId) => { editor.cancelLocalPatch(transactionId); },
        () => { void this.refreshLocal(file, endpoint.localId, true); },
      ).open();
    } catch (e) {
      new Notice(`Cannot edit endpoint exposures: ${(e as Error).message}`, 12000);
    }
  }

  private async reassignEndpointParent(file: TFile, endpoint: LocalRecord): Promise<void> {
    try {
      const editor = this.host.modelEditor();
      if (!editor) throw new Error("Workbench is still starting.");
      const text = await this.app.vault.read(file);
      const region = parseLocalModel(text);
      if (!region?.structured) throw new Error("The owner note has no usable Local Model.");
      const currentParentId = endpoint.parent?.blockId ?? "";
      const endpoints = region.records.filter((record) =>
        record.kind === "endpoint" &&
        record.localId !== endpoint.localId &&
        record.localId !== currentParentId
      );
      if (!endpoints.length && !currentParentId) throw new Error("This note has no alternate endpoint occurrence to use as a parent.");
      new LocalEndpointParentReassignModal(
        this.app,
        file.basename,
        endpoint,
        endpoints,
        (parent) => editor.stageAndReviewLocalRecordPatch(file.path, endpoint.localId, {
          fields: parent
            ? { parent: `[[#^${parent.localId}|${parent.identifier}]]`, part: null }
            : { parent: null },
        }),
        (transactionId) => editor.applyLocalPatch(transactionId),
        (transactionId) => { editor.cancelLocalPatch(transactionId); },
        () => { void this.refreshLocal(file, endpoint.localId, true); },
      ).open();
    } catch (e) {
      new Notice(`Cannot reassign endpoint parent: ${(e as Error).message}`, 12000);
    }
  }

  private async reassignEndpointPart(file: TFile, endpoint: LocalRecord): Promise<void> {
    try {
      const editor = this.host.modelEditor();
      if (!editor) throw new Error("Workbench is still starting.");
      const text = await this.app.vault.read(file);
      const region = parseLocalModel(text);
      if (!region?.structured) throw new Error("The owner note has no usable Local Model.");
      const currentPartId = endpoint.part?.blockId ?? "";
      const parts = region.records.filter((record) => record.kind === "part" && record.localId !== currentPartId);
      if (!parts.length) throw new Error("This note has no alternate part occurrence.");
      new LocalEndpointPartReassignModal(
        this.app,
        file.basename,
        endpoint,
        parts,
        (part) => editor.stageAndReviewLocalRecordPatch(file.path, endpoint.localId, {
          fields: {
            part: `[[#^${part.localId}|${part.identifier}]]`,
            parent: null,
          },
        }),
        (transactionId) => editor.applyLocalPatch(transactionId),
        (transactionId) => { editor.cancelLocalPatch(transactionId); },
        () => { void this.refreshLocal(file, endpoint.localId, true); },
      ).open();
    } catch (e) {
      new Notice(`Cannot reassign endpoint part: ${(e as Error).message}`, 12000);
    }
  }

  private async moveFlowConnection(file: TFile, flow: LocalRecord): Promise<void> {
    try {
      const editor = this.host.modelEditor();
      if (!editor) throw new Error("Workbench is still starting.");
      const text = await this.app.vault.read(file);
      const region = parseLocalModel(text);
      if (!region?.structured) throw new Error("The owner note has no usable Local Model.");
      const connections = region.records.filter((record) => record.kind === "connection" && record.localId !== flow.connectionId);
      if (!connections.length) throw new Error("This note has no alternate connection occurrence.");

      new LocalFlowConnectionMoveModal(
        this.app,
        file.basename,
        flow,
        connections,
        (connection) => editor.stageAndReviewLocalFlowMove(file.path, flow.localId, connection.localId),
        (transactionId) => editor.applyLocalPatch(transactionId),
        (transactionId) => { editor.cancelLocalPatch(transactionId); },
        () => { void this.refreshLocal(file, flow.localId, true); },
      ).open();
    } catch (e) {
      new Notice(`Cannot move flow: ${(e as Error).message}`, 12000);
    }
  }

  private editFlowRoles(file: TFile, flow: LocalRecord): void {
    try {
      const editor = this.host.modelEditor();
      if (!editor) throw new Error("Workbench is still starting.");
      new LocalFlowRolesEditModal(
        this.app,
        file.basename,
        flow,
        (roleA, roleB) => editor.stageAndReviewLocalRecordPatch(file.path, flow.localId, {
          fields: {
            endpointA: roleA,
            endpointB: roleB,
          },
        }),
        (transactionId) => editor.applyLocalPatch(transactionId),
        (transactionId) => { editor.cancelLocalPatch(transactionId); },
        () => { void this.refreshLocal(file, flow.localId, true); },
      ).open();
    } catch (e) {
      new Notice(`Cannot edit flow endpoint roles: ${(e as Error).message}`, 12000);
    }
  }

  private editFlowDefinition(file: TFile, flow: LocalRecord): void {
    try {
      const editor = this.host.modelEditor();
      if (!editor) throw new Error("Workbench is still starting.");
      new LocalFlowDefinitionEditModal(
        this.app,
        file.basename,
        flow,
        this.host.elements(file.path),
        (definition) => editor.stageAndReviewLocalRecordPatch(file.path, flow.localId, {
          fields: { definition },
        }),
        (transactionId) => editor.applyLocalPatch(transactionId),
        (transactionId) => { editor.cancelLocalPatch(transactionId); },
        () => { void this.refreshLocal(file, flow.localId, true); },
      ).open();
    } catch (e) {
      new Notice(`Cannot edit flow definition: ${(e as Error).message}`, 12000);
    }
  }

  private editEndpointDefinition(file: TFile, endpoint: LocalRecord): void {
    try {
      const editor = this.host.modelEditor();
      if (!editor) throw new Error("Workbench is still starting.");
      new LocalEndpointDefinitionEditModal(
        this.app,
        file.basename,
        endpoint,
        this.host.elements(file.path),
        (definition) => editor.stageAndReviewLocalRecordPatch(file.path, endpoint.localId, {
          fields: { definition },
        }),
        (transactionId) => editor.applyLocalPatch(transactionId),
        (transactionId) => { editor.cancelLocalPatch(transactionId); },
        () => { void this.refreshLocal(file, endpoint.localId, true); },
      ).open();
    } catch (e) {
      new Notice(`Cannot edit endpoint definition: ${(e as Error).message}`, 12000);
    }
  }

  private editPartDefinition(file: TFile, part: LocalRecord): void {
    try {
      const editor = this.host.modelEditor();
      if (!editor) throw new Error("Workbench is still starting.");
      new LocalPartDefinitionEditModal(
        this.app,
        file.basename,
        part,
        this.host.elements(file.path),
        (definition) => editor.stageAndReviewLocalRecordPatch(file.path, part.localId, {
          fields: { definition },
        }),
        (transactionId) => editor.applyLocalPatch(transactionId),
        (transactionId) => { editor.cancelLocalPatch(transactionId); },
        () => { void this.refreshLocal(file, part.localId, true); },
      ).open();
    } catch (e) {
      new Notice(`Cannot edit part definition: ${(e as Error).message}`, 12000);
    }
  }

  private editConnectionDefinition(file: TFile, connection: LocalRecord): void {
    try {
      const editor = this.host.modelEditor();
      if (!editor) throw new Error("Workbench is still starting.");
      new LocalConnectionDefinitionEditModal(
        this.app,
        file.basename,
        connection,
        this.host.elements(file.path),
        (definition) => editor.stageAndReviewLocalRecordPatch(file.path, connection.localId, {
          fields: { definition },
        }),
        (transactionId) => editor.applyLocalPatch(transactionId),
        (transactionId) => { editor.cancelLocalPatch(transactionId); },
        () => { void this.refreshLocal(file, connection.localId, true); },
      ).open();
    } catch (e) {
      new Notice(`Cannot edit connection definition: ${(e as Error).message}`, 12000);
    }
  }

  private async rewireConnectionEndpoint(
    file: TFile,
    connection: LocalRecord,
    end: "endpointA" | "endpointB",
  ): Promise<void> {
    try {
      const editor = this.host.modelEditor();
      if (!editor) throw new Error("Workbench is still starting.");
      const text = await this.app.vault.read(file);
      const region = parseLocalModel(text);
      if (!region?.structured) throw new Error("The owner note has no usable Local Model.");

      const current = end === "endpointA" ? connection.endpointA?.blockId : connection.endpointB?.blockId;
      const options = region.records.filter((record) => record.kind === "endpoint" && record.localId !== current);
      if (!options.length) throw new Error("This note has no alternate endpoint occurrence.");

      new LocalConnectionEndpointRewireModal(
        this.app,
        file.basename,
        connection,
        end,
        options,
        (target) => editor.stageAndReviewLocalRecordPatch(file.path, connection.localId, {
          fields: { [end]: `[[#^${target.localId}|${target.identifier}]]` },
        }),
        (transactionId) => editor.applyLocalPatch(transactionId),
        (transactionId) => { editor.cancelLocalPatch(transactionId); },
        () => { void this.refreshLocal(file, connection.localId, true); },
      ).open();
    } catch (e) {
      new Notice(`Cannot rewire connection endpoint: ${(e as Error).message}`, 12000);
    }
  }

  private async createFlowOccurrence(file: TFile, connection: LocalRecord): Promise<void> {
    try {
      const editor = this.host.modelEditor();
      if (!editor) throw new Error("Workbench is still starting.");
      const text = await this.app.vault.read(file);
      const region = parseLocalModel(text);
      if (!region?.structured) throw new Error("The owner note has no usable Local Model.");
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
      const ownerUid = typeof fm?.uid === "string" ? fm.uid : "";
      const localId = nextAvailableLocalId("flow", ownerUid, region.records.map((record) => record.localId));
      const definitions = this.host.elements(file.path);
      if (!definitions.length) throw new Error("No reusable model definitions are available.");
      new LocalFlowCreateModal(
        this.app,
        file.basename,
        connection,
        localId,
        definitions,
        (input) => editor.stageAndReviewLocalRecordCreate(file.path, input),
        (transactionId) => editor.applyLocalCreate(transactionId),
        (transactionId) => { editor.cancelLocalCreate(transactionId); },
        (createdId) => { void this.refreshLocal(file, createdId, true); },
      ).open();
    } catch (e) {
      new Notice(`Cannot create flow: ${(e as Error).message}`, 12000);
    }
  }

  private async createConnectionOccurrence(file: TFile, source: LocalRecord): Promise<void> {
    try {
      const editor = this.host.modelEditor();
      if (!editor) throw new Error("Workbench is still starting.");
      const text = await this.app.vault.read(file);
      const region = parseLocalModel(text);
      if (!region?.structured) throw new Error("The owner note has no usable Local Model.");
      const options = region.records.filter((record) => record.kind === "endpoint" && record.localId !== source.localId);
      if (!options.length) throw new Error("This note has no second endpoint occurrence to connect.");
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
      const ownerUid = typeof fm?.uid === "string" ? fm.uid : "";
      const localId = nextAvailableLocalId("connection", ownerUid, region.records.map((record) => record.localId));
      const definitions = this.host.elements(file.path);
      new LocalConnectionCreateModal(
        this.app,
        file.basename,
        source,
        options,
        localId,
        definitions,
        (input) => editor.stageAndReviewLocalRecordCreate(file.path, input),
        (transactionId) => editor.applyLocalCreate(transactionId),
        (transactionId) => { editor.cancelLocalCreate(transactionId); },
        (createdId) => { void this.refreshLocal(file, createdId, true); },
      ).open();
    } catch (e) {
      new Notice(`Cannot create connection: ${(e as Error).message}`, 12000);
    }
  }

  private async createEndpointOccurrence(file: TFile, part: LocalRecord): Promise<void> {
    try {
      const editor = this.host.modelEditor();
      if (!editor) throw new Error("Workbench is still starting.");
      const text = await this.app.vault.read(file);
      const region = parseLocalModel(text);
      if (!region?.structured) throw new Error("The owner note has no usable Local Model.");
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
      const ownerUid = typeof fm?.uid === "string" ? fm.uid : "";
      const localId = nextAvailableLocalId("endpoint", ownerUid, region.records.map((record) => record.localId));
      const definitions = this.host.elements(file.path);
      if (!definitions.length) throw new Error("No reusable model definitions are available.");
      new LocalEndpointCreateModal(
        this.app,
        file.basename,
        part.identifier,
        part.localId,
        localId,
        definitions,
        (input) => editor.stageAndReviewLocalRecordCreate(file.path, input),
        (transactionId) => editor.applyLocalCreate(transactionId),
        (transactionId) => { editor.cancelLocalCreate(transactionId); },
        (createdId) => { void this.refreshLocal(file, createdId, true); },
      ).open();
    } catch (e) {
      new Notice(`Cannot create endpoint: ${(e as Error).message}`, 12000);
    }
  }

  private deleteOccurrence(file: TFile, record: LocalRecord): void {
    if (record.kind !== "part" && record.kind !== "endpoint" && record.kind !== "connection" && record.kind !== "flow") return;
    try {
      const editor = this.host.modelEditor();
      if (!editor) throw new Error("Workbench is still starting.");
      new LocalOccurrenceDeleteModal(
        this.app,
        file.basename,
        record.identifier,
        record.kind,
        () => editor.stageAndReviewLocalRecordDelete(file.path, record.localId),
        (transactionId) => editor.applyLocalDelete(transactionId),
        (transactionId) => { editor.cancelLocalDelete(transactionId); },
        () => { void this.show(file, false); },
      ).open();
    } catch (e) {
      new Notice(`Cannot delete occurrence: ${(e as Error).message}`, 12000);
    }
  }

  private async createPartOccurrence(file: TFile): Promise<void> {
    try {
      const editor = this.host.modelEditor();
      if (!editor) throw new Error("Workbench is still starting.");
      const text = await this.app.vault.read(file);
      const region = parseLocalModel(text);
      if (region && !region.structured) throw new Error("The owner note has no usable Local Model.");
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
      if (fm?.type !== "Object") throw new Error("Part occurrences can only be created in an Object owner.");
      const ownerUid = typeof fm?.uid === "string" ? fm.uid : "";
      const localId = nextAvailableLocalId("part", ownerUid, region?.records.map((record) => record.localId) ?? []);
      const definitions = this.host.elements(file.path);
      if (!definitions.length) throw new Error("No reusable model definitions are available.");
      new LocalPartCreateModal(
        this.app,
        file.basename,
        localId,
        definitions,
        (input) => editor.stageAndReviewLocalRecordCreate(file.path, input),
        (transactionId) => editor.applyLocalCreate(transactionId),
        (transactionId) => { editor.cancelLocalCreate(transactionId); },
        (createdId) => { void this.refreshLocal(file, createdId, true); },
      ).open();
    } catch (e) {
      new Notice(`Cannot create occurrence: ${(e as Error).message}`, 12000);
    }
  }

  private async saveLocalPatch(file: TFile, record: LocalRecord, patch: LocalRecordPatch): Promise<void> {
    try {
      const editor = this.host.modelEditor();
      if (!editor) throw new Error("Workbench is still starting.");
      const result = await editor.patchLocalRecord(file.path, record.localId, patch);
      if (result.changed) new Notice(`Saved context for ${record.identifier}.`, 3000);
      await this.refreshLocal(file, record.localId, true);
    } catch (e) {
      new Notice(`Not saved: ${(e as Error).message}`, 12000);
      await this.refreshLocal(file, record.localId, true);
    }
  }

  private async refreshLocal(file: TFile, localId: string, editMode: boolean): Promise<void> {
    const text = await this.app.vault.read(file);
    const refreshed = parseLocalModel(text)?.records.find((candidate) => candidate.localId === localId);
    if (!refreshed) {
      new Notice(`Local Model record ${localId} is no longer present in ${file.basename}.`, 8000);
      this.close();
      return;
    }
    this.showLocal(file, refreshed, editMode);
  }

  /** A card for a note that does not exist yet (WB-092). */
  showUndefined(name: string): void {
    this.generation++;
    this.current = null;
    this.currentLocal = null;
    this.definitionReturn = null;
    this.definitionImpactReviewedPath = null;
    this.history = [];
    this.editing = false;
    this.bodyArea = null;
    this.renderer?.unload();
    this.renderer = null;
    const root = this.ensure();
    root.empty();
    root.removeClass("mdse-detail-editing");
    const head = root.createDiv({ cls: "mdse-detail-head" });
    head.createDiv({ cls: "mdse-detail-title", text: name });
    head.createEl("button", { text: "×", cls: "mdse-detail-btn", attr: { "aria-label": "Close" } }).onclick = () => this.close();
    root.createDiv({ cls: "mdse-detail-chips" }).createSpan({ cls: "mdse-detail-chip mdse-detail-undefined", text: "undefined" });
    root.createEl("p", { cls: "mdse-detail-empty", text: "No note with this name exists yet. It is linked from the note it hangs off in this view, and still has to be defined." });
  }

  close(): void {
    this.generation++;
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    this.renderer?.unload();
    this.renderer = null;
    this.el?.remove();
    this.el = null;
    this.current = null;
    this.currentLocal = null;
    this.history = [];
    this.editing = false;
    this.bodyArea = null;
    document.removeEventListener("keydown", this.escape, true);
  }

  private ensure(): HTMLElement {
    if (!this.el) {
      this.el = document.body.createDiv({ cls: "mdse-detail" });
      document.addEventListener("keydown", this.escape, true);
    }
    return this.el;
  }

  // ---- Properties ----

  private propertiesSection(root: HTMLElement, file: TFile, fm: Record<string, unknown> | null, fields: ReadonlySet<string>, schema: Schema | null): void {
    const rows = propertyRows(fm, fields, this.editing);
    if (!rows.length) return;
    const details = root.createEl("details", { cls: "mdse-detail-props" });
    details.open = this.editing;
    details.createEl("summary", { text: `Properties (${rows.reduce((n, r) => n + r.count, 0)})` });
    const table = details.createEl("table");
    const type = typeof fm?.type === "string" ? fm.type : "";
    const ctx = {
      relationFields: fields,
      translatedOnly: new Set(schema?.translatedOnlyProperties ?? []),
      subtypes: schema ? (schema.classes.find((c) => c.name === type)?.subtypes ?? null) : null,
    };
    for (const r of rows) {
      const tr = table.createEl("tr");
      tr.createEl("th", { text: r.count > 1 ? `${r.key} (${r.count})` : r.key });
      const td = tr.createEl("td");
      const value = fm?.[r.key];
      const editor = this.editing ? propertyEditor(r.key, value, ctx) : null;
      if (!editor || editor.kind === "readonly") {
        this.parts(td, r, file.path);
        if (editor) td.setAttr("title", editor.kind === "readonly" ? editor.why : "");
        continue;
      }
      const save = async (v: unknown) => {
        try {
          if (!(await this.ensureDefinitionImpactReviewed(file))) return;
          const writer = this.host.writer();
          if (!writer) throw new Error("Workbench is still starting.");
          await writer.setProperty(file.path, r.key, v);
          this.consumeDefinitionImpactReview(file);
          new Notice(`Saved ${r.key} on ${file.basename}.`, 3000);
        } catch (e) {
          new Notice(`Not saved: ${(e as Error).message}`, 12000);
          void this.show(file, false);
        }
      };
      if (editor.kind === "select") {
        const sel = td.createEl("select", { cls: "dropdown mdse-detail-input" });
        for (const o of editor.options) sel.createEl("option", { value: o, text: o === "" ? "(none)" : o });
        sel.value = typeof value === "string" ? value : "";
        sel.onchange = () => void save(sel.value);
      } else {
        const text = editor.kind === "list" ? (value as unknown[]).map(String).join(", ") : value === null || value === undefined ? "" : String(value);
        const input = td.createEl("input", { type: "text", cls: "mdse-detail-input", value: text });
        if (editor.kind === "status") {
          const id = `mdse-status-${Math.random().toString(36).slice(2, 8)}`;
          input.setAttr("list", id);
          const dl = td.createEl("datalist", { attr: { id } });
          for (const s of editor.suggestions) dl.createEl("option", { value: s });
        }
        if (editor.kind === "list") input.setAttr("placeholder", "comma separated");
        input.onchange = () => void save(editor.kind === "list" ? parseListInput(input.value) : coerceValue(value, input.value));
        input.onkeydown = (e) => {
          if (e.key === "Enter") input.blur();
          e.stopPropagation();
        };
      }
    }
  }

  // ---- Relationships ----

  private relationshipsSection(root: HTMLElement, file: TFile, rows: PropertyRow[], fields: ReadonlySet<string>): void {
    if (!rows.length && !this.editing) return;
    const details = root.createEl("details", { cls: "mdse-detail-props" });
    details.open = this.editing;
    details.createEl("summary", { text: `Relationships (${rows.reduce((n, r) => n + r.count, 0)})` });
    if (rows.length) {
      const table = details.createEl("table");
      for (const r of rows) {
        const tr = table.createEl("tr");
        tr.createEl("th", { text: r.count > 1 ? `${r.key} (${r.count})` : r.key });
        const td = tr.createEl("td");
        if (!this.editing) {
          this.parts(td, r, file.path);
          continue;
        }
        for (let i = 0; i < r.parts.length; i++) {
          const p = r.parts[i];
          if (!p.link) {
            td.appendText(p.text);
            continue;
          }
          this.link(td, p.text, p.link, file.path);
          const qty = r.parts[i + 1]?.text.startsWith(" ×") ? r.parts[++i] : null;
          if (qty) td.appendText(qty.text);
          const times = qty ? Number(qty.text.slice(2)) : 1;
          const x = td.createEl("button", { text: "✕", cls: "mdse-detail-x", attr: { "aria-label": `Remove ${p.text}`, title: "Remove this relationship" } });
          x.onclick = () => this.confirmRemove(file, r.key, p.link as string, p.text, times, fields);
        }
      }
    }
    if (this.editing) {
      const add = details.createEl("button", { text: "Add relationship…", cls: "mdse-detail-btn mdse-detail-add" });
      add.onclick = () => {
        void (async () => {
          if (!(await this.ensureDefinitionImpactReviewed(file))) return;
          new ElementPicker(this.app, this.host.elements(file.path), `Relate ${file.basename} to…`, (second) => {
            this.consumeDefinitionImpactReview(file);
            this.host.relate(file.path, second.path);
          }).open();
        })();
      };
    }
  }

  private confirmRemove(file: TFile, field: string, linkText: string, shown: string, times: number, _fields: ReadonlySet<string>): void {
    const schema = this.host.schema();
    const target = this.app.metadataCache.getFirstLinkpathDest(linkText, file.path);
    const forward = schema?.byField.get(field);
    const inverseOf = schema?.byInverse.get(field);
    const def = forward ?? inverseOf;
    const back = def ? (def.kind === "symmetric" ? def.field : def.inverse) : undefined;
    const once = times > 1 ? ` It is listed ${times} times; all are removed.` : "";
    const text = !target
      ? `Remove ${field} → ${shown} from ${file.basename}? ${shown} does not exist yet, so there is no inverse.${once}`
      : `Remove ${field} → ${shown} from ${file.basename}${back ? `, and its inverse ${forward ? back : def!.field} on ${shown}` : ""}?${once}`;
    new ConfirmModal(this.app, text, "Remove", () => {
      void (async () => {
        try {
          if (!(await this.ensureDefinitionImpactReviewed(file))) return;
          const writer = this.host.writer();
          if (!writer) throw new Error("Workbench is still starting.");
          if (!target) await writer.removeMissing(file.path, field, linkText);
          else if (forward) await writer.remove(forward, file.path, target.path);
          else if (inverseOf) await writer.remove(inverseOf, target.path, file.path);
          else throw new Error(`${field} is not a relationship in this vault's schema.`);
          this.consumeDefinitionImpactReview(file);
          new Notice(`Removed ${field} → ${shown}.`, 4000);
        } catch (e) {
          new Notice(`Not removed: ${(e as Error).message}`, 12000);
        }
      })();
    }).open();
  }

  // ---- Text ----

  private textEditor(root: HTMLElement, file: TFile, md: string): void {
    this.bodyLoaded = md;
    if (md.includes("<!-- MDSE:LOCAL-MODEL START schema=")) {
      root.createDiv({ cls: "mdse-detail-state", text: "Text editing is disabled for this note because it contains a governed Local Model. Region-aware editing is part of WB-106." });
      return;
    }
    const area = root.createEl("textarea", { cls: "mdse-detail-text", attr: { spellcheck: "true", "aria-label": "Note text" } });
    area.value = md;
    area.rows = Math.min(30, Math.max(10, md.split("\n").length + 2));
    this.bodyArea = area;
    const bar = root.createDiv({ cls: "mdse-detail-bar" });
    const save = bar.createEl("button", { text: "Save text", cls: "mdse-detail-btn mod-cta" });
    const cancel = bar.createEl("button", { text: "Revert", cls: "mdse-detail-btn" });
    const state = bar.createSpan({ cls: "mdse-detail-state" });
    const sync = () => {
      const dirty = this.isDirty();
      save.disabled = !dirty;
      cancel.disabled = !dirty;
      state.setText(dirty ? "unsaved" : "");
    };
    sync();
    area.oninput = sync;
    area.onkeydown = (e) => {
      e.stopPropagation(); // Esc and typing stay in the box; the canvas gets no shortcuts
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !save.disabled) save.click();
      if (e.key === "Escape") area.blur();
    };
    cancel.onclick = () => {
      area.value = this.bodyLoaded;
      sync();
    };
    save.onclick = () => {
      void (async () => {
        try {
          if (!(await this.ensureDefinitionImpactReviewed(file))) return;
          const writer = this.host.writer();
          if (!writer) throw new Error("Workbench is still starting.");
          await writer.setBody(file.path, this.bodyLoaded, area.value);
          this.consumeDefinitionImpactReview(file);
          this.bodyLoaded = area.value; // clean now; the change event re-renders the popup
          sync();
          new Notice(`Saved the text of ${file.basename}.`, 3000);
          if (this.current) void this.show(this.current, false);
        } catch (e) {
          new Notice(`Not saved: ${(e as Error).message}`, 12000);
        }
      })();
    };
  }

  // ---- Shared ----

  private parts(td: HTMLElement, r: PropertyRow, from: string): void {
    for (const p of r.parts) {
      if (p.link) this.link(td, p.text, p.link, from);
      else td.appendText(p.text);
    }
  }

  private link(parent: HTMLElement, text: string, linktext: string, from: string): void {
    const exists = !!this.app.metadataCache.getFirstLinkpathDest(linktext, from);
    if (!exists) {
      // A note that does not exist yet (WB-092): shown, not clickable.
      parent.createSpan({ text, cls: "mdse-detail-missing", attr: { title: "undefined: no note with this name yet" } });
      return;
    }
    const a = parent.createEl("a", { text, cls: "internal-link", href: "#" });
    a.onclick = (e) => {
      e.preventDefault();
      const target = this.app.metadataCache.getFirstLinkpathDest(linktext, from);
      if (target) void this.show(target);
    };
  }
}

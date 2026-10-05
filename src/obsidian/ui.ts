import { App, FuzzySuggestModal, Modal, Notice, SuggestModal, type FuzzyMatch } from "obsidian";
import type { NoteRecord } from "../core/model";
import type { RelationshipOption } from "../core/rules";
import type { ViewProfile } from "../core/views";
import type { NewLocalRecord } from "../core/localmodel-edit";
import type { LocalRecord } from "../core/localmodel";
import type { StagedLocalCreate, StagedLocalDelete, StagedLocalPatch } from "../core/model-edit";
import type { StagedDefinitionCreation } from "../core/definition-create";
import type { StagedDefinitionDelete } from "../core/definition-delete";
import type { StagedDefinitionRetirement } from "../core/definition-retire";
import type { StagedDefinitionSupersession } from "../core/definition-supersede-service";
import type { DefinitionMigrationCandidate } from "../core/definition-supersede";
import type { StagedDefinitionNoteMigration } from "../core/definition-note-migrate-service";

/** Element picker (WB-018 to WB-020): name first, with type and id beside it (WB-083). */
export class ElementPicker extends FuzzySuggestModal<NoteRecord> {
  constructor(app: App, private readonly items: NoteRecord[], placeholder: string, private readonly onPick: (r: NoteRecord) => void) {
    super(app);
    this.setPlaceholder(placeholder);
  }
  getItems(): NoteRecord[] {
    return this.items;
  }
  getItemText(r: NoteRecord): string {
    return `${r.name} ${r.type ?? ""} ${r.id ?? ""}`;
  }
  renderSuggestion(m: FuzzyMatch<NoteRecord>, el: HTMLElement): void {
    el.createSpan({ text: m.item.name });
    el.createSpan({ cls: "mdse-option-meta", text: [m.item.type, m.item.id].filter(Boolean).join(", ") });
  }
  onChooseItem(r: NoteRecord): void {
    this.onPick(r);
  }
}

/** Relationship picker: only relationships the endpoint rules allow (WB-053). */
export class RelationshipPicker extends SuggestModal<RelationshipOption> {
  constructor(
    app: App,
    private readonly options: RelationshipOption[],
    private readonly first: NoteRecord,
    private readonly second: NoteRecord,
    private readonly onPick: (o: RelationshipOption) => void,
  ) {
    super(app);
    this.setPlaceholder(`How is ${first.name} related to ${second.name}?`);
    this.emptyStateText = "No relationship is allowed between these two classes.";
  }
  private sentence(o: RelationshipOption): [string, string, string] {
    const [owner, target] = o.ownerIsFirst ? [this.first, this.second] : [this.second, this.first];
    return [owner.name, o.def.field, target.name];
  }
  getSuggestions(query: string): RelationshipOption[] {
    const q = query.toLowerCase();
    return this.options.filter((o) => this.sentence(o).join(" ").toLowerCase().includes(q));
  }
  renderSuggestion(o: RelationshipOption, el: HTMLElement): void {
    const [a, f, b] = this.sentence(o);
    el.createSpan({ text: `${a} ` });
    el.createEl("strong", { text: f });
    el.createSpan({ text: ` ${b}` });
    if (o.def.provisional) el.createSpan({ cls: "mdse-option-meta", text: "provisional: comes back in Review" });
  }
  onChooseSuggestion(o: RelationshipOption): void {
    this.onPick(o);
  }
}

/** Picks one of the views that can start from the current note (WB-102). */
export class ViewPicker extends SuggestModal<ViewProfile> {
  constructor(app: App, private readonly profiles: ViewProfile[], noteName: string, private readonly onPick: (p: ViewProfile) => void) {
    super(app);
    this.setPlaceholder(`View of ${noteName}…`);
    this.emptyStateText = "No view starts from this kind of note.";
  }
  getSuggestions(query: string): ViewProfile[] {
    const q = query.toLowerCase();
    return this.profiles.filter((p) => `${p.name} ${p.description ?? ""}`.toLowerCase().includes(q));
  }
  renderSuggestion(p: ViewProfile, el: HTMLElement): void {
    el.createEl("strong", { text: p.name });
    el.createDiv({ cls: "mdse-option-meta", text: p.description ?? "" });
  }
  onChooseSuggestion(p: ViewProfile): void {
    this.onPick(p);
  }
}

/** A simple two-column report used by diagnostics and the Canvas probe. */
export class ReportModal extends Modal {
  constructor(app: App, private readonly heading: string, private readonly rows: Array<[string, string, boolean?]>, private readonly notes: string[] = []) {
    super(app);
  }
  onOpen(): void {
    this.titleEl.setText(this.heading);
    const wrap = this.contentEl.createDiv({ cls: "mdse-diagnostics" });
    const table = wrap.createEl("table");
    for (const [k, v, warn] of this.rows) {
      const tr = table.createEl("tr");
      tr.createEl("td", { text: k });
      tr.createEl("td", { text: v, cls: warn ? "mdse-warn" : undefined });
    }
    for (const n of this.notes) wrap.createEl("p", { text: n });
  }
  onClose(): void {
    this.contentEl.empty();
  }
}

export class ConfirmModal extends Modal {
  constructor(app: App, private readonly text: string, private readonly action: string, private readonly onYes: () => void) {
    super(app);
  }
  onOpen(): void {
    this.contentEl.createEl("p", { text: this.text });
    const row = this.contentEl.createDiv({ cls: "modal-button-container" });
    row.createEl("button", { text: "Cancel" }).onclick = () => this.close();
    const yes = row.createEl("button", { text: this.action, cls: "mod-cta" });
    yes.onclick = () => {
      this.close();
      this.onYes();
    };
  }
  onClose(): void {
    this.contentEl.empty();
  }
}


export class LocalPartCreateModal extends Modal {
  private staged: StagedLocalCreate | null = null;
  private applied = false;

  constructor(
    app: App,
    private readonly ownerName: string,
    private readonly localId: string,
    private readonly definitions: NoteRecord[],
    private readonly stage: (input: NewLocalRecord) => Promise<StagedLocalCreate>,
    private readonly apply: (transactionId: string) => Promise<void>,
    private readonly cancel: (transactionId: string) => void,
    private readonly onApplied: (localId: string) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.renderCompose();
  }

  onClose(): void {
    const staged = this.staged;
    this.staged = null;
    this.contentEl.empty();
    if (staged && !this.applied) {
      try { this.cancel(staged.transaction.id); } catch { /* already cancelled */ }
    }
  }

  private renderCompose(): void {
    this.titleEl.setText("Add part occurrence");
    this.contentEl.empty();

    this.contentEl.createEl("p", {
      text: `Create a contextual part occurrence inside ${this.ownerName}. Nothing is written until Review → Apply.`,
    });

    const field = (label: string, value = "", placeholder = ""): HTMLInputElement => {
      const row = this.contentEl.createDiv({ cls: "mdse-create-field" });
      row.createEl("label", { text: label });
      const input = row.createEl("input", { type: "text", cls: "mdse-detail-input", value });
      if (placeholder) input.setAttr("placeholder", placeholder);
      input.onkeydown = (e) => e.stopPropagation();
      return input;
    };

    const heading = field("Occurrence name", "", "K1");
    const definitionRow = this.contentEl.createDiv({ cls: "mdse-create-field" });
    definitionRow.createEl("label", { text: "Reusable definition" });
    const definition = definitionRow.createEl("select", { cls: "mdse-detail-input" });
    definition.createEl("option", { text: "Choose a model definition…", value: "" });
    for (const option of this.definitions) {
      definition.createEl("option", { text: `${option.name} — ${option.type ?? "model"}`, value: option.path });
    }
    const usage = field("Usage", "standard", "standard");
    const multiplicity = field("Multiplicity", "", "optional");

    const id = this.contentEl.createEl("p", { cls: "mdse-muted", text: `Local ID: ${this.localId}` });
    id.setAttr("title", "Generated from the governed timestamp + author-suffix identity format.");

    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).onclick = () => this.close();
    const review = buttons.createEl("button", { text: "Review", cls: "mod-cta" });
    review.onclick = () => {
      void (async () => {
        review.disabled = true;
        try {
          const selected = this.definitions.find((option) => option.path === definition.value);
          if (!selected) throw new Error("Choose a reusable definition from the model.");
          const definitionLink = `[[${selected.path.replace(/\.md$/i, "")}]]`;
          const fields: Record<string, string> = {
            definition: definitionLink,
          };
          if (usage.value.trim() && usage.value.trim() !== "standard") fields.usage = usage.value.trim();
          if (multiplicity.value.trim()) fields.multiplicity = multiplicity.value.trim();

          const staged = await this.stage({
            kind: "part",
            localId: this.localId,
            heading: heading.value.trim(),
            fields,
          });
          this.staged = staged;
          this.renderReview(staged, {
            heading: heading.value.trim(),
            definition: definitionLink,
            usage: usage.value.trim() || "standard",
            multiplicity: multiplicity.value.trim(),
          });
        } catch (e) {
          new Notice(`Cannot stage occurrence: ${(e as Error).message}`, 12000);
          review.disabled = false;
        }
      })();
    };
  }

  private renderReview(
    staged: StagedLocalCreate,
    values: { heading: string; definition: string; usage: string; multiplicity: string },
  ): void {
    this.titleEl.setText("Review new part occurrence");
    this.contentEl.empty();

    const table = this.contentEl.createEl("table", { cls: "mdse-diagnostics" });
    const row = (key: string, value: string) => {
      const tr = table.createEl("tr");
      tr.createEl("td", { text: key });
      tr.createEl("td", { text: value || "—" });
    };
    row("Owner", this.ownerName);
    row("Transaction", staged.transaction.label);
    row("Scope", staged.transaction.scope);
    row("Occurrence", values.heading);
    row("Reusable definition", values.definition);
    row("Usage", values.usage);
    row("Multiplicity", values.multiplicity);
    row("Local ID", staged.plan.localId);

    const findings = staged.plan.findings;
    const blocking = findings.filter((finding) => finding.severity === "error");
    if (findings.length) {
      const box = this.contentEl.createDiv({ cls: "mdse-detail-state" });
      box.createEl("strong", { text: blocking.length ? "Validation findings" : "Validation warnings" });
      for (const finding of findings) {
        box.createEl("p", {
          text: `${finding.severity.toUpperCase()}: ${finding.message}`,
          cls: finding.severity === "error" ? "mdse-warn" : undefined,
        });
      }
    } else {
      this.contentEl.createEl("p", { cls: "mdse-muted", text: "Validation passed. Apply will write one structural Local Model change." });
    }

    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).onclick = () => {
      try { this.cancel(staged.transaction.id); } finally {
        this.staged = null;
        this.close();
      }
    };
    const apply = buttons.createEl("button", { text: "Apply", cls: "mod-cta" });
    apply.disabled = blocking.length > 0;
    apply.setAttr("title", blocking.length ? "Resolve blocking validation findings before Apply." : "Apply this staged structural change.");
    apply.onclick = () => {
      void (async () => {
        apply.disabled = true;
        try {
          await this.apply(staged.transaction.id);
          this.applied = true;
          this.staged = null;
          this.close();
          this.onApplied(staged.plan.localId);
          new Notice(`Created part occurrence ${values.heading}.`, 5000);
        } catch (e) {
          new Notice(`Not applied: ${(e as Error).message}`, 12000);
          apply.disabled = false;
        }
      })();
    };
  }
}


export class LocalOccurrenceDeleteModal extends Modal {
  private staged: StagedLocalDelete | null = null;
  private applied = false;

  constructor(
    app: App,
    private readonly ownerName: string,
    private readonly occurrenceName: string,
    private readonly occurrenceKind: "part" | "endpoint" | "connection" | "flow",
    private readonly stage: () => Promise<StagedLocalDelete>,
    private readonly apply: (transactionId: string) => Promise<void>,
    private readonly cancel: (transactionId: string) => void,
    private readonly onApplied: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(`Review ${this.occurrenceKind} occurrence deletion`);
    void this.load();
  }

  onClose(): void {
    const staged = this.staged;
    this.staged = null;
    this.contentEl.empty();
    if (staged && !this.applied) {
      try { this.cancel(staged.transaction.id); } catch { /* already cancelled */ }
    }
  }

  private async load(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.createEl("p", { text: "Checking structural dependencies before anything is changed…" });
    try {
      const staged = await this.stage();
      this.staged = staged;
      this.renderReview(staged);
    } catch (e) {
      this.contentEl.empty();
      this.contentEl.createEl("p", { cls: "mdse-warn", text: `Cannot stage deletion: ${(e as Error).message}` });
      const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
      buttons.createEl("button", { text: "Close" }).onclick = () => this.close();
    }
  }

  private renderReview(staged: StagedLocalDelete): void {
    this.contentEl.empty();
    const table = this.contentEl.createEl("table", { cls: "mdse-diagnostics" });
    const row = (key: string, value: string) => {
      const tr = table.createEl("tr");
      tr.createEl("td", { text: key });
      tr.createEl("td", { text: value || "—" });
    };
    row("Owner", this.ownerName);
    row("Occurrence", this.occurrenceName);
    row("Transaction", staged.transaction.label);
    row("Scope", staged.transaction.scope);
    row("Local ID", staged.plan.localId);

    const localImpacts = staged.plan.impacts;
    const externalImpacts = staged.externalImpacts;
    const blockingFindings = staged.plan.findings.filter((finding) => finding.severity === "error");
    const blocked = localImpacts.length + externalImpacts.length + blockingFindings.length > 0;

    const impactBox = this.contentEl.createDiv({ cls: "mdse-detail-state" });
    if (!blocked) {
      impactBox.createEl("strong", { text: "Impact review passed" });
      impactBox.createEl("p", { text: "No Local Model or indexed note-level references depend on this occurrence." });
    } else {
      impactBox.createEl("strong", { text: "Deletion blocked by dependencies" });
      for (const impact of localImpacts) {
        impactBox.createEl("p", {
          cls: "mdse-warn",
          text: `LOCAL: ${impact.sourceKind} "${impact.sourceIdentifier}" uses this occurrence through ${impact.field}.`,
        });
      }
      for (const impact of externalImpacts) {
        impactBox.createEl("p", {
          cls: "mdse-warn",
          text: `MODEL: ${impact.path} targets this occurrence through ${impact.field}.`,
        });
      }
      for (const finding of blockingFindings) {
        impactBox.createEl("p", { cls: "mdse-warn", text: `ERROR: ${finding.message}` });
      }
    }

    const warnings = staged.plan.findings.filter((finding) => finding.severity === "warning");
    if (warnings.length) {
      const warningBox = this.contentEl.createDiv({ cls: "mdse-detail-state" });
      warningBox.createEl("strong", { text: "Warnings" });
      for (const finding of warnings) warningBox.createEl("p", { text: finding.message });
    }

    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).onclick = () => {
      try { this.cancel(staged.transaction.id); } finally {
        this.staged = null;
        this.close();
      }
    };
    const apply = buttons.createEl("button", { text: "Apply deletion", cls: "mod-warning" });
    apply.disabled = blocked;
    apply.setAttr("title", blocked ? "Remove dependent references before deleting this occurrence." : "Delete this occurrence.");
    apply.onclick = () => {
      void (async () => {
        apply.disabled = true;
        try {
          await this.apply(staged.transaction.id);
          this.applied = true;
          this.staged = null;
          this.close();
          this.onApplied();
          new Notice(`Deleted ${this.occurrenceKind} occurrence ${this.occurrenceName}.`, 5000);
        } catch (e) {
          new Notice(`Not deleted: ${(e as Error).message}`, 12000);
          apply.disabled = false;
        }
      })();
    };
  }
}


export class LocalEndpointCreateModal extends Modal {
  private staged: StagedLocalCreate | null = null;
  private applied = false;

  constructor(
    app: App,
    private readonly ownerName: string,
    private readonly partName: string,
    private readonly partLocalId: string,
    private readonly localId: string,
    private readonly definitions: NoteRecord[],
    private readonly stage: (input: NewLocalRecord) => Promise<StagedLocalCreate>,
    private readonly apply: (transactionId: string) => Promise<void>,
    private readonly cancel: (transactionId: string) => void,
    private readonly onApplied: (localId: string) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.renderCompose();
  }

  onClose(): void {
    const staged = this.staged;
    this.staged = null;
    this.contentEl.empty();
    if (staged && !this.applied) {
      try { this.cancel(staged.transaction.id); } catch { /* already cancelled */ }
    }
  }

  private renderCompose(): void {
    this.titleEl.setText("Add endpoint occurrence");
    this.contentEl.empty();
    this.contentEl.createEl("p", {
      text: `Create an endpoint occurrence on part ${this.partName} in ${this.ownerName}. Parent/exposes/connection topology is intentionally deferred.`,
    });

    const field = (label: string, value = "", placeholder = ""): HTMLInputElement => {
      const row = this.contentEl.createDiv({ cls: "mdse-create-field" });
      row.createEl("label", { text: label });
      const input = row.createEl("input", { type: "text", cls: "mdse-detail-input", value });
      if (placeholder) input.setAttr("placeholder", placeholder);
      input.onkeydown = (e) => e.stopPropagation();
      return input;
    };

    const heading = field("Endpoint name", "", "J1");
    const definitionRow = this.contentEl.createDiv({ cls: "mdse-create-field" });
    definitionRow.createEl("label", { text: "Reusable definition" });
    const definition = definitionRow.createEl("select", { cls: "mdse-detail-input" });
    definition.createEl("option", { text: "Choose a model definition…", value: "" });
    for (const option of this.definitions) {
      definition.createEl("option", { text: `${option.name} — ${option.type ?? "model"}`, value: option.path });
    }
    const endpointKind = field("Endpoint kind", "", "physical");
    const usage = field("Usage", "standard", "standard");
    const multiplicity = field("Multiplicity", "", "optional");

    const part = this.contentEl.createEl("p", { cls: "mdse-muted", text: `Attached part: ${this.partName} (#^${this.partLocalId})` });
    part.setAttr("title", "The part relationship is fixed for this creation slice.");
    this.contentEl.createEl("p", { cls: "mdse-muted", text: `Local ID: ${this.localId}` });

    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).onclick = () => this.close();
    const review = buttons.createEl("button", { text: "Review", cls: "mod-cta" });
    review.onclick = () => {
      void (async () => {
        review.disabled = true;
        try {
          const selected = this.definitions.find((option) => option.path === definition.value);
          if (!selected) throw new Error("Choose a reusable definition from the model.");
          const definitionLink = `[[${selected.path.replace(/\.md$/i, "")}]]`;
          const fields: Record<string, string> = {
            definition: definitionLink,
            part: `[[#^${this.partLocalId}|${this.partName}]]`,
          };
          if (endpointKind.value.trim()) fields.kind = endpointKind.value.trim();
          if (usage.value.trim() && usage.value.trim() !== "standard") fields.usage = usage.value.trim();
          if (multiplicity.value.trim()) fields.multiplicity = multiplicity.value.trim();

          const staged = await this.stage({
            kind: "endpoint",
            localId: this.localId,
            heading: heading.value.trim(),
            fields,
          });
          this.staged = staged;
          this.renderReview(staged, {
            heading: heading.value.trim(),
            definition: definitionLink,
            endpointKind: endpointKind.value.trim(),
            usage: usage.value.trim() || "standard",
            multiplicity: multiplicity.value.trim(),
          });
        } catch (e) {
          new Notice(`Cannot stage endpoint: ${(e as Error).message}`, 12000);
          review.disabled = false;
        }
      })();
    };
  }

  private renderReview(
    staged: StagedLocalCreate,
    values: { heading: string; definition: string; endpointKind: string; usage: string; multiplicity: string },
  ): void {
    this.titleEl.setText("Review new endpoint occurrence");
    this.contentEl.empty();
    const table = this.contentEl.createEl("table", { cls: "mdse-diagnostics" });
    const row = (key: string, value: string) => {
      const tr = table.createEl("tr");
      tr.createEl("td", { text: key });
      tr.createEl("td", { text: value || "—" });
    };
    row("Owner", this.ownerName);
    row("Part", this.partName);
    row("Transaction", staged.transaction.label);
    row("Scope", staged.transaction.scope);
    row("Endpoint", values.heading);
    row("Reusable definition", values.definition);
    row("Endpoint kind", values.endpointKind);
    row("Usage", values.usage);
    row("Multiplicity", values.multiplicity);
    row("Local ID", staged.plan.localId);

    const findings = staged.plan.findings;
    const blocking = findings.filter((finding) => finding.severity === "error");
    if (findings.length) {
      const box = this.contentEl.createDiv({ cls: "mdse-detail-state" });
      box.createEl("strong", { text: blocking.length ? "Validation findings" : "Validation warnings" });
      for (const finding of findings) {
        box.createEl("p", {
          text: `${finding.severity.toUpperCase()}: ${finding.message}`,
          cls: finding.severity === "error" ? "mdse-warn" : undefined,
        });
      }
    } else {
      this.contentEl.createEl("p", { cls: "mdse-muted", text: "Validation passed. Apply will add one endpoint occurrence attached to the selected part." });
    }

    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).onclick = () => {
      try { this.cancel(staged.transaction.id); } finally {
        this.staged = null;
        this.close();
      }
    };
    const apply = buttons.createEl("button", { text: "Apply", cls: "mod-cta" });
    apply.disabled = blocking.length > 0;
    apply.onclick = () => {
      void (async () => {
        apply.disabled = true;
        try {
          await this.apply(staged.transaction.id);
          this.applied = true;
          this.staged = null;
          this.close();
          this.onApplied(staged.plan.localId);
          new Notice(`Created endpoint occurrence ${values.heading}.`, 5000);
        } catch (e) {
          new Notice(`Not applied: ${(e as Error).message}`, 12000);
          apply.disabled = false;
        }
      })();
    };
  }
}


export class LocalConnectionCreateModal extends Modal {
  private staged: StagedLocalCreate | null = null;
  private applied = false;
  constructor(
    app: App,
    private readonly ownerName: string,
    private readonly source: LocalRecord,
    private readonly options: LocalRecord[],
    private readonly localId: string,
    private readonly definitions: NoteRecord[],
    private readonly stage: (input: NewLocalRecord) => Promise<StagedLocalCreate>,
    private readonly apply: (id: string) => Promise<void>,
    private readonly cancel: (id: string) => void,
    private readonly onApplied: (localId: string) => void,
  ) { super(app); }

  onOpen(): void { this.compose(); }
  onClose(): void {
    const staged=this.staged; this.staged=null; this.contentEl.empty();
    if (staged && !this.applied) try { this.cancel(staged.transaction.id); } catch {}
  }

  private compose(): void {
    this.titleEl.setText("Add connection");
    this.contentEl.empty();
    this.contentEl.createEl("p",{text:`Connect ${this.source.identifier} to another endpoint in ${this.ownerName}. Flows are not created here.`});
    const input=(label:string, placeholder="")=>{
      const row=this.contentEl.createDiv({cls:"mdse-create-field"});
      row.createEl("label",{text:label});
      const el=row.createEl("input",{type:"text",cls:"mdse-detail-input"});
      if(placeholder) el.setAttr("placeholder",placeholder);
      el.onkeydown=(e)=>e.stopPropagation();
      return el;
    };
    const heading=input("Connection name","Harness");
    const definitionRow=this.contentEl.createDiv({cls:"mdse-create-field"});
    definitionRow.createEl("label",{text:"Reusable definition"});
    const definition=definitionRow.createEl("select",{cls:"mdse-detail-input"});
    definition.createEl("option",{text:"No reusable definition",value:""});
    for(const option of this.definitions) definition.createEl("option",{text:`${option.name} — ${option.type ?? "model"}`,value:option.path});
    const pickRow=this.contentEl.createDiv({cls:"mdse-create-field"});
    pickRow.createEl("label",{text:"Endpoint B"});
    const pick=pickRow.createEl("select",{cls:"mdse-detail-input"});
    pick.createEl("option",{text:"Choose endpoint…",value:""});
    for(const ep of this.options) pick.createEl("option",{text:ep.identifier,value:ep.localId});
    const buttons=this.contentEl.createDiv({cls:"modal-button-container"});
    buttons.createEl("button",{text:"Cancel"}).onclick=()=>this.close();
    const review=buttons.createEl("button",{text:"Review",cls:"mod-cta"});
    review.onclick=()=>void(async()=>{
      review.disabled=true;
      try{
        const target=this.options.find((ep)=>ep.localId===pick.value);
        if(!target) throw new Error("Choose a second endpoint.");
        const fields:Record<string,string>={
          endpointA:`[[#^${this.source.localId}|${this.source.identifier}]]`,
          endpointB:`[[#^${target.localId}|${target.identifier}]]`,
        };
        const selected=this.definitions.find((option)=>option.path===definition.value);
        const definitionLink=selected ? `[[${selected.path.replace(/\.md$/i,"")}]]` : "";
        if(definitionLink) fields.definition=definitionLink;
        const staged=await this.stage({kind:"connection",localId:this.localId,heading:heading.value.trim(),fields});
        this.staged=staged; this.review(staged,heading.value.trim(),definitionLink,target);
      }catch(e){ new Notice(`Cannot stage connection: ${(e as Error).message}`,12000); review.disabled=false; }
    })();
  }

  private review(staged:StagedLocalCreate, heading:string, definition:string, target:LocalRecord): void {
    this.titleEl.setText("Review new connection"); this.contentEl.empty();
    const rows:[string,string][]=[
      ["Owner",this.ownerName],["Connection",heading],["Endpoint A",this.source.identifier],
      ["Endpoint B",target.identifier],["Reusable definition",definition],["Local ID",staged.plan.localId]
    ];
    const table=this.contentEl.createEl("table",{cls:"mdse-diagnostics"});
    for(const [k,v] of rows){const tr=table.createEl("tr");tr.createEl("td",{text:k});tr.createEl("td",{text:v||"—"});}
    const blocking=staged.plan.findings.filter((f)=>f.severity==="error");
    for(const f of staged.plan.findings) this.contentEl.createEl("p",{text:`${f.severity.toUpperCase()}: ${f.message}`,cls:f.severity==="error"?"mdse-warn":undefined});
    const buttons=this.contentEl.createDiv({cls:"modal-button-container"});
    buttons.createEl("button",{text:"Cancel"}).onclick=()=>{try{this.cancel(staged.transaction.id);}finally{this.staged=null;this.close();}};
    const apply=buttons.createEl("button",{text:"Apply",cls:"mod-cta"}); apply.disabled=blocking.length>0;
    apply.onclick=()=>void(async()=>{
      apply.disabled=true;
      try{await this.apply(staged.transaction.id);this.applied=true;this.staged=null;this.close();this.onApplied(staged.plan.localId);new Notice(`Created connection ${heading}.`,5000);}
      catch(e){new Notice(`Not applied: ${(e as Error).message}`,12000);apply.disabled=false;}
    })();
  }
}


export class LocalFlowCreateModal extends Modal {
  private staged: StagedLocalCreate | null = null;
  private applied = false;

  constructor(
    app: App,
    private readonly ownerName: string,
    private readonly connection: LocalRecord,
    private readonly localId: string,
    private readonly definitions: NoteRecord[],
    private readonly stage: (input: NewLocalRecord) => Promise<StagedLocalCreate>,
    private readonly apply: (id: string) => Promise<void>,
    private readonly cancel: (id: string) => void,
    private readonly onApplied: (localId: string) => void,
  ) { super(app); }

  onOpen(): void { this.compose(); }

  onClose(): void {
    const staged=this.staged;
    this.staged=null;
    this.contentEl.empty();
    if(staged && !this.applied) try { this.cancel(staged.transaction.id); } catch {}
  }

  private compose(): void {
    this.titleEl.setText("Add flow");
    this.contentEl.empty();
    this.contentEl.createEl("p",{text:`Create a flow under connection ${this.connection.identifier} in ${this.ownerName}.`});

    const input=(label:string, placeholder="")=>{
      const row=this.contentEl.createDiv({cls:"mdse-create-field"});
      row.createEl("label",{text:label});
      const el=row.createEl("input",{type:"text",cls:"mdse-detail-input"});
      if(placeholder) el.setAttr("placeholder",placeholder);
      el.onkeydown=(e)=>e.stopPropagation();
      return el;
    };

    const heading=input("Flow name","Commands");
    const definitionRow=this.contentEl.createDiv({cls:"mdse-create-field"});
    definitionRow.createEl("label",{text:"Reusable definition"});
    const definition=definitionRow.createEl("select",{cls:"mdse-detail-input"});
    definition.createEl("option",{text:"Choose a model definition…",value:""});
    for(const option of this.definitions) definition.createEl("option",{text:`${option.name} — ${option.type ?? "model"}`,value:option.path});
    const roleA=input("Endpoint A role","transmit");
    const roleB=input("Endpoint B role","receive");

    this.contentEl.createEl("p",{cls:"mdse-muted",text:`Owning connection: ${this.connection.identifier} (#^${this.connection.localId})`});
    this.contentEl.createEl("p",{cls:"mdse-muted",text:`Local ID: ${this.localId}`});

    const buttons=this.contentEl.createDiv({cls:"modal-button-container"});
    buttons.createEl("button",{text:"Cancel"}).onclick=()=>this.close();
    const review=buttons.createEl("button",{text:"Review",cls:"mod-cta"});
    review.onclick=()=>void(async()=>{
      review.disabled=true;
      try{
        const selected=this.definitions.find((option)=>option.path===definition.value);
        if(!selected) throw new Error("Choose a reusable definition from the model.");
        const definitionLink=`[[${selected.path.replace(/\.md$/i,"")}]]`;
        const staged=await this.stage({
          kind:"flow",
          localId:this.localId,
          connectionId:this.connection.localId,
          heading:heading.value.trim(),
          fields:{
            definition:definitionLink,
            endpointA:roleA.value.trim(),
            endpointB:roleB.value.trim(),
          },
        });
        this.staged=staged;
        this.review(staged,heading.value.trim(),definitionLink,roleA.value.trim(),roleB.value.trim());
      }catch(e){
        new Notice(`Cannot stage flow: ${(e as Error).message}`,12000);
        review.disabled=false;
      }
    })();
  }

  private review(staged:StagedLocalCreate, heading:string, definition:string, roleA:string, roleB:string): void {
    this.titleEl.setText("Review new flow");
    this.contentEl.empty();

    const rows:[string,string][]=[
      ["Owner",this.ownerName],
      ["Connection",this.connection.identifier],
      ["Flow",heading],
      ["Reusable definition",definition],
      ["Endpoint A role",roleA],
      ["Endpoint B role",roleB],
      ["Local ID",staged.plan.localId],
    ];
    const table=this.contentEl.createEl("table",{cls:"mdse-diagnostics"});
    for(const [k,v] of rows){
      const tr=table.createEl("tr");
      tr.createEl("td",{text:k});
      tr.createEl("td",{text:v||"—"});
    }

    const blocking=staged.plan.findings.filter((f)=>f.severity==="error");
    for(const f of staged.plan.findings){
      this.contentEl.createEl("p",{text:`${f.severity.toUpperCase()}: ${f.message}`,cls:f.severity==="error"?"mdse-warn":undefined});
    }

    const buttons=this.contentEl.createDiv({cls:"modal-button-container"});
    buttons.createEl("button",{text:"Cancel"}).onclick=()=>{try{this.cancel(staged.transaction.id);}finally{this.staged=null;this.close();}};
    const apply=buttons.createEl("button",{text:"Apply",cls:"mod-cta"});
    apply.disabled=blocking.length>0;
    apply.onclick=()=>void(async()=>{
      apply.disabled=true;
      try{
        await this.apply(staged.transaction.id);
        this.applied=true;
        this.staged=null;
        this.close();
        this.onApplied(staged.plan.localId);
        new Notice(`Created flow ${heading}.`,5000);
      }catch(e){
        new Notice(`Not applied: ${(e as Error).message}`,12000);
        apply.disabled=false;
      }
    })();
  }
}


export class LocalEndpointPartReassignModal extends Modal {
  private staged: StagedLocalPatch | null = null;
  private applied = false;

  constructor(
    app: App,
    private readonly ownerName: string,
    private readonly endpoint: LocalRecord,
    private readonly parts: LocalRecord[],
    private readonly stage: (part: LocalRecord) => Promise<StagedLocalPatch>,
    private readonly apply: (id: string) => Promise<void>,
    private readonly cancel: (id: string) => void,
    private readonly onApplied: () => void,
  ) { super(app); }

  onOpen(): void { this.compose(); }

  onClose(): void {
    const staged=this.staged;
    this.staged=null;
    this.contentEl.empty();
    if(staged && !this.applied) try { this.cancel(staged.transaction.id); } catch {}
  }

  private compose(): void {
    this.titleEl.setText("Reassign endpoint part");
    this.contentEl.empty();
    this.contentEl.createEl("p",{text:`Move endpoint ${this.endpoint.identifier} to another existing part occurrence in ${this.ownerName}.`});

    const row=this.contentEl.createDiv({cls:"mdse-create-field"});
    row.createEl("label",{text:"New part"});
    const pick=row.createEl("select",{cls:"mdse-detail-input"});
    pick.createEl("option",{text:"Choose part…",value:""});
    for(const part of this.parts){
      pick.createEl("option",{text:`${part.identifier} — ^${part.localId}`,value:part.localId});
    }

    this.contentEl.createEl("p",{cls:"mdse-muted",text:`Endpoint: ${this.endpoint.identifier} (#^${this.endpoint.localId})`});
    const buttons=this.contentEl.createDiv({cls:"modal-button-container"});
    buttons.createEl("button",{text:"Cancel"}).onclick=()=>this.close();
    const review=buttons.createEl("button",{text:"Review",cls:"mod-cta"});
    review.onclick=()=>void(async()=>{
      review.disabled=true;
      try{
        const target=this.parts.find((part)=>part.localId===pick.value);
        if(!target) throw new Error("Choose a target part.");
        const staged=await this.stage(target);
        this.staged=staged;
        this.renderReview(staged,target);
      }catch(e){
        new Notice(`Cannot stage part reassignment: ${(e as Error).message}`,12000);
        review.disabled=false;
      }
    })();
  }

  private renderReview(staged:StagedLocalPatch, target:LocalRecord): void {
    this.titleEl.setText("Review endpoint part reassignment");
    this.contentEl.empty();
    const table=this.contentEl.createEl("table",{cls:"mdse-diagnostics"});
    const rows:[string,string][]=[
      ["Owner",this.ownerName],
      ["Endpoint",this.endpoint.identifier],
      ["New part",target.identifier],
      ["Current parent",this.endpoint.parent?.text ?? "none"],
      ["Parent after Apply",this.endpoint.parent ? "cleared" : "none"],
      ["Transaction",staged.transaction.label],
      ["Scope",staged.transaction.scope],
    ];
    for(const [k,v] of rows){const tr=table.createEl("tr");tr.createEl("td",{text:k});tr.createEl("td",{text:v});}

    const blocking=staged.plan.findings.filter((f)=>f.severity==="error");
    if(!staged.plan.findings.length){
      this.contentEl.createEl("p",{cls:"mdse-muted",text:this.endpoint.parent ? "Validation passed. Apply will assign the new part and clear the endpoint parent in one structural transaction." : "Validation passed. Apply will change only the endpoint part assignment."});
    } else {
      for(const f of staged.plan.findings){
        this.contentEl.createEl("p",{text:`${f.severity.toUpperCase()}: ${f.message}`,cls:f.severity==="error"?"mdse-warn":undefined});
      }
    }

    const buttons=this.contentEl.createDiv({cls:"modal-button-container"});
    buttons.createEl("button",{text:"Cancel"}).onclick=()=>{try{this.cancel(staged.transaction.id);}finally{this.staged=null;this.close();}};
    const apply=buttons.createEl("button",{text:"Apply",cls:"mod-cta"});
    apply.disabled=blocking.length>0;
    apply.onclick=()=>void(async()=>{
      apply.disabled=true;
      try{
        await this.apply(staged.transaction.id);
        this.applied=true;
        this.staged=null;
        this.close();
        this.onApplied();
        new Notice(`Reassigned endpoint ${this.endpoint.identifier} to ${target.identifier}.`,5000);
      }catch(e){
        new Notice(`Not applied: ${(e as Error).message}`,12000);
        apply.disabled=false;
      }
    })();
  }
}


export class LocalEndpointParentReassignModal extends Modal {
  private staged: StagedLocalPatch | null = null;
  private applied = false;

  constructor(
    app: App,
    private readonly ownerName: string,
    private readonly endpoint: LocalRecord,
    private readonly endpoints: LocalRecord[],
    private readonly stage: (parent: LocalRecord | null) => Promise<StagedLocalPatch>,
    private readonly apply: (id: string) => Promise<void>,
    private readonly cancel: (id: string) => void,
    private readonly onApplied: () => void,
  ) { super(app); }

  onOpen(): void { this.compose(); }

  onClose(): void {
    const staged = this.staged;
    this.staged = null;
    this.contentEl.empty();
    if (staged && !this.applied) try { this.cancel(staged.transaction.id); } catch {}
  }

  private compose(): void {
    this.titleEl.setText("Change endpoint parent");
    this.contentEl.empty();
    this.contentEl.createEl("p", { text: `Select another endpoint in ${this.ownerName} as the parent of ${this.endpoint.identifier}, or clear the parent relationship. Assigning a parent clears any direct part assignment because part and parent are mutually exclusive.` });

    const row = this.contentEl.createDiv({ cls: "mdse-create-field" });
    row.createEl("label", { text: "Parent endpoint" });
    const pick = row.createEl("select", { cls: "mdse-detail-input" });
    pick.createEl("option", { text: "Choose parent…", value: "" });
    if (this.endpoint.parent) pick.createEl("option", { text: "Clear parent", value: "__clear__" });
    for (const candidate of this.endpoints) {
      pick.createEl("option", { text: `${candidate.identifier} — ^${candidate.localId}`, value: candidate.localId });
    }

    this.contentEl.createEl("p", { cls: "mdse-muted", text: `Endpoint: ${this.endpoint.identifier} (#^${this.endpoint.localId})` });
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).onclick = () => this.close();
    const review = buttons.createEl("button", { text: "Review", cls: "mod-cta" });
    review.onclick = () => void (async () => {
      review.disabled = true;
      try {
        const target = pick.value === "__clear__" ? null : this.endpoints.find((candidate) => candidate.localId === pick.value);
        if (pick.value !== "__clear__" && !target) throw new Error("Choose a parent endpoint.");
        const staged = await this.stage(target ?? null);
        this.staged = staged;
        this.renderReview(staged, target ?? null);
      } catch (e) {
        new Notice(`Cannot stage parent reassignment: ${(e as Error).message}`, 12000);
        review.disabled = false;
      }
    })();
  }

  private renderReview(staged: StagedLocalPatch, target: LocalRecord | null): void {
    this.titleEl.setText("Review endpoint parent reassignment");
    this.contentEl.empty();
    const table = this.contentEl.createEl("table", { cls: "mdse-diagnostics" });
    const rows: [string, string][] = [
      ["Owner", this.ownerName],
      ["Endpoint", this.endpoint.identifier],
      ["New parent", target?.identifier ?? "none"],
      ["Direct part", target && this.endpoint.part ? "cleared" : (this.endpoint.part?.alias ?? this.endpoint.part?.text ?? "none")],
      ["Transaction", staged.transaction.label],
      ["Scope", staged.transaction.scope],
    ];
    for (const [key, value] of rows) {
      const tr = table.createEl("tr");
      tr.createEl("td", { text: key });
      tr.createEl("td", { text: value });
    }

    const blocking = staged.plan.findings.filter((finding) => finding.severity === "error");
    if (!staged.plan.findings.length) {
      this.contentEl.createEl("p", { cls: "mdse-muted", text: "Validation passed. Apply will change only the endpoint parent assignment." });
    } else {
      for (const finding of staged.plan.findings) {
        this.contentEl.createEl("p", { text: `${finding.severity.toUpperCase()}: ${finding.message}`, cls: finding.severity === "error" ? "mdse-warn" : undefined });
      }
    }

    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).onclick = () => {
      try { this.cancel(staged.transaction.id); } finally { this.staged = null; this.close(); }
    };
    const apply = buttons.createEl("button", { text: "Apply", cls: "mod-cta" });
    apply.disabled = blocking.length > 0;
    apply.onclick = () => void (async () => {
      apply.disabled = true;
      try {
        await this.apply(staged.transaction.id);
        this.applied = true;
        this.staged = null;
        this.close();
        this.onApplied();
        new Notice(target
          ? `Reassigned endpoint ${this.endpoint.identifier} parent to ${target.identifier}.`
          : `Cleared parent from endpoint ${this.endpoint.identifier}.`, 5000);
      } catch (e) {
        new Notice(`Not applied: ${(e as Error).message}`, 12000);
        apply.disabled = false;
      }
    })();
  }
}


export class LocalEndpointExposureEditModal extends Modal {
  private staged: StagedLocalPatch | null = null;
  private applied = false;

  constructor(
    app: App,
    private readonly ownerName: string,
    private readonly endpoint: LocalRecord,
    private readonly addOptions: LocalRecord[],
    private readonly removeOptions: LocalRecord[],
    private readonly stage: (mode: "add" | "remove", target: LocalRecord) => Promise<StagedLocalPatch>,
    private readonly apply: (id: string) => Promise<void>,
    private readonly cancel: (id: string) => void,
    private readonly onApplied: () => void,
  ) { super(app); }

  onOpen(): void { this.compose(); }

  onClose(): void {
    const staged = this.staged;
    this.staged = null;
    this.contentEl.empty();
    if (staged && !this.applied) try { this.cancel(staged.transaction.id); } catch {}
  }

  private compose(): void {
    this.titleEl.setText("Edit endpoint exposures");
    this.contentEl.empty();
    this.contentEl.createEl("p", { text: `Add or remove one same-note endpoint exposure for ${this.endpoint.identifier}. Existing equals and connection topology are not changed.` });

    const modeRow = this.contentEl.createDiv({ cls: "mdse-create-field" });
    modeRow.createEl("label", { text: "Change" });
    const mode = modeRow.createEl("select", { cls: "mdse-detail-input" });
    if (this.addOptions.length) mode.createEl("option", { text: "Add exposure", value: "add" });
    if (this.removeOptions.length) mode.createEl("option", { text: "Remove exposure", value: "remove" });

    const targetRow = this.contentEl.createDiv({ cls: "mdse-create-field" });
    targetRow.createEl("label", { text: "Endpoint" });
    const target = targetRow.createEl("select", { cls: "mdse-detail-input" });

    const refill = () => {
      target.empty();
      const options = mode.value === "remove" ? this.removeOptions : this.addOptions;
      target.createEl("option", { text: "Choose endpoint…", value: "" });
      for (const option of options) {
        target.createEl("option", { text: `${option.identifier} — ^${option.localId}`, value: option.localId });
      }
    };
    mode.onchange = refill;
    refill();

    this.contentEl.createEl("p", { cls: "mdse-muted", text: `Endpoint: ${this.endpoint.identifier} (#^${this.endpoint.localId})` });

    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).onclick = () => this.close();
    const review = buttons.createEl("button", { text: "Review", cls: "mod-cta" });
    review.onclick = () => void (async () => {
      review.disabled = true;
      try {
        const editMode = mode.value === "remove" ? "remove" : "add";
        const options = editMode === "remove" ? this.removeOptions : this.addOptions;
        const selected = options.find((option) => option.localId === target.value);
        if (!selected) throw new Error("Choose an endpoint.");
        const staged = await this.stage(editMode, selected);
        this.staged = staged;
        this.renderReview(staged, editMode, selected);
      } catch (e) {
        new Notice(`Cannot stage exposure edit: ${(e as Error).message}`, 12000);
        review.disabled = false;
      }
    })();
  }

  private renderReview(staged: StagedLocalPatch, mode: "add" | "remove", target: LocalRecord): void {
    this.titleEl.setText("Review endpoint exposure edit");
    this.contentEl.empty();
    const table = this.contentEl.createEl("table", { cls: "mdse-diagnostics" });
    const rows: [string, string][] = [
      ["Owner", this.ownerName],
      ["Endpoint", this.endpoint.identifier],
      ["Change", mode === "add" ? "add exposure" : "remove exposure"],
      ["Target endpoint", target.identifier],
      ["Transaction", staged.transaction.label],
      ["Scope", staged.transaction.scope],
    ];
    for (const [key, value] of rows) {
      const tr = table.createEl("tr");
      tr.createEl("td", { text: key });
      tr.createEl("td", { text: value });
    }

    const blocking = staged.plan.findings.filter((finding) => finding.severity === "error");
    if (!staged.plan.findings.length) {
      this.contentEl.createEl("p", { cls: "mdse-muted", text: "Validation passed. Apply will change only the endpoint exposes field." });
    } else {
      for (const finding of staged.plan.findings) {
        this.contentEl.createEl("p", { text: `${finding.severity.toUpperCase()}: ${finding.message}`, cls: finding.severity === "error" ? "mdse-warn" : undefined });
      }
    }

    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).onclick = () => {
      try { this.cancel(staged.transaction.id); } finally { this.staged = null; this.close(); }
    };
    const apply = buttons.createEl("button", { text: "Apply", cls: "mod-cta" });
    apply.disabled = blocking.length > 0;
    apply.onclick = () => void (async () => {
      apply.disabled = true;
      try {
        await this.apply(staged.transaction.id);
        this.applied = true;
        this.staged = null;
        this.close();
        this.onApplied();
        new Notice(`${mode === "add" ? "Added" : "Removed"} exposure ${this.endpoint.identifier} → ${target.identifier}.`, 5000);
      } catch (e) {
        new Notice(`Not applied: ${(e as Error).message}`, 12000);
        apply.disabled = false;
      }
    })();
  }
}


export class LocalEndpointEqualsEditModal extends Modal {
  private staged: StagedLocalPatch | null = null;
  private applied = false;

  constructor(
    app: App,
    private readonly ownerName: string,
    private readonly endpoint: LocalRecord,
    private readonly addOptions: LocalRecord[],
    private readonly removeOptions: LocalRecord[],
    private readonly stage: (mode: "add" | "remove", target: LocalRecord) => Promise<StagedLocalPatch>,
    private readonly apply: (id: string) => Promise<void>,
    private readonly cancel: (id: string) => void,
    private readonly onApplied: () => void,
  ) { super(app); }

  onOpen(): void { this.compose(); }

  onClose(): void {
    const staged = this.staged;
    this.staged = null;
    this.contentEl.empty();
    if (staged && !this.applied) try { this.cancel(staged.transaction.id); } catch {}
  }

  private compose(): void {
    this.titleEl.setText("Edit endpoint equals");
    this.contentEl.empty();
    this.contentEl.createEl("p", { text: `Add or remove one same-note endpoint equals relationship for ${this.endpoint.identifier}. Existing exposes and connection topology are not changed.` });

    const modeRow = this.contentEl.createDiv({ cls: "mdse-create-field" });
    modeRow.createEl("label", { text: "Change" });
    const mode = modeRow.createEl("select", { cls: "mdse-detail-input" });
    if (this.addOptions.length) mode.createEl("option", { text: "Add equals", value: "add" });
    if (this.removeOptions.length) mode.createEl("option", { text: "Remove equals", value: "remove" });

    const targetRow = this.contentEl.createDiv({ cls: "mdse-create-field" });
    targetRow.createEl("label", { text: "Endpoint" });
    const target = targetRow.createEl("select", { cls: "mdse-detail-input" });

    const refill = () => {
      target.empty();
      const options = mode.value === "remove" ? this.removeOptions : this.addOptions;
      target.createEl("option", { text: "Choose endpoint…", value: "" });
      for (const option of options) {
        target.createEl("option", { text: `${option.identifier} — ^${option.localId}`, value: option.localId });
      }
    };
    mode.onchange = refill;
    refill();

    this.contentEl.createEl("p", { cls: "mdse-muted", text: `Endpoint: ${this.endpoint.identifier} (#^${this.endpoint.localId})` });

    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).onclick = () => this.close();
    const review = buttons.createEl("button", { text: "Review", cls: "mod-cta" });
    review.onclick = () => void (async () => {
      review.disabled = true;
      try {
        const editMode = mode.value === "remove" ? "remove" : "add";
        const options = editMode === "remove" ? this.removeOptions : this.addOptions;
        const selected = options.find((option) => option.localId === target.value);
        if (!selected) throw new Error("Choose an endpoint.");
        const staged = await this.stage(editMode, selected);
        this.staged = staged;
        this.renderReview(staged, editMode, selected);
      } catch (e) {
        new Notice(`Cannot stage equals edit: ${(e as Error).message}`, 12000);
        review.disabled = false;
      }
    })();
  }

  private renderReview(staged: StagedLocalPatch, mode: "add" | "remove", target: LocalRecord): void {
    this.titleEl.setText("Review endpoint equals edit");
    this.contentEl.empty();
    const table = this.contentEl.createEl("table", { cls: "mdse-diagnostics" });
    const rows: [string, string][] = [
      ["Owner", this.ownerName],
      ["Endpoint", this.endpoint.identifier],
      ["Change", mode === "add" ? "add equals" : "remove equals"],
      ["Target endpoint", target.identifier],
      ["Transaction", staged.transaction.label],
      ["Scope", staged.transaction.scope],
    ];
    for (const [key, value] of rows) {
      const tr = table.createEl("tr");
      tr.createEl("td", { text: key });
      tr.createEl("td", { text: value });
    }

    const blocking = staged.plan.findings.filter((finding) => finding.severity === "error");
    if (!staged.plan.findings.length) {
      this.contentEl.createEl("p", { cls: "mdse-muted", text: "Validation passed. Apply will change only the endpoint equals field." });
    } else {
      for (const finding of staged.plan.findings) {
        this.contentEl.createEl("p", { text: `${finding.severity.toUpperCase()}: ${finding.message}`, cls: finding.severity === "error" ? "mdse-warn" : undefined });
      }
    }

    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).onclick = () => {
      try { this.cancel(staged.transaction.id); } finally { this.staged = null; this.close(); }
    };
    const apply = buttons.createEl("button", { text: "Apply", cls: "mod-cta" });
    apply.disabled = blocking.length > 0;
    apply.onclick = () => void (async () => {
      apply.disabled = true;
      try {
        await this.apply(staged.transaction.id);
        this.applied = true;
        this.staged = null;
        this.close();
        this.onApplied();
        new Notice(`${mode === "add" ? "Added" : "Removed"} equals ${this.endpoint.identifier} ↔ ${target.identifier}.`, 5000);
      } catch (e) {
        new Notice(`Not applied: ${(e as Error).message}`, 12000);
        apply.disabled = false;
      }
    })();
  }
}


export class LocalConnectionEndpointRewireModal extends Modal {
  private staged: StagedLocalPatch | null = null;
  private applied = false;

  constructor(
    app: App,
    private readonly ownerName: string,
    private readonly connection: LocalRecord,
    private readonly end: "endpointA" | "endpointB",
    private readonly options: LocalRecord[],
    private readonly stage: (target: LocalRecord) => Promise<StagedLocalPatch>,
    private readonly apply: (id: string) => Promise<void>,
    private readonly cancel: (id: string) => void,
    private readonly onApplied: () => void,
  ) { super(app); }

  onOpen(): void {
    this.titleEl.setText(`Rewire connection ${this.end}`);
    this.contentEl.empty();
    const other = this.end === "endpointA" ? this.connection.endpointB : this.connection.endpointA;
    this.contentEl.createEl("p", { text: `Change only ${this.end} on ${this.connection.identifier}. The opposite endpoint and all child flows remain unchanged.` });

    const row = this.contentEl.createDiv({ cls: "mdse-create-field" });
    row.createEl("label", { text: "New endpoint" });
    const pick = row.createEl("select", { cls: "mdse-detail-input" });
    pick.createEl("option", { text: "Choose endpoint...", value: "" });
    for (const option of this.options) pick.createEl("option", { text: `${option.identifier} - ^${option.localId}`, value: option.localId });

    this.contentEl.createEl("p", { cls: "mdse-muted", text: `Connection: ${this.connection.identifier} (#^${this.connection.localId})` });
    this.contentEl.createEl("p", { cls: "mdse-muted", text: `Other end: ${other?.text ?? "-"}` });

    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).onclick = () => this.close();
    const review = buttons.createEl("button", { text: "Review", cls: "mod-cta" });
    review.onclick = () => void this.stageReview(pick.value, review);
  }

  onClose(): void {
    const staged = this.staged;
    this.staged = null;
    this.contentEl.empty();
    if (staged && !this.applied) try { this.cancel(staged.transaction.id); } catch {}
  }

  private async stageReview(localId: string, review: HTMLButtonElement): Promise<void> {
    review.disabled = true;
    try {
      const target = this.options.find((option) => option.localId === localId);
      if (!target) throw new Error("Choose a replacement endpoint.");
      const staged = await this.stage(target);
      this.staged = staged;
      this.renderReview(staged, target);
    } catch (e) {
      new Notice(`Cannot stage connection rewire: ${(e as Error).message}`, 12000);
      review.disabled = false;
    }
  }

  private renderReview(staged: StagedLocalPatch, target: LocalRecord): void {
    this.titleEl.setText("Review connection endpoint rewire");
    this.contentEl.empty();
    const other = this.end === "endpointA" ? this.connection.endpointB : this.connection.endpointA;
    const table = this.contentEl.createEl("table", { cls: "mdse-diagnostics" });
    const rows: [string, string][] = [
      ["Owner", this.ownerName],
      ["Connection", this.connection.identifier],
      ["Changed end", this.end],
      ["New endpoint", target.identifier],
      ["Opposite endpoint", other?.text ?? "-"],
      ["Child flows", "preserved"],
      ["Transaction", staged.transaction.label],
      ["Scope", staged.transaction.scope],
    ];
    for (const [key, value] of rows) {
      const tr = table.createEl("tr");
      tr.createEl("td", { text: key });
      tr.createEl("td", { text: value });
    }

    const blocking = staged.plan.findings.filter((finding) => finding.severity === "error");
    if (!staged.plan.findings.length) {
      this.contentEl.createEl("p", { cls: "mdse-muted", text: `Validation passed. Apply will change only connection ${this.end}.` });
    } else {
      for (const finding of staged.plan.findings) {
        this.contentEl.createEl("p", { text: `${finding.severity.toUpperCase()}: ${finding.message}`, cls: finding.severity === "error" ? "mdse-warn" : undefined });
      }
    }

    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).onclick = () => {
      try { this.cancel(staged.transaction.id); } finally { this.staged = null; this.close(); }
    };
    const apply = buttons.createEl("button", { text: "Apply", cls: "mod-cta" });
    apply.disabled = blocking.length > 0;
    apply.onclick = () => void (async () => {
      apply.disabled = true;
      try {
        await this.apply(staged.transaction.id);
        this.applied = true;
        this.staged = null;
        this.close();
        this.onApplied();
        new Notice(`Rewired ${this.connection.identifier} ${this.end} to ${target.identifier}.`, 5000);
      } catch (e) {
        new Notice(`Not applied: ${(e as Error).message}`, 12000);
        apply.disabled = false;
      }
    })();
  }
}


export class LocalConnectionDefinitionEditModal extends Modal {
  private staged: StagedLocalPatch | null = null;
  private applied = false;

  constructor(
    app: App,
    private readonly ownerName: string,
    private readonly connection: LocalRecord,
    private readonly definitions: NoteRecord[],
    private readonly stage: (definition: string | null) => Promise<StagedLocalPatch>,
    private readonly apply: (id: string) => Promise<void>,
    private readonly cancel: (id: string) => void,
    private readonly onApplied: () => void,
  ) { super(app); }

  onOpen(): void {
    this.titleEl.setText("Edit connection definition");
    this.contentEl.empty();
    this.contentEl.createEl("p", { text: `Change only the reusable definition link for ${this.connection.identifier}. Connection identity, endpoints, and child flows remain unchanged.` });

    const row = this.contentEl.createDiv({ cls: "mdse-create-field" });
    row.createEl("label", { text: "Reusable definition" });
    const input = row.createEl("select", { cls: "mdse-detail-input" });
    input.createEl("option", { text: "No reusable definition", value: "" });
    const currentTarget = this.connection.definition?.target ?? "";
    for (const option of this.definitions) {
      const item = input.createEl("option", { text: `${option.name} — ${option.type ?? "model"}`, value: option.path });
      const stem = option.path.replace(/\.md$/i, "");
      if (currentTarget === stem || currentTarget === option.name) item.selected = true;
    }

    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).onclick = () => this.close();
    const review = buttons.createEl("button", { text: "Review", cls: "mod-cta" });
    review.onclick = () => void (async () => {
      review.disabled = true;
      try {
        const selected = this.definitions.find((option) => option.path === input.value);
        const value = selected ? `[[${selected.path.replace(/\.md$/i, "")}]]` : "";
        const staged = await this.stage(value || null);
        this.staged = staged;
        this.renderReview(staged, value);
      } catch (e) {
        new Notice(`Cannot stage connection definition edit: ${(e as Error).message}`, 12000);
        review.disabled = false;
      }
    })();
  }

  onClose(): void {
    const staged = this.staged;
    this.staged = null;
    this.contentEl.empty();
    if (staged && !this.applied) try { this.cancel(staged.transaction.id); } catch {}
  }

  private renderReview(staged: StagedLocalPatch, value: string): void {
    this.titleEl.setText("Review connection definition edit");
    this.contentEl.empty();
    const table = this.contentEl.createEl("table", { cls: "mdse-diagnostics" });
    const rows: [string, string][] = [
      ["Owner", this.ownerName],
      ["Connection", this.connection.identifier],
      ["New definition", value || "none"],
      ["Endpoint A", this.connection.endpointA?.text ?? "-"],
      ["Endpoint B", this.connection.endpointB?.text ?? "-"],
      ["Child flows", "preserved"],
      ["Transaction", staged.transaction.label],
      ["Scope", staged.transaction.scope],
    ];
    for (const [key, val] of rows) {
      const tr = table.createEl("tr");
      tr.createEl("td", { text: key });
      tr.createEl("td", { text: val });
    }

    const blocking = staged.plan.findings.filter((finding) => finding.severity === "error");
    for (const finding of staged.plan.findings) {
      this.contentEl.createEl("p", { text: `${finding.severity.toUpperCase()}: ${finding.message}`, cls: finding.severity === "error" ? "mdse-warn" : undefined });
    }
    if (!staged.plan.findings.length) this.contentEl.createEl("p", { cls: "mdse-muted", text: "Validation passed. Apply will change only the connection definition field." });

    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).onclick = () => {
      try { this.cancel(staged.transaction.id); } finally { this.staged = null; this.close(); }
    };
    const apply = buttons.createEl("button", { text: "Apply", cls: "mod-cta" });
    apply.disabled = blocking.length > 0;
    apply.onclick = () => void (async () => {
      apply.disabled = true;
      try {
        await this.apply(staged.transaction.id);
        this.applied = true;
        this.staged = null;
        this.close();
        this.onApplied();
        new Notice(`Updated definition for connection ${this.connection.identifier}.`, 5000);
      } catch (e) {
        new Notice(`Not applied: ${(e as Error).message}`, 12000);
        apply.disabled = false;
      }
    })();
  }
}


export class LocalPartDefinitionEditModal extends Modal {
  private staged: StagedLocalPatch | null = null;
  private applied = false;

  constructor(
    app: App,
    private readonly ownerName: string,
    private readonly part: LocalRecord,
    private readonly definitions: NoteRecord[],
    private readonly stage: (definition: string) => Promise<StagedLocalPatch>,
    private readonly apply: (id: string) => Promise<void>,
    private readonly cancel: (id: string) => void,
    private readonly onApplied: () => void,
  ) { super(app); }

  onOpen(): void {
    this.titleEl.setText("Edit part definition");
    this.contentEl.empty();
    this.contentEl.createEl("p", { text: `Change only the reusable definition link for ${this.part.identifier}. Part identity, usage, multiplicity, and attached endpoints remain unchanged.` });

    const row = this.contentEl.createDiv({ cls: "mdse-create-field" });
    row.createEl("label", { text: "Reusable definition" });
    const input = row.createEl("select", { cls: "mdse-detail-input" });
    input.createEl("option", { text: "Choose a model definition…", value: "" });
    const currentTarget = this.part.definition?.target ?? "";
    for (const option of this.definitions) {
      const item = input.createEl("option", { text: `${option.name} — ${option.type ?? "model"}`, value: option.path });
      const stem = option.path.replace(/\.md$/i, "");
      if (currentTarget === stem || currentTarget === option.name) item.selected = true;
    }

    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).onclick = () => this.close();
    const review = buttons.createEl("button", { text: "Review", cls: "mod-cta" });
    review.onclick = () => void (async () => {
      review.disabled = true;
      try {
        const selected = this.definitions.find((option) => option.path === input.value);
        if (!selected) throw new Error("Choose a reusable definition from the model.");
        const value = `[[${selected.path.replace(/\.md$/i, "")}]]`;
        const staged = await this.stage(value);
        this.staged = staged;
        this.renderReview(staged, value);
      } catch (e) {
        new Notice(`Cannot stage part definition edit: ${(e as Error).message}`, 12000);
        review.disabled = false;
      }
    })();
  }

  onClose(): void {
    const staged = this.staged;
    this.staged = null;
    this.contentEl.empty();
    if (staged && !this.applied) try { this.cancel(staged.transaction.id); } catch {}
  }

  private renderReview(staged: StagedLocalPatch, value: string): void {
    this.titleEl.setText("Review part definition edit");
    this.contentEl.empty();
    const table = this.contentEl.createEl("table", { cls: "mdse-diagnostics" });
    const rows: [string, string][] = [
      ["Owner", this.ownerName],
      ["Part", this.part.identifier],
      ["New definition", value],
      ["Usage", this.part.usage],
      ["Multiplicity", this.part.multiplicity ?? "none"],
      ["Attached endpoints", "preserved"],
      ["Transaction", staged.transaction.label],
      ["Scope", staged.transaction.scope],
    ];
    for (const [key, val] of rows) {
      const tr = table.createEl("tr");
      tr.createEl("td", { text: key });
      tr.createEl("td", { text: val });
    }

    const blocking = staged.plan.findings.filter((finding) => finding.severity === "error");
    for (const finding of staged.plan.findings) {
      this.contentEl.createEl("p", { text: `${finding.severity.toUpperCase()}: ${finding.message}`, cls: finding.severity === "error" ? "mdse-warn" : undefined });
    }
    if (!staged.plan.findings.length) this.contentEl.createEl("p", { cls: "mdse-muted", text: "Validation passed. Apply will change only the part definition field." });

    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).onclick = () => {
      try { this.cancel(staged.transaction.id); } finally { this.staged = null; this.close(); }
    };
    const apply = buttons.createEl("button", { text: "Apply", cls: "mod-cta" });
    apply.disabled = blocking.length > 0;
    apply.onclick = () => void (async () => {
      apply.disabled = true;
      try {
        await this.apply(staged.transaction.id);
        this.applied = true;
        this.staged = null;
        this.close();
        this.onApplied();
        new Notice(`Updated definition for part ${this.part.identifier}.`, 5000);
      } catch (e) {
        new Notice(`Not applied: ${(e as Error).message}`, 12000);
        apply.disabled = false;
      }
    })();
  }
}


export class LocalEndpointDefinitionEditModal extends Modal {
  private staged: StagedLocalPatch | null = null;
  private applied = false;

  constructor(
    app: App,
    private readonly ownerName: string,
    private readonly endpoint: LocalRecord,
    private readonly definitions: NoteRecord[],
    private readonly stage: (definition: string) => Promise<StagedLocalPatch>,
    private readonly apply: (id: string) => Promise<void>,
    private readonly cancel: (id: string) => void,
    private readonly onApplied: () => void,
  ) { super(app); }

  onOpen(): void {
    this.titleEl.setText("Edit endpoint definition");
    this.contentEl.empty();
    this.contentEl.createEl("p", { text: `Change only the reusable definition link for ${this.endpoint.identifier}. Endpoint identity, usage, multiplicity, topology, and connections remain unchanged.` });

    const row = this.contentEl.createDiv({ cls: "mdse-create-field" });
    row.createEl("label", { text: "Reusable definition" });
    const input = row.createEl("select", { cls: "mdse-detail-input" });
    input.createEl("option", { text: "Choose a model definition…", value: "" });
    const currentTarget = this.endpoint.definition?.target ?? "";
    for (const option of this.definitions) {
      const item = input.createEl("option", { text: `${option.name} — ${option.type ?? "model"}`, value: option.path });
      const stem = option.path.replace(/\.md$/i, "");
      if (currentTarget === stem || currentTarget === option.name) item.selected = true;
    }

    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).onclick = () => this.close();
    const review = buttons.createEl("button", { text: "Review", cls: "mod-cta" });
    review.onclick = () => void (async () => {
      review.disabled = true;
      try {
        const selected = this.definitions.find((option) => option.path === input.value);
        if (!selected) throw new Error("Choose a reusable definition from the model.");
        const value = `[[${selected.path.replace(/\.md$/i, "")}]]`;
        const staged = await this.stage(value);
        this.staged = staged;
        this.renderReview(staged, value);
      } catch (e) {
        new Notice(`Cannot stage endpoint definition edit: ${(e as Error).message}`, 12000);
        review.disabled = false;
      }
    })();
  }

  onClose(): void {
    const staged = this.staged;
    this.staged = null;
    this.contentEl.empty();
    if (staged && !this.applied) try { this.cancel(staged.transaction.id); } catch {}
  }

  private renderReview(staged: StagedLocalPatch, value: string): void {
    this.titleEl.setText("Review endpoint definition edit");
    this.contentEl.empty();
    const table = this.contentEl.createEl("table", { cls: "mdse-diagnostics" });
    const rows: [string, string][] = [
      ["Owner", this.ownerName],
      ["Endpoint", this.endpoint.identifier],
      ["New definition", value],
      ["Usage", this.endpoint.usage],
      ["Multiplicity", this.endpoint.multiplicity ?? "none"],
      ["Part", this.endpoint.part?.text ?? "none"],
      ["Parent", this.endpoint.parent?.text ?? "none"],
      ["Exposes", this.endpoint.exposes.length ? "preserved" : "none"],
      ["Equals", this.endpoint.equals.length ? "preserved" : "none"],
      ["Connections", "preserved"],
      ["Transaction", staged.transaction.label],
      ["Scope", staged.transaction.scope],
    ];
    for (const [key, val] of rows) {
      const tr = table.createEl("tr");
      tr.createEl("td", { text: key });
      tr.createEl("td", { text: val });
    }

    const blocking = staged.plan.findings.filter((finding) => finding.severity === "error");
    for (const finding of staged.plan.findings) {
      this.contentEl.createEl("p", { text: `${finding.severity.toUpperCase()}: ${finding.message}`, cls: finding.severity === "error" ? "mdse-warn" : undefined });
    }
    if (!staged.plan.findings.length) this.contentEl.createEl("p", { cls: "mdse-muted", text: "Validation passed. Apply will change only the endpoint definition field." });

    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).onclick = () => {
      try { this.cancel(staged.transaction.id); } finally { this.staged = null; this.close(); }
    };
    const apply = buttons.createEl("button", { text: "Apply", cls: "mod-cta" });
    apply.disabled = blocking.length > 0;
    apply.onclick = () => void (async () => {
      apply.disabled = true;
      try {
        await this.apply(staged.transaction.id);
        this.applied = true;
        this.staged = null;
        this.close();
        this.onApplied();
        new Notice(`Updated definition for endpoint ${this.endpoint.identifier}.`, 5000);
      } catch (e) {
        new Notice(`Not applied: ${(e as Error).message}`, 12000);
        apply.disabled = false;
      }
    })();
  }
}


export class LocalFlowDefinitionEditModal extends Modal {
  private staged: StagedLocalPatch | null = null;
  private applied = false;

  constructor(
    app: App,
    private readonly ownerName: string,
    private readonly flow: LocalRecord,
    private readonly definitions: NoteRecord[],
    private readonly stage: (definition: string) => Promise<StagedLocalPatch>,
    private readonly apply: (id: string) => Promise<void>,
    private readonly cancel: (id: string) => void,
    private readonly onApplied: () => void,
  ) { super(app); }

  onOpen(): void {
    this.titleEl.setText("Edit flow definition");
    this.contentEl.empty();
    this.contentEl.createEl("p", { text: `Change only the reusable definition link for ${this.flow.identifier}. Flow identity, owning connection, and both endpoint roles remain unchanged.` });

    const row = this.contentEl.createDiv({ cls: "mdse-create-field" });
    row.createEl("label", { text: "Reusable definition" });
    const input = row.createEl("select", { cls: "mdse-detail-input" });
    input.createEl("option", { text: "Choose a model definition…", value: "" });
    const currentTarget = this.flow.definition?.target ?? "";
    for (const option of this.definitions) {
      const item = input.createEl("option", { text: `${option.name} — ${option.type ?? "model"}`, value: option.path });
      const stem = option.path.replace(/\.md$/i, "");
      if (currentTarget === stem || currentTarget === option.name) item.selected = true;
    }

    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).onclick = () => this.close();
    const review = buttons.createEl("button", { text: "Review", cls: "mod-cta" });
    review.onclick = () => void (async () => {
      review.disabled = true;
      try {
        const selected = this.definitions.find((option) => option.path === input.value);
        if (!selected) throw new Error("Choose a reusable definition from the model.");
        const value = `[[${selected.path.replace(/\.md$/i, "")}]]`;
        const staged = await this.stage(value);
        this.staged = staged;
        this.renderReview(staged, value);
      } catch (e) {
        new Notice(`Cannot stage flow definition edit: ${(e as Error).message}`, 12000);
        review.disabled = false;
      }
    })();
  }

  onClose(): void {
    const staged = this.staged;
    this.staged = null;
    this.contentEl.empty();
    if (staged && !this.applied) try { this.cancel(staged.transaction.id); } catch {}
  }

  private renderReview(staged: StagedLocalPatch, value: string): void {
    this.titleEl.setText("Review flow definition edit");
    this.contentEl.empty();
    const table = this.contentEl.createEl("table", { cls: "mdse-diagnostics" });
    const rows: [string, string][] = [
      ["Owner", this.ownerName],
      ["Flow", this.flow.identifier],
      ["New definition", value],
      ["Connection", this.flow.connectionId ?? "none"],
      ["Endpoint A role", this.flow.roleA ?? "none"],
      ["Endpoint B role", this.flow.roleB ?? "none"],
      ["Transaction", staged.transaction.label],
      ["Scope", staged.transaction.scope],
    ];
    for (const [key, val] of rows) {
      const tr = table.createEl("tr");
      tr.createEl("td", { text: key });
      tr.createEl("td", { text: val });
    }

    const blocking = staged.plan.findings.filter((finding) => finding.severity === "error");
    for (const finding of staged.plan.findings) {
      this.contentEl.createEl("p", { text: `${finding.severity.toUpperCase()}: ${finding.message}`, cls: finding.severity === "error" ? "mdse-warn" : undefined });
    }
    if (!staged.plan.findings.length) this.contentEl.createEl("p", { cls: "mdse-muted", text: "Validation passed. Apply will change only the flow definition field." });

    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).onclick = () => {
      try { this.cancel(staged.transaction.id); } finally { this.staged = null; this.close(); }
    };
    const apply = buttons.createEl("button", { text: "Apply", cls: "mod-cta" });
    apply.disabled = blocking.length > 0;
    apply.onclick = () => void (async () => {
      apply.disabled = true;
      try {
        await this.apply(staged.transaction.id);
        this.applied = true;
        this.staged = null;
        this.close();
        this.onApplied();
        new Notice(`Updated definition for flow ${this.flow.identifier}.`, 5000);
      } catch (e) {
        new Notice(`Not applied: ${(e as Error).message}`, 12000);
        apply.disabled = false;
      }
    })();
  }
}


export class LocalFlowRolesEditModal extends Modal {
  private staged: StagedLocalPatch | null = null;
  private applied = false;
  private static readonly roles = ["transmit", "receive", "exchange", "unspecified"];

  constructor(
    app: App,
    private readonly ownerName: string,
    private readonly flow: LocalRecord,
    private readonly stage: (roleA: string, roleB: string) => Promise<StagedLocalPatch>,
    private readonly apply: (id: string) => Promise<void>,
    private readonly cancel: (id: string) => void,
    private readonly onApplied: () => void,
  ) { super(app); }

  onOpen(): void {
    this.titleEl.setText("Edit flow endpoint roles");
    this.contentEl.empty();
    this.contentEl.createEl("p", {
      text: `Change the Endpoint A/B roles for ${this.flow.identifier}. Flow identity, reusable definition, and owning connection remain unchanged.`,
    });

    const select = (label: string, current: string | null): HTMLSelectElement => {
      const row = this.contentEl.createDiv({ cls: "mdse-create-field" });
      row.createEl("label", { text: label });
      const pick = row.createEl("select", { cls: "mdse-detail-input" });
      for (const role of LocalFlowRolesEditModal.roles) {
        const option = pick.createEl("option", { text: role, value: role });
        if (role === current) option.selected = true;
      }
      return pick;
    };

    const roleA = select("Endpoint A role", this.flow.roleA);
    const roleB = select("Endpoint B role", this.flow.roleB);

    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).onclick = () => this.close();
    const review = buttons.createEl("button", { text: "Review", cls: "mod-cta" });
    review.onclick = () => void (async () => {
      review.disabled = true;
      try {
        const staged = await this.stage(roleA.value, roleB.value);
        this.staged = staged;
        this.renderReview(staged, roleA.value, roleB.value);
      } catch (e) {
        new Notice(`Cannot stage flow role edit: ${(e as Error).message}`, 12000);
        review.disabled = false;
      }
    })();
  }

  onClose(): void {
    const staged = this.staged;
    this.staged = null;
    this.contentEl.empty();
    if (staged && !this.applied) try { this.cancel(staged.transaction.id); } catch {}
  }

  private renderReview(staged: StagedLocalPatch, roleA: string, roleB: string): void {
    this.titleEl.setText("Review flow endpoint-role edit");
    this.contentEl.empty();

    const table = this.contentEl.createEl("table", { cls: "mdse-diagnostics" });
    const rows: [string, string][] = [
      ["Owner", this.ownerName],
      ["Flow", this.flow.identifier],
      ["Reusable definition", this.flow.definition?.text ?? "none"],
      ["Owning connection", this.flow.connectionId ?? "none"],
      ["Endpoint A role", `${this.flow.roleA ?? "none"} → ${roleA}`],
      ["Endpoint B role", `${this.flow.roleB ?? "none"} → ${roleB}`],
      ["Transaction", staged.transaction.label],
      ["Scope", staged.transaction.scope],
    ];
    for (const [key, val] of rows) {
      const tr = table.createEl("tr");
      tr.createEl("td", { text: key });
      tr.createEl("td", { text: val });
    }

    const blocking = staged.plan.findings.filter((finding) => finding.severity === "error");
    for (const finding of staged.plan.findings) {
      this.contentEl.createEl("p", {
        text: `${finding.severity.toUpperCase()}: ${finding.message}`,
        cls: finding.severity === "error" ? "mdse-warn" : undefined,
      });
    }
    if (!staged.plan.findings.length) {
      this.contentEl.createEl("p", {
        cls: "mdse-muted",
        text: "Validation passed. Apply will change only the two governed flow endpoint-role fields.",
      });
    }

    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).onclick = () => {
      try { this.cancel(staged.transaction.id); } finally { this.staged = null; this.close(); }
    };
    const apply = buttons.createEl("button", { text: "Apply", cls: "mod-cta" });
    apply.disabled = blocking.length > 0;
    apply.onclick = () => void (async () => {
      apply.disabled = true;
      try {
        await this.apply(staged.transaction.id);
        this.applied = true;
        this.staged = null;
        this.close();
        this.onApplied();
        new Notice(`Updated endpoint roles for flow ${this.flow.identifier}.`, 5000);
      } catch (e) {
        new Notice(`Not applied: ${(e as Error).message}`, 12000);
        apply.disabled = false;
      }
    })();
  }
}


export class LocalFlowConnectionMoveModal extends Modal {
  private staged: StagedLocalPatch | null = null;
  private applied = false;

  constructor(
    app: App,
    private readonly ownerName: string,
    private readonly flow: LocalRecord,
    private readonly connections: LocalRecord[],
    private readonly stage: (connection: LocalRecord) => Promise<StagedLocalPatch>,
    private readonly apply: (id: string) => Promise<void>,
    private readonly cancel: (id: string) => void,
    private readonly onApplied: () => void,
  ) { super(app); }

  onOpen(): void {
    this.titleEl.setText("Move flow to connection");
    this.contentEl.empty();
    this.contentEl.createEl("p", {
      text: `Move ${this.flow.identifier} to another connection in this Local Model. Flow identity, definition, and endpoint roles remain unchanged.`,
    });

    const row = this.contentEl.createDiv({ cls: "mdse-create-field" });
    row.createEl("label", { text: "Owning connection" });
    const select = row.createEl("select", { cls: "mdse-detail-input" });
    select.createEl("option", { text: "Choose a connection…", value: "" });
    for (const connection of this.connections) {
      select.createEl("option", { text: connection.identifier, value: connection.localId });
    }

    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).onclick = () => this.close();
    const review = buttons.createEl("button", { text: "Review", cls: "mod-cta" });
    review.onclick = () => void (async () => {
      review.disabled = true;
      try {
        const connection = this.connections.find((candidate) => candidate.localId === select.value);
        if (!connection) throw new Error("Choose a target connection.");
        const staged = await this.stage(connection);
        this.staged = staged;
        this.renderReview(staged, connection);
      } catch (e) {
        new Notice(`Cannot stage flow move: ${(e as Error).message}`, 12000);
        review.disabled = false;
      }
    })();
  }

  onClose(): void {
    const staged = this.staged;
    this.staged = null;
    this.contentEl.empty();
    if (staged && !this.applied) try { this.cancel(staged.transaction.id); } catch {}
  }

  private renderReview(staged: StagedLocalPatch, connection: LocalRecord): void {
    this.titleEl.setText("Review flow connection move");
    this.contentEl.empty();
    const table = this.contentEl.createEl("table", { cls: "mdse-diagnostics" });
    const rows: [string, string][] = [
      ["Owner", this.ownerName],
      ["Flow", this.flow.identifier],
      ["Reusable definition", this.flow.definition?.text ?? "none"],
      ["Connection", `${this.flow.connectionId ?? "none"} → ${connection.localId}`],
      ["Endpoint A role", this.flow.roleA ?? "none"],
      ["Endpoint B role", this.flow.roleB ?? "none"],
      ["Transaction", staged.transaction.label],
      ["Scope", staged.transaction.scope],
    ];
    for (const [key, val] of rows) {
      const tr = table.createEl("tr");
      tr.createEl("td", { text: key });
      tr.createEl("td", { text: val });
    }

    const blocking = staged.plan.findings.filter((finding) => finding.severity === "error");
    for (const finding of staged.plan.findings) {
      this.contentEl.createEl("p", {
        text: `${finding.severity.toUpperCase()}: ${finding.message}`,
        cls: finding.severity === "error" ? "mdse-warn" : undefined,
      });
    }
    if (!staged.plan.findings.length) {
      this.contentEl.createEl("p", {
        cls: "mdse-muted",
        text: "Validation passed. Apply will move this flow under the selected connection without changing its identity or flow fields.",
      });
    }

    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).onclick = () => {
      try { this.cancel(staged.transaction.id); } finally { this.staged = null; this.close(); }
    };
    const apply = buttons.createEl("button", { text: "Apply", cls: "mod-cta" });
    apply.disabled = blocking.length > 0;
    apply.onclick = () => void (async () => {
      apply.disabled = true;
      try {
        await this.apply(staged.transaction.id);
        this.applied = true;
        this.staged = null;
        this.close();
        this.onApplied();
        new Notice(`Moved flow ${this.flow.identifier} to ${connection.identifier}.`, 5000);
      } catch (e) {
        new Notice(`Not applied: ${(e as Error).message}`, 12000);
        apply.disabled = false;
      }
    })();
  }
}


export class DefinitionCreateFromOccurrenceModal extends Modal {
  private stagedDefinition: StagedDefinitionCreation | null = null;
  private stagedBinding: StagedLocalPatch | null = null;
  private definitionApplied = false;
  private bindingApplied = false;

  constructor(
    app: App,
    private readonly ownerName: string,
    private readonly occurrence: LocalRecord,
    private readonly stageDefinition: (name: string, path: string) => StagedDefinitionCreation,
    private readonly applyDefinition: (transactionId: string) => Promise<void>,
    private readonly cancelDefinition: (transactionId: string) => void,
    private readonly rollbackDefinition: (transactionId: string) => Promise<void>,
    private readonly stageBinding: (definitionPath: string) => Promise<StagedLocalPatch>,
    private readonly applyBinding: (transactionId: string) => Promise<void>,
    private readonly cancelBinding: (transactionId: string) => void,
    private readonly onApplied: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.renderCompose();
  }

  onClose(): void {
    const definition = this.stagedDefinition;
    const binding = this.stagedBinding;
    this.stagedDefinition = null;
    this.stagedBinding = null;
    this.contentEl.empty();
    if (binding && !this.bindingApplied) {
      try { this.cancelBinding(binding.transaction.id); } catch { /* already closed */ }
    }
    if (definition && !this.definitionApplied) {
      try { this.cancelDefinition(definition.transaction.id); } catch { /* already closed */ }
    }
  }

  private renderCompose(): void {
    this.titleEl.setText("Create reusable definition");
    this.contentEl.empty();
    this.contentEl.createEl("p", {
      text: `Create a reusable definition for ${this.occurrence.kind} occurrence "${this.occurrence.identifier}" in ${this.ownerName}. Review includes both definition creation and the occurrence binding before anything is written.`,
    });

    const field = (label: string, value = "", placeholder = ""): HTMLInputElement => {
      const row = this.contentEl.createDiv({ cls: "mdse-create-field" });
      row.createEl("label", { text: label });
      const input = row.createEl("input", { type: "text", cls: "mdse-detail-input", value });
      if (placeholder) input.setAttr("placeholder", placeholder);
      input.onkeydown = (e) => e.stopPropagation();
      return input;
    };

    const name = field("Definition name", this.occurrence.identifier, "Reusable definition name");
    const path = field("Vault path", "", "e.g. 40_Objects/Main Contactor.md");
    this.contentEl.createEl("p", {
      cls: "mdse-muted",
      text: "Choose the canonical vault location explicitly. Workbench generates the governed UID from your configured creator identity.",
    });

    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).onclick = () => this.close();
    const review = buttons.createEl("button", { text: "Review", cls: "mod-cta" });
    review.onclick = () => {
      void (async () => {
        review.disabled = true;
        try {
          const definition = this.stageDefinition(name.value.trim(), path.value.trim());
          this.stagedDefinition = definition;
          try {
            const binding = await this.stageBinding(definition.plan.path);
            this.stagedBinding = binding;
            this.renderReview(definition, binding);
          } catch (error) {
            try { this.cancelDefinition(definition.transaction.id); } catch { /* already closed */ }
            this.stagedDefinition = null;
            throw error;
          }
        } catch (e) {
          new Notice(`Cannot stage definition workflow: ${(e as Error).message}`, 12000);
          review.disabled = false;
        }
      })();
    };
  }

  private renderReview(definition: StagedDefinitionCreation, binding: StagedLocalPatch): void {
    this.titleEl.setText("Review definition + occurrence binding");
    this.contentEl.empty();

    const rows: Array<[string, string]> = [
      ["Owner", this.ownerName],
      ["Occurrence", `${this.occurrence.kind} ${this.occurrence.identifier}`],
      ["Definition transaction", definition.transaction.label],
      ["Definition scope", definition.transaction.scope],
      ["Definition", definition.plan.name],
      ["Type", definition.plan.type],
      ["UID", definition.plan.uid],
      ["Path", definition.plan.path],
      ["Binding transaction", binding.transaction.label],
      ["Binding scope", binding.transaction.scope],
      ["Occurrence field", "definition"],
      ["Binding target", definition.plan.path.replace(/\.md$/i, "")],
    ];
    const table = this.contentEl.createEl("table", { cls: "mdse-diagnostics" });
    for (const [key, value] of rows) {
      const tr = table.createEl("tr");
      tr.createEl("td", { text: key });
      tr.createEl("td", { text: value });
    }

    const bindingBlocking = binding.plan.findings.filter((finding) => finding.severity === "error");
    for (const finding of binding.plan.findings) {
      this.contentEl.createEl("p", {
        text: `${finding.severity.toUpperCase()}: ${finding.message}`,
        cls: finding.severity === "error" ? "mdse-warn" : undefined,
      });
    }
    if (!binding.plan.findings.length) {
      this.contentEl.createEl("p", {
        cls: "mdse-muted",
        text: "Both structural transactions are staged and reviewed. Apply creates the definition first, then applies the already-reviewed occurrence binding.",
      });
    }

    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).onclick = () => this.close();
    const apply = buttons.createEl("button", { text: "Apply definition + bind", cls: "mod-cta" });
    apply.disabled = bindingBlocking.length > 0;
    apply.setAttr("title", bindingBlocking.length
      ? "Resolve blocking occurrence-binding findings before Apply."
      : "Apply the reviewed definition creation, then the reviewed occurrence binding.");
    apply.onclick = () => {
      void (async () => {
        apply.disabled = true;
        try {
          await this.applyDefinition(definition.transaction.id);
          this.definitionApplied = true;
          this.stagedDefinition = null;

          await this.applyBinding(binding.transaction.id);
          this.bindingApplied = true;
          this.stagedBinding = null;

          this.close();
          this.onApplied();
          new Notice(`Created ${definition.plan.name} and bound ${this.occurrence.identifier} to it.`, 6000);
        } catch (e) {
          if (this.definitionApplied && !this.bindingApplied) {
            new Notice(`Definition was created, but the reviewed occurrence binding was refused: ${(e as Error).message}`, 15000);
            const recovery = this.contentEl.createDiv({ cls: "mdse-detail-state" });
            recovery.createEl("p", {
              cls: "mdse-warn",
              text: "The reusable definition exists, but the occurrence binding was not applied. You can keep the reusable definition, or roll back only that definition creation if no newer semantic edit has occurred.",
            });
            const recoveryButtons = recovery.createDiv({ cls: "modal-button-container" });
            const keep = recoveryButtons.createEl("button", { text: "Keep definition" });
            keep.onclick = () => this.close();
            const rollback = recoveryButtons.createEl("button", { text: "Roll back definition", cls: "mod-warning" });
            rollback.onclick = () => {
              void (async () => {
                rollback.disabled = true;
                try {
                  if (this.stagedBinding) {
                    try { this.cancelBinding(this.stagedBinding.transaction.id); } catch { /* already closed */ }
                    this.stagedBinding = null;
                  }
                  await this.rollbackDefinition(definition.transaction.id);
                  this.definitionApplied = false;
                  this.close();
                  new Notice(`Rolled back reusable definition ${definition.plan.name}.`, 6000);
                } catch (rollbackError) {
                  new Notice(`Definition rollback was refused: ${(rollbackError as Error).message}`, 15000);
                  rollback.disabled = false;
                }
              })();
            };
          } else {
            new Notice(`Definition workflow was not applied: ${(e as Error).message}`, 15000);
            apply.disabled = bindingBlocking.length > 0;
          }
        }
      })();
    };
  }
}



export class DefinitionDeleteModal extends Modal {
  private staged: StagedDefinitionDelete | null = null;
  private applied = false;

  constructor(
    app: App,
    private readonly definitionName: string,
    private readonly stage: () => Promise<StagedDefinitionDelete>,
    private readonly apply: (transactionId: string) => Promise<void>,
    private readonly cancel: (transactionId: string) => void,
    private readonly onApplied: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText("Review definition deletion");
    void this.load();
  }

  onClose(): void {
    const staged = this.staged;
    this.staged = null;
    this.contentEl.empty();
    if (staged && !this.applied) {
      try { this.cancel(staged.transaction.id); } catch { /* already closed */ }
    }
  }

  private async load(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.createEl("p", {
      text: `Checking every indexed note relationship and Local Model occurrence that may use ${this.definitionName}…`,
    });
    try {
      const staged = await this.stage();
      this.staged = staged;
      this.renderReview(staged);
    } catch (e) {
      this.contentEl.empty();
      this.contentEl.createEl("p", { cls: "mdse-warn", text: `Cannot stage deletion: ${(e as Error).message}` });
      const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
      buttons.createEl("button", { text: "Close" }).onclick = () => this.close();
    }
  }

  private renderReview(staged: StagedDefinitionDelete): void {
    this.contentEl.empty();
    const table = this.contentEl.createEl("table", { cls: "mdse-diagnostics" });
    const rows: Array<[string, string]> = [
      ["Definition", this.definitionName],
      ["Path", staged.path],
      ["UID", staged.uid],
      ["Transaction", staged.transaction.label],
      ["Scope", staged.transaction.scope],
      ["Note-level uses", String(staged.impact.noteUseCount)],
      ["Local Model occurrences", String(staged.impact.occurrenceUseCount)],
    ];
    for (const [key, value] of rows) {
      const tr = table.createEl("tr");
      tr.createEl("td", { text: key });
      tr.createEl("td", { text: value });
    }

    if (staged.impact.allowed) {
      this.contentEl.createEl("p", {
        cls: "mdse-muted",
        text: "Impact review passed. No active note-level or Local Model occurrence references use this definition. Apply will delete only this canonical definition note.",
      });
    } else {
      const box = this.contentEl.createDiv({ cls: "mdse-detail-state" });
      box.createEl("strong", { text: "Deletion blocked by active references" });
      for (const blocker of staged.impact.blockers) {
        box.createEl("p", { cls: "mdse-warn", text: blocker });
      }
      box.createEl("p", {
        text: "Resolve these references through explicit model edits, retirement, or supersession. Workbench will not silently detach them.",
      });
    }

    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).onclick = () => this.close();
    const apply = buttons.createEl("button", { text: "Delete definition", cls: "mod-warning" });
    apply.disabled = !staged.impact.allowed;
    apply.setAttr("title", staged.impact.allowed
      ? "Delete this definition. Apply will recheck impact and file contents before mutation."
      : "Deletion is blocked while active references remain.");
    apply.onclick = () => {
      void (async () => {
        apply.disabled = true;
        try {
          await this.apply(staged.transaction.id);
          this.applied = true;
          this.staged = null;
          this.close();
          this.onApplied();
          new Notice(`Deleted reusable definition ${this.definitionName}.`, 6000);
        } catch (e) {
          new Notice(`Definition was not deleted: ${(e as Error).message}`, 15000);
          apply.disabled = !staged.impact.allowed;
        }
      })();
    };
  }
}


export class DefinitionRetireModal extends Modal {
  private staged: StagedDefinitionRetirement | null = null;
  private applied = false;

  constructor(
    app: App,
    private readonly definitionName: string,
    private readonly stage: () => Promise<StagedDefinitionRetirement>,
    private readonly apply: (transactionId: string) => Promise<void>,
    private readonly cancel: (transactionId: string) => void,
    private readonly onApplied: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText("Review definition retirement");
    void this.load();
  }

  onClose(): void {
    const staged = this.staged;
    this.staged = null;
    this.contentEl.empty();
    if (staged && !this.applied) {
      try { this.cancel(staged.transaction.id); } catch { /* already closed */ }
    }
  }

  private async load(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.createEl("p", {
      text: `Checking every current use of ${this.definitionName} before retirement…`,
    });
    try {
      const staged = await this.stage();
      this.staged = staged;
      this.renderReview(staged);
    } catch (e) {
      this.contentEl.empty();
      this.contentEl.createEl("p", { cls: "mdse-warn", text: `Cannot stage retirement: ${(e as Error).message}` });
      const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
      buttons.createEl("button", { text: "Close" }).onclick = () => this.close();
    }
  }

  private renderReview(staged: StagedDefinitionRetirement): void {
    this.contentEl.empty();

    const table = this.contentEl.createEl("table", { cls: "mdse-diagnostics" });
    const rows: Array<[string, string]> = [
      ["Definition", this.definitionName],
      ["Path", staged.path],
      ["UID", staged.uid],
      ["Transaction", staged.transaction.label],
      ["Scope", staged.transaction.scope],
      ["Current status", staged.plan.fromStatus ?? "unset"],
      ["New status", staged.plan.toStatus],
      ["Note-level uses", String(staged.plan.noteUseCount)],
      ["Local Model occurrences", String(staged.plan.occurrenceUseCount)],
    ];
    for (const [key, value] of rows) {
      const tr = table.createEl("tr");
      tr.createEl("td", { text: key });
      tr.createEl("td", { text: value });
    }

    if (staged.plan.impactRows.length) {
      const impact = this.contentEl.createDiv({ cls: "mdse-detail-state" });
      impact.createEl("strong", { text: "Preserved active uses" });
      for (const row of staged.plan.impactRows) impact.createEl("p", { text: row });
      impact.createEl("p", {
        text: "Retirement preserves these references exactly as authored. Migration is a separate supersession workflow.",
      });
    } else {
      this.contentEl.createEl("p", {
        cls: "mdse-muted",
        text: "No current note-level or Local Model occurrence uses were found. Retirement still changes only canonical lifecycle status.",
      });
    }

    if (!staged.plan.changed) {
      this.contentEl.createEl("p", { cls: "mdse-warn", text: "This definition is already retired. No additional retirement change is available." });
    }

    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).onclick = () => this.close();
    const apply = buttons.createEl("button", { text: "Retire definition", cls: "mod-warning" });
    apply.disabled = !staged.plan.changed;
    apply.setAttr("title", staged.plan.changed
      ? "Set only the canonical definition status to retired. Existing references are preserved."
      : "This definition is already retired.");
    apply.onclick = () => {
      void (async () => {
        apply.disabled = true;
        try {
          await this.apply(staged.transaction.id);
          this.applied = true;
          this.staged = null;
          this.close();
          this.onApplied();
          new Notice(`Retired reusable definition ${this.definitionName}. Existing references were preserved.`, 6000);
        } catch (e) {
          new Notice(`Definition was not retired: ${(e as Error).message}`, 15000);
          apply.disabled = !staged.plan.changed;
        }
      })();
    };
  }
}


export class DefinitionSupersedeModal extends Modal {
  private staged: StagedDefinitionSupersession | null = null;
  private stagedMigration: StagedLocalPatch | null = null;
  private stagedNoteMigration: StagedDefinitionNoteMigration | null = null;
  private applied = false;
  private migrationApplied = false;
  private noteMigrationApplied = false;

  constructor(
    app: App,
    private readonly replacedName: string,
    private readonly candidates: NoteRecord[],
    private readonly stage: (replacementPath: string) => Promise<StagedDefinitionSupersession>,
    private readonly apply: (transactionId: string) => Promise<void>,
    private readonly cancel: (transactionId: string) => void,
    private readonly stageMigration: (ownerPath: string, localId: string, replacedPath: string, replacementPath: string) => Promise<StagedLocalPatch>,
    private readonly applyMigration: (transactionId: string) => Promise<void>,
    private readonly cancelMigration: (transactionId: string) => void,
    private readonly stageNoteMigration: (ownerPath: string, field: string, replacedPath: string, replacementPath: string) => Promise<StagedDefinitionNoteMigration>,
    private readonly applyNoteMigration: (transactionId: string) => Promise<void>,
    private readonly cancelNoteMigration: (transactionId: string) => void,
    private readonly refreshMigrationCandidates: (replacedPath: string) => Promise<DefinitionMigrationCandidate[]>,
    private readonly onRetireReplaced: () => void,
    private readonly onApplied: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.renderCompose();
  }

  onClose(): void {
    const staged = this.staged;
    const migration = this.stagedMigration;
    const noteMigration = this.stagedNoteMigration;
    this.staged = null;
    this.stagedMigration = null;
    this.stagedNoteMigration = null;
    this.contentEl.empty();
    if (migration && !this.migrationApplied) {
      try { this.cancelMigration(migration.transaction.id); } catch { /* already closed */ }
    }
    if (noteMigration && !this.noteMigrationApplied) {
      try { this.cancelNoteMigration(noteMigration.transaction.id); } catch { /* already closed */ }
    }
    if (staged && !this.applied) {
      try { this.cancel(staged.transaction.id); } catch { /* already closed */ }
    }
  }

  private renderCompose(): void {
    this.titleEl.setText("Supersede definition");
    this.contentEl.empty();
    this.contentEl.createEl("p", {
      text: `Choose the reusable definition that replaces ${this.replacedName}. Only same-class definitions are offered. Supersession records replacement intent; dependent migration remains separate and reviewed.`,
    });

    const row = this.contentEl.createDiv({ cls: "mdse-create-field" });
    row.createEl("label", { text: "Replacement definition" });
    const pick = row.createEl("select", { cls: "mdse-detail-input" });
    pick.createEl("option", { text: "Choose replacement…", value: "" });
    for (const candidate of this.candidates) {
      pick.createEl("option", { text: candidate.name, value: candidate.path });
    }

    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).onclick = () => this.close();
    const review = buttons.createEl("button", { text: "Review", cls: "mod-cta" });
    review.disabled = this.candidates.length === 0;
    review.setAttr("title", this.candidates.length
      ? "Stage the supersession relationship and complete migration inventory for review."
      : "No same-class replacement definitions are available.");
    review.onclick = () => {
      void (async () => {
        review.disabled = true;
        try {
          if (!pick.value) throw new Error("Choose a replacement definition.");
          const staged = await this.stage(pick.value);
          this.staged = staged;
          this.renderReview(staged);
        } catch (e) {
          new Notice(`Cannot stage supersession: ${(e as Error).message}`, 15000);
          review.disabled = this.candidates.length === 0;
        }
      })();
    };
  }

  private renderReview(staged: StagedDefinitionSupersession): void {
    this.titleEl.setText("Review definition supersession");
    this.contentEl.empty();

    const replacement = this.candidates.find((candidate) => candidate.path === staged.plan.replacementPath);
    const table = this.contentEl.createEl("table", { cls: "mdse-diagnostics" });
    const rows: Array<[string, string]> = [
      ["Replaced definition", this.replacedName],
      ["Replacement", replacement?.name ?? staged.plan.replacementPath],
      ["Relationship", "replacement supersedes replaced"],
      ["Transaction", staged.transaction.label],
      ["Scope", staged.transaction.scope],
      ["Migration candidates", String(staged.plan.migrationCandidates.length)],
      ["Automatic rewrites", "none"],
    ];
    for (const [key, value] of rows) {
      const tr = table.createEl("tr");
      tr.createEl("td", { text: key });
      tr.createEl("td", { text: value });
    }

    for (const warning of staged.plan.warnings) {
      this.contentEl.createEl("p", { cls: "mdse-warn", text: `WARNING: ${warning}` });
    }

    if (staged.plan.migrationCandidates.length) {
      const inventory = this.contentEl.createDiv({ cls: "mdse-detail-state" });
      inventory.createEl("strong", { text: "Guided migration inventory" });
      for (const candidate of staged.plan.migrationCandidates) {
        inventory.createEl("p", {
          text: candidate.scope === "occurrence"
            ? `LOCAL: ${candidate.ownerPath} — ${candidate.kind} ${candidate.identifier} (^${candidate.localId})`
            : `MODEL: ${candidate.ownerPath} — ${candidate.field}`,
        });
      }
      inventory.createEl("p", {
        text: "Apply does not alter these dependents. Each migration remains a separate governed model edit.",
      });
    } else {
      this.contentEl.createEl("p", {
        cls: "mdse-muted",
        text: "No current dependents require migration. Apply still records only the paired supersession relationship.",
      });
    }

    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).onclick = () => this.close();
    const apply = buttons.createEl("button", { text: "Apply supersession", cls: "mod-cta" });
    apply.onclick = () => {
      void (async () => {
        apply.disabled = true;
        try {
          await this.apply(staged.transaction.id);
          this.applied = true;
          this.staged = null;
          this.onApplied();
          new Notice(`Recorded supersession for ${this.replacedName}. Dependent migration remains explicit.`, 7000);
          this.renderMigration(staged);
        } catch (e) {
          new Notice(`Supersession was not applied: ${(e as Error).message}`, 15000);
          apply.disabled = false;
        }
      })();
    };
  }

  private async refreshMigration(staged: StagedDefinitionSupersession): Promise<void> {
    const migrationCandidates = await this.refreshMigrationCandidates(staged.plan.replacedPath);
    const refreshed: StagedDefinitionSupersession = {
      ...staged,
      plan: { ...staged.plan, migrationCandidates },
    };
    this.renderMigration(refreshed);
  }

  private renderMigration(staged: StagedDefinitionSupersession): void {
    this.titleEl.setText("Migrate one dependent");
    this.contentEl.empty();

    const occurrenceCandidates = staged.plan.migrationCandidates.filter(
      (candidate) => candidate.scope === "occurrence" && !!candidate.localId,
    );
    const noteCandidates = staged.plan.migrationCandidates.filter(
      (candidate) => candidate.scope === "note",
    );

    this.contentEl.createEl("p", {
      text: "Supersession is recorded. Migrate one dependent at a time as a separate reviewed transaction. Workbench rechecks fresh source before staging.",
    });

    if (!occurrenceCandidates.length && !noteCandidates.length) {
      this.titleEl.setText("Supersession migration complete");
      this.contentEl.createEl("p", {
        text: "Supersession is recorded and there are no remaining dependents using the replaced definition.",
      });
      this.contentEl.createEl("p", {
        cls: "mdse-muted",
        text: "The replaced definition is still preserved. Retirement is a separate governed lifecycle change and is never applied automatically.",
      });
      const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
      buttons.createEl("button", { text: "Done" }).onclick = () => this.close();
      buttons.createEl("button", { text: "Review retirement…", cls: "mod-cta" }).onclick = () => {
        this.close();
        this.onRetireReplaced();
      };
      return;
    }

    if (occurrenceCandidates.length) {
      const row = this.contentEl.createDiv({ cls: "mdse-create-field" });
      row.createEl("label", { text: "Local Model occurrence" });
      const pick = row.createEl("select", { cls: "mdse-detail-input" });
      pick.createEl("option", { text: "Choose occurrence…", value: "" });
      occurrenceCandidates.forEach((candidate, index) => {
        pick.createEl("option", {
          text: `${candidate.ownerPath} — ${candidate.kind} ${candidate.identifier} (^${candidate.localId})`,
          value: String(index),
        });
      });
      const review = row.createEl("button", { text: "Review occurrence migration", cls: "mod-cta" });
      review.onclick = () => {
        void (async () => {
          review.disabled = true;
          try {
            const candidate = occurrenceCandidates[Number(pick.value)];
            if (!candidate?.localId) throw new Error("Choose an occurrence.");
            this.migrationApplied = false;
            const migration = await this.stageMigration(
              candidate.ownerPath,
              candidate.localId,
              staged.plan.replacedPath,
              staged.plan.replacementPath,
            );
            this.stagedMigration = migration;
            this.renderMigrationReview(staged, candidate, migration);
          } catch (e) {
            new Notice(`Cannot stage occurrence migration: ${(e as Error).message}`, 15000);
            review.disabled = false;
          }
        })();
      };
    }

    if (noteCandidates.length) {
      const row = this.contentEl.createDiv({ cls: "mdse-create-field" });
      row.createEl("label", { text: "Model relationship" });
      const pick = row.createEl("select", { cls: "mdse-detail-input" });
      pick.createEl("option", { text: "Choose relationship…", value: "" });
      noteCandidates.forEach((candidate, index) => {
        pick.createEl("option", {
          text: `${candidate.ownerPath} — ${candidate.field}`,
          value: String(index),
        });
      });
      const review = row.createEl("button", { text: "Review relationship migration", cls: "mod-cta" });
      review.onclick = () => {
        void (async () => {
          review.disabled = true;
          try {
            const candidate = noteCandidates[Number(pick.value)];
            if (!candidate) throw new Error("Choose a model relationship.");
            this.noteMigrationApplied = false;
            const migration = await this.stageNoteMigration(
              candidate.ownerPath,
              candidate.field,
              staged.plan.replacedPath,
              staged.plan.replacementPath,
            );
            this.stagedNoteMigration = migration;
            this.renderNoteMigrationReview(staged, candidate, migration);
          } catch (e) {
            new Notice(`Cannot stage relationship migration: ${(e as Error).message}`, 15000);
            review.disabled = false;
          }
        })();
      };
    }

    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Done" }).onclick = () => this.close();
  }

  private renderMigrationRefreshFailure(
    supersession: StagedDefinitionSupersession,
    error: unknown,
  ): void {
    this.titleEl.setText("Migration applied");
    this.contentEl.empty();
    this.contentEl.createEl("p", {
      text: "The migration was applied successfully, but Workbench could not refresh the remaining dependent inventory.",
    });
    this.contentEl.createEl("p", {
      cls: "mdse-warn",
      text: `Refresh failed: ${(error as Error).message}`,
    });
    this.contentEl.createEl("p", {
      text: "Do not re-apply the completed migration. Retry the inventory refresh or close this dialog and reopen supersession later.",
    });
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    const retry = buttons.createEl("button", { text: "Retry inventory", cls: "mod-cta" });
    retry.onclick = () => {
      void (async () => {
        retry.disabled = true;
        try {
          await this.refreshMigration(supersession);
        } catch (e) {
          this.renderMigrationRefreshFailure(supersession, e);
        }
      })();
    };
    buttons.createEl("button", { text: "Done" }).onclick = () => this.close();
  }

  private renderNoteMigrationReview(
    supersession: StagedDefinitionSupersession,
    candidate: StagedDefinitionSupersession["plan"]["migrationCandidates"][number],
    migration: StagedDefinitionNoteMigration,
  ): void {
    this.titleEl.setText("Review relationship migration");
    this.contentEl.empty();

    const table = this.contentEl.createEl("table", { cls: "mdse-diagnostics" });
    const rows: Array<[string, string]> = [
      ["Owner", candidate.ownerPath],
      ["Relationship", candidate.field],
      ["From definition", supersession.plan.replacedPath],
      ["To definition", supersession.plan.replacementPath],
      ["Inverse field", migration.plan.inverseField ?? "none"],
      ["Affected notes", String(migration.affectedPaths.length)],
      ["Transaction", migration.transaction.label],
      ["Scope", migration.transaction.scope],
    ];
    for (const [key, value] of rows) {
      const tr = table.createEl("tr");
      tr.createEl("td", { text: key });
      tr.createEl("td", { text: value });
    }

    const affected = this.contentEl.createDiv({ cls: "mdse-detail-state" });
    affected.createEl("strong", { text: "Files changed together" });
    for (const path of migration.affectedPaths) affected.createEl("p", { text: path });
    affected.createEl("p", {
      text: "Apply replaces the authored target and moves any paired or symmetric inverse relationship in the same structural transaction.",
    });

    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel migration" }).onclick = () => {
      try { this.cancelNoteMigration(migration.transaction.id); } finally {
        this.stagedNoteMigration = null;
        this.renderMigration(supersession);
      }
    };
    const apply = buttons.createEl("button", { text: "Apply relationship migration", cls: "mod-cta" });
    apply.onclick = () => {
      void (async () => {
        apply.disabled = true;
        try {
          await this.applyNoteMigration(migration.transaction.id);
        } catch (e) {
          new Notice(`Relationship migration was not applied: ${(e as Error).message}`, 15000);
          apply.disabled = false;
          return;
        }
        this.noteMigrationApplied = true;
        this.stagedNoteMigration = null;
        new Notice(`Migrated ${candidate.ownerPath} ${candidate.field} to the replacement definition.`, 6000);
        try {
          await this.refreshMigration(supersession);
        } catch (e) {
          this.renderMigrationRefreshFailure(supersession, e);
        }
      })();
    };
  }

  private renderMigrationReview(
    supersession: StagedDefinitionSupersession,
    candidate: StagedDefinitionSupersession["plan"]["migrationCandidates"][number],
    migration: StagedLocalPatch,
  ): void {
    this.titleEl.setText("Review occurrence migration");
    this.contentEl.empty();

    const table = this.contentEl.createEl("table", { cls: "mdse-diagnostics" });
    const rows: Array<[string, string]> = [
      ["Owner", candidate.ownerPath],
      ["Occurrence", `${candidate.kind ?? "occurrence"} ${candidate.identifier ?? candidate.localId ?? ""}`],
      ["From definition", supersession.plan.replacedPath],
      ["To definition", supersession.plan.replacementPath],
      ["Transaction", migration.transaction.label],
      ["Scope", migration.transaction.scope],
    ];
    for (const [key, value] of rows) {
      const tr = table.createEl("tr");
      tr.createEl("td", { text: key });
      tr.createEl("td", { text: value });
    }
    for (const finding of migration.plan.findings) {
      this.contentEl.createEl("p", {
        text: `${finding.severity.toUpperCase()}: ${finding.message}`,
        cls: finding.severity === "error" ? "mdse-warn" : undefined,
      });
    }

    const blocking = migration.plan.findings.some((finding) => finding.severity === "error");
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel migration" }).onclick = () => {
      try { this.cancelMigration(migration.transaction.id); } finally {
        this.stagedMigration = null;
        this.renderMigration(supersession);
      }
    };
    const apply = buttons.createEl("button", { text: "Apply occurrence migration", cls: "mod-cta" });
    apply.disabled = blocking;
    apply.onclick = () => {
      void (async () => {
        apply.disabled = true;
        try {
          await this.applyMigration(migration.transaction.id);
        } catch (e) {
          new Notice(`Occurrence migration was not applied: ${(e as Error).message}`, 15000);
          apply.disabled = blocking;
          return;
        }
        this.migrationApplied = true;
        this.stagedMigration = null;
        new Notice(`Migrated occurrence ^${candidate.localId} to the replacement definition.`, 6000);
        try {
          await this.refreshMigration(supersession);
        } catch (e) {
          this.renderMigrationRefreshFailure(supersession, e);
        }
      })();
    };
  }
}


import { App, FuzzySuggestModal, Modal, Notice, SuggestModal, type FuzzyMatch } from "obsidian";
import type { NoteRecord } from "../core/model";
import type { RelationshipOption } from "../core/rules";
import type { ViewProfile } from "../core/views";
import type { NewLocalRecord } from "../core/localmodel-edit";
import type { StagedLocalCreate, StagedLocalDelete } from "../core/model-edit";

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
    const definition = field("Reusable definition", "", "[[Main Contactor]]");
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
          const fields: Record<string, string> = {
            definition: definition.value.trim(),
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
            definition: definition.value.trim(),
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


export class LocalPartDeleteModal extends Modal {
  private staged: StagedLocalDelete | null = null;
  private applied = false;

  constructor(
    app: App,
    private readonly ownerName: string,
    private readonly occurrenceName: string,
    private readonly stage: () => Promise<StagedLocalDelete>,
    private readonly apply: (transactionId: string) => Promise<void>,
    private readonly cancel: (transactionId: string) => void,
    private readonly onApplied: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText("Review part occurrence deletion");
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
          new Notice(`Deleted part occurrence ${this.occurrenceName}.`, 5000);
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
    const definition = field("Reusable definition", "", "[[CAN Port]]");
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
          const fields: Record<string, string> = {
            definition: definition.value.trim(),
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
            definition: definition.value.trim(),
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

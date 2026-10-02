import { App, FuzzySuggestModal, Modal, SuggestModal, type FuzzyMatch } from "obsidian";
import type { NoteRecord } from "../core/model";
import type { RelationshipOption } from "../core/rules";
import type { ViewProfile } from "../core/views";

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

/**
 * Review screen (Part C, WB-063): categories with counts, a filtered list, and a focused
 * finding modal with Previous / Next. Reads the index; the only writes are the two resolution
 * actions, and both go through the relationship writer so they are undoable (WB-086).
 */
import { ItemView, Modal, Notice, TFile, WorkspaceLeaf, type App } from "obsidian";
import type { ModelIndex } from "../core/model";
import { optionsBetween } from "../core/rules";
import type { Schema } from "../core/schema";
import { CATEGORIES, countByCategory, filterFindings, neighbour, type Category, type Finding } from "../core/review";
import type { RelationshipWriter } from "./writer";
import type { AssuranceSnapshot } from "./assurance";

export const REVIEW_VIEW = "mdse-review";
const ROW_LIMIT = 200;

/** What the screen needs from the plugin. */
export interface ReviewHost {
  app: App;
  ready(): boolean;
  index(): ModelIndex;
  schema(): Schema;
  writer(): RelationshipWriter;
  assurance(force?: boolean): Promise<AssuranceSnapshot>;
}

const base = (path: string) => path.replace(/^.*\//, "").replace(/\.md$/, "");

async function openNote(app: App, path: string): Promise<void> {
  const f = app.vault.getAbstractFileByPath(path);
  if (f instanceof TFile) await app.workspace.getLeaf(false).openFile(f);
  else new Notice(`${path} no longer exists.`);
}

export class ReviewView extends ItemView {
  private all: Finding[] = [];
  /** Findings resolved here since the last recompute; hidden until the index catches up. */
  private readonly resolved = new Set<string>();
  private category: Category = "provisional";
  private text = "";
  private type = "";
  private field = "";
  private timer: number | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly host: ReviewHost) {
    super(leaf);
  }
  getViewType(): string {
    return REVIEW_VIEW;
  }
  getDisplayText(): string {
    return "Workbench Review";
  }
  getIcon(): string {
    return "list-checks";
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("mdse-review");
    // Follow changes (a write here, an edit by hand, a pull), after things go quiet.
    this.registerEvent(this.app.metadataCache.on("changed", () => this.later()));
    this.registerEvent(this.app.vault.on("delete", () => this.later()));
    this.registerEvent(this.app.vault.on("rename", () => this.later()));
    void this.refresh();
  }
  async onClose(): Promise<void> {
    if (this.timer !== null) window.clearTimeout(this.timer);
  }

  private later(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.refresh();
    }, 1000);
  }

  /** Consume the shared assurance snapshot; no view owns its own whole-model validation loop. */
  async refresh(force = false): Promise<void> {
    if (!this.host.ready()) {
      this.contentEl.empty();
      this.contentEl.createEl("p", { text: "Workbench is still indexing. This screen will fill in when it finishes.", cls: "mdse-muted" });
      this.later();
      return;
    }
    const snapshot = await this.host.assurance(force);
    if (snapshot.error) {
      this.contentEl.empty();
      this.contentEl.createEl("h3", { text: "Review" });
      this.contentEl.createEl("p", { text: "Global assurance is temporarily unavailable. The core model and ordinary notes remain usable.", cls: "mdse-warn" });
      this.contentEl.createEl("p", { text: snapshot.error, cls: "mdse-muted" });
      this.contentEl.createEl("button", { text: "Retry assurance" }).onclick = () => void this.refresh(true);
      return;
    }
    this.all = snapshot.all;
    this.resolved.clear();
    this.render();
    if (snapshot.stale) this.later();
  }

  private visible(): Finding[] {
    const list = filterFindings(this.all, this.host.index(), { category: this.category, text: this.text, type: this.type || undefined, field: this.field || undefined });
    return list.filter((f) => !this.resolved.has(f.key));
  }

  private render(): void {
    const el = this.contentEl;
    el.empty();
    const counts = countByCategory(this.all.filter((f) => !this.resolved.has(f.key)));
    const head = el.createDiv({ cls: "mdse-review-head" });
    head.createEl("h3", { text: "Review" });
    head.createEl("button", { text: "Refresh" }).onclick = () => void this.refresh(true);

    const cats = el.createDiv({ cls: "mdse-review-cats" });
    for (const c of CATEGORIES) {
      const b = cats.createEl("button", { cls: c.id === this.category ? "mdse-cat is-active" : "mdse-cat" });
      b.createSpan({ text: c.label });
      b.createSpan({ text: String(counts[c.id]), cls: counts[c.id] ? "mdse-count" : "mdse-count is-zero" });
      b.onclick = () => {
        this.category = c.id;
        this.type = "";
        this.field = "";
        this.render();
      };
    }
    el.createEl("p", { text: CATEGORIES.find((c) => c.id === this.category)!.help, cls: "mdse-muted" });

    // Filters narrow within the chosen category (Part C).
    const inCat = this.all.filter((f) => f.category === this.category);
    const types = [...new Set(inCat.map((f) => this.host.index().notes.get(f.from)?.type).filter((t): t is string => !!t))].sort();
    const fields = [...new Set(inCat.map((f) => f.field))].sort();
    const bar = el.createDiv({ cls: "mdse-review-filters" });
    const search = bar.createEl("input", { type: "search", placeholder: "Search notes or relationship" });
    search.value = this.text;
    search.oninput = () => {
      this.text = search.value;
      this.renderList(listEl);
    };
    const pick = (label: string, values: string[], current: string, set: (v: string) => void) => {
      const s = bar.createEl("select");
      s.createEl("option", { value: "", text: label });
      for (const v of values) s.createEl("option", { value: v, text: v });
      s.value = current;
      s.onchange = () => {
        set(s.value);
        this.renderList(listEl);
      };
    };
    pick("Any note type", types, this.type, (v) => (this.type = v));
    pick("Any relationship", fields, this.field, (v) => (this.field = v));

    const listEl = el.createDiv({ cls: "mdse-review-list" });
    this.renderList(listEl);
  }

  private renderList(listEl: HTMLElement): void {
    listEl.empty();
    const list = this.visible();
    if (!list.length) {
      listEl.createEl("p", { text: this.all.some((f) => f.category === this.category) ? "Nothing matches these filters." : "No findings in this category.", cls: "mdse-muted" });
      return;
    }
    list.slice(0, ROW_LIMIT).forEach((f, i) => {
      const row = listEl.createDiv({ cls: "mdse-row" });
      row.createSpan({ text: base(f.from), cls: "mdse-from" });
      row.createSpan({ text: f.field, cls: "mdse-field" });
      row.createSpan({ text: f.to ? base(f.to) : (f.link ?? ""), cls: "mdse-to" });
      row.onclick = () => this.openFinding(list, i);
    });
    if (list.length > ROW_LIMIT) listEl.createEl("p", { text: `Showing the first ${ROW_LIMIT} of ${list.length}. Narrow the filters to see the rest.`, cls: "mdse-muted" });
  }

  private openFinding(list: Finding[], at: number): void {
    new FindingModal(this.host, list, at, (key) => this.markResolved(key)).open();
  }

  private markResolved(key: string): void {
    this.resolved.add(key);
    this.render();
    this.later();
  }
}

/** One finding in context, with only the actions that apply to it. */
export class FindingModal extends Modal {
  private at: number;
  constructor(
    private readonly host: ReviewHost,
    private readonly list: Finding[],
    start: number,
    private readonly onResolved: (key: string) => void,
  ) {
    super(host.app);
    this.at = start;
  }

  /** Findings resolved in this modal; Previous / Next skip them. */
  private readonly done = new Set<string>();

  onOpen(): void {
    this.draw();
  }
  onClose(): void {
    this.contentEl.empty();
  }

  private go(direction: 1 | -1): void {
    const n = neighbour(this.list, this.at, direction, this.done);
    if (n < 0) {
      new Notice(direction === 1 ? "That was the last finding in this list." : "That was the first finding in this list.");
      return;
    }
    this.at = n;
    this.draw();
  }

  private draw(): void {
    const f = this.list[this.at];
    const { contentEl } = this;
    contentEl.empty();
    const cat = CATEGORIES.find((c) => c.id === f.category)!;
    this.titleEl.setText(cat.label.replace(/s$/, ""));
    contentEl.createEl("p", { text: `${this.at + 1} of ${this.list.length}`, cls: "mdse-muted" });

    const index = this.host.index();
    const from = index.notes.get(f.from);
    const to = f.to ? index.notes.get(f.to) : undefined;
    const t = contentEl.createEl("table", { cls: "mdse-finding" });
    const row = (k: string, v: string) => {
      const tr = t.createEl("tr");
      tr.createEl("td", { text: k });
      tr.createEl("td", { text: v });
    };
    row(f.category === "orphanInverse" ? "Note with the inverse" : "Source", `${base(f.from)}${from?.type ? ` (${from.type})` : ""}`);
    row(f.category === "orphanInverse" ? "Inverse field" : "Relationship", f.field);
    if (f.to) row(f.category === "orphanInverse" ? "Named as owner" : "Target", `${base(f.to)}${to?.type ? ` (${to.type})` : ""}`);
    if (f.link) row("Unresolved link", f.link);
    if (f.reason) row("Why it is off-rule", f.reason);

    const explain: Record<Category, string> = {
      provisional: "This link was written with the provisional relationship. Replace it with an approved relationship, or leave it if none fits yet.",
      missingInverse: "The forward link is there but the other note does not show it. Writing the inverse fixes that and changes only the other note.",
      orphanInverse: "No forward link backs this entry up. Check the owner note by hand before removing anything.",
      offRule: "Imported links stay as findings. Fix the link by hand, or leave it until the post-import review.",
      broken: "The link points at a note that does not exist. Fix the name in the note, or create the missing note.",
      localModel: "This finding is in a contextual Local Model record. WB-106 Review reports it here but does not rewrite Local Model records.",
    };
    contentEl.createEl("p", { text: explain[f.category] });

    // Resolution actions.
    let action: (() => Promise<void>) | null = null;
    let actionLabel = "";
    if (f.category === "provisional" && from && to && index.isElement(from) && index.isElement(to)) {
      const options = optionsBetween(this.host.schema(), from.type, to.type).filter((o) => !o.def.provisional);
      if (options.length) {
        const box = contentEl.createDiv({ cls: "mdse-options" });
        box.createEl("p", { text: "Valid replacements:", cls: "mdse-muted" });
        let chosen = 0;
        options.forEach((o, i) => {
          const [owner, target] = o.ownerIsFirst ? [from, to] : [to, from];
          const label = box.createEl("label", { cls: "mdse-option" });
          const radio = label.createEl("input", { type: "radio" });
          radio.name = "mdse-replacement";
          radio.checked = i === 0;
          radio.onchange = () => (chosen = i);
          label.createSpan({ text: `${base(owner.path)} ` });
          label.createEl("strong", { text: o.def.field });
          label.createSpan({ text: ` ${base(target.path)}` });
        });
        actionLabel = "Replace relationship";
        action = async () => {
          const o = options[chosen];
          const writer = this.host.writer();
          const [owner, target] = o.ownerIsFirst ? [from, to] : [to, from];
          // Add the approved link first; remove the provisional one only if that worked.
          await writer.add(o.def, owner.path, target.path);
          const oldDef = this.host.schema().byField.get(f.field);
          if (oldDef) await writer.remove(oldDef, f.from, f.to as string);
          new Notice(`Replaced ${f.field} with ${o.def.field}. Undo last relationship change reverses the removal first.`, 10000);
        };
      } else {
        contentEl.createEl("p", { text: "No approved relationship is allowed between these two classes. Leave it provisional.", cls: "mdse-muted" });
      }
    }
    if (f.category === "missingInverse" && from && to && index.isElement(from) && index.isElement(to)) {
      const def = this.host.schema().byField.get(f.field);
      if (def) {
        // A link that already breaks its endpoint rule is a modeling error: writing its inverse would
        // spread the error, and the writer refuses it. Offer no button (WB-094).
        const problem = this.host.writer().check(def, f.from, f.to as string);
        if (problem) {
          contentEl.createEl("p", { text: `This link breaks its endpoint rule (${problem}), so its inverse is not written. Fix the link in the note, or leave it for the post-import review.`, cls: "mdse-muted" });
        } else {
          actionLabel = "Write missing inverse";
          action = async () => {
            await this.host.writer().add(def, f.from, f.to as string);
            new Notice(`Wrote the inverse on ${base(f.to as string)}.`, 8000);
          };
        }
      }
    }

    const buttons = contentEl.createDiv({ cls: "mdse-buttons" });
    buttons.createEl("button", { text: "Open source" }).onclick = () => void openNote(this.app, f.from);
    if (f.to) buttons.createEl("button", { text: "Open target" }).onclick = () => void openNote(this.app, f.to as string);

    const nav = contentEl.createDiv({ cls: "modal-button-container" });
    nav.createEl("button", { text: "Previous" }).onclick = () => this.go(-1);
    nav.createEl("button", { text: "Next" }).onclick = () => this.go(1);
    if (action) {
      const run = action;
      const b = nav.createEl("button", { text: actionLabel, cls: "mod-cta" });
      b.onclick = async () => {
        b.disabled = true;
        try {
          await run();
          this.done.add(f.key);
          this.onResolved(f.key);
          const next = neighbour(this.list, this.at, 1, this.done);
          if (next >= 0) {
            this.at = next;
            this.draw();
          } else this.close();
        } catch (e) {
          b.disabled = false;
          new Notice(`Not changed: ${(e as Error).message}`, 15000);
        }
      };
    }
  }
}

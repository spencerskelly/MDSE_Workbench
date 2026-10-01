/**
 * Note detail popup (WB-099): a floating panel that shows a note's properties and rendered text, so a
 * person navigating a generated view does not have to open the note. Not modal: it stays on screen while
 * the canvas is used, and follows the next note clicked. Links inside it open in the same panel.
 */
import { App, Component, MarkdownRenderer, TFile } from "obsidian";
import { bodyOf, propertyRows } from "../core/detail";

export class NoteDetailPanel extends Component {
  private el: HTMLElement | null = null;
  private renderer: Component | null = null;
  private history: string[] = [];
  private current: TFile | null = null;
  private escape = (e: KeyboardEvent) => {
    if (e.key === "Escape" && this.el) this.close();
  };

  constructor(
    private readonly app: App,
    /** Relationship field names, kept out of the short property list (the canvas already draws them). */
    private readonly relationFields: () => ReadonlySet<string>,
  ) {
    super();
  }

  onunload(): void {
    this.close();
  }

  isOpenFor(file: TFile): boolean {
    return !!this.el && this.current?.path === file.path;
  }

  async show(file: TFile, remember = true): Promise<void> {
    if (remember && this.current && this.current.path !== file.path) this.history.push(this.current.path);
    this.current = file;
    const root = this.ensure();
    const gen = ++this.generation;
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = (cache?.frontmatter ?? null) as Record<string, unknown> | null;
    const text = await this.app.vault.cachedRead(file);
    if (gen !== this.generation) return; // a newer click arrived while reading
    this.renderer?.unload();
    this.renderer = new Component();
    this.renderer.load();
    root.empty();

    const head = root.createDiv({ cls: "mdse-detail-head" });
    const back = head.createEl("button", { text: "‹", cls: "mdse-detail-btn", attr: { "aria-label": "Back" } });
    back.disabled = this.history.length === 0;
    back.onclick = () => {
      const prev = this.history.pop();
      const f = prev ? this.app.vault.getAbstractFileByPath(prev) : null;
      if (f instanceof TFile) void this.show(f, false);
    };
    const title = head.createDiv({ cls: "mdse-detail-title", text: file.basename });
    title.setAttr("title", file.path);
    const open = head.createEl("button", { text: "Open note", cls: "mdse-detail-btn" });
    open.onclick = () => void this.app.workspace.getLeaf(true).openFile(file);
    const close = head.createEl("button", { text: "×", cls: "mdse-detail-btn", attr: { "aria-label": "Close" } });
    close.onclick = () => this.close();

    const chips = root.createDiv({ cls: "mdse-detail-chips" });
    for (const k of ["type", "subtype", "id", "status"]) {
      const v = fm?.[k];
      if (v !== undefined && v !== null && String(v) !== "") chips.createSpan({ cls: "mdse-detail-chip", text: k === "type" || k === "subtype" ? String(v) : `${k} ${String(v)}` });
    }

    const rows = propertyRows(fm, this.relationFields());
    if (rows.length) {
      const details = root.createEl("details", { cls: "mdse-detail-props" });
      details.createEl("summary", { text: "Properties" });
      const table = details.createEl("table");
      for (const r of rows) {
        const tr = table.createEl("tr");
        tr.createEl("th", { text: r.key });
        const td = tr.createEl("td");
        for (const p of r.parts) {
          if (p.link) this.link(td, p.text, p.link, file.path);
          else td.appendText(p.text);
        }
      }
    }

    const body = root.createDiv({ cls: "mdse-detail-body markdown-rendered" });
    const md = bodyOf(text, cache?.frontmatterPosition?.end.offset);
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
    root.scrollTop = 0;
  }

  /** A card for a note that does not exist yet (WB-092). */
  showUndefined(name: string): void {
    this.generation++;
    this.current = null;
    this.history = [];
    this.renderer?.unload();
    this.renderer = null;
    const root = this.ensure();
    root.empty();
    const head = root.createDiv({ cls: "mdse-detail-head" });
    head.createDiv({ cls: "mdse-detail-title", text: name });
    const close = head.createEl("button", { text: "×", cls: "mdse-detail-btn", attr: { "aria-label": "Close" } });
    close.onclick = () => this.close();
    root.createDiv({ cls: "mdse-detail-chips" }).createSpan({ cls: "mdse-detail-chip mdse-detail-undefined", text: "undefined" });
    root.createEl("p", { cls: "mdse-detail-empty", text: "No note with this name exists yet. It is linked from the note it hangs off in this view, and still has to be defined." });
  }

  close(): void {
    this.generation++;
    this.renderer?.unload();
    this.renderer = null;
    this.el?.remove();
    this.el = null;
    this.current = null;
    this.history = [];
    document.removeEventListener("keydown", this.escape, true);
  }

  private generation = 0;

  private ensure(): HTMLElement {
    if (!this.el) {
      this.el = document.body.createDiv({ cls: "mdse-detail" });
      document.addEventListener("keydown", this.escape, true);
    }
    return this.el;
  }

  private link(parent: HTMLElement, text: string, linktext: string, from: string): void {
    const a = parent.createEl("a", { text, cls: "internal-link", href: "#" });
    a.onclick = (e) => {
      e.preventDefault();
      const target = this.app.metadataCache.getFirstLinkpathDest(linktext, from);
      if (target) void this.show(target);
    };
  }
}

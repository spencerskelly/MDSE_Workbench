/**
 * Relationship service (WB-080): validate, write the forward field on the owner and the
 * inverse on the target in one step (WB-085, W-275), keep a safe undo (WB-086).
 * No UI here; commands and, later, Canvas call it.
 */
import { App, TFile } from "obsidian";
import { addLink, canonicalOrder, orderProperties, removeLink } from "../core/frontmatter";
import type { ModelIndex } from "../core/model";
import { allows } from "../core/rules";
import { editingBlocked, type RelationshipDef, type Schema } from "../core/schema";

interface FileState {
  path: string;
  before: string;
  after: string;
}

export interface Transaction {
  label: string;
  files: FileState[];
}

export class RelationshipWriter {
  private undoStack: Transaction[] = [];

  constructor(private readonly app: App, private readonly getSchema: () => Schema, private readonly getIndex: () => ModelIndex) {}

  private file(path: string): TFile {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) throw new Error(`${path} no longer exists.`);
    return f;
  }

  /** Checks a proposed link. Returns the reason it cannot be made, or null. */
  check(def: RelationshipDef, ownerPath: string, targetPath: string): string | null {
    const schema = this.getSchema();
    if (editingBlocked(schema)) return "The vault's schema is older than this Workbench supports, so editing is off.";
    if (ownerPath === targetPath) return "A note cannot be related to itself.";
    const index = this.getIndex();
    const owner = index.notes.get(ownerPath);
    const target = index.notes.get(targetPath);
    if (!index.isElement(owner) || !index.isElement(target)) return "Both notes must be model notes with a known type.";
    if (def.temporary) return `${def.field} is temporary and is not created by hand.`;
    const r = allows(def, owner.type, target.type);
    return r.ok ? null : (r.reason ?? "Not allowed by the endpoint rules.");
  }

  async add(def: RelationshipDef, ownerPath: string, targetPath: string): Promise<Transaction> {
    const problem = this.check(def, ownerPath, targetPath);
    if (problem) throw new Error(problem);
    const owner = this.file(ownerPath);
    const target = this.file(targetPath);
    const order = canonicalOrder(this.getSchema());
    const tx: Transaction = { label: `${owner.basename} ${def.field} ${target.basename}`, files: [] };

    const edit = async (file: TFile, field: string, linkTo: TFile) => {
      const before = await this.app.vault.read(file);
      let changed = false;
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        changed = addLink(fm, field, linkTo.basename);
        if (changed) orderProperties(fm, order);
      });
      if (changed) tx.files.push({ path: file.path, before, after: await this.app.vault.read(file) });
    };

    await edit(owner, def.field, target);
    // Inverse in the same step: paired → its inverse field; symmetric → same field; one-way → nothing.
    const back = def.kind === "symmetric" ? def.field : def.inverse;
    if (back) await edit(target, back, owner);

    if (tx.files.length) this.undoStack.push(tx);
    return tx;
  }

  /** Removes a link and its inverse (WB-051: removal is explicit and confirmed by the caller). */
  async remove(def: RelationshipDef, ownerPath: string, targetPath: string): Promise<Transaction> {
    const owner = this.file(ownerPath);
    const target = this.file(targetPath);
    const tx: Transaction = { label: `remove ${owner.basename} ${def.field} ${target.basename}`, files: [] };
    const edit = async (file: TFile, field: string, linkTo: TFile) => {
      const before = await this.app.vault.read(file);
      let changed = false;
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        changed = removeLink(fm, field, linkTo.basename);
      });
      if (changed) tx.files.push({ path: file.path, before, after: await this.app.vault.read(file) });
    };
    await edit(owner, def.field, target);
    const back = def.kind === "symmetric" ? def.field : def.inverse;
    if (back) await edit(target, back, owner);
    if (tx.files.length) this.undoStack.push(tx);
    return tx;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /**
   * Undo the last transaction, but only if no note in it changed since (WB-086).
   * Nothing is written unless every file still matches.
   */
  async undo(): Promise<string> {
    const tx = this.undoStack[this.undoStack.length - 1];
    if (!tx) return "Nothing to undo.";
    for (const s of tx.files) {
      const current = await this.app.vault.read(this.file(s.path));
      if (current !== s.after) {
        this.undoStack.pop();
        return `Not undone: ${s.path} changed after "${tx.label}". Fix it by hand or from Git history.`;
      }
    }
    for (const s of tx.files) await this.app.vault.modify(this.file(s.path), s.before);
    this.undoStack.pop();
    return `Undone: ${tx.label}.`;
  }
}

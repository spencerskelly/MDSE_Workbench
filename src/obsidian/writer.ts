/**
 * Relationship service (WB-080): validate, write the forward field on the owner and the
 * inverse on the target in one step (WB-085, W-275), keep a safe undo (WB-086).
 * No UI here; commands and, later, Canvas call it.
 */
import { App, getLinkpath, TFile } from "obsidian";
import { bodyUnchanged, PROTECTED_PROPERTIES, replaceBody } from "../core/edit";
import { assertIndexedNoteUidMatchesSource } from "../core/identity";
import { noteRef, type ModelRef } from "../core/localmodel";
import { TransactionManager, type AppliedEdit, type SemanticChange } from "../core/transaction";
import { addLink, canonicalOrder, linkTarget, orderProperties, removeLink, type SameNote } from "../core/frontmatter";
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

/**
 * The link text Obsidian itself would write for `target` from `source` (W-324): the file name when it is
 * unique, the shortest unique path otherwise, following the vault's link-format setting. A bare file name is
 * not enough: where two notes share a name it would point at the wrong one.
 */
export function linkTextFor(app: App, target: TFile, sourcePath: string): string {
  try {
    const md = app.fileManager.generateMarkdownLink(target, sourcePath);
    const m = /^\[\[([^\]|#]+)/.exec(md);
    if (m) return m[1].trim();
  } catch {
    // fall through to the metadata cache
  }
  return app.metadataCache.fileToLinktext(target, sourcePath, true);
}

/** True when an existing list entry resolves, from `sourcePath`, to `target`. */
export function pointsAt(app: App, target: TFile, sourcePath: string): SameNote {
  return (value: unknown) => {
    const text = linkTarget(value);
    if (!text) return false;
    return app.metadataCache.getFirstLinkpathDest(getLinkpath(text), sourcePath)?.path === target.path;
  };
}

export class RelationshipWriter {
  private sequence = 0;

  constructor(
    private readonly app: App,
    private readonly getSchema: () => Schema,
    private readonly getIndex: () => ModelIndex,
    private readonly transactions: TransactionManager = new TransactionManager(),
  ) {}

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
      this.assertCurrentIdentity(file.path, before, "add relationship to");
      let changed = false;
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        changed = addLink(fm, field, linkTextFor(this.app, linkTo, file.path), pointsAt(this.app, linkTo, file.path));
        if (changed) orderProperties(fm, order);
      });
      if (changed) tx.files.push({ path: file.path, before, after: await this.app.vault.read(file) });
    };

    await edit(owner, def.field, target);
    // Inverse in the same step: paired → its inverse field; symmetric → same field; one-way → nothing.
    const back = def.kind === "symmetric" ? def.field : def.inverse;
    if (back) await edit(target, back, owner);

    if (tx.files.length) this.record(tx, "relationship.add", this.refs(ownerPath, targetPath));
    return tx;
  }

  /** Removes a link and its inverse (WB-051: removal is explicit and confirmed by the caller). */
  async remove(def: RelationshipDef, ownerPath: string, targetPath: string): Promise<Transaction> {
    const owner = this.file(ownerPath);
    const target = this.file(targetPath);
    const tx: Transaction = { label: `remove ${owner.basename} ${def.field} ${target.basename}`, files: [] };
    const edit = async (file: TFile, field: string, linkTo: TFile) => {
      const before = await this.app.vault.read(file);
      this.assertCurrentIdentity(file.path, before, "remove relationship from");
      let changed = false;
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        changed = removeLink(fm, field, linkTextFor(this.app, linkTo, file.path), pointsAt(this.app, linkTo, file.path));
      });
      if (changed) tx.files.push({ path: file.path, before, after: await this.app.vault.read(file) });
    };
    await edit(owner, def.field, target);
    const back = def.kind === "symmetric" ? def.field : def.inverse;
    if (back) await edit(target, back, owner);
    if (tx.files.length) this.record(tx, "relationship.remove", this.refs(ownerPath, targetPath));
    return tx;
  }

  /** Removes a link whose note does not exist (an undefined card, WB-092). There is no inverse to remove. */
  async removeMissing(path: string, field: string, linkText: string): Promise<Transaction> {
    const file = this.file(path);
    const tx: Transaction = { label: `remove ${file.basename} ${field} ${linkText}`, files: [] };
    const before = await this.app.vault.read(file);
    this.assertCurrentIdentity(file.path, before, "remove missing relationship from");
    let changed = false;
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      changed = removeLink(fm, field, linkText);
    });
    if (changed) tx.files.push({ path: file.path, before, after: await this.app.vault.read(file) });
    if (tx.files.length) this.record(tx, "relationship.remove-missing", this.refs(path));
    return tx;
  }

  /**
   * Sets one ordinary property (WB-101). Never `type`, `id` or `uid`, never a relationship field (those go
   * through add and remove), and only a property the note already has: properties are not added or dropped
   * (AI_INSTRUCTIONS).
   */
  async setProperty(path: string, key: string, value: unknown): Promise<Transaction> {
    const schema = this.getSchema();
    if (editingBlocked(schema)) throw new Error("The vault's schema is older than this Workbench supports, so editing is off.");
    if (PROTECTED_PROPERTIES.has(key)) throw new Error(`${key} is never edited by hand.`);
    if (schema.byField.has(key) || schema.byInverse.has(key)) throw new Error(`${key} is a relationship: change it under Relationships.`);
    const file = this.file(path);
    const tx: Transaction = { label: `set ${key} on ${file.basename}`, files: [] };
    const before = await this.app.vault.read(file);
    this.assertCurrentIdentity(file.path, before, "set property on");
    let present = true;
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      if (!(key in fm)) {
        present = false;
        return;
      }
      fm[key] = value;
    });
    if (!present) throw new Error(`${file.basename} has no ${key} property, and properties are not added by hand.`);
    const after = await this.app.vault.read(file);
    if (after !== before) {
      tx.files.push({ path: file.path, before, after });
      this.record(tx, "property.set", this.refs(path));
    }
    return tx;
  }

  /** Replaces the note text below the properties. Refuses if the text changed since the popup loaded it. */
  async setBody(path: string, loadedBody: string, newBody: string): Promise<Transaction> {
    const schema = this.getSchema();
    if (editingBlocked(schema)) throw new Error("The vault's schema is older than this Workbench supports, so editing is off.");
    const file = this.file(path);
    const tx: Transaction = { label: `edit text of ${file.basename}`, files: [] };
    const before = await this.app.vault.read(file);
    this.assertCurrentIdentity(file.path, before, "edit body of");
    if (before.includes("<!-- MDSE:LOCAL-MODEL START schema=")) throw new Error("Ordinary text editing is disabled on notes containing a governed Local Model until region-aware editing is implemented.");
    if (!bodyUnchanged(before, loadedBody)) throw new Error(`${file.basename} changed since the popup showed it. Close and reopen the popup, then edit again.`);
    const after = replaceBody(before, newBody);
    if (after !== before) {
      await this.app.vault.modify(file, after);
      tx.files.push({ path: file.path, before, after });
      this.record(tx, "body.edit", this.refs(path));
    }
    return tx;
  }

  get canUndo(): boolean {
    return this.transactions.canUndo;
  }

  get canRedo(): boolean {
    return this.transactions.canRedo;
  }

  async undo(): Promise<string> {
    try {
      const entry = await this.transactions.undo();
      return "Undone: " + entry.label + ".";
    } catch (e) {
      return "Not undone: " + (e as Error).message;
    }
  }

  async redo(): Promise<string> {
    try {
      const entry = await this.transactions.redo();
      return "Redone: " + entry.label + ".";
    } catch (e) {
      return "Not redone: " + (e as Error).message;
    }
  }

  private assertCurrentIdentity(path: string, source: string, operation: string): void {
    const uid = this.getIndex().notes.get(path)?.uid;
    if (!uid) throw new Error(`Cannot ${operation} ${path}: the note is not indexed with a durable uid.`);
    assertIndexedNoteUidMatchesSource(path, source, uid, operation);
  }

  private refs(...paths: string[]): ModelRef[] {
    const out: ModelRef[] = [];
    for (const path of paths) {
      const uid = this.getIndex().notes.get(path)?.uid;
      if (uid) out.push(noteRef(uid));
    }
    return out;
  }

  private record(tx: Transaction, kind: string, refs: ModelRef[]): void {
    const id = "legacy-" + Date.now().toString(36) + "-" + (++this.sequence).toString(36);
    const change: SemanticChange = { kind, summary: tx.label, refs };
    const applied: AppliedEdit = {
      undo: async () => {
        for (const s of tx.files) {
          const current = await this.app.vault.read(this.file(s.path));
          if (current !== s.after) throw new Error(s.path + " changed after \"" + tx.label + "\".");
        }
        for (const s of tx.files) await this.app.vault.modify(this.file(s.path), s.before);
      },
      redo: async () => {
        for (const s of tx.files) {
          const current = await this.app.vault.read(this.file(s.path));
          if (current !== s.before) throw new Error(s.path + " changed after undoing \"" + tx.label + "\".");
        }
        for (const s of tx.files) await this.app.vault.modify(this.file(s.path), s.after);
      },
    };
    this.transactions.recordApplied(id, tx.label, "atomic", [change], applied);
  }
}

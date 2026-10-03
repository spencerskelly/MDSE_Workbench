/**
 * Obsidian adapter for the WB-114 semantic edit core.
 *
 * UI components call this service. It plans Local Model changes in pure core, verifies the file has
 * not changed since planning, applies through TransactionManager, and supplies guarded undo/redo.
 */
import { App, TFile } from "obsidian";
import { allocateLocalId, assertAuthorCode, tokenFromLocalId, type LocalIdentityKind } from "../core/identity";
import {
  planLocalRecordCreate,
  planLocalRecordPatch,
  type LocalRecordPatch,
  type NewLocalRecord,
  type PlannedLocalEdit,
} from "../core/localmodel-edit";
import { localRef, type LocalKind, type LocalModelIndex, type ModelRef } from "../core/localmodel";
import type { ModelIndex } from "../core/model";
import {
  TransactionManager,
  type AppliedEdit,
  type EditExecutor,
  type EditScope,
  type EditTransaction,
  type SemanticChange,
} from "../core/transaction";

export interface LocalCreateRequest {
  kind: LocalKind;
  heading: string;
  fields: Readonly<Record<string, string>>;
  connectionId?: string;
}

export interface LocalEditResult {
  transactionId: string;
  change: SemanticChange;
  plan: PlannedLocalEdit;
}

export class WorkbenchEditService {
  readonly transactions = new TransactionManager();
  private sequence = 0;

  constructor(
    private readonly app: App,
    private readonly getIndex: () => ModelIndex,
    private readonly getLocal: () => LocalModelIndex,
  ) {}

  get canUndo(): boolean {
    return this.transactions.canUndo;
  }

  get canRedo(): boolean {
    return this.transactions.canRedo;
  }

  history() {
    return this.transactions.history();
  }

  async undo(): Promise<string> {
    const entry=await this.transactions.undo();
    return "Undone: "+entry.label+".";
  }

  async redo(): Promise<string> {
    const entry=await this.transactions.redo();
    return "Redone: "+entry.label+".";
  }

  async patchLocal(path: string, localId: string, patch: LocalRecordPatch): Promise<LocalEditResult> {
    const file=this.file(path);
    const owner=this.ownerRef(path);
    const before=await this.app.vault.read(file);
    const plan=planLocalRecordPatch(before,localId,patch);
    if (!plan.changed) {
      return {
        transactionId:"",
        change:{kind:"local.noop",summary:"No Local Model change",refs:[localRef(owner.uid,plan.kind,localId)]},
        plan,
      };
    }
    const ref=localRef(owner.uid,plan.kind,localId);
    const change: SemanticChange={
      kind:"local.patch",
      summary:"Edit "+plan.kind+" "+localId,
      refs:[ref],
      metadata:{path,localId},
    };
    const transactionId=await this.applySingleFile(
      "Edit "+plan.kind+" "+localId,
      "atomic",
      path,
      before,
      plan.after,
      change,
    );
    return {transactionId,change,plan};
  }

  async createLocal(path: string, request: LocalCreateRequest, at=new Date()): Promise<LocalEditResult> {
    const file=this.file(path);
    const owner=this.ownerRef(path);
    const authorCode=await this.authorCode();
    const allocation=allocateLocalId(request.kind as LocalIdentityKind,at,authorCode,this.usedTokens());
    const before=await this.app.vault.read(file);
    const input: NewLocalRecord={
      kind:request.kind,
      localId:allocation.localId,
      heading:request.heading,
      fields:request.fields,
      connectionId:request.connectionId,
    };
    const plan=planLocalRecordCreate(before,input);
    const ref=localRef(owner.uid,request.kind,allocation.localId);
    const change: SemanticChange={
      kind:"local.create",
      summary:"Create "+request.kind+" "+request.heading,
      refs:[ref],
      metadata:{
        path,
        localId:allocation.localId,
        authorCode:allocation.authorCode,
        createdTimestamp:allocation.timestamp,
        collisionSteps:allocation.collisionSteps,
      },
    };
    const transactionId=await this.applySingleFile(
      "Create "+request.kind+" "+request.heading,
      "atomic",
      path,
      before,
      plan.after,
      change,
    );
    return {transactionId,change,plan};
  }

  private async applySingleFile(
    label: string,
    scope: EditScope,
    path: string,
    before: string,
    after: string,
    change: SemanticChange,
  ): Promise<string> {
    const id=this.transactionId();
    this.transactions.begin(id,label,scope);
    this.transactions.add(id,{id:id+"-op",label,changes:[change]});
    const executor: EditExecutor={
      apply: async (_transaction: Readonly<EditTransaction>): Promise<AppliedEdit> => {
        const file=this.file(path);
        const current=await this.app.vault.read(file);
        if (current!==before) throw new Error(path+" changed after the edit was planned. Reopen the editor and try again.");
        await this.app.vault.modify(file,after);
        return {
          undo: async () => {
            const now=await this.app.vault.read(this.file(path));
            if (now!==after) throw new Error(path+" changed after "+label+"; undo refused.");
            await this.app.vault.modify(this.file(path),before);
          },
          redo: async () => {
            const now=await this.app.vault.read(this.file(path));
            if (now!==before) throw new Error(path+" changed after undoing "+label+"; redo refused.");
            await this.app.vault.modify(this.file(path),after);
          },
        };
      },
    };
    await this.transactions.apply(id,executor);
    return id;
  }

  private ownerRef(path:string): {kind:"note";uid:string} {
    const uid=this.getIndex().notes.get(path)?.uid;
    if (!uid) throw new Error("The owner note has no uid, so Workbench cannot address Local Model edits safely.");
    return {kind:"note",uid};
  }

  private file(path:string): TFile {
    const f=this.app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) throw new Error(path+" no longer exists.");
    return f;
  }

  private async authorCode(): Promise<string> {
    const path=".obsidian/author-code.txt";
    if (!(await this.app.vault.adapter.exists(path))) {
      throw new Error("No registered author code was found. Complete MDSE Bootstrap author registration first.");
    }
    return assertAuthorCode((await this.app.vault.adapter.read(path)).trim());
  }

  private usedTokens(): Set<string> {
    const used=new Set<string>();
    for (const note of this.getIndex().notes.values()) if (note.uid) used.add(note.uid);
    for (const region of this.getLocal().regions.values()) {
      for (const record of region.records) {
        const token=tokenFromLocalId(record.localId);
        if (token) used.add(token);
      }
    }
    return used;
  }

  private transactionId(): string {
    this.sequence++;
    return "wb-"+Date.now().toString(36)+"-"+this.sequence.toString(36);
  }
}

export function modelRefLabel(ref:ModelRef): string {
  return ref.kind==="note" ? ref.uid : ref.localKind+" "+ref.localId;
}

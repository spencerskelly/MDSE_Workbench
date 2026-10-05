import { parseDocument, stringify } from "yaml";
import { linkTarget } from "./frontmatter";
import { noteRef, type ModelRef } from "./localmodel";
import { planDefinitionNoteMigration, type DefinitionNoteMigrationPlan } from "./definition-note-migrate";
import type { RelationshipDef } from "./schema";
import { TransactionManager, type EditTransaction } from "./transaction";

export interface DefinitionNoteMigrationStore {
  read(path: string): Promise<string>;
  write(path: string, text: string): Promise<void>;
}

export interface DefinitionNoteMigrationServiceRequest {
  ownerPath: string;
  ownerUid?: string;
  field: string;
  replacedPath: string;
  replacedUid?: string;
  replacementPath: string;
  replacementUid?: string;
  relationship: RelationshipDef;
}

export interface StagedDefinitionNoteMigration {
  transaction: EditTransaction;
  plan: DefinitionNoteMigrationPlan;
  affectedPaths: string[];
}

interface FileState { path: string; before: string; after: string }
interface PendingDefinitionNoteMigration {
  plan: DefinitionNoteMigrationPlan;
  label: string;
  files: FileState[];
}

function frontmatter(text: string): { doc: ReturnType<typeof parseDocument>; body: string } {
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
  if (!match) throw new Error("Model note must begin with YAML frontmatter.");
  return { doc: parseDocument(match[1]), body: text.slice(match[0].length) };
}

function list(value: unknown): unknown[] {
  if (value === undefined || value === null || value === "") return [];
  return Array.isArray(value) ? [...value] : [value];
}

function mutateRelationship(
  text: string,
  sourcePath: string,
  field: string,
  removePath: string | undefined,
  addPath: string | undefined,
  resolve: (target: string, fromPath: string) => string | null,
  linkText: (targetPath: string, fromPath: string) => string,
): string {
  const { doc, body } = frontmatter(text);
  const values = list(doc.get(field));
  const kept = removePath
    ? values.filter((value) => {
        const target = linkTarget(value);
        return !target || resolve(target, sourcePath) !== removePath;
      })
    : values;

  if (addPath) {
    const already = kept.some((value) => {
      const target = linkTarget(value);
      return !!target && resolve(target, sourcePath) === addPath;
    });
    if (!already) kept.push(`[[${linkText(addPath, sourcePath)}]]`);
  }

  const sorted = kept.sort((a, b) => String(a).localeCompare(String(b), undefined, { sensitivity: "base" }));
  doc.set(field, sorted);
  const yaml = stringify(doc.toJS()).trimEnd();
  return `---\n${yaml}\n---\n${body}`;
}

/**
 * Governed migration of one note-level relationship from a superseded definition.
 *
 * Source and paired/symmetric inverse mutations are staged from fresh source and applied as one
 * structural transaction. Every affected file is exact-content guarded at Apply and undo/redo.
 */
export class DefinitionNoteMigrationService {
  private sequence = 0;
  private readonly pending = new Map<string, PendingDefinitionNoteMigration>();

  constructor(
    private readonly store: DefinitionNoteMigrationStore,
    private readonly resolve: (target: string, fromPath: string) => string | null,
    private readonly linkText: (targetPath: string, fromPath: string) => string,
    private readonly currentTargets: (ownerPath: string, field: string) => string[],
    private readonly transactions: TransactionManager,
  ) {}

  async stage(request: DefinitionNoteMigrationServiceRequest): Promise<StagedDefinitionNoteMigration> {
    const plan = planDefinitionNoteMigration({
      ownerPath: request.ownerPath,
      field: request.field,
      replacedPath: request.replacedPath,
      replacementPath: request.replacementPath,
      relationship: request.relationship,
      currentTargets: this.currentTargets(request.ownerPath, request.field),
    });

    const beforeByPath = new Map<string,string>();
    const need = [request.ownerPath, ...plan.inverseMutations.map((mutation) => mutation.path)];
    for (const path of [...new Set(need)]) beforeByPath.set(path, await this.store.read(path));

    const afterByPath = new Map(beforeByPath);
    afterByPath.set(request.ownerPath, mutateRelationship(
      beforeByPath.get(request.ownerPath) as string,
      request.ownerPath,
      request.field,
      plan.sourceMutation.removeTarget,
      plan.sourceMutation.addTarget,
      this.resolve,
      this.linkText,
    ));
    for (const mutation of plan.inverseMutations) {
      const current = afterByPath.get(mutation.path) as string;
      afterByPath.set(mutation.path, mutateRelationship(
        current, mutation.path, mutation.field, mutation.removeTarget, mutation.addTarget, this.resolve, this.linkText,
      ));
    }

    const files=[...beforeByPath.entries()].map(([path,before])=>({path,before,after:afterByPath.get(path) as string}));
    const id=`definition-note-migrate-${Date.now().toString(36)}-${(++this.sequence).toString(36)}`;
    const label=`migrate ${request.ownerPath} ${request.field} to ${request.replacementPath}`;
    this.transactions.begin(id,label,"structural");
    const refs:ModelRef[]=[];
    if(request.ownerUid) refs.push(noteRef(request.ownerUid));
    if(request.replacedUid) refs.push(noteRef(request.replacedUid));
    if(request.replacementUid) refs.push(noteRef(request.replacementUid));
    const transaction=this.transactions.add(id,{
      id:id+"-relationship",label,changes:[{
        kind:"definition.note-migrate",summary:label,refs,
        metadata:{
          ownerPath:request.ownerPath,field:request.field,replacedPath:request.replacedPath,
          replacementPath:request.replacementPath,inverseField:plan.inverseField,affectedFiles:files.length,
        },
      }],
    });
    this.pending.set(id,{plan,label,files});
    return {transaction,plan,affectedPaths:files.map((file)=>file.path)};
  }

  async stageAndReview(request: DefinitionNoteMigrationServiceRequest): Promise<StagedDefinitionNoteMigration> {
    const staged=await this.stage(request);
    return this.review(staged.transaction.id);
  }

  review(transactionId:string):StagedDefinitionNoteMigration{
    const pending=this.requirePending(transactionId);
    return {transaction:this.transactions.review(transactionId),plan:pending.plan,affectedPaths:pending.files.map((file)=>file.path)};
  }

  async apply(transactionId:string):Promise<void>{
    const pending=this.requirePending(transactionId);
    await this.transactions.apply(transactionId,{
      apply:async()=>{
        for(const file of pending.files){
          const current=await this.store.read(file.path);
          if(current!==file.before) throw new Error(`${file.path} changed after Review.`);
        }
        const written:FileState[]=[];
        try{
          for(const file of pending.files){
            await this.store.write(file.path,file.after);
            written.push(file);
          }
        }catch(error){
          for(const file of written.reverse()) await this.store.write(file.path,file.before);
          throw error;
        }
        return {
          undo:async()=>{
            for(const file of pending.files){
              if(await this.store.read(file.path)!==file.after) throw new Error(`${file.path} changed after ${pending.label}.`);
            }
            for(const file of pending.files) await this.store.write(file.path,file.before);
          },
          redo:async()=>{
            for(const file of pending.files){
              if(await this.store.read(file.path)!==file.before) throw new Error(`${file.path} changed after undoing ${pending.label}.`);
            }
            for(const file of pending.files) await this.store.write(file.path,file.after);
          },
        };
      },
    });
    this.pending.delete(transactionId);
  }

  cancel(transactionId:string):EditTransaction{
    this.requirePending(transactionId);
    const cancelled=this.transactions.cancel(transactionId);
    this.pending.delete(transactionId);
    return cancelled;
  }

  private requirePending(transactionId:string):PendingDefinitionNoteMigration{
    const pending=this.pending.get(transactionId);
    if(!pending) throw new Error(`Definition note migration transaction ${transactionId} does not exist.`);
    return pending;
  }
}

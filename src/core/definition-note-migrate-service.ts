import { parseDocument } from "yaml";
import { linkTarget } from "./frontmatter";
import { noteRef, type ModelRef } from "./localmodel";
import { planDefinitionNoteMigration, type DefinitionNoteMigrationPlan } from "./definition-note-migrate";
import type { RelationshipDef } from "./schema";
import { TransactionManager, type EditTransaction } from "./transaction";

export interface DefinitionNoteMigrationStore {
  exists(path: string): Promise<boolean>;
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
  replacementUid?: string;
}

function frontmatter(text: string): { doc: ReturnType<typeof parseDocument>; yaml: string; body: string } {
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
  if (!match) throw new Error("Model note must begin with YAML frontmatter.");
  const yaml = match[1];
  const doc = parseDocument(yaml);
  if (doc.errors.length) throw new Error(`Model note frontmatter is invalid YAML: ${doc.errors[0]?.message ?? "parse error"}`);
  return { doc, yaml, body: text.slice(match[0].length) };
}

function list(value: unknown): unknown[] {
  if (value === undefined || value === null || value === "") return [];
  if (Array.isArray(value)) return [...value];

  // yaml Document#get() returns YAML collection nodes by default. Normalize those nodes to their
  // plain JS value before inspecting relationship lists; otherwise a YAMLSeq is mistaken for one
  // scalar string and fresh-source target resolution fails closed for every list relationship.
  if (typeof value === "object" && value !== null && "toJSON" in value) {
    const toJSON = (value as { toJSON?: () => unknown }).toJSON;
    if (typeof toJSON === "function") return list(toJSON.call(value));
  }
  return [value];
}

function fieldPairRange(
  doc: ReturnType<typeof parseDocument>,
  yaml: string,
  field: string,
): [number, number] | null {
  const contents = doc.contents as {
    items?: Array<{
      key?: { range?: [number, number, number?]; toJSON?: () => unknown };
    }>;
  } | null;
  const pair = contents?.items?.find((item) => {
    const key = item.key;
    if (!key) return false;
    const value = typeof key.toJSON === "function" ? key.toJSON() : undefined;
    return String(value ?? "") === field;
  });
  const keyRange = pair?.key?.range;
  if (!keyRange) return null;

  const start = yaml.lastIndexOf("\n", Math.max(0, keyRange[0] - 1)) + 1;
  let cursor = yaml.indexOf("\n", keyRange[1]);
  if (cursor < 0) return [start, yaml.length];
  cursor += 1;

  // A governed relationship is a top-level field. Its block value consists only of indented
  // continuation lines. Stop before the next top-level property or comment so unrelated source
  // text is preserved byte-for-byte.
  while (cursor < yaml.length) {
    const next = yaml.indexOf("\n", cursor);
    const end = next < 0 ? yaml.length : next;
    const line = yaml.slice(cursor, end);
    if (line.length > 0 && !/^\s/.test(line)) break;
    cursor = next < 0 ? yaml.length : next + 1;
  }
  return [start, cursor];
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
  const { doc, yaml, body } = frontmatter(text);
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
  const node = doc.get(field, true);
  let nextYaml: string;

  if (sorted.length === 0) {
    if (node === undefined || node === null) return text;
    const pairRange = fieldPairRange(doc, yaml, field);
    if (!pairRange) throw new Error(`Cannot safely remove empty ${field}; YAML property source range is unavailable.`);
    nextYaml = yaml.slice(0, pairRange[0]) + yaml.slice(pairRange[1]);
    if (nextYaml.endsWith("\n")) nextYaml = nextYaml.slice(0, -1);
  } else {
    const encoded = "\n" + sorted.map((value) => `  - ${JSON.stringify(String(value))}`).join("\n");
    if (node === undefined || node === null) {
      const addition = `${yaml.endsWith("\n") || yaml.length === 0 ? "" : "\n"}${field}:${encoded}`;
      nextYaml = yaml + addition;
    } else {
      const range = (node as { range?: [number, number, number?] }).range;
      if (!range) throw new Error(`Cannot safely update ${field}; YAML source range is unavailable.`);
      nextYaml = yaml.slice(0, range[0]) + encoded.trimStart() + yaml.slice(range[1]);
    }
  }
  return `---\n${nextYaml}\n---\n${body}`;
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
    private readonly transactions: TransactionManager,
  ) {}

  async stage(request: DefinitionNoteMigrationServiceRequest): Promise<StagedDefinitionNoteMigration> {
    if (!(await this.store.exists(request.ownerPath))) throw new Error(`${request.ownerPath} no longer exists.`);
    if (!(await this.store.exists(request.replacedPath))) throw new Error(`${request.replacedPath} no longer exists.`);
    if (!(await this.store.exists(request.replacementPath))) throw new Error(`${request.replacementPath} no longer exists.`);

    const ownerBefore = await this.store.read(request.ownerPath);
    const replacedBefore = request.replacedPath === request.ownerPath
      ? ownerBefore
      : await this.store.read(request.replacedPath);
    const replacementBefore = request.replacementPath === request.ownerPath
      ? ownerBefore
      : request.replacementPath === request.replacedPath
        ? replacedBefore
        : await this.store.read(request.replacementPath);

    const validateUid = (text: string, path: string, expected?: string): void => {
      if (!expected) return;
      const parsed = frontmatter(text);
      const storedUid = String(parsed.doc.get("uid") ?? "").trim();
      if (!storedUid || storedUid !== expected) {
        throw new Error(`Cannot stage relationship migration: expected ${path} uid ${expected}, found ${storedUid || "none"}.`);
      }
    };
    validateUid(ownerBefore, request.ownerPath, request.ownerUid);
    validateUid(replacedBefore, request.replacedPath, request.replacedUid);
    validateUid(replacementBefore, request.replacementPath, request.replacementUid);

    const parsedOwner = frontmatter(ownerBefore);
    const currentTargets = list(parsedOwner.doc.get(request.field))
      .map((value) => linkTarget(value))
      .filter((target): target is string => !!target)
      .map((target) => this.resolve(target, request.ownerPath))
      .filter((target): target is string => !!target);

    const plan = planDefinitionNoteMigration({
      ownerPath: request.ownerPath,
      field: request.field,
      replacedPath: request.replacedPath,
      replacementPath: request.replacementPath,
      relationship: request.relationship,
      currentTargets,
    });

    const beforeByPath = new Map<string,string>();
    beforeByPath.set(request.ownerPath, ownerBefore);
    const need = plan.inverseMutations.map((mutation) => mutation.path);
    for (const path of [...new Set(need)]) beforeByPath.set(path, await this.store.read(path));

    // Migration is not a repair operation. Every planned removal must still exist on fresh
    // source, and every planned addition must still be absent, otherwise stop and surface the
    // pre-existing relationship inconsistency instead of silently normalizing it.
    for (const mutation of plan.inverseMutations) {
      const text = beforeByPath.get(mutation.path) as string;
      const parsed = frontmatter(text);
      const targets = list(parsed.doc.get(mutation.field))
        .map((value) => linkTarget(value))
        .filter((target): target is string => !!target)
        .map((target) => this.resolve(target, mutation.path))
        .filter((target): target is string => !!target);
      if (mutation.removeTarget && !targets.includes(mutation.removeTarget)) {
        throw new Error(
          `Relationship integrity mismatch: ${mutation.path}.${mutation.field} does not point back to ${mutation.removeTarget}; migration will not repair it silently.`,
        );
      }
      if (mutation.addTarget && targets.includes(mutation.addTarget)) {
        throw new Error(
          `Relationship integrity mismatch: ${mutation.path}.${mutation.field} already points to ${mutation.addTarget}; migration will not create a duplicate.`,
        );
      }
    }

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
    this.pending.set(id,{plan,label,files,replacementUid:request.replacementUid});
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
        if (!(await this.store.exists(pending.plan.replacementPath))) {
          throw new Error(`${pending.plan.replacementPath} no longer exists; reopen supersession migration review.`);
        }
        if (pending.replacementUid) {
          const currentReplacement = await this.store.read(pending.plan.replacementPath);
          const parsedReplacement = frontmatter(currentReplacement);
          const currentUid = String(parsedReplacement.doc.get("uid") ?? "").trim();
          if (!currentUid || currentUid !== pending.replacementUid) {
            throw new Error(
              `${pending.plan.replacementPath} identity changed; expected uid ${pending.replacementUid}, found ${currentUid || "none"}. Reopen supersession migration review.`,
            );
          }
        }
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
            const reverted:FileState[]=[];
            try{
              for(const file of pending.files){
                await this.store.write(file.path,file.before);
                reverted.push(file);
              }
            }catch(error){
              for(const file of reverted.reverse()) await this.store.write(file.path,file.after);
              throw error;
            }
          },
          redo:async()=>{
            if (!(await this.store.exists(pending.plan.replacementPath))) {
              throw new Error(`${pending.plan.replacementPath} no longer exists; reopen supersession migration review.`);
            }
            if (pending.replacementUid) {
              const currentReplacement = await this.store.read(pending.plan.replacementPath);
              const parsedReplacement = frontmatter(currentReplacement);
              const currentUid = String(parsedReplacement.doc.get("uid") ?? "").trim();
              if (!currentUid || currentUid !== pending.replacementUid) {
                throw new Error(
                  `${pending.plan.replacementPath} identity changed; expected uid ${pending.replacementUid}, found ${currentUid || "none"}. Reopen supersession migration review.`,
                );
              }
            }
            for(const file of pending.files){
              if(await this.store.read(file.path)!==file.before) throw new Error(`${file.path} changed after undoing ${pending.label}.`);
            }
            const rewritten:FileState[]=[];
            try{
              for(const file of pending.files){
                await this.store.write(file.path,file.after);
                rewritten.push(file);
              }
            }catch(error){
              for(const file of rewritten.reverse()) await this.store.write(file.path,file.before);
              throw error;
            }
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

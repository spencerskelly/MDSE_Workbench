import { parseDocument } from "yaml";
import { noteRef } from "./localmodel";
import { planDefinitionRetirement, type DefinitionDeletionImpact, type DefinitionRetirementPlan } from "./definition-lifecycle";
import { TransactionManager, type EditTransaction } from "./transaction";

export interface DefinitionRetirementStore {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, text: string): Promise<void>;
}

export interface StagedDefinitionRetirement {
  transaction: EditTransaction;
  plan: DefinitionRetirementPlan;
  path: string;
  uid: string;
}

interface PendingDefinitionRetirement {
  path: string;
  uid: string;
  before: string;
  after: string;
  label: string;
  plan: DefinitionRetirementPlan;
  impactSignature: string;
}

function impactSignature(impact: DefinitionDeletionImpact): string {
  const note = impact.noteUses
    .map((use) => `${use.fromPath}|${use.field}`)
    .sort()
    .join("\n");
  const occurrence = impact.occurrenceUses
    .map((use) => `${use.ownerPath}|${use.kind}|${use.identifier}|${use.localId}`)
    .sort()
    .join("\n");
  return `${note}\n--\n${occurrence}`;
}

export function retireDefinitionText(text: string): { text: string; currentStatus: unknown } {
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
  if (!match) throw new Error("Definition note must begin with YAML frontmatter.");

  const yaml = match[1];
  const doc = parseDocument(yaml);
  if (doc.errors.length) throw new Error(`Definition frontmatter is invalid YAML: ${doc.errors[0]?.message ?? "parse error"}`);
  const currentStatus = doc.get("status");
  const node = doc.get("status", true);

  let nextYaml: string;
  if (node === undefined || node === null) {
    const addition = `${yaml.endsWith("\n") || yaml.length === 0 ? "" : "\n"}status: retired`;
    nextYaml = yaml + addition;
  } else {
    const range = (node as { range?: [number, number, number?] }).range;
    if (!range) throw new Error("Cannot safely update status; YAML source range is unavailable.");
    nextYaml = yaml.slice(0, range[0]) + "retired" + yaml.slice(range[1]);
  }

  const after = `---\n${nextYaml}\n---\n${text.slice(match[0].length)}`;
  return { text: after, currentStatus };
}

export class DefinitionRetirementService {
  private sequence = 0;
  private readonly pending = new Map<string, PendingDefinitionRetirement>();

  constructor(
    private readonly store: DefinitionRetirementStore,
    private readonly impactFor: (path: string) => Promise<DefinitionDeletionImpact>,
    private readonly transactions: TransactionManager,
  ) {}

  async stage(path: string, uid: string): Promise<StagedDefinitionRetirement> {
    if (!(await this.store.exists(path))) throw new Error(`${path} does not exist.`);
    const before = await this.store.read(path);
    const frontmatterMatch = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(before);
    if (!frontmatterMatch) throw new Error(`${path} must begin with YAML frontmatter.`);
    const doc = parseDocument(frontmatterMatch[1]);
    if (doc.errors.length) throw new Error(`${path} frontmatter is invalid YAML.`);
    const storedUid = String(doc.get("uid") ?? "").trim();
    if (!storedUid || storedUid !== uid) {
      throw new Error(`Cannot stage retirement of ${path}: expected uid ${uid}, found ${storedUid || "none"}.`);
    }
    const transformed = retireDefinitionText(before);
    const impact = await this.impactFor(path);
    const plan = planDefinitionRetirement(path, transformed.currentStatus, impact);

    const id = `definition-retire-${Date.now().toString(36)}-${(++this.sequence).toString(36)}`;
    const label = `retire definition ${path}`;
    this.transactions.begin(id, label, "structural");
    const transaction = this.transactions.add(id, {
      id: id + "-retire",
      label,
      changes: [{
        kind: "definition.retire",
        summary: label,
        refs: [noteRef(uid)],
        metadata: {
          path,
          fromStatus: plan.fromStatus,
          toStatus: plan.toStatus,
          noteUseCount: plan.noteUseCount,
          occurrenceUseCount: plan.occurrenceUseCount,
          preservesReferences: true,
        },
      }],
    });

    this.pending.set(id, {
      path,
      uid,
      before,
      after: transformed.text,
      label,
      plan,
      impactSignature: impactSignature(impact),
    });
    return { transaction, plan, path, uid };
  }

  async stageAndReview(path: string, uid: string): Promise<StagedDefinitionRetirement> {
    const staged = await this.stage(path, uid);
    return this.review(staged.transaction.id);
  }

  review(transactionId: string): StagedDefinitionRetirement {
    const pending = this.requirePending(transactionId);
    return {
      transaction: this.transactions.review(transactionId),
      plan: pending.plan,
      path: pending.path,
      uid: pending.uid,
    };
  }

  async apply(transactionId: string): Promise<void> {
    const pending = this.requirePending(transactionId);
    if (!pending.plan.changed) throw new Error(`${pending.path} is already retired.`);
    const latestImpact = await this.impactFor(pending.path);
    if (impactSignature(latestImpact) !== pending.impactSignature) {
      throw new Error("Dependent usage changed after Review. Reopen retirement review before Apply.");
    }
    if (!(await this.store.exists(pending.path))) throw new Error(`${pending.path} no longer exists.`);
    const current = await this.store.read(pending.path);
    if (current !== pending.before) throw new Error(`${pending.path} changed after Review.`);

    await this.transactions.apply(transactionId, {
      apply: async () => {
        const latestImpact = await this.impactFor(pending.path);
        if (impactSignature(latestImpact) !== pending.impactSignature) {
          throw new Error("Dependent usage changed after Review.");
        }
        if (!(await this.store.exists(pending.path))) throw new Error(`${pending.path} no longer exists.`);
        const latest = await this.store.read(pending.path);
        if (latest !== pending.before) throw new Error(`${pending.path} changed after Review.`);
        await this.store.write(pending.path, pending.after);
        return {
          undo: async () => {
            if (!(await this.store.exists(pending.path))) throw new Error(`${pending.path} no longer exists after retirement.`);
            const retired = await this.store.read(pending.path);
            if (retired !== pending.after) throw new Error(`${pending.path} changed after retirement.`);
            await this.store.write(pending.path, pending.before);
          },
          redo: async () => {
            const latestImpact = await this.impactFor(pending.path);
            if (impactSignature(latestImpact) !== pending.impactSignature) {
              throw new Error(`Cannot redo ${pending.label}: dependent usage changed after Review.`);
            }
            if (!(await this.store.exists(pending.path))) throw new Error(`${pending.path} no longer exists before retirement redo.`);
            const restored = await this.store.read(pending.path);
            if (restored !== pending.before) throw new Error(`${pending.path} changed after undoing retirement.`);
            await this.store.write(pending.path, pending.after);
          },
        };
      },
    });
    this.pending.delete(transactionId);
  }

  cancel(transactionId: string): EditTransaction {
    this.requirePending(transactionId);
    const cancelled = this.transactions.cancel(transactionId);
    this.pending.delete(transactionId);
    return cancelled;
  }

  private requirePending(transactionId: string): PendingDefinitionRetirement {
    const pending = this.pending.get(transactionId);
    if (!pending) throw new Error(`Definition retirement transaction ${transactionId} does not exist.`);
    return pending;
  }
}
